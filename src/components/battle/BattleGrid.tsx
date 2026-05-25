import { useState, useEffect, useRef, useMemo } from 'react';
import { Cell, GRID_SIZE, PLAYER_ROWS, UNIT_DEFS, UNIT_COLOR_GROUPS, Phase, ColorGroup, UnitType, TERRAIN_DEFS } from '@/lib/battleGame';
import { BattleEvent } from '@/lib/battleEvents';
import { UnitGlyph } from '@/components/UnitGlyph';
import { getAttackIcon, iconUrl, getAnimation, getAnimationEntry, loadAnimationManifest } from '@/lib/unitIcons';
import { EffectAnimationPreview } from '@/components/EffectAnimationPreview';
import battlefieldGrass from '@/assets/battlefield-grass.png';
import battlefieldDesert from '@/assets/battlefield-desert.png';

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
  /** Increments each new match — re-rolls battlefield background */
  matchId?: number;
  /** Per-cell aura overlay map: "r-c" -> 'buff' | 'nerf' (shown around placed units). */
  auraOverlay?: Map<string, 'buff' | 'nerf'>;
  /** Cells belonging to the currently selected formation (shown highlighted during combat). */
  selectedFormationCells?: Set<string>;
}

interface UnitPos { row: number; col: number }
interface DamagePopup { id: string; row: number; col: number; damage: number; isStrong: boolean; isWeak: boolean; isKill: boolean }
interface HealPopup { id: string; row: number; col: number; healAmount: number }
interface Projectile { id: string; fromRow: number; fromCol: number; toRow: number; toCol: number; emoji: string; iconFile?: string | null; type?: 'arrow' | 'magic' | 'frost' | 'default' | 'custom' | 'heal' }
interface DragonFire { id: string; cells: { row: number; col: number }[] }
interface HealGlow { id: string; row: number; col: number }
interface FreezeEffect { id: string; row: number; col: number }
interface ChainEffect { id: string; cells: { row: number; col: number }[]; color: 'lightning' | 'chaindancer' }
interface ImpulseEffect { id: string; row: number; col: number; kind: 'push' | 'pull' }
interface FrostNovaEffect { id: string; row: number; col: number }
interface RiderHornFlash { id: string; row: number; col: number; kind: 'inner' | 'outer' }
interface DragonSpinFlame { id: string; row: number; col: number; delayMs: number }
interface TeleportEffect { id: string; row: number; col: number; kind: 'out' | 'in' }

export function BattleGrid({ grid, phase, onCellClick, lastPlaced, battleEvents = [], moraleBoostActive, opponentMoraleActive, focusFireActive, sacrificeFlash, alwaysShowColorDots, showZoneColors, flipped, dragPreview, matchId, auraOverlay, selectedFormationCells }: BattleGridProps) {
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
  const [mirrorExplosions, setMirrorExplosions] = useState<{ id: string; row: number; col: number }[]>([]);
  const mirrorExplosionCounter = useRef(0);
  const [teleportEffects, setTeleportEffects] = useState<TeleportEffect[]>([]);
  const teleportCounter = useRef(0);
  const [frostNovaEffects, setFrostNovaEffects] = useState<FrostNovaEffect[]>([]);
  const frostNovaCounter = useRef(0);
  const [hornFlashes, setHornFlashes] = useState<RiderHornFlash[]>([]);
  const hornCounter = useRef(0);
  const [dragonSpinFlames, setDragonSpinFlames] = useState<DragonSpinFlame[]>([]);
  const dragonSpinCounter = useRef(0);
  const [dragonAnims, setDragonAnims] = useState<{ id: string; row: number; col: number; file: string }[]>([]);
  const dragonAnimCounter = useRef(0);
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

  // Random battlefield background per MATCH (re-rolls when matchId changes)
  const BATTLEFIELDS = useMemo(() => [
    { id: 'grass' as const, url: battlefieldGrass },
    { id: 'desert' as const, url: battlefieldDesert },
  ], []);
  const [battlefield, setBattlefield] = useState(() => BATTLEFIELDS[Math.floor(Math.random() * BATTLEFIELDS.length)]);
  const battlefieldBg = battlefield.url;
  const prevMatchIdRef = useRef<number | undefined>(matchId);
  useEffect(() => {
    if (matchId !== undefined && matchId !== prevMatchIdRef.current) {
      setBattlefield(BATTLEFIELDS[Math.floor(Math.random() * BATTLEFIELDS.length)]);
      prevMatchIdRef.current = matchId;
    }
  }, [matchId, BATTLEFIELDS]);


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

    // --- Animation stagger ---
    // When many "heavy" specials trigger in the same tick (e.g. 5 mages
    // pulsing at once), rendering them on the exact same frame causes a
    // visible hitch. Gameplay state is already resolved — we only stagger
    // the *visual* spawn of those effects by tiny micro-delays per unique
    // attacker. Deterministic order = same on both SP/MP clients.
    const HEAVY_TYPES = new Set(['impulse', 'mirrorExplode', 'frostNova', 'riderHorn', 'dragonSpin', 'teleport', 'chain', 'spawn']);
    const STAGGER_MS = 55;
    const staggerOrder = new Map<string, number>();
    for (const evt of events) {
      if (!HEAVY_TYPES.has(evt.type)) continue;
      if (!staggerOrder.has(evt.attackerId)) staggerOrder.set(evt.attackerId, staggerOrder.size);
    }
    const delayFor = (attackerId: string) => (staggerOrder.get(attackerId) ?? 0) * STAGGER_MS;


    // Separate ranged (projectile) and melee events
    const rangedDamageEvents: BattleEvent[] = [];
    const meleeDamageEvents: BattleEvent[] = [];
    const healEvents: BattleEvent[] = [];
    const freezeEvents: BattleEvent[] = [];

    for (const evt of events) {
      // Impulse / teleport / spawn are visual-only and must not produce
      // projectiles, damage popups or AOE fire overlays.
      if (evt.type === 'impulse' || evt.type === 'teleport' || evt.type === 'spawn' || evt.type === 'frostNova' || evt.type === 'riderHorn' || evt.type === 'dragonSpin' || evt.type === 'mirrorExplode') continue;
      if (evt.type === 'volleyMiss') { rangedDamageEvents.push(evt); continue; }
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
          if (evt.type === 'volleyMiss') continue; // visual-only arrow, no popup/shake
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
    type ChainEntry = { eff: ChainEffect; delay: number };
    const chainEntries: ChainEntry[] = [];
    for (const evt of events) {
      if (!evt.chainCells || evt.chainCells.length < 2) continue;
      chainCounter.current += 1;
      const baseDelay = evt.type === 'chain' ? 0 : PROJECTILE_FLIGHT_TIME;
      chainEntries.push({
        eff: {
          id: `chain-${chainCounter.current}`,
          cells: evt.chainCells,
          color: evt.type === 'chain' ? 'chaindancer' : 'lightning',
        },
        delay: baseDelay + delayFor(evt.attackerId),
      });
    }
    for (const { eff, delay } of chainEntries) {
      setTimeout(() => {
        setChainEffects(prev => [...prev, eff]);
        setTimeout(() => setChainEffects(prev => prev.filter(c => c.id !== eff.id)), 900);
      }, delay);
    }

    // --- Mage impulse (shockwave) ---
    type ImpulseEntry = { eff: ImpulseEffect; pushedIds: string[]; delay: number };
    const impulseEntries: ImpulseEntry[] = [];
    for (const evt of events) {
      if (evt.type !== 'impulse') continue;
      impulseCounter.current += 1;
      impulseEntries.push({
        eff: { id: `impulse-${impulseCounter.current}`, row: evt.attackerRow, col: evt.attackerCol, kind: evt.attackerType === 'magnetiker' ? 'pull' : 'push' },
        pushedIds: evt.pushedIds || [],
        delay: delayFor(evt.attackerId),
      });
    }
    for (const { eff, pushedIds, delay } of impulseEntries) {
      setTimeout(() => {
        setImpulseEffects(prev => [...prev, eff]);
        setTimeout(() => setImpulseEffects(prev => prev.filter(i => i.id !== eff.id)), 1500);
        if (pushedIds.length > 0) {
          setImpulsePushedIds(prev => {
            const next = new Set(prev);
            pushedIds.forEach(id => next.add(id));
            return next;
          });
          setTimeout(() => setImpulsePushedIds(prev => {
            const next = new Set(prev);
            pushedIds.forEach(id => next.delete(id));
            return next;
          }), 1700);
        }
      }, delay);
    }

    // --- Mirror death explosion (red 3x3 shockwave) ---
    type MirrorEntry = { eff: { id: string; row: number; col: number }; delay: number };
    const mirrorEntries: MirrorEntry[] = [];
    for (const evt of events) {
      if (evt.type !== 'mirrorExplode') continue;
      mirrorExplosionCounter.current += 1;
      mirrorEntries.push({
        eff: { id: `mirror-x-${mirrorExplosionCounter.current}`, row: evt.attackerRow, col: evt.attackerCol },
        delay: delayFor(evt.attackerId),
      });
    }
    for (const { eff, delay } of mirrorEntries) {
      setTimeout(() => {
        setMirrorExplosions(prev => [...prev, eff]);
        setTimeout(() => setMirrorExplosions(prev => prev.filter(m => m.id !== eff.id)), 1100);
      }, delay);
    }

    // --- Frost Nova (3x3 freeze burst) ---
    type NovaEntry = { eff: FrostNovaEffect; delay: number };
    const novaEntries: NovaEntry[] = [];
    for (const evt of events) {
      if (evt.type !== 'frostNova') continue;
      frostNovaCounter.current += 1;
      novaEntries.push({
        eff: { id: `nova-${frostNovaCounter.current}`, row: evt.attackerRow, col: evt.attackerCol },
        delay: delayFor(evt.attackerId),
      });
    }
    for (const { eff, delay } of novaEntries) {
      setTimeout(() => {
        setFrostNovaEffects(prev => [...prev, eff]);
        setTimeout(() => setFrostNovaEffects(prev => prev.filter(n => n.id !== eff.id)), 1100);
      }, delay);
    }

    // --- Rider horn: 2-step yellow wave (inner cells now, outer cells after 280ms) ---
    type HornEntry = { inner: RiderHornFlash[]; outer: RiderHornFlash[]; delay: number };
    const hornEntries: HornEntry[] = [];
    for (const evt of events) {
      if (evt.type !== 'riderHorn') continue;
      const inner: RiderHornFlash[] = [];
      const outer: RiderHornFlash[] = [];
      for (const c of evt.innerCells || []) {
        hornCounter.current += 1;
        inner.push({ id: `horn-i-${hornCounter.current}`, row: c.row, col: c.col, kind: 'inner' });
      }
      for (const c of evt.outerCells || []) {
        hornCounter.current += 1;
        outer.push({ id: `horn-o-${hornCounter.current}`, row: c.row, col: c.col, kind: 'outer' });
      }
      hornEntries.push({ inner, outer, delay: delayFor(evt.attackerId) });
    }
    for (const { inner, outer, delay } of hornEntries) {
      setTimeout(() => {
        if (inner.length > 0) {
          setHornFlashes(prev => [...prev, ...inner]);
          setTimeout(() => setHornFlashes(prev => prev.filter(f => !inner.find(n => n.id === f.id))), 650);
        }
        if (outer.length > 0) {
          setTimeout(() => {
            setHornFlashes(prev => [...prev, ...outer]);
            setTimeout(() => setHornFlashes(prev => prev.filter(f => !outer.find(n => n.id === f.id))), 650);
          }, 280);
        }
      }, delay);
    }

    // --- Dragon fire-spin: per-tick 3-cell beam, cells ignite one after another ---
    for (const evt of events) {
      if (evt.type !== 'dragonSpin') continue;

      // Fallback: original per-cell rotating flames
      const cells = evt.spinCells || [];
      const beamOrder = evt.spinBeamOrder ?? 0;
      const BEAM_GAP = 70; // ms between consecutive beams
      const CELL_GAP = 30; // ms between cells along a beam
      const baseDelay = delayFor(evt.attackerId);
      cells.forEach((c, i) => {
        dragonSpinCounter.current += 1;
        const flame: DragonSpinFlame = {
          id: `dspin-${dragonSpinCounter.current}`,
          row: c.row, col: c.col,
          delayMs: beamOrder * BEAM_GAP + i * CELL_GAP,
        };
        setTimeout(() => {
          setDragonSpinFlames(prev => [...prev, flame]);
          setTimeout(() => {
            setDragonSpinFlames(prev => prev.filter(x => x.id !== flame.id));
          }, 850);
        }, baseDelay + flame.delayMs);
      });
    }

    // --- Shadowblade teleport puffs ---
    type TeleportEntry = { effs: TeleportEffect[]; delay: number };
    const teleportEntries: TeleportEntry[] = [];
    for (const evt of events) {
      if (evt.type !== 'teleport') continue;
      teleportCounter.current += 1;
      const out: TeleportEffect = { id: `tp-out-${teleportCounter.current}`, row: evt.attackerRow, col: evt.attackerCol, kind: 'out' };
      teleportCounter.current += 1;
      const inn: TeleportEffect = { id: `tp-in-${teleportCounter.current}`, row: evt.targetRow, col: evt.targetCol, kind: 'in' };
      teleportEntries.push({ effs: [out, inn], delay: delayFor(evt.attackerId) });
    }
    for (const { effs, delay } of teleportEntries) {
      setTimeout(() => {
        setTeleportEffects(prev => [...prev, ...effs]);
        setTimeout(() => setTeleportEffects(prev => prev.filter(t => !effs.find(nt => nt.id === t.id))), 700);
      }, delay);
    }
  };


  const cellSize = 100 / GRID_SIZE;
  // When flipped, visual row position is inverted for overlay effects
  const visualRow = (r: number) => flipped ? (GRID_SIZE - 1 - r) : r;

  // Track grid pixel width for sprite-sheet animations (need px sizes for CSS steps())
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridPx, setGridPx] = useState(0);
  useEffect(() => {
    loadAnimationManifest();
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setGridPx(e.contentRect.width);
    });
    ro.observe(el);
    setGridPx(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  const cellPx = gridPx / GRID_SIZE;

  return (
    <div ref={gridRef} className="w-full aspect-square max-w-[min(100vw-2rem,28rem)] mx-auto relative">

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
          const isPhantom = unit ? !!unit.isPhantom && !unit.dead : false;
          const isBurning = unit ? !!(unit.burning && unit.burning.length > 0 && !unit.dead) : false;
          const isBleeding = unit ? !!(unit.bleeding && unit.bleeding.length > 0 && !unit.dead) : false;
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

          const vRow = flipped ? (GRID_SIZE - 1 - cell.row) : cell.row;
          const cellBgStyle = {
            backgroundImage: `url(${battlefieldBg})`,
            backgroundSize: `${GRID_SIZE * 100}% ${GRID_SIZE * 100}%`,
            backgroundPosition: `${(cell.col / (GRID_SIZE - 1)) * 100}% ${(vRow / (GRID_SIZE - 1)) * 100}%`,
          };

          return (
            <button
              key={cellKey}
              data-cell-row={cell.row}
              data-cell-col={cell.col}
              onClick={() => onCellClick(cell.row, cell.col)}
              style={cellBgStyle}
              className={`aspect-square flex flex-col items-center justify-center relative overflow-visible
                ${isPlayerZone && (isPlacing || showZoneColors) && !unit && terrain !== 'water' ? 'bg-primary/5' : ''} ${isPlayerZone && isPlacing && !unit && terrain !== 'water' ? 'hover:bg-primary/15 cursor-pointer' : isPlayerZone && isPlacing && terrain === 'water' ? 'cursor-not-allowed' : ''}
                ${(isEnemyZone && (showZoneColors || !isPlacing)) || (isEnemyZone && !unit) ? 'bg-danger/5' : ''}
                ${isDead ? 'bg-muted/40' : ''}
                
                
                ${isShaking ? 'shake-hit' : ''}
                transition-colors duration-200
              `}
            >
              {/* Lava overlay – persistent */}
              {(cell.lavaTicks ?? 0) > 0 && (
                <div className="absolute inset-0 z-0 pointer-events-none cell-lava" />
              )}
              {/* Obelisk aura overlay */}
              {(cell.obeliskAura ?? 0) > 0 && (
                <div
                  className={`absolute inset-0 z-0 pointer-events-none rounded-sm ${cell.obeliskAura === 2 ? 'cell-obelisk-beam' : 'cell-obelisk-aura'}`}
                />
              )}
              {/* Bomber bomb: render attack icon (or 💣) with fuse pulse */}
              {cell.bomb && (() => {
                const bombIcon = getAttackIcon('bomber');
                return (
                  <div className="absolute inset-0 z-[8] pointer-events-none flex items-center justify-center cell-bomb-pulse">
                    {bombIcon ? (
                      <img
                        src={iconUrl(bombIcon)}
                        alt="bomb"
                        draggable={false}
                        style={{ width: '70%', height: '70%', imageRendering: 'pixelated' }}
                      />
                    ) : (
                      <span className="text-2xl drop-shadow-[0_2px_3px_rgba(0,0,0,0.7)]">💣</span>
                    )}
                  </div>
                );
              })()}
              {/* Drag preview overlays */}
              {showDragAttack && <div className="absolute inset-0 z-20 pointer-events-none drag-preview-attack" />}
              {showDragMove && <div className="absolute inset-0 z-20 pointer-events-none drag-preview-move" />}
              {isDragOrigin && <div className="absolute inset-0 z-20 pointer-events-none drag-preview-origin" />}
              {/* Aura overlay (placement preview) */}
              {auraOverlay && (() => {
                const k = auraOverlay.get(cellKey);
                if (!k) return null;
                const isBuff = k === 'buff';
                return (
                  <div
                    className={`absolute inset-0 z-[6] pointer-events-none flex items-center justify-center rounded-sm ${isBuff ? 'bg-green-500/25 ring-1 ring-green-400/60' : 'bg-red-500/25 ring-1 ring-red-400/60'}`}
                  >
                    <span className={`text-base font-black drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] ${isBuff ? 'text-green-200' : 'text-red-200'}`}>
                      {isBuff ? '+' : '−'}
                    </span>
                  </div>
                );
              })()}
              {/* Formation selection highlight (combat) */}
              {selectedFormationCells?.has(cellKey) && (
                <div className="absolute inset-0 z-[7] pointer-events-none rounded-sm ring-2 ring-primary/80 bg-primary/10 animate-pulse" />
              )}
              {/* Placement attack/move flash overlays (transparent, don't replace cell bg) */}
              {isFlashing && <div className="placement-attack-flash" />}
              {isMoveFlashing && !isFlashing && <div className="placement-move-flash" />}
              {/* Placement impact */}
              {isImpact && <div className="placement-impact" />}
              {/* Terrain emoji (show when no unit or unit is dead) */}
              {hasTerrain && (!unit || isDead) && (
                <span className="text-[11px] select-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">{terrain === 'forest' && battlefield.id === 'desert' ? '🌵' : TERRAIN_DEFS[terrain].emoji}</span>
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
                  {/* Persistent bleed overlay – vampire bite DoT */}
                  {isBleeding && (
                    <div className="absolute inset-0 z-0 pointer-events-none rounded-sm animate-pulse"
                      style={{
                        background: 'radial-gradient(circle at 50% 35%, hsl(0 85% 45% / 0.45), hsl(0 90% 30% / 0.20) 70%, transparent 100%)',
                        boxShadow: 'inset 0 -6px 8px hsl(0 90% 35% / 0.55)',
                      }}
                    />
                  )}
                  {isPhantom && (
                    <div className="absolute inset-0 z-0 pointer-events-none rounded-sm animate-pulse"
                      style={{
                        background: 'linear-gradient(135deg, hsl(280 80% 70% / 0.35), hsl(220 90% 70% / 0.25))',
                        boxShadow: 'inset 0 0 10px hsl(270 90% 75% / 0.7), 0 0 8px hsl(280 80% 65% / 0.5)',
                      }}
                    />
                  )}
                  {/* Curse overlay – shadowpriest stacks (subtle at 1-2, intense at 3) */}
                  {(unit.curseStacks || 0) > 0 && (
                    <div
                      className={`absolute inset-0 z-0 pointer-events-none rounded-sm ${unit.cursed ? 'cell-cursed-3' : 'cell-cursed'}`}
                    />
                  )}
                  {/* Obelisk buff aura on unit */}
                  {(unit.obeliskBuff || 0) > 0 && (
                    <div className="absolute inset-0 z-0 pointer-events-none rounded-sm cell-obelisk-buff" />
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
                          ? 'drop-shadow(0 0 5px hsl(152, 80%, 50%)) drop-shadow(0 0 10px hsl(152, 80%, 50%)) drop-shadow(0 0 16px hsl(152, 85%, 45%))'
                          : 'drop-shadow(0 0 5px hsl(0, 85%, 55%)) drop-shadow(0 0 10px hsl(0, 85%, 55%)) drop-shadow(0 0 16px hsl(0, 85%, 50%))',
                    }}
                  >
                    {unit.type && <UnitGlyph type={unit.type} isClone={unit.isClone} className="inline-block w-5 h-5 sm:w-6 sm:h-6 align-middle" />}
                    {isFrozen && <span className="absolute -top-0.5 -right-0.5 text-[8px]">🧊</span>}
                    {isWebbed && !isFrozen && <span className="absolute -top-0.5 -right-0.5 text-[8px]">🕸️</span>}
                    {isBurning && !isFrozen && !isWebbed && <span className="absolute -top-0.5 -right-0.5 text-[8px]">🔥</span>}
                    {isBleeding && !isFrozen && !isWebbed && !isBurning && <span className="absolute -top-0.5 -right-0.5 text-[8px]">🩸</span>}
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

      {/* Mage impulse (push, expands) / Magnetiker pull (shrinks inward) */}
      {impulseEffects.map(imp => {
        const cx = imp.col * cellSize + cellSize / 2;
        const cy = visualRow(imp.row) * cellSize + cellSize / 2;
        const isPull = imp.kind === 'pull';
        const ringStroke = isPull ? 'hsl(180, 100%, 70%)' : 'hsl(270, 100%, 80%)';
        const ringStrokeInner = isPull ? 'hsl(200, 100%, 85%)' : 'hsl(290, 100%, 90%)';
        const fillStop1 = isPull ? 'hsl(180, 100%, 70%)' : 'hsl(270, 100%, 80%)';
        const fillStop2 = isPull ? 'hsl(200, 100%, 60%)' : 'hsl(280, 100%, 65%)';
        const fillCls = isPull ? 'magnet-impulse-fill' : 'mage-impulse-fill';
        const ringCls = isPull ? 'magnet-impulse-ring' : 'mage-impulse-ring';
        const ringInnerCls = isPull ? 'magnet-impulse-ring-inner' : 'mage-impulse-ring-inner';
        return (
          <svg key={imp.id} className="absolute inset-0 z-[5] pointer-events-none w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <radialGradient id={`imp-grad-${imp.id}`}>
                <stop offset="0%" stopColor={fillStop1} stopOpacity="0.0" />
                <stop offset="70%" stopColor={fillStop1} stopOpacity="0.35" />
                <stop offset="100%" stopColor={fillStop2} stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx={cx} cy={cy} r={cellSize * 3.5} fill={`url(#imp-grad-${imp.id})`} className={fillCls} />
            <circle cx={cx} cy={cy} r={cellSize * 3.5} fill="none" stroke={ringStroke} strokeWidth="0.8" className={ringCls} />
            <circle cx={cx} cy={cy} r={cellSize * 3.5} fill="none" stroke={ringStrokeInner} strokeWidth="0.4" className={ringInnerCls} />
          </svg>
        );
      })}

      {/* Mirror death explosion: red expanding shockwave covering 3x3 around the mirror cell */}
      {mirrorExplosions.map(mx => {
        const cx = mx.col * cellSize + cellSize / 2;
        const cy = visualRow(mx.row) * cellSize + cellSize / 2;
        return (
          <svg key={mx.id} className="absolute inset-0 z-[6] pointer-events-none w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <radialGradient id={`mx-grad-${mx.id}`}>
                <stop offset="0%" stopColor="hsl(0, 100%, 90%)" stopOpacity="0.9" />
                <stop offset="55%" stopColor="hsl(8, 100%, 60%)" stopOpacity="0.7" />
                <stop offset="100%" stopColor="hsl(0, 100%, 45%)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx={cx} cy={cy} r={cellSize * 1.5} fill={`url(#mx-grad-${mx.id})`} className="mirror-explode-fill" />
            <circle cx={cx} cy={cy} r={cellSize * 1.5} fill="none" stroke="hsl(0, 100%, 70%)" strokeWidth="1.2" className="mirror-explode-ring" />
            <circle cx={cx} cy={cy} r={cellSize * 1.5} fill="none" stroke="hsl(20, 100%, 80%)" strokeWidth="0.6" className="mirror-explode-ring-inner" />
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

      {/* Frost Nova: expanding cyan burst centered on frost mage, spans 3x3 */}
      {frostNovaEffects.map(nv => {
        const cx = nv.col * cellSize + cellSize / 2;
        const cy = visualRow(nv.row) * cellSize + cellSize / 2;
        return (
          <svg key={nv.id} className="absolute inset-0 z-[5] pointer-events-none w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <radialGradient id={`nova-grad-${nv.id}`}>
                <stop offset="0%" stopColor="hsl(190, 100%, 92%)" stopOpacity="0.0" />
                <stop offset="55%" stopColor="hsl(195, 100%, 75%)" stopOpacity="0.55" />
                <stop offset="100%" stopColor="hsl(210, 100%, 65%)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx={cx} cy={cy} r={cellSize * 1.6} fill={`url(#nova-grad-${nv.id})`} className="frost-nova-fill" />
            <circle cx={cx} cy={cy} r={cellSize * 1.6} fill="none" stroke="hsl(195, 100%, 85%)" strokeWidth="1.0" className="frost-nova-ring" />
            <circle cx={cx} cy={cy} r={cellSize * 1.6} fill="none" stroke="hsl(210, 100%, 95%)" strokeWidth="0.5" className="frost-nova-ring-inner" />
            {/* Snowflake glyphs at the 8 surrounding cells */}
            {[-1, 0, 1].map(dr => [-1, 0, 1].map(dc => {
              if (dr === 0 && dc === 0) return null;
              const sx = (nv.col + dc) * cellSize + cellSize / 2;
              const sy = visualRow(nv.row + dr) * cellSize + cellSize / 2;
              return (
                <text
                  key={`${dr}-${dc}`}
                  x={sx}
                  y={sy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={cellSize * 0.55}
                  className="frost-nova-flake"
                >❄</text>
              );
            }))}
          </svg>
        );
      })}

      {/* Rider horn: yellow square flash on each cell of the inner 3×3 then outer 5×5 ring */}
      {hornFlashes.map(f => (
        <div
          key={f.id}
          className={f.kind === 'inner' ? 'horn-flash-inner' : 'horn-flash-outer'}
          style={{
            position: 'absolute',
            left: `${f.col * cellSize}%`,
            top: `${visualRow(f.row) * cellSize}%`,
            width: `${cellSize}%`,
            height: `${cellSize}%`,
            pointerEvents: 'none',
            zIndex: 6,
          }}
        />
      ))}

      {/* Dragon fire-spin beam: per-cell sequential ignition */}
      {dragonSpinFlames.map(f => (
        <div
          key={f.id}
          className="dragon-fire-cell"
          style={{
            position: 'absolute',
            left: `${f.col * cellSize}%`,
            top: `${visualRow(f.row) * cellSize}%`,
            width: `${cellSize}%`,
            height: `${cellSize}%`,
            pointerEvents: 'none',
            zIndex: 7,
          }}
        >
          <div
            className="dragon-fire-emoji"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: `${cellSize * 0.55}cqw`,
            }}
          >🔥</div>
        </div>
      ))}

    </div>
  );
}

