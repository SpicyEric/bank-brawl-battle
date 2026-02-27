import { useState, useEffect, useRef } from 'react';
import { Cell, GRID_SIZE, PLAYER_ROWS, UNIT_DEFS, UNIT_COLOR_GROUPS, Phase, ColorGroup, UnitType, TERRAIN_DEFS } from '@/lib/battleGame';
import { BattleEvent } from '@/lib/battleEvents';

interface BattleGridProps {
  grid: Cell[][];
  phase: Phase;
  onCellClick: (row: number, col: number) => void;
  lastPlaced?: { row: number; col: number; type: UnitType } | null;
  battleEvents?: BattleEvent[];
  moraleBoostActive?: 'buff' | 'debuff' | null;
  opponentMoraleActive?: 'buff' | 'debuff' | null;
  focusFireActive?: boolean;
  sacrificeFlash?: boolean;
  /** Always show color dots on units regardless of phase */
  alwaysShowColorDots?: boolean;
  /** Always show zone colors (player=blue, enemy=red) regardless of phase */
  showZoneColors?: boolean;
}

interface UnitPos { row: number; col: number }
interface DamagePopup { id: string; row: number; col: number; damage: number; isStrong: boolean; isWeak: boolean; isKill: boolean }
interface HealPopup { id: string; row: number; col: number; healAmount: number }
interface Projectile { id: string; fromRow: number; fromCol: number; toRow: number; toCol: number; emoji: string; type?: 'arrow' | 'magic' | 'frost' | 'default' }
interface DragonFire { id: string; cells: { row: number; col: number }[] }
interface HealGlow { id: string; row: number; col: number }
interface FreezeEffect { id: string; row: number; col: number }

export function BattleGrid({ grid, phase, onCellClick, lastPlaced, battleEvents = [], moraleBoostActive, opponentMoraleActive, focusFireActive, sacrificeFlash, alwaysShowColorDots, showZoneColors }: BattleGridProps) {
  const isPlacing = phase === 'place_player';
  const [flashCells, setFlashCells] = useState<Set<string>>(new Set());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPositions = useRef<Map<string, UnitPos>>(new Map());
  const [slideOffsets, setSlideOffsets] = useState<Map<string, { dr: number; dc: number }>>(new Map());
  const [shakeCells, setShakeCells] = useState<Set<string>>(new Set());
  const [popups, setPopups] = useState<DamagePopup[]>([]);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const [dragonFires, setDragonFires] = useState<DragonFire[]>([]);
  const [healGlows, setHealGlows] = useState<HealGlow[]>([]);
  const [healPopups, setHealPopups] = useState<HealPopup[]>([]);
  const [freezeEffects, setFreezeEffects] = useState<FreezeEffect[]>([]);
  const popupCounter = useRef(0);
  const projCounter = useRef(0);
  const dragonFireCounter = useRef(0);
  const healCounter = useRef(0);
  const freezeCounter = useRef(0);
  const [warCryFlash, setWarCryFlash] = useState(false);
  const [focusFlashAnim, setFocusFlashAnim] = useState(false);
  const [sacrificeAnim, setSacrificeAnim] = useState(false);
  const prevMorale = useRef<'buff' | 'debuff' | null>(null);
  const prevOpponentMorale = useRef<'buff' | 'debuff' | null>(null);
  const prevFocus = useRef(false);
  const prevSacrifice = useRef(false);

  // War cry flash animation (own or opponent)
  useEffect(() => {
    if (moraleBoostActive === 'buff' && prevMorale.current !== 'buff') {
      setWarCryFlash(true);
      setTimeout(() => setWarCryFlash(false), 600);
    }
    prevMorale.current = moraleBoostActive ?? null;
  }, [moraleBoostActive]);

  useEffect(() => {
    if (opponentMoraleActive === 'buff' && prevOpponentMorale.current !== 'buff') {
      setWarCryFlash(true);
      setTimeout(() => setWarCryFlash(false), 600);
    }
    prevOpponentMorale.current = opponentMoraleActive ?? null;
  }, [opponentMoraleActive]);

  // Focus fire flash
  useEffect(() => {
    if (focusFireActive && !prevFocus.current) {
      setFocusFlashAnim(true);
      setTimeout(() => setFocusFlashAnim(false), 500);
    }
    prevFocus.current = !!focusFireActive;
  }, [focusFireActive]);

  // Sacrifice flash
  useEffect(() => {
    if (sacrificeFlash && !prevSacrifice.current) {
      setSacrificeAnim(true);
      setTimeout(() => setSacrificeAnim(false), 600);
    }
    prevSacrifice.current = !!sacrificeFlash;
  }, [sacrificeFlash]);

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

  // Handle battle events: shake + damage popups + projectiles + heal glows + freeze
  useEffect(() => {
    if (battleEvents.length === 0) return;
    const newShake = new Set<string>();
    const newPopups: DamagePopup[] = [];
    const newProjs: Projectile[] = [];
    const newDragonFires: DragonFire[] = [];
    const newHealGlows: HealGlow[] = [];
    const newHealPopups: HealPopup[] = [];
    const newFreezes: FreezeEffect[] = [];

    for (const evt of battleEvents) {
      // Heal events: green glow + heal popup
      if (evt.type === 'heal') {
        healCounter.current += 1;
        newHealGlows.push({
          id: `heal-${healCounter.current}`,
          row: evt.targetRow, col: evt.targetCol,
        });
        newHealPopups.push({
          id: `hpop-${healCounter.current}`,
          row: evt.targetRow, col: evt.targetCol,
          healAmount: evt.healAmount || 0,
        });
        if (evt.isRanged) {
          projCounter.current += 1;
          newProjs.push({
            id: `proj-${projCounter.current}`,
            fromRow: evt.attackerRow, fromCol: evt.attackerCol,
            toRow: evt.targetRow, toCol: evt.targetCol,
            emoji: '✨',
          });
        }
        continue;
      }

      // Freeze events: ice spread animation
      if (evt.type === 'freeze') {
        freezeCounter.current += 1;
        newFreezes.push({
          id: `freeze-${freezeCounter.current}`,
          row: evt.targetRow, col: evt.targetCol,
        });
        continue;
      }

      const key = `${evt.targetRow}-${evt.targetCol}`;
      newShake.add(key);
      popupCounter.current += 1;
      newPopups.push({
        id: `pop-${popupCounter.current}`,
        row: evt.targetRow, col: evt.targetCol,
        damage: evt.damage, isStrong: evt.isStrong, isWeak: evt.isWeak,
        isKill: evt.type === 'kill',
      });

      // Dragon AOE fire effect
      if (evt.aoeCells && evt.aoeCells.length > 0) {
        dragonFireCounter.current += 1;
        newDragonFires.push({
          id: `dfire-${dragonFireCounter.current}`,
          cells: evt.aoeCells,
        });
      }

      if (evt.isRanged) {
        projCounter.current += 1;
        const projType: Projectile['type'] = evt.attackerEmoji === '🏹' ? 'arrow'
          : evt.attackerEmoji === '🔮' ? 'magic'
          : evt.attackerEmoji === '🥶' ? 'frost'
          : 'default';
        newProjs.push({
          id: `proj-${projCounter.current}`,
          fromRow: evt.attackerRow, fromCol: evt.attackerCol,
          toRow: evt.targetRow, toCol: evt.targetCol,
          emoji: projType === 'arrow' ? '➴' : projType === 'magic' ? '✦' : projType === 'frost' ? '❄' : evt.attackerEmoji === '🐉' ? '🔥' : '⚡',
          type: projType,
        });
      }
    }

    setShakeCells(newShake);
    setPopups(prev => [...prev, ...newPopups]);
    setProjectiles(prev => [...prev, ...newProjs]);
    if (newDragonFires.length > 0) {
      setDragonFires(prev => [...prev, ...newDragonFires]);
    }
    if (newHealGlows.length > 0) {
      setHealGlows(prev => [...prev, ...newHealGlows]);
      setHealPopups(prev => [...prev, ...newHealPopups]);
    }
    if (newFreezes.length > 0) {
      setFreezeEffects(prev => [...prev, ...newFreezes]);
    }

    setTimeout(() => setShakeCells(new Set()), 400);
    setTimeout(() => {
      setPopups(prev => prev.filter(p => !newPopups.find(np => np.id === p.id)));
    }, 700);
    setTimeout(() => {
      setProjectiles(prev => prev.filter(p => !newProjs.find(np => np.id === p.id)));
    }, 450);
    if (newDragonFires.length > 0) {
      setTimeout(() => {
        setDragonFires(prev => prev.filter(f => !newDragonFires.find(nf => nf.id === f.id)));
      }, 800);
    }
    if (newHealGlows.length > 0) {
      setTimeout(() => {
        setHealGlows(prev => prev.filter(h => !newHealGlows.find(nh => nh.id === h.id)));
      }, 900);
      setTimeout(() => {
        setHealPopups(prev => prev.filter(h => !newHealPopups.find(nh => nh.id === h.id)));
      }, 800);
    }
    if (newFreezes.length > 0) {
      setTimeout(() => {
        setFreezeEffects(prev => prev.filter(f => !newFreezes.find(nf => nf.id === f.id)));
      }, 1000);
    }
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
          const colorGroup = unit && !unit.dead ? UNIT_COLOR_GROUPS[unit.type] : null;
          const showColorDot = colorGroup && (alwaysShowColorDots || phase === 'place_player' || phase === 'place_enemy');
          const hpPercent = unit && !unit.dead ? (unit.hp / unit.maxHp) * 100 : 0;
          const isLow = unit && !unit.dead ? unit.hp / unit.maxHp < 0.3 : false;
          const isFlashing = flashCells.has(`${cell.row}-${cell.col}`);
          const isShaking = shakeCells.has(`${cell.row}-${cell.col}`);
          const isDead = unit?.dead;
          const isFrozen = unit ? (unit.frozen ?? 0) > 0 : false;
          const isInactive = unit && !isDead && unit.activationTurn !== undefined && unit.activationTurn > 0 && phase === 'place_player';
          const cellKey = `${cell.row}-${cell.col}`;
          const terrain = cell.terrain || 'none';
          const hasTerrain = terrain !== 'none' && TERRAIN_DEFS[terrain];

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
                ${isPlayerZone && (isPlacing || showZoneColors) && !unit && terrain !== 'water' ? 'bg-primary/5' : ''} ${isPlayerZone && isPlacing && !unit && terrain !== 'water' ? 'hover:bg-primary/15 cursor-pointer' : isPlayerZone && isPlacing && terrain === 'water' ? 'cursor-not-allowed' : ''}
                ${(isEnemyZone && (showZoneColors || !isPlacing)) || (isEnemyZone && !unit) ? 'bg-danger/5' : ''}
                ${!unit && !hasTerrain ? 'bg-card' : ''}
                ${!unit && terrain === 'forest' ? 'bg-[hsl(145,30%,15%)]' : ''}
                ${!unit && terrain === 'hill' ? 'bg-[hsl(35,25%,18%)]' : ''}
                ${!unit && terrain === 'water' ? 'bg-[hsl(210,40%,18%)]' : ''}
                ${isDead ? 'bg-muted/40' : ''}
                ${isFlashing ? 'flash-attack' : ''}
                ${isShaking ? 'shake-hit' : ''}
                transition-colors duration-200
              `}
            >
              {/* Terrain emoji (show when no unit or unit is dead) */}
              {hasTerrain && (!unit || isDead) && (
                <span className="text-[10px] opacity-50 select-none">{TERRAIN_DEFS[terrain].emoji}</span>
              )}
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
                    className={`text-base sm:text-lg leading-none select-none ${isFrozen ? 'opacity-60' : ''}`}
                    style={{
                      filter: isFrozen
                        ? 'drop-shadow(0 0 5px hsl(210, 80%, 60%)) drop-shadow(0 0 10px hsl(210, 80%, 60%))'
                        : unit.team === 'player'
                          ? 'drop-shadow(0 0 4px hsl(152, 60%, 48%)) drop-shadow(0 0 8px hsl(152, 60%, 48%))'
                          : 'drop-shadow(0 0 4px hsl(0, 72%, 55%)) drop-shadow(0 0 8px hsl(0, 72%, 55%))',
                    }}
                  >
                    {def?.emoji}
                    {isFrozen && <span className="absolute -top-0.5 -right-0.5 text-[8px]">🧊</span>}
                  </span>
                  <div className="absolute bottom-0.5 left-0.5 right-0.5 h-[3px] rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isLow ? 'bg-danger' : unit.team === 'player' ? 'bg-success' : 'bg-danger'
                      }`}
                      style={{ width: `${hpPercent}%` }}
                    />
                  </div>
                  {showColorDot && (
                    <div className={`absolute top-0.5 left-0.5 w-2 h-2 rounded-full ${
                      colorGroup === 'red' ? 'bg-unit-red' : colorGroup === 'blue' ? 'bg-unit-blue' : 'bg-unit-green'
                    }`} />
                  )}
                  {/* Shield aura indicator: show small shield icon if unit is next to friendly tank */}
                  {unit.type !== 'tank' && phase === 'battle' && (() => {
                    for (const offset of [{ row: -1, col: 0 }, { row: 1, col: 0 }, { row: 0, col: -1 }, { row: 0, col: 1 }]) {
                      const r = cell.row + offset.row;
                      const c = cell.col + offset.col;
                      if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
                        const neighbor = grid[r]?.[c];
                        if (neighbor?.unit && neighbor.unit.type === 'tank' && neighbor.unit.team === unit.team && neighbor.unit.hp > 0 && !neighbor.unit.dead) {
                          return <span className="absolute top-0 right-0.5 text-[7px] opacity-70 select-none">🛡️</span>;
                        }
                      }
                    }
                    return null;
                  })()}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Shield bond connections during placement */}
      {(isPlacing || phase === 'place_enemy') && (() => {
        const bonds: { tankRow: number; tankCol: number; unitRow: number; unitCol: number }[] = [];
        const tanks = grid.flat().filter(c => c.unit && !c.unit.dead && c.unit.type === 'tank' && c.unit.team === 'player');
        for (const tankCell of tanks) {
          for (const offset of [{ row: -1, col: 0 }, { row: 1, col: 0 }, { row: 0, col: -1 }, { row: 0, col: 1 }]) {
            const r = tankCell.row + offset.row;
            const c = tankCell.col + offset.col;
            if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
              const neighbor = grid[r][c];
              if (neighbor.unit && !neighbor.unit.dead && neighbor.unit.team === 'player' && neighbor.unit.type !== 'tank') {
                bonds.push({ tankRow: tankCell.row, tankCol: tankCell.col, unitRow: r, unitCol: c });
              }
            }
          }
        }
        return bonds.map((b, i) => {
          const x1 = b.tankCol * cellSize + cellSize / 2;
          const y1 = b.tankRow * cellSize + cellSize / 2;
          const x2 = b.unitCol * cellSize + cellSize / 2;
          const y2 = b.unitRow * cellSize + cellSize / 2;
          return (
            <svg key={`bond-${i}`} className="absolute inset-0 z-20 pointer-events-none w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="hsl(152, 60%, 48%)"
                strokeWidth="0.6"
                strokeDasharray="1.5,1"
                opacity="0.7"
              >
                <animate attributeName="stroke-dashoffset" from="0" to="-5" dur="1.5s" repeatCount="indefinite" />
              </line>
              <circle cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} r="1.2" fill="hsl(152, 60%, 48%)" opacity="0.8">
                <animate attributeName="opacity" values="0.4;0.9;0.4" dur="1.5s" repeatCount="indefinite" />
              </circle>
            </svg>
          );
        });
      })()}

      {projectiles.map(p => {
        const fromX = p.fromCol * cellSize + cellSize / 2;
        const fromY = p.fromRow * cellSize + cellSize / 2;
        const toX = p.toCol * cellSize + cellSize / 2;
        const toY = p.toRow * cellSize + cellSize / 2;
        const projClass = p.type === 'arrow' ? 'projectile-arrow'
          : p.type === 'magic' ? 'projectile-magic'
          : p.type === 'frost' ? 'projectile-frost'
          : 'projectile-fly';
        return (
          <div
            key={p.id}
            className={`absolute pointer-events-none z-30 ${projClass}`}
            style={{
              '--from-x': `${fromX}%`,
              '--from-y': `${fromY}%`,
              '--to-x': `${toX}%`,
              '--to-y': `${toY}%`,
            } as React.CSSProperties}
          >
            <span className={`text-xs drop-shadow-lg ${
              p.type === 'magic' ? 'text-sm magic-proj-glow' :
              p.type === 'frost' ? 'frost-proj-glow' :
              p.type === 'arrow' ? 'arrow-proj-trail' : ''
            }`}>{p.emoji}</span>
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
      {/* War cry overlay flash */}
      {warCryFlash && (
        <div className="absolute inset-0 z-40 pointer-events-none rounded-xl war-cry-flash flex items-center justify-center">
          <span className="text-5xl war-cry-emoji">🔥</span>
        </div>
      )}

      {/* Active morale glow border */}
      {moraleBoostActive === 'buff' && (
        <div className="absolute inset-0 z-30 pointer-events-none rounded-xl border-2 border-warning shadow-[inset_0_0_20px_hsl(var(--warning)/0.15),0_0_15px_hsl(var(--warning)/0.2)] animate-pulse" />
      )}
      {moraleBoostActive === 'debuff' && (
        <div className="absolute inset-0 z-30 pointer-events-none rounded-xl border-2 border-danger/40 shadow-[inset_0_0_15px_hsl(var(--danger)/0.1)]" />
      )}

      {/* Focus fire overlay flash */}
      {focusFlashAnim && (
        <div className="absolute inset-0 z-40 pointer-events-none rounded-xl focus-fire-flash flex items-center justify-center">
          <span className="text-5xl focus-fire-emoji">🎯</span>
        </div>
      )}

      {/* Focus fire active border */}
      {focusFireActive && (
        <div className="absolute inset-0 z-30 pointer-events-none rounded-xl border-2 border-primary shadow-[inset_0_0_20px_hsl(var(--primary)/0.15),0_0_15px_hsl(var(--primary)/0.2)] animate-pulse" />
      )}

      {/* Sacrifice overlay flash */}
      {sacrificeAnim && (
        <div className="absolute inset-0 z-40 pointer-events-none rounded-xl sacrifice-flash flex items-center justify-center">
          <span className="text-5xl sacrifice-emoji">💀</span>
        </div>
      )}

      {/* Dragon fire AOE overlay */}
      {dragonFires.map(fire => (
        fire.cells.map((cell, i) => {
          const left = cell.col * cellSize;
          const top = cell.row * cellSize;
          return (
            <div
              key={`${fire.id}-${i}`}
              className="absolute pointer-events-none z-25 dragon-fire-cell"
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: `${cellSize}%`,
                height: `${cellSize}%`,
              }}
            >
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-lg dragon-fire-emoji" style={{ animationDelay: `${i * 40}ms` }}>🔥</span>
              </div>
            </div>
          );
        })
      ))}

      {/* Heal glow overlay */}
      {healGlows.map(h => {
        const left = h.col * cellSize;
        const top = h.row * cellSize;
        return (
          <div
            key={h.id}
            className="absolute pointer-events-none z-25 heal-glow-cell"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${cellSize}%`,
              height: `${cellSize}%`,
            }}
          >
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-lg heal-glow-emoji">✨</span>
            </div>
          </div>
        );
      })}

      {/* Heal popups */}
      {healPopups.map(h => {
        const left = h.col * cellSize + cellSize / 2;
        const top = h.row * cellSize + cellSize / 4;
        return (
          <div
            key={h.id}
            className="absolute pointer-events-none z-20 dmg-popup"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <span className="text-xs font-bold font-mono drop-shadow-lg text-[hsl(145,65%,50%)]">
              +{h.healAmount} ❤️
            </span>
          </div>
        );
      })}
      {/* Freeze effect overlay */}
      {freezeEffects.map(f => {
        const left = f.col * cellSize;
        const top = f.row * cellSize;
        return (
          <div
            key={f.id}
            className="absolute pointer-events-none z-25 freeze-cell"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${cellSize}%`,
              height: `${cellSize}%`,
            }}
          >
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-lg freeze-emoji">🧊</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
