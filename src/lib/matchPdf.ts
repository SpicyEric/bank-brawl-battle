import jsPDF from 'jspdf';
import type { MatchData, RoundRecord, RecordedEvent } from './matchRecorder';

interface DbRow {
  id: string;
  created_at: string;
  mode?: string;
  difficulty?: number | null;
  winner?: string | null;
  player1_label?: string | null;
  player2_label?: string | null;
  client_id?: string | null;
  data?: MatchData;
}

function fmt(d?: string) { return d ? new Date(d).toLocaleString('de-DE') : '-'; }
function winnerLabel(w?: string | null, p1?: string, p2?: string) {
  if (w === 'player1') return `🏆 ${p1 ?? 'Spieler 1'}`;
  if (w === 'player2') return `🏆 ${p2 ?? 'Spieler 2'}`;
  if (w === 'draw') return '🤝 Unentschieden';
  return '–';
}

export function generateMatchesPdf(rows: DbRow[]): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 36;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };
  const line = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number] } = {}) => {
    const size = opts.size ?? 9;
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    if (opts.color) doc.setTextColor(...opts.color); else doc.setTextColor(0, 0, 0);
    const wrapped = doc.splitTextToSize(text, pageW - 2 * margin);
    for (const ln of wrapped) {
      ensureSpace(size + 2);
      doc.text(ln, margin, y);
      y += size + 2;
    }
  };

  // Title page
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('Match-Auswertung', margin, y); y += 28;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Erstellt: ${new Date().toLocaleString('de-DE')}`, margin, y); y += 14;
  doc.text(`Matches insgesamt: ${rows.length}`, margin, y); y += 14;

  // Summary stats
  const sp = rows.filter(r => r.mode === 'singleplayer').length;
  const mp = rows.filter(r => r.mode === 'multiplayer').length;
  const wins = rows.filter(r => r.winner === 'player1').length;
  const losses = rows.filter(r => r.winner === 'player2').length;
  const draws = rows.filter(r => r.winner === 'draw').length;
  doc.text(`Einzelspieler: ${sp}  •  Multiplayer: ${mp}`, margin, y); y += 14;
  doc.text(`Spieler-1-Siege: ${wins}  •  Spieler-2-Siege: ${losses}  •  Unentschieden: ${draws}`, margin, y); y += 20;

  // Coord notation legend
  line('Notation: Spalten A–H (links → rechts), Reihen 1–8 (oben → unten).', { size: 9 });
  y += 8;

  rows.forEach((row, idx) => {
    const d = row.data;
    ensureSpace(60);
    doc.setDrawColor(180); doc.line(margin, y, pageW - margin, y); y += 10;
    line(`Match #${idx + 1}  •  ${fmt(row.created_at)}`, { size: 12, bold: true });
    line(
      `Modus: ${row.mode === 'singleplayer' ? `Einzelspieler (KI Schwierigkeit ${row.difficulty ?? '?'})` : 'Multiplayer'}  •  Sieger: ${winnerLabel(row.winner, row.player1_label ?? undefined, row.player2_label ?? undefined)}`,
      { size: 9 },
    );
    line(`${row.player1_label ?? 'Spieler 1'}  vs  ${row.player2_label ?? 'Spieler 2'}`, { size: 9 });
    if (d?.finalScore) line(`Endstand: ${d.finalScore.player1} : ${d.finalScore.player2}`, { size: 9 });
    if (!d) { line('(Keine Detail-Daten gespeichert.)', { size: 8, color: [120,120,120] }); return; }

    // Roster
    const rosterLine = (label: string, r?: { slot: number; type: string; color: string }[]) => {
      if (!r) return;
      const txt = r.map(e => `${e.slot+1}.${e.type}(${e.color[0].toUpperCase()})`).join('  ');
      line(`${label}: ${txt}`, { size: 8 });
    };
    rosterLine('Trupp ' + (row.player1_label ?? 'P1'), d.player1Roster);
    rosterLine('Trupp ' + (row.player2_label ?? 'P2'), d.player2Roster);

    // Rounds
    d.rounds.forEach(r => writeRound(line, r));
    y += 6;
  });

  return doc.output('blob');
}

function writeRound(
  line: (text: string, opts?: { size?: number; bold?: boolean; color?: [number, number, number] }) => void,
  r: RoundRecord,
) {
  line(`— Runde ${r.round} —`, { size: 10, bold: true });
  // Placements
  const p1 = r.placements.filter(p => p.team === 'player1').map(p => `${p.type}@${p.coord}${p.color ? '('+p.color[0].toUpperCase()+')' : ''}`).join(', ');
  const p2 = r.placements.filter(p => p.team === 'player2').map(p => `${p.type}@${p.coord}${p.color ? '('+p.color[0].toUpperCase()+')' : ''}`).join(', ');
  line(`P1: ${p1 || '–'}`, { size: 8 });
  line(`P2: ${p2 || '–'}`, { size: 8 });

  // Events (compact, grouped by tick)
  const byTick = new Map<number, RecordedEvent[]>();
  for (const e of r.events) {
    if (!byTick.has(e.tick)) byTick.set(e.tick, []);
    byTick.get(e.tick)!.push(e);
  }
  const ticks = [...byTick.keys()].sort((a,b) => a-b);
  for (const t of ticks) {
    const evts = byTick.get(t)!;
    const parts = evts.map(e => formatEvent(e));
    line(`t${t}: ${parts.join(' | ')}`, { size: 7, color: [60,60,60] });
  }
  if (r.result) line(`→ Stand: ${r.result.player1Score} : ${r.result.player2Score}`, { size: 8, bold: true });
}

function formatEvent(e: RecordedEvent): string {
  const a = `${e.attackerType ?? '?'}${e.attackerCoord ? '@'+e.attackerCoord : ''}`;
  const tg = `${e.targetType ?? '?'}${e.targetCoord ? '@'+e.targetCoord : ''}`;
  const tag = (e.attackerTeam === 'player1' ? '[P1]' : e.attackerTeam === 'player2' ? '[P2]' : '');
  switch (e.type) {
    case 'kill': return `${tag}${a} 💀 ${tg} (-${e.damage ?? 0})`;
    case 'hit': {
      const mod = e.isStrong ? '⚔️+' : e.isWeak ? '⚔️-' : '⚔️';
      const rng = e.isRanged ? '🏹' : '';
      const aoe = e.isAoe ? '💥' : '';
      const frz = e.isFrozen ? '❄️' : '';
      return `${tag}${a} ${mod}${rng}${aoe} ${tg} -${e.damage ?? 0}${frz}`;
    }
    case 'heal': return `${tag}${a} +${e.heal ?? 0}❤ ${tg}`;
    case 'freeze': return `${tag}${a} ❄️ ${tg}`;
    case 'web': return `${tag}${a} 🕸 ${tg}`;
    case 'chain': return `${tag}${a} ⚡ ${tg} -${e.damage ?? 0}`;
    case 'spawn': return `${tag}${a} ✨spawn ${tg}`;
    default: return `${tag}${e.type} ${a}→${tg}`;
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
