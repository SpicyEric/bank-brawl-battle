import { useEffect, useRef, useState } from 'react';
import { useBattleGame } from '@/hooks/useBattleGame';
import { BattleGrid } from '@/components/battle/BattleGrid';
import { UnitPicker } from '@/components/battle/UnitPicker';
import { BattleLog } from '@/components/battle/BattleLog';
import { UnitInfoModal } from '@/components/battle/UnitInfoModal';
import { POINTS_TO_WIN, UnitType } from '@/lib/battleGame';

const Index = () => {
  const game = useBattleGame();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [inspectUnit, setInspectUnit] = useState<UnitType | null>(null);

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

  const placingBlind = game.phase === 'place_player' && game.playerStarts;
  const placingReactive = game.phase === 'place_player' && !game.playerStarts;

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-md mx-auto">
      {/* Header */}
      <header className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚔️</span>
          <span className="font-bold text-sm text-foreground tracking-tight">GridBattle</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="font-mono text-muted-foreground">R{game.roundNumber}</span>
          <div className="flex items-center gap-1.5 font-mono">
            <span className="text-success font-bold">{game.playerScore}</span>
            <span className="text-muted-foreground">:</span>
            <span className="text-danger font-bold">{game.enemyScore}</span>
          </div>
          <span className="text-[10px] text-muted-foreground">/ {POINTS_TO_WIN}</span>
        </div>
      </header>


      {/* Phase banner */}
      <div className={`mx-4 mb-2 py-2 px-3 rounded-lg text-center text-xs font-semibold ${
        game.phase === 'place_player' ? 'bg-primary/10 text-primary border border-primary/20' :
        game.phase === 'place_enemy' ? 'bg-warning/10 text-warning border border-warning/20' :
        game.phase === 'battle' ? 'bg-warning/10 text-warning border border-warning/20' :
        game.phase === 'round_won' ? 'bg-success/10 text-success border border-success/20' :
        'bg-danger/10 text-danger border border-danger/20'
      }`}>
        {placingBlind && '📍 Platziere blind – Gegner sieht dich danach!'}
        {placingReactive && '👁️ Gegner hat aufgestellt – reagiere mit deiner Aufstellung!'}
        {game.phase === 'place_enemy' && '⚔️ Beide Seiten stehen – bereit zum Kampf?'}
        {game.phase === 'battle' && `⚔️ Kampf läuft... Zug ${game.turnCount}`}
        {game.phase === 'round_won' && '🏆 Runde gewonnen!'}
        {game.phase === 'round_lost' && '💀 Runde verloren!'}
      </div>

      {/* Grid */}
      <div className="px-4">
        <BattleGrid
          grid={game.grid}
          phase={game.phase}
          onCellClick={(row, col) => {
            if (game.phase === 'place_player') {
              const unit = game.grid[row][col].unit;
              if (unit && unit.team === 'player') {
                game.removeUnit(unit.id);
              } else {
                game.placeUnit(row, col);
              }
            }
            const unit = game.grid[row][col].unit;
            if (unit) {
              setInspectUnit(unit.type);
            }
          }}
        />
      </div>

      {/* Controls */}
      <div className="px-4 mt-3 flex-1">
        {game.phase === 'place_player' && (
          <div className="space-y-3">
            <UnitPicker
              selected={game.selectedUnit}
              onSelect={game.setSelectedUnit}
              placedCount={game.playerUnits.length}
            />
            <button
              onClick={game.confirmPlacement}
              disabled={game.playerUnits.length === 0}
              className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ✅ Aufstellung bestätigen ({game.playerUnits.length} Einheiten)
            </button>
          </div>
        )}

        {game.phase === 'place_enemy' && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">
              {game.playerStarts
                ? <>Der Gegner hat <span className="text-danger font-bold">{game.enemyUnits.length}</span> Einheiten als Konter aufgestellt.</>
                : <>Deine Aufstellung steht! Bereit zum Kampf?</>
              }
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
            <div className="text-5xl">{game.phase === 'round_won' ? '🏆' : '💀'}</div>
            <p className="text-lg font-bold text-foreground">
              {game.phase === 'round_won' ? 'Runde gewonnen!' : 'Runde verloren!'}
            </p>
            <p className="text-sm text-muted-foreground">
              Stand: <span className="text-success font-bold">{game.playerScore}</span> : <span className="text-danger font-bold">{game.enemyScore}</span>
            </p>
            <p className="text-[11px] text-muted-foreground">
              Nächste Runde: {!game.playerStarts ? 'Du platzierst zuerst (blind)' : 'Gegner platziert zuerst'}
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