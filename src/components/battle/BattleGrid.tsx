import { Cell, GRID_SIZE, PLAYER_ROWS, UNIT_DEFS, Phase } from '@/lib/battleGame';

interface BattleGridProps {
  grid: Cell[][];
  phase: Phase;
  onCellClick: (row: number, col: number) => void;
}

export function BattleGrid({ grid, phase, onCellClick }: BattleGridProps) {
  const isPlacing = phase === 'place_player';

  return (
    <div className="w-full aspect-square max-w-[min(100vw-2rem,28rem)] mx-auto">
      <div className="grid grid-cols-8 gap-[2px] w-full h-full bg-border rounded-xl overflow-hidden border border-border">
        {grid.flat().map((cell) => {
          const isPlayerZone = PLAYER_ROWS.includes(cell.row);
          const isEnemyZone = cell.row < 3;
          const unit = cell.unit;
          const def = unit ? UNIT_DEFS[unit.type] : null;
          const hpPercent = unit ? (unit.hp / unit.maxHp) * 100 : 0;
          const isLow = unit ? unit.hp / unit.maxHp < 0.3 : false;

          return (
            <button
              key={`${cell.row}-${cell.col}`}
              onClick={() => onCellClick(cell.row, cell.col)}
              className={`aspect-square flex flex-col items-center justify-center relative transition-all duration-200
                ${isPlayerZone && isPlacing ? 'bg-primary/5 hover:bg-primary/15' : ''}
                ${isEnemyZone ? 'bg-danger/5' : ''}
                ${!isPlayerZone && !isEnemyZone ? 'bg-card' : ''}
                ${isPlayerZone && isPlacing && !unit ? 'cursor-pointer' : ''}
                ${unit ? '' : 'bg-card'}
              `}
            >
              {unit && (
                <>
                  <span className={`text-base sm:text-lg leading-none ${unit.hp <= 0 ? 'opacity-30' : ''}`}>
                    {def?.emoji}
                  </span>
                  <div className="absolute bottom-0.5 left-0.5 right-0.5 h-[3px] rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isLow ? 'bg-danger' : unit.team === 'player' ? 'bg-success' : 'bg-danger'
                      }`}
                      style={{ width: `${hpPercent}%` }}
                    />
                  </div>
                  <div className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${
                    unit.team === 'player' ? 'bg-success' : 'bg-danger'
                  }`} />
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
