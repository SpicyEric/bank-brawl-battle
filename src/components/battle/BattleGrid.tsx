import { useState, useEffect, useRef, useMemo } from 'react';
import { Cell, GRID_SIZE, PLAYER_ROWS, UNIT_DEFS, UNIT_COLOR_GROUPS, Phase, ColorGroup, UnitType, Position } from '@/lib/battleGame';

const COLOR_DOT: Record<ColorGroup, string> = {
  red: 'bg-unit-red',
  blue: 'bg-unit-blue',
  green: 'bg-unit-green',
};

interface BattleGridProps {
  grid: Cell[][];
  phase: Phase;
  onCellClick: (row: number, col: number) => void;
  lastPlaced?: { row: number; col: number; type: UnitType } | null;
}

// Track where each unit was last frame
interface UnitPos { row: number; col: number }

export function BattleGrid({ grid, phase, onCellClick, lastPlaced }: BattleGridProps) {
  const isPlacing = phase === 'place_player';
  const [flashCells, setFlashCells] = useState<Set<string>>(new Set());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPositions = useRef<Map<string, UnitPos>>(new Map());
  const [slideOffsets, setSlideOffsets] = useState<Map<string, { dr: number; dc: number }>>(new Map());

  // Flash effect for attack pattern
  useEffect(() => {
    if (!lastPlaced) return;
    const def = UNIT_DEFS[lastPlaced.type];
    const cells = new Set<string>();
    for (const p of def.attackPattern) {
      const r = lastPlaced.row + p.row;
      const c = lastPlaced.col + p.col;
      if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
        cells.add(`${r}-${c}`);
      }
    }
    setFlashCells(cells);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashCells(new Set()), 800);
  }, [lastPlaced]);

  // Detect unit movements and compute slide offsets
  useEffect(() => {
    const newOffsets = new Map<string, { dr: number; dc: number }>();
    const currentPositions = new Map<string, UnitPos>();

    for (const row of grid) {
      for (const cell of row) {
        if (cell.unit && cell.unit.hp > 0) {
          const id = cell.unit.id;
          currentPositions.set(id, { row: cell.row, col: cell.col });
          const prev = prevPositions.current.get(id);
          if (prev && (prev.row !== cell.row || prev.col !== cell.col)) {
            // Unit moved: start offset = old pos - new pos (in cell units)
            newOffsets.set(id, { dr: prev.row - cell.row, dc: prev.col - cell.col });
          }
        }
      }
    }

    prevPositions.current = currentPositions;

    if (newOffsets.size > 0) {
      setSlideOffsets(newOffsets);
      // Clear offsets after a frame so CSS transition kicks in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setSlideOffsets(new Map());
        });
      });
    }
  }, [grid]);

  return (
    <div className="w-full aspect-square max-w-[min(100vw-2rem,28rem)] mx-auto">
      <div className="grid grid-cols-8 gap-[2px] w-full h-full bg-border rounded-xl overflow-hidden border border-border">
        {grid.flat().map((cell) => {
          const isPlayerZone = PLAYER_ROWS.includes(cell.row);
          const isEnemyZone = cell.row < 3;
          const unit = cell.unit;
          const def = unit ? UNIT_DEFS[unit.type] : null;
          const colorGroup = unit ? UNIT_COLOR_GROUPS[unit.type] : null;
          const hpPercent = unit ? (unit.hp / unit.maxHp) * 100 : 0;
          const isLow = unit ? unit.hp / unit.maxHp < 0.3 : false;
          const isFlashing = flashCells.has(`${cell.row}-${cell.col}`);

          // Slide offset for this unit
          const offset = unit ? slideOffsets.get(unit.id) : null;
          const slideStyle = offset
            ? { transform: `translate(${offset.dc * 100}%, ${offset.dr * 100}%)` }
            : undefined;

          return (
            <button
              key={`${cell.row}-${cell.col}`}
              onClick={() => onCellClick(cell.row, cell.col)}
              className={`aspect-square flex flex-col items-center justify-center relative transition-all duration-200 overflow-visible
                ${isPlayerZone && isPlacing ? 'bg-primary/5 hover:bg-primary/15' : ''}
                ${isEnemyZone ? 'bg-danger/5' : ''}
                ${!isPlayerZone && !isEnemyZone ? 'bg-card' : ''}
                ${isPlayerZone && isPlacing && !unit ? 'cursor-pointer' : ''}
                ${unit ? '' : 'bg-card'}
                ${isFlashing ? 'flash-attack' : ''}
              `}
            >
              {unit && (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center z-10"
                  style={{
                    ...slideStyle,
                    transition: offset ? 'none' : 'transform 350ms ease-out',
                  }}
                >
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
                  {colorGroup && (
                    <div className={`absolute top-0.5 left-0.5 w-2 h-2 rounded-full ${COLOR_DOT[colorGroup]}`} />
                  )}
                  <div className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${
                    unit.team === 'player' ? 'bg-success' : 'bg-danger'
                  }`} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
