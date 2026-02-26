import { useEffect, useRef, useState } from 'react';
import { useBattleGame } from '@/hooks/useBattleGame';
import { BattleGrid } from '@/components/battle/BattleGrid';
import { UnitPicker } from '@/components/battle/UnitPicker';
import { BattleLog } from '@/components/battle/BattleLog';
import { UnitInfoModal } from '@/components/battle/UnitInfoModal';
import { POINTS_TO_WIN, UnitType } from '@/lib/battleGame';

// Scoreboard dots
function ScoreDots({ score, max, color }: { score: number; max: number; color: 'success' | 'danger' }) {
  return (
    <div className="flex flex-col-reverse gap-[3px] items-center">
      {Array.from({ length: max }, (_, i) => (
        <div
          key={i}
          className={`w-2 h-2 rounded-full transition-all duration-300 ${
            i < score
              ? color === 'success' ? 'bg-success shadow-[0_0_4px_hsl(var(--success))]' : 'bg-danger shadow-[0_0_4px_hsl(var(--danger))]'
              : 'bg-muted/40'
          }`}
        />
      ))}
    </div>
  );
}

const Index = () => {
  const game = useBattleGame();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [inspectUnit, setInspectUnit] = useState<UnitType | null>(null);
  const [lastPlaced, setLastPlaced] = useState<{ row: number; col: number; type: UnitType } | null>(null);
  const [phaseOverlay, setPhaseOverlay] = useState<string | null>(null);
  const [overlaySubtext, setOverlaySubtext] = useState<string | null>(null);
  const prevPhase = useRef(game.phase);

  useEffect(() => {
    const audio = new Audio('/music/background.mp3');
    audio.loop = true;
    audio.volume = 0.15;
    audioRef.current = audio;
    const playOnInteraction = () => {
      audio.play().catch(() => {});
      document.removeEventListener('click', playOnInteraction);
    };
    document.addEventListener('click', playOnInteraction);
    return () => {
      audio.pause();
      document.removeEventListener('click', playOnInteraction);
    };
  }, []);

  // Phase overlay trigger
  useEffect(() => {
    if (game.phase === prevPhase.current) return;
    prevPhase.current = game.phase;

    let text: string | null = null;
    let sub: string | null = null;

    if (game.phase === 'place_player' && game.playerStarts) {
      text = 'Platziere!';
      if (game.playerMaxUnits > 5) sub = `+${game.playerMaxUnits - 5} Comeback-Bonus`;
    } else if (game.phase === 'place_player' && !game.playerStarts) {
      text = 'Konter!';
      if (game.playerMaxUnits > 5) sub = `+${game.playerMaxUnits - 5} Comeback-Bonus`;
    } else if (game.phase === 'place_enemy') {
      text = 'Bereit?';
    } else if (game.phase === 'battle') {
      text = 'Kampf!';
    } else if (game.phase === 'round_won') {
      text = '🏆 Gewonnen!';
    } else if (game.phase === 'round_lost') {
      text = '💀 Verloren!';
    }

    if (text) {
      setPhaseOverlay(text);
      setOverlaySubtext(sub);
      setTimeout(() => {
        setPhaseOverlay(null);
        setOverlaySubtext(null);
      }, 1400);
    }
  }, [game.phase, game.playerStarts, game.playerMaxUnits]);

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-md mx-auto">
      {/* Header - just logo */}
      <header className="px-4 pt-3 pb-1 flex items-center justify-center">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚔️</span>
          <span className="font-bold text-sm text-foreground tracking-tight">GridBattle</span>
        </div>
      </header>

      {/* Scoreboard */}
      <div className="mx-4 mb-2 py-3 px-4 rounded-xl bg-card border border-border">
        <div className="flex items-center justify-between">
          {/* Player side */}
          <div className="flex items-center gap-3">
            <ScoreDots score={game.playerScore} max={POINTS_TO_WIN} color="success" />
            <div className="text-center">
              <p className="text-2xl font-bold font-mono text-success leading-none">{game.playerScore}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5 uppercase tracking-wider">Du</p>
            </div>
          </div>

          {/* Center - Round */}
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Runde</p>
            <p className="text-xl font-bold font-mono text-foreground leading-none mt-0.5">{game.roundNumber}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5">/ {POINTS_TO_WIN}</p>
          </div>

          {/* Enemy side */}
          <div className="flex items-center gap-3">
            <div className="text-center">
              <p className="text-2xl font-bold font-mono text-danger leading-none">{game.enemyScore}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5 uppercase tracking-wider">Gegner</p>
            </div>
            <ScoreDots score={game.enemyScore} max={POINTS_TO_WIN} color="danger" />
          </div>
        </div>
      </div>

      {/* Grid with overlay */}
      <div className="px-4 relative">
        <BattleGrid
          grid={game.grid}
          phase={game.phase}
          onCellClick={(row, col) => {
            if (game.phase === 'place_player') {
              const unit = game.grid[row][col].unit;
              if (unit && unit.team === 'player') {
                game.removeUnit(unit.id);
                setLastPlaced(null);
                return;
              }
              if (game.selectedUnit) {
                game.placeUnit(row, col);
                setLastPlaced({ row, col, type: game.selectedUnit });
              }
              return;
            }
            const unit = game.grid[row][col].unit;
            if (unit) {
              setInspectUnit(unit.type);
            }
          }}
          lastPlaced={lastPlaced}
          battleEvents={game.battleEvents}
        />

        {/* Phase overlay text */}
        {phaseOverlay && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-30 pointer-events-none phase-overlay-fade">
            <p className="text-4xl font-black text-foreground drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] tracking-tight">
              {phaseOverlay}
            </p>
            {overlaySubtext && (
              <p className="text-sm font-semibold text-primary mt-1 drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)]">
                {overlaySubtext}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="px-4 mt-3 flex-1">
        {game.phase === 'place_player' && (
          <div className="space-y-3">
            <UnitPicker
              selected={game.selectedUnit}
              onSelect={game.setSelectedUnit}
              placedCount={game.playerUnits.length}
              maxUnits={game.playerMaxUnits}
            />
            <button
              onClick={game.confirmPlacement}
              disabled={game.playerUnits.length === 0}
              className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ✅ Aufstellung bestätigen ({game.playerUnits.length}/{game.playerMaxUnits})
            </button>
          </div>
        )}

        {game.phase === 'place_enemy' && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">
              Beide Seiten stehen – bereit zum Kampf?
            </p>
            <button
              onClick={game.startBattle}
              className="w-full py-3.5 rounded-xl bg-warning text-warning-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all"
            >
              ⚔️ Kampf starten!
            </button>
          </div>
        )}

        {game.phase === 'battle' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Kampflog</p>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-success">👤 {game.playerUnits.length}</span>
                <span className="text-muted-foreground">vs</span>
                <span className="text-danger">💀 {game.enemyUnits.length}</span>
              </div>
            </div>
            <BattleLog logs={game.battleLog} />
          </div>
        )}

        {(game.phase === 'round_won' || game.phase === 'round_lost') && (
          <div className="text-center space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Stand: <span className="text-success font-bold">{game.playerScore}</span> : <span className="text-danger font-bold">{game.enemyScore}</span>
            </p>
            <p className="text-[11px] text-muted-foreground">
              Nächste Runde: {!game.playerStarts ? 'Du platzierst zuerst' : 'Gegner platziert zuerst'}
            </p>
            {game.gameOver ? (
              <div className="space-y-3">
                <p className="text-xl font-bold text-foreground">
                  {game.gameWon ? '🎉 SPIEL GEWONNEN!' : '😢 SPIEL VERLOREN!'}
                </p>
                <button
                  onClick={game.resetGame}
                  className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all"
                >
                  🔄 Neues Spiel
                </button>
              </div>
            ) : (
              <button
                onClick={game.nextRound}
                className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all"
              >
                ➡️ Nächste Runde ({game.roundNumber + 1})
              </button>
            )}
          </div>
        )}
      </div>

      {inspectUnit && (
        <UnitInfoModal unitType={inspectUnit} onClose={() => setInspectUnit(null)} />
      )}

      <div className="h-6" />
    </div>
  );
};

export default Index;
