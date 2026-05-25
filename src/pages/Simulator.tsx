import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Download, Loader2, Zap } from 'lucide-react';
import { runSimulation, rankUnits, flattenMatchups, flattenSynergies, reportToCsv, type SimReport, type TeamMode } from '@/lib/headlessSim';
import { UNIT_DEFS, UNIT_TYPES } from '@/lib/battleGame';
import { toast } from 'sonner';
import menuBg from '@/assets/menu-bg.png';

const PRESET_SIZES = [100, 500, 2000, 10000];

const Simulator = () => {
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [report, setReport] = useState<SimReport | null>(null);
  const [count, setCount] = useState(500);
  const [teamSize, setTeamSize] = useState(5);
  const [mode, setMode] = useState<TeamMode>('random');

  const run = async () => {
    if (running) return;
    setRunning(true);
    setReport(null);
    setProgress(0);
    setTotal(count);
    try {
      const r = await runSimulation(count, {
        teamSize,
        mode,
        onProgress: (done, all) => { setProgress(done); setTotal(all); },
      });
      setReport(r);
      toast.success(`${r.battles} Matches simuliert in ${(r.durationMs / 1000).toFixed(1)}s`);
    } catch (e) {
      console.error(e);
      toast.error('Simulation fehlgeschlagen.');
    } finally {
      setRunning(false);
    }
  };

  const exportCsv = () => {
    if (!report) return;
    const csv = reportToCsv(report);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    a.download = `simulation-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const ranked = report ? rankUnits(report) : [];
  const topMatchups = report ? flattenMatchups(report, 10).sort((a, b) => b.winRate - a.winRate).slice(0, 12) : [];
  const worstMatchups = report ? flattenMatchups(report, 10).sort((a, b) => a.winRate - b.winRate).slice(0, 12) : [];
  const topSynergies = report ? flattenSynergies(report, 10).sort((a, b) => b.winRate - a.winRate).slice(0, 12) : [];

  const flagColor = (f: string) => f === 'OP' ? 'text-danger' : f === 'STRONG' ? 'text-warning' : f === 'BALANCED' ? 'text-foreground' : f === 'WEAK' ? 'text-muted-foreground' : 'text-muted-foreground/60';

  return (
    <div className="min-h-[100dvh] relative" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <img src={menuBg} alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />

      <div className="relative z-10 max-w-2xl mx-auto px-4 py-6">
        <button onClick={() => navigate('/singleplayer')} className="mb-4 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <ArrowLeft size={20} />
        </button>

        <header className="mb-5">
          <h1 className="text-2xl font-black text-foreground flex items-center gap-2">
            <Zap className="text-primary" size={22} /> Simulator
          </h1>
          <p className="text-xs text-muted-foreground mt-1">Headless Match-Simulator mit allen Effekten – für Balance-Analysen.</p>
        </header>

        {/* Config */}
        <div className="bg-card/80 backdrop-blur-sm border border-border rounded-xl p-4 space-y-4 mb-4">
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Anzahl Matches</label>
            <div className="flex gap-2 mt-2 flex-wrap">
              {PRESET_SIZES.map(n => (
                <button key={n} onClick={() => setCount(n)} disabled={running}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${count === n ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-accent'}`}>
                  {n.toLocaleString()}
                </button>
              ))}
              <input type="number" value={count} min={10} max={100000} step={10}
                onChange={e => setCount(Math.max(10, Math.min(100000, parseInt(e.target.value) || 100)))}
                disabled={running}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-secondary text-secondary-foreground w-24" />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Team-Größe</label>
            <div className="flex gap-2 mt-2">
              {[3, 5, 7, 9].map(n => (
                <button key={n} onClick={() => setTeamSize(n)} disabled={running}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${teamSize === n ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-accent'}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Modus</label>
            <div className="flex gap-2 mt-2">
              {(['random'] as TeamMode[]).map(m => (
                <button key={m} onClick={() => setMode(m)} disabled={running}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold capitalize ${mode === m ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
                  Zufall vs. Zufall
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Zu Beginn der Simulation zieht jeder Spieler einen festen {9}er-Roster aus 9 <b>unterschiedlichen</b> Einheiten (unterschiedlich pro Spieler). Pro Match werden dann zufällig {teamSize} Einheiten <b>mit Wiederholung</b> aus diesem Roster auf zufällige Positionen platziert – so kommen auch Mono-Teams (z.B. 5× Bogenschütze) ganz natürlich vor.</p>
          </div>

          <button onClick={run} disabled={running}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:opacity-90 active:scale-[0.97] transition-all flex items-center justify-center gap-2 disabled:opacity-60 shadow-[0_0_20px_hsl(var(--primary)/0.3)]">
            {running ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
            {running ? `Simuliere ${progress.toLocaleString()} / ${total.toLocaleString()}` : 'Simulation starten'}
          </button>
          {running && (
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${(progress / Math.max(1, total)) * 100}%` }} />
            </div>
          )}
        </div>

        {/* Results */}
        {report && (
          <div className="space-y-4">
            <div className="bg-card/80 backdrop-blur-sm border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-foreground">Einheiten-Ranking</h2>
                <button onClick={exportCsv} className="text-xs px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground hover:bg-accent flex items-center gap-1.5">
                  <Download size={14} /> CSV
                </button>
              </div>
              <div className="text-[11px] text-muted-foreground mb-2">
                {report.battles.toLocaleString()} Matches · Ø {(report.ticksTotal / report.battles).toFixed(1)} Ticks · {report.draws} Unentschieden · {(report.durationMs / 1000).toFixed(1)}s
              </div>
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                {ranked.map(r => (
                  <div key={r.type} className="flex items-center gap-2 text-xs bg-secondary/40 rounded-lg px-2 py-1.5">
                    <span className="text-lg w-7 text-center">{r.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-foreground truncate">{r.label}</div>
                      <div className="text-[10px] text-muted-foreground">
                        DMG {r.avgDamageDealt.toFixed(0)} · TAKEN {r.avgDamageTaken.toFixed(0)} · K/D {r.kdr.toFixed(2)} · ❤️ {(r.avgSurvivedHp * 100).toFixed(0)}%
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-foreground tabular-nums">{r.winRate.toFixed(1)}%</div>
                      <div className={`text-[10px] font-bold ${flagColor(r.opFlag)}`}>{r.opFlag}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="bg-card/80 backdrop-blur-sm border border-border rounded-xl p-4">
                <h3 className="font-bold text-foreground mb-2 text-sm">🔥 Krasseste Konter (Team-vs-Team Winrate)</h3>
                <div className="space-y-1 text-xs">
                  {topMatchups.map((m, i) => (
                    <div key={i} className="flex justify-between bg-secondary/40 px-2 py-1 rounded">
                      <span>{UNIT_DEFS[m.a].emoji} {UNIT_DEFS[m.a].label} vs {UNIT_DEFS[m.b].emoji} {UNIT_DEFS[m.b].label}</span>
                      <span className="font-bold text-danger tabular-nums">{m.winRate.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-card/80 backdrop-blur-sm border border-border rounded-xl p-4">
                <h3 className="font-bold text-foreground mb-2 text-sm">🥶 Stärkste Schwächen</h3>
                <div className="space-y-1 text-xs">
                  {worstMatchups.map((m, i) => (
                    <div key={i} className="flex justify-between bg-secondary/40 px-2 py-1 rounded">
                      <span>{UNIT_DEFS[m.a].emoji} {UNIT_DEFS[m.a].label} vs {UNIT_DEFS[m.b].emoji} {UNIT_DEFS[m.b].label}</span>
                      <span className="font-bold text-muted-foreground tabular-nums">{m.winRate.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-card/80 backdrop-blur-sm border border-border rounded-xl p-4">
                <h3 className="font-bold text-foreground mb-2 text-sm">✨ Top-Synergien (gleiches Team)</h3>
                <div className="space-y-1 text-xs">
                  {topSynergies.map((s, i) => (
                    <div key={i} className="flex justify-between bg-secondary/40 px-2 py-1 rounded">
                      <span>{UNIT_DEFS[s.a].emoji} {UNIT_DEFS[s.a].label} + {UNIT_DEFS[s.b].emoji} {UNIT_DEFS[s.b].label}</span>
                      <span className="font-bold text-success tabular-nums">{s.winRate.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Simulator;
