import { useState, useEffect, useRef } from 'react';
import { Cell, GRID_SIZE, PLAYER_ROWS, UNIT_DEFS, UNIT_COLOR_GROUPS, Phase, ColorGroup, UnitType, TERRAIN_DEFS } from '@/lib/battleGame';
import { BattleEvent } from '@/lib/battleEvents';
import { UnitGlyph } from '@/components/UnitGlyph';
import { getAttackIcon, iconUrl } from '@/lib/unitIcons';

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
  /** Flip the grid vertically (for player2 in multiplayer) */
  flipped?: boolean;
  /** While the player is dragging a unit, show alternating attack/move preview around this cell */
  dragPreview?: { row: number; col: number; type: UnitType } | null;
}

interface UnitPos { row: number; col: number }
interface DamagePopup { id: string; row: number; col: number; damage: number; isStrong: boolean; isWeak: boolean; isKill: boolean }
interface HealPopup { id: string; row: number; col: number; healAmount: number }
interface Projectile { id: string; fromRow: number; fromCol: number; toRow: number; toCol: number; emoji: string; iconFile?: string | null; type?: 'arrow' | 'magic' | 'frost' | 'default' | 'custom' | 'heal' }
interface DragonFire { id: string; cells: { row: number; col: number }[] }
interface HealGlow { id: string; row: number; col: number }
interface FreezeEffect { id: string; row: number; col: number }
interface ChainEffect { id: string; cells: { row: number; col: number }[]; color: 'lightning' | 'chaindancer' }
interface ImpulseEffect { id: string; row: number; col: number }
interface FrostNovaEffect { id: string; row: number; col: number }
interface TeleportEffect { id: string; row: number; col: number; kind: 'out' | 'in' }

export function BattleGrid({ grid, phase, onCellClick, lastPlaced, battleEvents = [], moraleBoostActive, opponentMoraleActive, focusFireActive, sacrificeFlash, alwaysShowColorDots, showZoneColors, flipped, dragPreview }: BattleGridProps) {
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
  const [chainEffects, setChainEffects] = useState<ChainEffect[]>([]);
  const [impulseEffects, setImpulseEffects] = useState<ImpulseEffect[]>([]);
  const [impulsePushedIds, setImpulsePushedIds] = useState<Set<string>>(new Set());
  const impulseCounter = useRef(0);
  const [teleportEffects, setTeleportEffects] = useState<TeleportEffect[]>([]);
  const teleportCounter = useRef(0);
  const [frostNovaEffects, setFrostNovaEffects] = useState<FrostNovaEffect[]>([]);
  const frostNovaCounter = useRef(0);
  const popupCounter = useRef(0);
  const projCounter = useRef(0);
  const dragonFireCounter = useRef(0);
  const healCounter = useRef(0);
  const freezeCounter = useRef(0);
  const chainCounter = useRef(0);
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

  // Flash effect for attack + move pattern on placement (impact)
  const [moveFlashCells, setMoveFlashCells] = useState<Set<string>>(new Set());
  const [impactCell, setImpactCell] = useState<string | null>(null);
  useEffect(() => {
    if (!lastPlaced) return;
    const def = UNIT_DEFS[lastPlaced.type];
    const atk = new Set<string>();
    const mv = new Set<string>();
    for (const p of def.attackPattern) {
      const r = lastPlaced.row + p.row;
      const c = lastPlaced.col + p.col;
      if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) atk.add(`${r}-${c}`);
    }
    for (const p of def.movePattern) {
      const r = lastPlaced.row + p.row;
      const c = lastPlaced.col + p.col;
      if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) mv.add(`${r}-${c}`);
    }
    setFlashCells(atk);
    setMoveFlashCells(mv);
    setImpactCell(`${lastPlaced.row}-${lastPlaced.col}`);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      setFlashCells(new Set());
      setMoveFlashCells(new Set());
      setImpactCell(null);
    }, 750);
  }, [lastPlaced]);

  // Alternating attack/move blink while dragging a unit over a cell
  const [dragBlinkMode, setDragBlinkMode] = useState<'attack' | 'move'>('attack');
  useEffect(() => {
    if (!dragPreview) { setDragBlinkMode('attack'); return; }
    setDragBlinkMode('attack');
    const id = setInterval(() => {
      setDragBlinkMode(m => (m === 'attack' ? 'move' : 'attack'));
    }, 450);
    return () => clearInterval(id);
  }, [dragPreview]);

  // Compute drag preview cells (attack vs move pattern around the hovered cell)
  let dragAttackCells = new Set<string>();
  let dragMoveCells = new Set<string>();
  let dragOriginKey: string | null = null;
  if (dragPreview) {
    const def = UNIT_DEFS[dragPreview.type];
    dragOriginKey = `${dragPreview.row}-${dragPreview.col}`;
    for (const p of def.attackPattern) {
      const r = dragPreview.row + p.row;
      const c = dragPreview.col + p.col;
      if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) dragAttackCells.add(`${r}-${c}`);
    }
    for (const p of def.movePattern) {
      const r = dragPreview.row + p.row;
      const c = dragPreview.col + p.col;
      if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) dragMoveCells.add(`${r}-${c}`);
    }
  }

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
            const dr = prev.row - cell.row;
            newOffsets.set(id, { dr: flipped ? -dr : dr, dc: prev.col - cell.col });
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
  // Delay damage/effects by movement animation duration so they appear after units arrive
  const MOVE_ANIM_DURATION = 580;
  const pendingEventsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (battleEvents.length === 0) return;

    // Cancel any pending event processing from a previous tick
    if (pendingEventsTimeout.current) {
      clearTimeout(pendingEventsTimeout.current);
      pendingEventsTimeout.current = null;
    }

    pendingEventsTimeout.current = setTimeout(() => {
      pendingEventsTimeout.current = null;
      processBattleEvents(battleEvents);
    }, MOVE_ANIM_DURATION);

    return () => {
      if (pendingEventsTimeout.current) {
        clearTimeout(pendingEventsTimeout.current);
        pendingEventsTimeout.current = null;
      }
    };
  }, [battleEvents]);

  const processBattleEvents = (events: BattleEvent[]) => {
    if (events.length === 0) return;

    // Separate ranged (projectile) and melee events
    const rangedDamageEvents: BattleEvent[] = [];
    const meleeDamageEvents: BattleEvent[] = [];
    const healEvents: BattleEvent[] = [];
    const freezeEvents: BattleEvent[] = [];

    for (const evt of events) {
      // Impulse / teleport / spawn are visual-only and must not produce
      // projectiles, damage popups or AOE fire overlays.
      if (evt.type === 'impulse' || evt.type === 'teleport' || evt.type === 'spawn') continue;
      if (evt.type === 'heal') healEvents.push(evt);
      else if (evt.type === 'freeze') freezeEvents.push(evt);
      else if (evt.isRanged) rangedDamageEvents.push(evt);
      else meleeDamageEvents.push(evt);
    }

    // --- Phase 1: Launch projectiles for ranged attacks (and for melee if a custom attack icon is set) ---
    const newProjs: Projectile[] = [];
    for (const evt of [...rangedDamageEvents, ...meleeDamageEvents]) {
      const customIcon = getAttackIcon(evt.attackerType);
      const isRanged = evt.isRanged;
      // Skip melee projectile only if no custom icon (keep existing snappy melee feel)
      if (!isRanged && !customIcon) continue;
      projCounter.current += 1;
      const projType: Projectile['type'] = customIcon ? 'custom'
        : evt.attackerEmoji === '🏹' ? 'arrow'
        : evt.attackerEmoji === '🔮' ? 'magic'
        : evt.attackerEmoji === '🥶' ? 'frost'
        : 'default';
      newProjs.push({
        id: `proj-${projCounter.current}`,
        fromRow: evt.attackerRow, fromCol: evt.attackerCol,
        toRow: evt.targetRow, toCol: evt.targetCol,
        emoji: projType === 'arrow' ? '➴' : projType === 'magic' ? '✦' : projType === 'frost' ? '❄' : evt.attackerEmoji === '🐉' ? '🔥' : '⚡',
        iconFile: customIcon,
        type: projType,
      });
    }
    // Heal projectiles
    const healProjs: Projectile[] = [];
    for (const evt of healEvents) {
      const customIcon = getAttackIcon(evt.attackerType);
      if (evt.isRanged || customIcon) {
        projCounter.current += 1;
        healProjs.push({
          id: `proj-${projCounter.current}`,
          fromRow: evt.attackerRow, fromCol: evt.attackerCol,
          toRow: evt.targetRow, toCol: evt.targetCol,
          emoji: '✨',
          iconFile: customIcon,
          type: customIcon ? 'custom' : 'heal',
        });
      }
    }
    const allProjs = [...newProjs, ...healProjs];
    if (allProjs.length > 0) {
      setProjectiles(prev => [...prev, ...allProjs]);
    }

    // --- Phase 1b: Melee damage appears immediately (no projectile needed) ---
    const meleeShake = new Set<string>();
    const meleePopups: DamagePopup[] = [];
    const meleeDragonFires: DragonFire[] = [];
    for (const evt of meleeDamageEvents) {
      const key = `${evt.targetRow}-${evt.targetCol}`;
      meleeShake.add(key);
      popupCounter.current += 1;
      meleePopups.push({
        id: `pop-${popupCounter.current}`,
        row: evt.targetRow, col: evt.targetCol,
        damage: evt.damage, isStrong: evt.isStrong, isWeak: evt.isWeak,
        isKill: evt.type === 'kill',
      });
      if (evt.aoeCells && evt.aoeCells.length > 0) {
        dragonFireCounter.current += 1;
        meleeDragonFires.push({ id: `dfire-${dragonFireCounter.current}`, cells: evt.aoeCells });
      }
    }
    if (meleePopups.length > 0) {
      setShakeCells(prev => new Set([...prev, ...meleeShake]));
      setPopups(prev => [...prev, ...meleePopups]);
      setTimeout(() => setShakeCells(prev => {
        const next = new Set(prev);
        meleeShake.forEach(k => next.delete(k));
        return next;
      }), 700);
      setTimeout(() => {
        setPopups(prev => prev.filter(p => !meleePopups.find(mp => mp.id === p.id)));
      }, 1200);
    }
    if (meleeDragonFires.length > 0) {
      setDragonFires(prev => [...prev, ...meleeDragonFires]);
      setTimeout(() => {
        setDragonFires(prev => prev.filter(f => !meleeDragonFires.find(nf => nf.id === f.id)));
      }, 1400);
    }

    // --- Phase 2: Ranged damage appears AFTER projectile arrives ---
    const PROJECTILE_FLIGHT_TIME = 620; // matches longest projectile animation
    if (rangedDamageEvents.length > 0) {
      setTimeout(() => {
        const rangedShake = new Set<string>();
        const rangedPopups: DamagePopup[] = [];
        const rangedDragonFires: DragonFire[] = [];
        for (const evt of rangedDamageEvents) {
          const key = `${evt.targetRow}-${evt.targetCol}`;
          rangedShake.add(key);
          popupCounter.current += 1;
          rangedPopups.push({
            id: `pop-${popupCounter.current}`,
            row: evt.targetRow, col: evt.targetCol,
            damage: evt.damage, isStrong: evt.isStrong, isWeak: evt.isWeak,
            isKill: evt.type === 'kill',
          });
          if (evt.aoeCells && evt.aoeCells.length > 0) {
            dragonFireCounter.current += 1;
            rangedDragonFires.push({ id: `dfire-${dragonFireCounter.current}`, cells: evt.aoeCells });
          }
        }
        setShakeCells(prev => new Set([...prev, ...rangedShake]));
        setPopups(prev => [...prev, ...rangedPopups]);
        setTimeout(() => setShakeCells(prev => {
          const next = new Set(prev);
          rangedShake.forEach(k => next.delete(k));
          return next;
        }), 700);
        setTimeout(() => {
          setPopups(prev => prev.filter(p => !rangedPopups.find(rp => rp.id === p.id)));
        }, 1200);
        if (rangedDragonFires.length > 0) {
          setDragonFires(prev => [...prev, ...rangedDragonFires]);
          setTimeout(() => {
            setDragonFires(prev => prev.filter(f => !rangedDragonFires.find(nf => nf.id === f.id)));
          }, 1400);
        }
      }, PROJECTILE_FLIGHT_TIME);
    }

    // Clean up projectiles after flight
    if (allProjs.length > 0) {
      setTimeout(() => {
        setProjectiles(prev => prev.filter(p => !allProjs.find(ap => ap.id === p.id)));
      }, PROJECTILE_FLIGHT_TIME + 100);
    }

    // --- Heal effects (immediate for melee heals, delayed for ranged) ---
    const newHealGlows: HealGlow[] = [];
    const newHealPopups: HealPopup[] = [];
    for (const evt of healEvents) {
      healCounter.current += 1;
      newHealGlows.push({ id: `heal-${healCounter.current}`, row: evt.targetRow, col: evt.targetCol });
      newHealPopups.push({ id: `hpop-${healCounter.current}`, row: evt.targetRow, col: evt.targetCol, healAmount: evt.healAmount || 0 });
    }
    const healDelay = healProjs.length > 0 ? PROJECTILE_FLIGHT_TIME : 0;
    if (newHealGlows.length > 0) {
      setTimeout(() => {
        setHealGlows(prev => [...prev, ...newHealGlows]);
        setHealPopups(prev => [...prev, ...newHealPopups]);
        setTimeout(() => setHealGlows(prev => prev.filter(h => !newHealGlows.find(nh => nh.id === h.id))), 1500);
        setTimeout(() => setHealPopups(prev => prev.filter(h => !newHealPopups.find(nh => nh.id === h.id))), 1400);
      }, healDelay);
    }

    // --- Freeze effects ---
    const newFreezes: FreezeEffect[] = [];
    for (const evt of freezeEvents) {
      freezeCounter.current += 1;
      newFreezes.push({ id: `freeze-${freezeCounter.current}`, row: evt.targetRow, col: evt.targetCol });
    }
    if (newFreezes.length > 0) {
      // Freeze is from frost (ranged), so delay after projectile
      setTimeout(() => {
        setFreezeEffects(prev => [...prev, ...newFreezes]);
        setTimeout(() => setFreezeEffects(prev => prev.filter(f => !newFreezes.find(nf => nf.id === f.id))), 675);
      }, PROJECTILE_FLIGHT_TIME);
    }

    // --- Chain effects (lightning chains + chaindancer) ---
    const newChains: ChainEffect[] = [];
    for (const evt of events) {
      if (!evt.chainCells || evt.chainCells.length < 2) continue;
      chainCounter.current += 1;
      newChains.push({
        id: `chain-${chainCounter.current}`,
        cells: evt.chainCells,
        color: evt.type === 'chain' ? 'chaindancer' : 'lightning',
      });
    }
    if (newChains.length > 0) {
      const delay = newChains[0].color === 'lightning' ? PROJECTILE_FLIGHT_TIME : 0;
      setTimeout(() => {
        setChainEffects(prev => [...prev, ...newChains]);
        setTimeout(() => setChainEffects(prev => prev.filter(c => !newChains.find(nc => nc.id === c.id))), 900);
      }, delay);
    }

    // --- Mage impulse (shockwave) ---
    const newImpulses: ImpulseEffect[] = [];
    const impulsePushedIdsBatch: string[] = [];
    for (const evt of events) {
      if (evt.type !== 'impulse') continue;
      impulseCounter.current += 1;
      newImpulses.push({ id: `impulse-${impulseCounter.current}`, row: evt.attackerRow, col: evt.attackerCol });
      if (evt.pushedIds) impulsePushedIdsBatch.push(...evt.pushedIds);
    }
    if (newImpulses.length > 0) {
      setImpulseEffects(prev => [...prev, ...newImpulses]);
      setTimeout(() => setImpulseEffects(prev => prev.filter(i => !newImpulses.find(ni => ni.id === i.id))), 1500);
    }
    if (impulsePushedIdsBatch.length > 0) {
      setImpulsePushedIds(new Set(impulsePushedIdsBatch));
      setTimeout(() => setImpulsePushedIds(new Set()), 1700);
    }

    // --- Shadowblade teleport puffs ---
    const newTeleports: TeleportEffect[] = [];
    for (const evt of events) {
      if (evt.type !== 'teleport') continue;
      teleportCounter.current += 1;
      newTeleports.push({ id: `tp-out-${teleportCounter.current}`, row: evt.attackerRow, col: evt.attackerCol, kind: 'out' });
      teleportCounter.current += 1;
      newTeleports.push({ id: `tp-in-${teleportCounter.current}`, row: evt.targetRow, col: evt.targetCol, kind: 'in' });
    }
    if (newTeleports.length > 0) {
      setTeleportEffects(prev => [...prev, ...newTeleports]);
      setTimeout(() => setTeleportEffects(prev => prev.filter(t => !newTeleports.find(nt => nt.id === t.id))), 700);
    }
  };

  const cellSize = 100 / GRID_SIZE;
  // When flipped, visual row position is inverted for overlay effects
  const visualRow = (r: number) => flipped ? (GRID_SIZE - 1 - r) : r;

  return (
    <div className="w-full aspect-square max-w-[min(100vw-2rem,28rem)] mx-auto relative">
      <div className="grid grid-cols-8 gap-[2px] w-full h-full bg-border rounded-xl overflow-hidden border border-border">
         {(flipped ? [...grid].reverse().flat() : grid.flat()).map((cell) => {
          const isPlayerZone = flipped ? cell.row < 3 : PLAYER_ROWS.includes(cell.row);
          const isEnemyZone = flipped ? PLAYER_ROWS.includes(cell.row) : cell.row < 3;
          const unit = cell.unit;
          const def = unit ? UNIT_DEFS[unit.type] : null;
          const colorGroup = unit && !unit.dead ? (unit.color || UNIT_COLOR_GROUPS[unit.type]) : null;
          const showColorDot = colorGroup && (alwaysShowColorDots || phase === 'place_player' || phase === 'place_enemy');
          const hpPercent = unit && !unit.dead ? (unit.hp / unit.maxHp) * 100 : 0;
          const isLow = unit && !unit.dead ? unit.hp / unit.maxHp < 0.3 : false;
          const isFlashing = flashCells.has(`${cell.row}-${cell.col}`);
          const isMoveFlashing = moveFlashCells.has(`${cell.row}-${cell.col}`);
          const isShaking = shakeCells.has(`${cell.row}-${cell.col}`);
          const isDead = unit?.dead;
          const isFrozen = unit ? (unit.frozen ?? 0) > 0 : false;
          const isWebbed = unit ? (unit.webbed ?? 0) > 0 : false;
          const isPhantom = unit ? !!unit.isPhantom && (unit.phantom ?? 0) > 0 : false;
          const isBurning = unit ? !!(unit.burning && unit.burning.length > 0 && !unit.dead) : false;
          const isInactive = unit && !isDead && unit.activationTurn !== undefined && unit.activationTurn > 0 && phase === 'place_player';
          const cellKey = `${cell.row}-${cell.col}`;
          const terrain = cell.terrain || 'none';
          const hasTerrain = terrain !== 'none' && TERRAIN_DEFS[terrain];
          const isImpact = impactCell === cellKey;
          const isDragOrigin = dragOriginKey === cellKey;
          const showDragAttack = !isDragOrigin && dragBlinkMode === 'attack' && dragAttackCells.has(cellKey);
          const showDragMove   = !isDragOrigin && dragBlinkMode === 'move'   && dragMoveCells.has(cellKey);

          // Slide offset
          const offset = unit && !isDead ? slideOffsets.get(unit.id) : null;
          const slideStyle = offset
            ? { transform: `translate(${offset.dc * 100}%, ${offset.dr * 100}%)` }
            : undefined;

          return (
            <button
              key={cellKey}
              data-cell-row={cell.row}
              data-cell-col={cell.col}
              onClick={() => onCellClick(cell.row, cell.col)}
              className={`aspect-square flex flex-col items-center justify-center relative overflow-visible
                ${isPlayerZone && (isPlacing || showZoneColors) && !unit && terrain !== 'water' ? 'bg-primary/5' : ''} ${isPlayerZone && isPlacing && !unit && terrain !== 'water' ? 'hover:bg-primary/15 cursor-pointer' : isPlayerZone && isPlacing && terrain === 'water' ? 'cursor-not-allowed' : ''}
                ${(isEnemyZone && (showZoneColors || !isPlacing)) || (isEnemyZone && !unit) ? 'bg-danger/5' : ''}
                ${!unit && !hasTerrain ? 'bg-card' : ''}
                ${!unit && terrain === 'forest' ? 'bg-[hsl(145,30%,15%)]' : ''}
                ${!unit && terrain === 'hill' ? 'bg-[hsl(35,25%,18%)]' : ''}
                ${!unit && terrain === 'water' ? 'bg-[hsl(210,40%,18%)]' : ''}
                ${isDead ? 'bg-muted/40' : ''}
                ${isFlashing ? 'placement-attack-flash' : ''}
                ${isMoveFlashing && !isFlashing ? 'placement-move-flash' : ''}
                ${isShaking ? 'shake-hit' : ''}
                transition-colors duration-200
              `}
            >
              {/* Lava overlay – persistent */}
              {cell.lavaTicks && cell.lavaTicks > 0 && (
                <div className="absolute inset-0 z-0 pointer-events-none cell-lava" />
              )}
              {/* Drag preview overlays */}
              {showDragAttack && <div className="absolute inset-0 z-20 pointer-events-none drag-preview-attack" />}
              {showDragMove && <div className="absolute inset-0 z-20 pointer-events-none drag-preview-move" />}
              {isDragOrigin && <div className="absolute inset-0 z-20 pointer-events-none drag-preview-origin" />}
              {/* Placement impact */}
              {isImpact && <div className="placement-impact" />}
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
                    transition: offset
                      ? 'none'
                      : (impulsePushedIds.has(unit.id)
                          ? 'transform 1500ms cubic-bezier(0.12, 0.85, 0.25, 1)'
                          : 'transform 580ms ease-out'),
                  }}
                >
                  {/* Persistent freeze overlay – stays visible the entire time the unit is frozen */}
                  {isFrozen && (
                    <div className="absolute inset-0 z-0 pointer-events-none rounded-sm"
                      style={{
                        background: 'linear-gradient(135deg, hsl(210 80% 60% / 0.45), hsl(195 90% 65% / 0.30))',
                        boxShadow: 'inset 0 0 10px hsl(210 80% 70% / 0.6)',
                      }}
                    />
                  )}
                  {/* Persistent burn overlay – flickering fire while burning stacks active */}
                  {isBurning && (
                    <div className="absolute inset-0 z-0 pointer-events-none rounded-sm animate-pulse"
                      style={{
                        background: 'linear-gradient(135deg, hsl(15 90% 50% / 0.30), hsl(35 95% 55% / 0.20))',
                        boxShadow: 'inset 0 0 8px hsl(20 95% 55% / 0.5)',
                      }}
                    />
                  )}
                  {/* Persistent web overlay – spiderqueen capture */}
                  {isWebbed && (
                    <div className="absolute inset-0 z-0 pointer-events-none rounded-sm"
                      style={{
                        background: 'repeating-linear-gradient(45deg, hsl(0 0% 90% / 0.35) 0 1px, transparent 1px 4px), repeating-linear-gradient(-45deg, hsl(0 0% 90% / 0.35) 0 1px, transparent 1px 4px)',
                        boxShadow: 'inset 0 0 6px hsl(0 0% 100% / 0.3)',
                      }}
                    />
                  )}
                  {/* Phantom shimmer overlay – doppelganger invulnerable phantom */}
                  {isPhantom && (
                    <div className="absolute inset-0 z-0 pointer-events-none rounded-sm animate-pulse"
                      style={{
                        background: 'linear-gradient(135deg, hsl(280 80% 70% / 0.35), hsl(220 90% 70% / 0.25))',
                        boxShadow: 'inset 0 0 10px hsl(270 90% 75% / 0.7), 0 0 8px hsl(280 80% 65% / 0.5)',
                      }}
                    />
                  )}
                  <span
                    className={`text-base sm:text-lg leading-none select-none relative ${isFrozen ? 'opacity-60' : ''} ${isPhantom ? 'opacity-70' : ''} ${unit.ghost && unit.ghost > 0 ? 'ghost-active' : ''}`}
                    style={{
                      filter: unit.ghost && unit.ghost > 0
                        ? undefined
                        : isPhantom
                        ? 'drop-shadow(0 0 6px hsl(280, 80%, 70%)) drop-shadow(0 0 10px hsl(280, 80%, 70%))'
                        : isFrozen
                        ? 'drop-shadow(0 0 5px hsl(210, 80%, 60%)) drop-shadow(0 0 10px hsl(210, 80%, 60%))'
                        : (flipped ? unit.team === 'enemy' : unit.team === 'player')
                          ? 'drop-shadow(0 0 4px hsl(152, 60%, 48%)) drop-shadow(0 0 8px hsl(152, 60%, 48%))'
                          : 'drop-shadow(0 0 4px hsl(0, 72%, 55%)) drop-shadow(0 0 8px hsl(0, 72%, 55%))',
                    }}
                  >
                    {unit.type && <UnitGlyph type={unit.type} isClone={unit.isClone} className="inline-block w-5 h-5 sm:w-6 sm:h-6 align-middle" />}
                    {isFrozen && <span className="absolute -top-0.5 -right-0.5 text-[8px]">🧊</span>}
                    {isWebbed && !isFrozen && <span className="absolute -top-0.5 -right-0.5 text-[8px]">🕸️</span>}
                    {isBurning && !isFrozen && !isWebbed && <span className="absolute -top-0.5 -right-0.5 text-[8px]">🔥</span>}
                    {isPhantom && <span className="absolute -top-0.5 -left-0.5 text-[8px]">👥</span>}
                  </span>

                  <div className="absolute bottom-0.5 left-0.5 right-0.5 h-[3px] rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isLow ? 'bg-danger' : (flipped ? unit.team === 'enemy' : unit.team === 'player') ? 'bg-success' : 'bg-danger'
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
                  {phase === 'battle' && (() => {
                    for (const offset of [{ row: -1, col: 0 }, { row: 1, col: 0 }, { row: 0, col: -1 }, { row: 0, col: 1 }, { row: -1, col: -1 }, { row: -1, col: 1 }, { row: 1, col: -1 }, { row: 1, col: 1 }]) {
                      const r = cell.row + offset.row;
                      const c = cell.col + offset.col;
                      if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
                        const neighbor = grid[r]?.[c];
                        if (neighbor?.unit && neighbor.unit.type === 'tank' && neighbor.unit.team === unit.team && neighbor.unit.hp > 0 && !neighbor.unit.dead && neighbor.unit.id !== unit.id) {
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

      {/* Shield bond connections – visible during placement AND combat */}
      {(isPlacing || phase === 'place_enemy' || phase === 'battle') && (() => {
        const bonds: { tankRow: number; tankCol: number; unitRow: number; unitCol: number; team: 'player' | 'enemy' }[] = [];
        const tanks = grid.flat().filter(c => c.unit && !c.unit.dead && c.unit.type === 'tank');
        for (const tankCell of tanks) {
          const tank = tankCell.unit!;
          for (const offset of [{ row: -1, col: 0 }, { row: 1, col: 0 }, { row: 0, col: -1 }, { row: 0, col: 1 }, { row: -1, col: -1 }, { row: -1, col: 1 }, { row: 1, col: -1 }, { row: 1, col: 1 }]) {
            const r = tankCell.row + offset.row;
            const c = tankCell.col + offset.col;
            if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
              const neighbor = grid[r][c];
              if (neighbor.unit && !neighbor.unit.dead && neighbor.unit.team === tank.team && neighbor.unit.id !== tank.id) {
                bonds.push({ tankRow: tankCell.row, tankCol: tankCell.col, unitRow: r, unitCol: c, team: tank.team });
              }
            }
          }
        }
        return bonds.map((b, i) => {
          const x1 = b.tankCol * cellSize + cellSize / 2;
          const y1 = visualRow(b.tankRow) * cellSize + cellSize / 2;
          const x2 = b.unitCol * cellSize + cellSize / 2;
          const y2 = visualRow(b.unitRow) * cellSize + cellSize / 2;
          const isOwnTeam = flipped ? b.team === 'enemy' : b.team === 'player';
          const color = isOwnTeam ? 'hsl(152, 60%, 48%)' : 'hsl(0, 72%, 55%)';
          return (
            <svg key={`bond-${i}`} className="absolute inset-0 z-20 pointer-events-none w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={color}
                strokeWidth="0.6"
                strokeDasharray="1.5,1"
                opacity="0.7"
              >
                <animate attributeName="stroke-dashoffset" from="0" to="-5" dur="1.5s" repeatCount="indefinite" />
              </line>
              <circle cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} r="1.2" fill={color} opacity="0.8">
                <animate attributeName="opacity" values="0.4;0.9;0.4" dur="1.5s" repeatCount="indefinite" />
              </circle>
            </svg>
          );
        });
      })()}

      {projectiles.map(p => {
        const fromX = p.fromCol * cellSize + cellSize / 2;
        const fromY = visualRow(p.fromRow) * cellSize + cellSize / 2;
        const toX = p.toCol * cellSize + cellSize / 2;
        const toY = visualRow(p.toRow) * cellSize + cellSize / 2;
        const projClass = p.type === 'arrow' ? 'projectile-arrow'
          : p.type === 'magic' ? 'projectile-magic'
          : p.type === 'frost' ? 'projectile-frost'
          : p.type === 'custom' ? 'projectile-magic'
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
            {p.iconFile ? (
              <img
                src={iconUrl(p.iconFile)}
                alt=""
                draggable={false}
                className="w-5 h-5 drop-shadow-lg"
                style={{ imageRendering: 'pixelated', filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.6))' }}
              />
            ) : (
              <span className={`text-xs drop-shadow-lg ${
                p.type === 'magic' ? 'text-sm magic-proj-glow' :
                p.type === 'frost' ? 'frost-proj-glow' :
                p.type === 'arrow' ? 'arrow-proj-trail' : ''
              }`}>{p.emoji}</span>
            )}
          </div>
        );
      })}

      {/* Damage popups overlay */}
      {popups.map(p => {
        const left = p.col * cellSize + cellSize / 2;
        const top = visualRow(p.row) * cellSize + cellSize / 4;
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
          const top = visualRow(cell.row) * cellSize;
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
        const top = visualRow(h.row) * cellSize;
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
        const top = visualRow(h.row) * cellSize + cellSize / 4;
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
        const top = visualRow(f.row) * cellSize;
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

      {/* Chain effects: lightning bolts / chaindancer chain – flashing SVG between cells */}
      {chainEffects.map(chain => {
        const color = chain.color === 'lightning' ? 'hsl(55, 100%, 65%)' : 'hsl(280, 90%, 70%)';
        const glow  = chain.color === 'lightning' ? 'hsl(55, 100%, 75%)' : 'hsl(290, 100%, 80%)';
        const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];
        for (let i = 0; i < chain.cells.length - 1; i++) {
          const a = chain.cells[i], b = chain.cells[i + 1];
          segments.push({
            x1: a.col * cellSize + cellSize / 2,
            y1: visualRow(a.row) * cellSize + cellSize / 2,
            x2: b.col * cellSize + cellSize / 2,
            y2: visualRow(b.row) * cellSize + cellSize / 2,
          });
        }
        return (
          <svg key={chain.id} className="absolute inset-0 z-40 pointer-events-none w-full h-full chain-flash" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <filter id={`chain-glow-${chain.id}`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="0.6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {segments.map((s, i) => (
              <g key={i} filter={`url(#chain-glow-${chain.id})`}>
                <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={glow} strokeWidth="1.4" opacity="0.55" />
                <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={color} strokeWidth="0.7" strokeDasharray="2 1" />
              </g>
            ))}
            {chain.cells.map((c, i) => (
              <circle key={`c-${i}`} cx={c.col * cellSize + cellSize / 2} cy={visualRow(c.row) * cellSize + cellSize / 2} r="2.2" fill={glow} opacity="0.9" />
            ))}
          </svg>
        );
      })}

      {/* Mage impulse: expanding shockwave ring centered on mage, spans 7x7 */}
      {impulseEffects.map(imp => {
        const cx = imp.col * cellSize + cellSize / 2;
        const cy = visualRow(imp.row) * cellSize + cellSize / 2;
        return (
          <svg key={imp.id} className="absolute inset-0 z-[5] pointer-events-none w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <radialGradient id={`imp-grad-${imp.id}`}>
                <stop offset="0%" stopColor="hsl(270, 100%, 80%)" stopOpacity="0.0" />
                <stop offset="70%" stopColor="hsl(270, 100%, 75%)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="hsl(280, 100%, 65%)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx={cx} cy={cy} r={cellSize * 3.5} fill={`url(#imp-grad-${imp.id})`} className="mage-impulse-fill" />
            <circle cx={cx} cy={cy} r={cellSize * 3.5} fill="none" stroke="hsl(270, 100%, 80%)" strokeWidth="0.8" className="mage-impulse-ring" />
            <circle cx={cx} cy={cy} r={cellSize * 3.5} fill="none" stroke="hsl(290, 100%, 90%)" strokeWidth="0.4" className="mage-impulse-ring-inner" />
          </svg>
        );
      })}

      {/* Shadowblade teleport puffs */}
      {teleportEffects.map(tp => (
        <div
          key={tp.id}
          className={`absolute pointer-events-none z-40 ${tp.kind === 'out' ? 'teleport-out' : 'teleport-in'}`}
          style={{
            left: `${tp.col * cellSize}%`,
            top: `${visualRow(tp.row) * cellSize}%`,
            width: `${cellSize}%`,
            height: `${cellSize}%`,
          }}
        >
          <div className="absolute inset-0 teleport-puff-bg" />
          <div className="absolute inset-0 flex items-center justify-center text-2xl teleport-puff-emoji">💨</div>
        </div>
      ))}
    </div>
  );
}
