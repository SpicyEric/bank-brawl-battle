import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Lock } from 'lucide-react';
import { UNIT_TYPES, UNIT_DEFS, UnitType } from '@/lib/battleGame';
import { UnitGlyph } from '@/components/UnitGlyph';
import { getRoomById, subscribeToRoom, updateRoom } from '@/lib/multiplayer';
import { toast } from 'sonner';
import { sfxSlotSpin, stopSlotSpin, sfxSlotKlonk, sfxSlotFanfare, sfxConfirm } from '@/lib/sfx';

const ROSTER_SIZE = 9;
const MAX_HANDICAP = 3;
const COLUMN_LABELS = ['Links', 'Mitte', 'Rechts'];

function shuffle<T>(arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Pick 9 unique units from the pool. If pool < 9, allow duplicates as filler.
function drawRoster(): UnitType[] {
  const pool = shuffle(UNIT_TYPES);
  const out = pool.slice(0, ROSTER_SIZE);
  while (out.length < ROSTER_SIZE) out.push(pool[out.length % pool.length]);
  return out;
}

type Status = 'idle' | 'spinning' | 'stopping' | 'stopped';

// Grid index → column (0=left,1=middle,2=right) and row (0..2)
// Layout: row-major. idx 0,1,2 = top row; 3,4,5 = middle row; 6,7,8 = bottom row.
// Column of idx = idx % 3.
const colOf = (i: number) => i % 3;
const indicesOfColumn = (col: number) => [col, col + 3, col + 6];

export default function UnitRoster() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mpMode = searchParams.get('mode') === 'multi';
  const roomId = searchParams.get('room') || '';
  const role = (searchParams.get('role') as 'player1' | 'player2' | null);
  const isHost = role === 'player1';

  // 9-slot display state. During spinning shows random flickering units.
  const [display, setDisplay] = useState<(UnitType | null)[]>(Array(ROSTER_SIZE).fill(null));
  // Final roster (locked-in units once a column stops).
  const finalRef = useRef<(UnitType | null)[]>(Array(ROSTER_SIZE).fill(null));
  const [, forceRender] = useState(0);
  const bump = () => forceRender(x => x + 1);

  const [status, setStatus] = useState<Status>('idle');
  // Which column to stop next on tap (0,1,2).
  const stopColRef = useRef(0);
  const spinIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The 9 units pre-drawn for the current spin (deterministic per spin).
  const drawnRef = useRef<UnitType[]>([]);

  const [handicap, setHandicap] = useState(0);

  // MP state
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [opponentReady, setOpponentReady] = useState(false);
  const hasNavigatedRef = useRef(false);

  // ─── Spinner control ────────────────────────────────────────
  const startSpinning = useCallback(() => {
    finalRef.current = Array(ROSTER_SIZE).fill(null);
    drawnRef.current = drawRoster();
    setDisplay(Array(ROSTER_SIZE).fill(null));
    stopColRef.current = 0;
    setStatus('spinning');
    sfxSlotSpin();
    // Flicker random unit icons across all 9 slots
    spinIntervalRef.current = setInterval(() => {
      setDisplay(prev => prev.map((_, i) => {
        if (finalRef.current[i]) return finalRef.current[i];
        return UNIT_TYPES[Math.floor(Math.random() * UNIT_TYPES.length)];
      }));
    }, 70);
  }, []);

  const stopAllSpin = useCallback(() => {
    if (spinIntervalRef.current) { clearInterval(spinIntervalRef.current); spinIntervalRef.current = null; }
    stopSlotSpin();
  }, []);

  // Stop a column: snap its 3 slots one by one to the pre-drawn final values.
  const stopColumn = useCallback((col: number) => {
    const indices = indicesOfColumn(col);
    indices.forEach((idx, k) => {
      setTimeout(() => {
        finalRef.current[idx] = drawnRef.current[idx];
        setDisplay(prev => prev.map((v, i) => (i === idx ? drawnRef.current[idx] : v)));
        sfxSlotKlonk();
        // After last column's last slot snaps: fanfare + transition to stopped
        if (col === 2 && k === indices.length - 1) {
          stopAllSpin();
          setStatus('stopped');
          sfxSlotFanfare();
        }
      }, k * 130);
    });
  }, [stopAllSpin]);

  const handleMainButton = useCallback(() => {
    if (status === 'idle') {
      startSpinning();
      return;
    }
    if (status === 'spinning') {
      const col = stopColRef.current;
      stopColumn(col);
      stopColRef.current = col + 1;
      if (col === 2) {
        setStatus('stopping'); // disables further taps until fanfare flips to 'stopped'
      }
    }
  }, [status, startSpinning, stopColumn]);

  const handleReroll = useCallback(() => {
    if (handicap >= MAX_HANDICAP) return;
    setHandicap(h => h + 1);
    startSpinning();
  }, [handicap, startSpinning]);

  // Cleanup
  useEffect(() => () => { stopAllSpin(); }, [stopAllSpin]);

  // ─── MP: subscribe & navigate ───────────────────────────────
  useEffect(() => {
    if (!mpMode || !roomId || !role) return;
    let disposed = false;

    const handleRoom = (room: any) => {
      if (disposed || !room || hasNavigatedRef.current) return;
      const myReady = isHost ? room.player1_roster_ready : room.player2_roster_ready;
      const oppReady = isHost ? room.player2_roster_ready : room.player1_roster_ready;
      if (myReady) setSubmitted(true);
      setOpponentReady(!!oppReady);

      if (room.player1_roster_ready && room.player2_roster_ready
          && room.player1_roster && room.player2_roster) {
        hasNavigatedRef.current = true;
        navigate(`/game?mode=multi&room=${roomId}&role=${role}`);
      }
    };

    const unsub = subscribeToRoom(roomId, handleRoom);
    const pollId = window.setInterval(async () => {
      try { handleRoom(await getRoomById(roomId)); } catch {}
    }, 1500);
    (async () => { try { handleRoom(await getRoomById(roomId)); } catch {} })();

    return () => { disposed = true; unsub(); window.clearInterval(pollId); };
  }, [mpMode, roomId, role, isHost, navigate]);

  // ─── Confirm ────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (status !== 'stopped') return;
    const roster = finalRef.current as UnitType[];
    if (roster.some(r => !r)) return;
    sfxConfirm();
    if (!mpMode) {
      navigate(`/game?roster=${roster.join(',')}&handicap=${handicap}`);
      return;
    }
    if (submitted || submitting) return;
    setSubmitting(true);
    try {
      const rosterField = isHost ? 'player1_roster' : 'player2_roster';
      const readyField = isHost ? 'player1_roster_ready' : 'player2_roster_ready';
      const handicapField = isHost ? 'player1_handicap' : 'player2_handicap';
      await updateRoom(roomId, {
        [rosterField]: roster,
        [readyField]: true,
        [handicapField]: handicap,
      });
      setSubmitted(true);
    } catch (e: any) {
      toast.error('Bereit senden fehlgeschlagen: ' + e.message);
      setSubmitting(false);
    }
  };

  // Lock-icon overlay on the last `handicap` slots after stop (they are sperrt im Match).
  const slotIsLocked = (idx: number) => status === 'stopped' && handicap > 0 && idx >= ROSTER_SIZE - handicap;

  const showButton = status === 'idle' || status === 'spinning' || status === 'stopping';
  const stopMode = status === 'spinning' || status === 'stopping';

  return (
    <div className="min-h-[100dvh] max-h-[100dvh] bg-background flex flex-col max-w-md mx-auto overflow-hidden" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <button onClick={() => navigate(mpMode ? '/multiplayer' : '/singleplayer')} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent">
          <ArrowLeft size={18} />
        </button>
        <h1 className="font-bold text-foreground text-sm flex-1">
          {mpMode ? `Trupp aufstellen ${isHost ? '(Host)' : '(Gast)'}` : 'Stelle deinen Trupp auf'}
        </h1>
      </div>

      {/* Handicap dots */}
      <div className="px-3 pt-2 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Handicap</span>
        <div className="flex gap-1.5">
          {Array.from({ length: MAX_HANDICAP }).map((_, i) => (
            <div
              key={i}
              className={`w-2.5 h-2.5 rounded-full transition-all ${
                i < handicap
                  ? 'bg-danger shadow-[0_0_6px_hsl(var(--danger))]'
                  : 'bg-muted/40 border border-border'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Column labels */}
      <div className="px-3 pt-3">
        <div className="grid grid-cols-3 gap-2 mb-1.5">
          {COLUMN_LABELS.map(l => (
            <div key={l} className="text-center text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{l}</div>
          ))}
        </div>

        {/* 3×3 slot grid */}
        <div className="grid grid-cols-3 gap-2">
          {display.map((t, idx) => {
            const def = t ? UNIT_DEFS[t] : null;
            const locked = slotIsLocked(idx);
            const isFinal = !!finalRef.current[idx];
            const isFlickering = status === 'spinning' && !isFinal;
            return (
              <div
                key={idx}
                className={`aspect-square rounded-xl border-2 flex flex-col items-center justify-center transition-all relative overflow-hidden ${
                  locked
                    ? 'border-danger/60 bg-danger/10'
                    : isFinal
                    ? 'border-primary/60 bg-primary/10 shadow-[0_0_10px_hsl(var(--primary)/0.3)]'
                    : isFlickering
                    ? 'border-warning/50 bg-warning/5'
                    : 'border-border bg-card/60'
                }`}
              >
                {def ? (
                  <div className={`flex flex-col items-center ${isFlickering ? 'animate-pulse' : ''}`}>
                    <UnitGlyph type={t!} className="w-10 h-10" />
                    {isFinal && (
                      <>
                        <span className="text-[9px] font-semibold text-foreground mt-0.5 leading-none">{def.label}</span>
                        <span className="text-[8px] text-muted-foreground">❤️{def.hp}</span>
                      </>
                    )}
                  </div>
                ) : (
                  <span className="text-2xl font-black text-muted-foreground/40">?</span>
                )}
                {locked && (
                  <div className="absolute top-1 right-1 bg-danger/90 rounded-full p-0.5">
                    <Lock size={10} className="text-danger-foreground" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1" />

      {/* Buttons */}
      <div className="p-3 border-t border-border">
        {mpMode && submitted ? (
          <div className="w-full py-3 rounded-xl bg-card border border-border text-center">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="animate-spin" size={16} />
              {opponentReady ? 'Starte Kampf…' : 'Warte auf Gegner…'}
            </div>
          </div>
        ) : showButton ? (
          <button
            onClick={handleMainButton}
            disabled={status === 'stopping'}
            className={`w-full py-4 rounded-xl font-extrabold text-base active:scale-[0.97] transition-all disabled:opacity-50 ${
              stopMode
                ? 'bg-danger text-danger-foreground shadow-[0_0_18px_hsl(var(--danger)/0.5)]'
                : 'bg-primary text-primary-foreground shadow-[0_0_18px_hsl(var(--primary)/0.5)]'
            }`}
          >
            {stopMode ? '⏹ Stopp!' : '🎰 Drehen!'}
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleReroll}
              disabled={handicap >= MAX_HANDICAP}
              className="py-3 rounded-xl bg-secondary text-secondary-foreground font-bold text-xs active:scale-[0.97] transition-all disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center justify-center leading-tight"
            >
              <span>🔄 Neu drehen</span>
              <span className="text-[10px] opacity-80">+1 Handicap {handicap >= MAX_HANDICAP ? '(max)' : ''}</span>
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="py-3 rounded-xl bg-success text-success-foreground font-bold text-sm active:scale-[0.97] transition-all disabled:opacity-50"
            >
              {submitting ? 'Sende…' : '✅ Bestätigen'}
            </button>
          </div>
        )}
        {mpMode && !submitted && status === 'stopped' && opponentReady && (
          <p className="text-[11px] text-center text-success mt-2">Gegner ist bereit – wartet auf dich.</p>
        )}
      </div>
    </div>
  );
}
