import { useEffect, useRef, useState } from 'react';
import { useBattleGame } from '@/hooks/useBattleGame';
import { BattleGrid } from '@/components/battle/BattleGrid';
import { UnitPicker } from '@/components/battle/UnitPicker';
import { BattleLog } from '@/components/battle/BattleLog';
import { UnitInfoModal } from '@/components/battle/UnitInfoModal';
import { POINTS_TO_WIN, UnitType, ROUND_TIME_LIMIT } from '@/lib/battleGame';
import { Settings, RotateCcw, Home, VolumeX, Volume2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Horizontal score dots
function ScoreDots({ score, max, color }: { score: number; max: number; color: 'success' | 'danger' }) {
  return (
    <div className="flex gap-[3px] items-center">
      {Array.from({ length: max }, (_, i) => (
        <div
          key={i}
          className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
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
  const trackIndexRef = useRef(0);
  const tracks = ['/music/background.mp3', '/music/stoischer-ringkampf.mp3'];
  const [inspectUnit, setInspectUnit] = useState<UnitType | null>(null);
  const [lastPlaced, setLastPlaced] = useState<{ row: number; col: number; type: UnitType } | null>(null);
  const [muted, setMuted] = useState(false);
  const [phaseOverlay, setPhaseOverlay] = useState<string | null>(null);
  const [overlaySubtext, setOverlaySubtext] = useState<string | null>(null);
  const prevPhase = useRef(game.phase);

  useEffect(() => {
    const playTrack = (index: number) => {
      const audio = new Audio(tracks[index]);
      audio.volume = 0.15;
      audio.loop = false;
      if (muted) audio.muted = true;
      audioRef.current = audio;
      audio.addEventListener('ended', () => {
        trackIndexRef.current = (trackIndexRef.current + 1) % tracks.length;
        playTrack(trackIndexRef.current);
      });
      audio.play().catch(() => {});
    };

    const startOnInteraction = () => {
      playTrack(trackIndexRef.current);
      document.removeEventListener('click', startOnInteraction);
    };
    document.addEventListener('click', startOnInteraction);
    return () => {
      if (audioRef.current) audioRef.current.pause();
      document.removeEventListener('click', startOnInteraction);
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
    } else if (game.phase === 'round_draw') {
      text = '⚖️ Gleichstand!';
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
    <div className="min-h-[100dvh] max-h-[100dvh] bg-background flex flex-col max-w-md mx-auto overflow-hidden">
      {/* Slim scoreboard bar */}
      <div className="mx-3 mt-2 mb-1.5 py-1.5 px-3 rounded-lg bg-card border border-border flex items-center justify-between">
        {/* Player */}
        <div className="flex items-center gap-2">
          <p className="text-base font-bold font-mono text-success leading-none">{game.playerScore}</p>
          <ScoreDots score={game.playerScore} max={POINTS_TO_WIN} color="success" />
        </div>

        {/* Round */}
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
          Runde <span className="text-foreground font-bold">{game.roundNumber}</span>
        </p>

        {/* Enemy */}
        <div className="flex items-center gap-2">
          <ScoreDots score={game.enemyScore} max={POINTS_TO_WIN} color="danger" />
          <p className="text-base font-bold font-mono text-danger leading-none">{game.enemyScore}</p>
        </div>

        {/* Settings gear */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <Settings size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuItem onClick={() => {
              setMuted(m => {
                const next = !m;
                if (audioRef.current) audioRef.current.muted = next;
                return next;
              });
            }}>
              {muted ? <Volume2 className="mr-2 h-4 w-4" /> : <VolumeX className="mr-2 h-4 w-4" />}
              {muted ? 'Ton an' : 'Ton aus'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={game.resetGame}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Spiel neustarten
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <Home className="mr-2 h-4 w-4" />
              Hauptmenü
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
              disabled={game.playerUnits.length < game.playerMaxUnits}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ✅ Bereit
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
              <div className="flex items-center gap-3 text-[11px]">
                <span className={`font-mono font-bold ${game.battleTimer <= 10 ? 'text-danger animate-pulse' : 'text-muted-foreground'}`}>
                  ⏱ {game.battleTimer}s
                </span>
                <span className="text-success">👤 {game.playerUnits.length}</span>
                <span className="text-muted-foreground">vs</span>
                <span className="text-danger">💀 {game.enemyUnits.length}</span>
              </div>
            </div>
            <BattleLog logs={game.battleLog} />
          </div>
        )}

        {(game.phase === 'round_won' || game.phase === 'round_lost' || game.phase === 'round_draw') && (
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
