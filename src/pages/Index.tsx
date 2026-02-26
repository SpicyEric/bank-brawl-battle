import { useEffect, useRef } from 'react';
import { useBattleGame } from '@/hooks/useBattleGame';
import { BattleGrid } from '@/components/battle/BattleGrid';
import { UnitPicker } from '@/components/battle/UnitPicker';
import { BattleLog } from '@/components/battle/BattleLog';
import { UNIT_DEFS } from '@/lib/battleGame';

const Index = () => {
  const game = useBattleGame();
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-md mx-auto">
      {/* Header */}
      <header className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚔️</span>
          <span className="font-bold text-sm text-foreground tracking-tight">GridBattle</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {game.phase === 'battle' && (
            <span className="text-muted-foreground font-mono">Runde {game.turnCount}</span>
          )}
          <div className="flex items-center gap-2">
            <span className="text-success text-[11px]">👤 {game.playerUnits.length}</span>
            <span className="text-muted-foreground">vs</span>
            <span className="text-danger text-[11px]">💀 {game.enemyUnits.length}</span>
          </div>
        </div>
      </header>

      {/* Phase banner */}
      <div className={`mx-4 mb-2 py-2 px-3 rounded-lg text-center text-xs font-semibold ${
        game.phase === 'place' ? 'bg-primary/10 text-primary border border-primary/20' :
        game.phase === 'battle' ? 'bg-warning/10 text-warning border border-warning/20' :
        game.phase === 'won' ? 'bg-success/10 text-success border border-success/20' :
        'bg-danger/10 text-danger border border-danger/20'
      }`}>
        {game.phase === 'place' && '📍 Platziere deine Einheiten auf den unteren 3 Reihen'}
        {game.phase === 'battle' && '⚔️ Kampf läuft...'}
        {game.phase === 'won' && '🏆 Sieg! Alle Feinde besiegt!'}
        {game.phase === 'lost' && '💀 Niederlage! Alle Einheiten gefallen.'}
      </div>

      {/* Grid */}
      <div className="px-4">
        <BattleGrid
          grid={game.grid}
          phase={game.phase}
          onCellClick={(row, col) => {
            if (game.phase === 'place') {
              const unit = game.grid[row][col].unit;
              if (unit && unit.team === 'player') {
                game.removeUnit(unit.id);
              } else {
                game.placeUnit(row, col);
              }
            }
          }}
        />
      </div>

      {/* Controls */}
      <div className="px-4 mt-3 flex-1">
        {game.phase === 'place' && (
          <div className="space-y-3">
            <UnitPicker
              selected={game.selectedUnit}
              onSelect={game.setSelectedUnit}
              placedCount={game.playerUnits.length}
            />
            <button
              onClick={game.startBattle}
              disabled={game.playerUnits.length === 0}
              className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ⚔️ Kampf starten ({game.playerUnits.length} Einheiten)
            </button>
          </div>
        )}

        {game.phase === 'battle' && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Kampflog</p>
            <BattleLog logs={game.battleLog} />
          </div>
        )}

        {(game.phase === 'won' || game.phase === 'lost') && (
          <div className="text-center space-y-4 py-4">
            <div className="text-5xl">{game.phase === 'won' ? '🏆' : '💀'}</div>
            <p className="text-lg font-bold text-foreground">
              {game.phase === 'won' ? 'Sieg!' : 'Niederlage!'}
            </p>
            <p className="text-sm text-muted-foreground">
              {game.turnCount} Runden gespielt
            </p>
            <button
              onClick={game.resetGame}
              className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all"
            >
              🔄 Neues Spiel
            </button>
          </div>
        )}
      </div>

      <div className="h-6" />
    </div>
  );
};

export default Index;
