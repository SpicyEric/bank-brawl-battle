import { useState, useEffect, useRef } from 'react';
import { Cell, GRID_SIZE, PLAYER_ROWS, UNIT_DEFS, Phase, UnitType } from '@/lib/battleGame';
import { BattleEvent } from '@/lib/battleEvents';

interface BattleGridProps {
  grid: Cell[][];
  phase: Phase;
  onCellClick: (row: number, col: number) => void;
  lastPlaced?: { row: number; col: number; type: UnitType } | null;
  battleEvents?: BattleEvent[];
}

interface UnitPos { row: number; col: number }
interface DamagePopup { id: string; row: number; col: number; damage: number; isStrong: boolean; isWeak: boolean; isKill: boolean }
interface Projectile { id: string; fromRow: number; fromCol: number; toRow: number; toCol: number; emoji: string }

export function BattleGrid({ grid, phase, onCellClick, lastPlaced, battleEvents = [] }: BattleGridProps) {
  const isPlacing = phase === 'place_player';
  const [flashCells, setFlashCells] = useState<Set<string>>(new Set());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPositions = useRef<Map<string, UnitPos>>(new Map());
  const [slideOffsets, setSlideOffsets] = useState<Map<string, { dr: number; dc: number }>>(new Map());
  const [shakeCells, setShakeCells] = useState<Set<string>>(new Set());
  const [popups, setPopups] = useState<DamagePopup[]>([]);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const popupCounter = useRef(0);
  const projCounter = useRef(0);

  // Flash effect for attack pattern on placement
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

  // Detect unit movements
  useEffect(() => {
    const newOffsets = new Map<string, { dr: number; dc: number }>();
    const currentPositions = new Map<string, UnitPos>();
    for (const row of grid) {
      for (const cell of row) {
        if (cell.unit && cell.unit.hp > 0 && !cell.unit.dead) {
          const id = cell.unit.id;
          currentPositions.set(id, { row: cell.row, col: cell.col });
          const prev = prevPositions.current.get(id);
          if (prev && (prev.row !== cell.row || prev.col !== cell.col)) {
            newOffsets.set(id, { dr: prev.row - cell.row, dc: prev.col - cell.col });
          }
        }
      }
    }
    prevPositions.current = currentPositions;
    if (newOffsets.size > 0) {
      setSlideOffsets(newOffsets);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setSlideOffsets(new Map()));
      });
    }
  }, [grid]);

  // Handle battle events: shake + damage popups + projectiles
  useEffect(() => {
    if (battleEvents.length === 0) return;
    const newShake = new Set<string>();
    const newPopups: DamagePopup[] = [];
    const newProjs: Projectile[] = [];

    for (const evt of battleEvents) {
      const key = `${evt.targetRow}-${evt.targetCol}`;
      newShake.add(key);
      popupCounter.current += 1;
      newPopups.push({
        id: `pop-${popupCounter.current}`,
        row: evt.targetRow, col: evt.targetCol,
        damage: evt.damage, isStrong: evt.isStrong, isWeak: evt.isWeak,
        isKill: evt.type === 'kill',
      });

      if (evt.isRanged) {
        projCounter.current += 1;
        newProjs.push({
          id: `proj-${projCounter.current}`,
          fromRow: evt.attackerRow, fromCol: evt.attackerCol,
          toRow: evt.targetRow, toCol: evt.targetCol,
          emoji: evt.attackerEmoji === '🏹' ? '➴' : evt.attackerEmoji === '🔮' ? '✦' : '⚡',
        });
      }
    }

    setShakeCells(newShake);
    setPopups(prev => [...prev, ...newPopups]);
    setProjectiles(prev => [...prev, ...newProjs]);

    setTimeout(() => setShakeCells(new Set()), 400);
    setTimeout(() => {
      setPopups(prev => prev.filter(p => !newPopups.find(np => np.id === p.id)));
    }, 700);
    setTimeout(() => {
      setProjectiles(prev => prev.filter(p => !newProjs.find(np => np.id === p.id)));
    }, 450);
  }, [battleEvents]);

  const cellSize = 100 / GRID_SIZE;

  return (
    <div className="w-full aspect-square max-w-[min(100vw-2rem,28rem)] mx-auto relative">
      <div className="grid grid-cols-8 gap-[2px] w-full h-full bg-border rounded-xl overflow-hidden border border-border">
        {grid.flat().map((cell) => {
          const isPlayerZone = PLAYER_ROWS.includes(cell.row);
          const isEnemyZone = cell.row < 3;
          const unit = cell.unit;
          const def = unit ? UNIT_DEFS[unit.type] : null;
          const hpPercent = unit && !unit.dead ? (unit.hp / unit.maxHp) * 100 : 0;
          const isLow = unit && !unit.dead ? unit.hp / unit.maxHp < 0.3 : false;
          const isFlashing = flashCells.has(`${cell.row}-${cell.col}`);
          const isShaking = shakeCells.has(`${cell.row}-${cell.col}`);
          const isDead = unit?.dead;
          const cellKey = `${cell.row}-${cell.col}`;

          // Slide offset
          const offset = unit && !isDead ? slideOffsets.get(unit.id) : null;
          const slideStyle = offset
            ? { transform: `translate(${offset.dc * 100}%, ${offset.dr * 100}%)` }
            : undefined;

          return (
            <button
              key={cellKey}
              onClick={() => onCellClick(cell.row, cell.col)}
              className={`aspect-square flex flex-col items-center justify-center relative overflow-visible
                ${isPlayerZone && isPlacing && !unit ? 'bg-primary/5 hover:bg-primary/15 cursor-pointer' : ''}
                ${isEnemyZone && !unit ? 'bg-danger/5' : ''}
                ${!unit ? 'bg-card' : ''}
                ${isDead ? 'bg-muted/40' : ''}
                ${isFlashing ? 'flash-attack' : ''}
                ${isShaking ? 'shake-hit' : ''}
                transition-colors duration-200
              `}
            >
              {isDead && (
                <span className="text-sm opacity-40 select-none">💀</span>
              )}
              {unit && !isDead && (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center z-10"
                  style={{
                    ...slideStyle,
                    transition: offset ? 'none' : 'transform 350ms ease-out',
                  }}
                >
                  <span
                    className="text-base sm:text-lg leading-none select-none"
                    style={{
                      filter: unit.team === 'player'
                        ? 'drop-shadow(0 0 4px hsl(152, 60%, 48%)) drop-shadow(0 0 8px hsl(152, 60%, 48%))'
                        : 'drop-shadow(0 0 4px hsl(0, 72%, 55%)) drop-shadow(0 0 8px hsl(0, 72%, 55%))',
                    }}
                  >
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
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Projectile animations */}
      {projectiles.map(p => {
        const fromX = p.fromCol * cellSize + cellSize / 2;
        const fromY = p.fromRow * cellSize + cellSize / 2;
        const toX = p.toCol * cellSize + cellSize / 2;
        const toY = p.toRow * cellSize + cellSize / 2;
        return (
          <div
            key={p.id}
            className="absolute pointer-events-none z-30 projectile-fly"
            style={{
              '--from-x': `${fromX}%`,
              '--from-y': `${fromY}%`,
              '--to-x': `${toX}%`,
              '--to-y': `${toY}%`,
            } as React.CSSProperties}
          >
            <span className="text-xs drop-shadow-lg">{p.emoji}</span>
          </div>
        );
      })}

      {/* Damage popups overlay */}
      {popups.map(p => {
        const left = p.col * cellSize + cellSize / 2;
        const top = p.row * cellSize + cellSize / 4;
        return (
          <div
            key={p.id}
            className="absolute pointer-events-none z-20 dmg-popup"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <span className={`text-xs font-bold font-mono drop-shadow-lg ${
              p.isKill ? 'text-warning text-sm' :
              p.isStrong ? 'text-success' :
              p.isWeak ? 'text-muted-foreground' :
              'text-danger'
            }`}>
              {p.isKill ? '☠️' : ''}-{p.damage}{p.isStrong ? '!' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
