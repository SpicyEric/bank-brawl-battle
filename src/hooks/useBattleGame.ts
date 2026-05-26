import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Unit, UnitType, Cell, Phase, ColorGroup,
  createEmptyGrid, createUnit, findTarget, moveToward, canAttack, calcDamage,
  generateAIPlacement, getMaxUnits, generateTerrain, setBondsForPlacement, moveTankFormation,
  GRID_SIZE, MAX_UNITS, PLAYER_ROWS, UNIT_DEFS, UNIT_TYPES, UNIT_COLOR_GROUPS, ROUNDS_TO_WIN, BASE_UNITS, ROUND_TIME_LIMIT,
  OVERTIME_THRESHOLD, AUTO_OVERTIMES, MAX_OVERTIMES, PLACE_TIME_LIMIT,
  getActivationTurn,
  applyPostAttackEffects, applyDeathEffects, applyMirrorReflect, processLavaTick, processGhostTick, shouldSkipMove,
  spawnDoppelgangerPhantoms, tickPhantomTimers, applyChainAttack, tickClonerSpawns, tickMageImpulse, tickFrostNova, tickRiderHorn, tickArcherVolley, tickDragonSpin, tickMagnetPull, handleShadowbladeTick, leaveArsonistTrail,
  handleTerrainSeeker, isImmuneToFreeze, isImmuneToFire, effectiveCooldown, tickTerrainHeals,
  tickBomberActions, tickBombFuses, tickObeliskAura, tickShadowpriestHarvest, applyShadowpriestCurse,
} from '@/lib/battleGame';
import { BattleEvent } from '@/lib/battleEvents';
import { findFormations, applyFormationMove, findFormationContaining } from '@/lib/formations';
import { sfxHit, sfxCriticalHit, sfxKill, sfxFreeze, sfxProjectile } from '@/lib/sfx';
import { matchRecorder } from '@/lib/matchRecorder';
import { loadAuraData, type AuraZoneMap, type AuraEffectMap } from '@/lib/auraData';
import { applyAuraStacks, applyAuraTick, applyAuraOnAttack, applyAuraOnDeath, applyAuraSourceEffects, applyDefenderShare, fireLightningTakenMul, hasImmuneFFP } from '@/lib/auraEffects';

// Roster slots: 0..2 = red, 3..5 = green, 6..8 = blue
const SLOT_COLORS: ColorGroup[] = ['red','red','red','green','green','green','blue','blue','blue'];
const FORMATION_MODE = true;
const BATTLE_WORLD_ROWS = 24;

function createBattleWorldGrid(): Cell[][] {
  return Array.from({ length: BATTLE_WORLD_ROWS }, (_, row) =>
    Array.from({ length: GRID_SIZE }, (_, col) => ({ row, col, unit: null, terrain: 'none' as const }))
  );
}

export function useBattleGame(difficulty: number = 2, roster?: UnitType[], handicap: number = 0) {
  const hasRoster = !!(roster && roster.length === 9);
  const safeHandicap = Math.max(0, Math.min(3, handicap | 0));
  const [grid, setGrid] = useState<Cell[][]>(() => generateTerrain(createEmptyGrid()));
  const [phase, setPhase] = useState<Phase>('place_player');
  // Slot-based selection (when roster present). Otherwise legacy type-based.
  const [selectedSlot, setSelectedSlot] = useState<number | null>(hasRoster ? 0 : null);
  const initialSelected = (hasRoster ? roster![0] : 'warrior') as UnitType;
  const [selectedUnit, setSelectedUnitState] = useState<UnitType | null>(initialSelected);
  const setSelectedUnit = useCallback((t: UnitType | null) => setSelectedUnitState(t), []);
  const [playerUnits, setPlayerUnits] = useState<Unit[]>([]);
  const [enemyUnits, setEnemyUnits] = useState<Unit[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [battleLog, setBattleLog] = useState<string[]>([]);
  const [playerScore, setPlayerScore] = useState(0);
  const [enemyScore, setEnemyScore] = useState(0);
  const playerScoreRef = useRef(0);
  const enemyScoreRef = useRef(0);
  const [roundNumber, setRoundNumber] = useState(1);
  const [playerStarts, setPlayerStarts] = useState(true);
  const battleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [battleEvents, setBattleEvents] = useState<BattleEvent[]>([]);
  const [battleTimer, setBattleTimer] = useState(ROUND_TIME_LIMIT);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnCountRef = useRef(0);
  // Stalemate detection: if total HP across all units does not change for N ticks,
  // force every unit to rush one step toward the nearest enemy.
  const stalemateHpRef = useRef<number>(-1);
  const stalemateTicksRef = useRef<number>(0);
  const stalemateRushRef = useRef<number>(0); // remaining ticks of forced rush

  // Placement timer: always-on 30s simultaneous live-placement
  const hasPlaceTimer = true;
  const [placeTimer, setPlaceTimer] = useState(PLACE_TIME_LIMIT);
  const placeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerUnitsRef = useRef(playerUnits);
  useEffect(() => { playerUnitsRef.current = playerUnits; }, [playerUnits]);
  const enemyUnitsRef = useRef(enemyUnits);
  useEffect(() => { enemyUnitsRef.current = enemyUnits; }, [enemyUnits]);
  // Track if AI drip-placement already kicked off for this match
  const aiDripStartedRef = useRef(false);
  const aiDripTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Plan of all AI drip placements for this placement phase (so spy can flush them instantly).
  const aiDripPendingRef = useRef<{ type: UnitType; row: number; col: number }[]>([]);

  // Aura data (loaded once)
  const auraRef = useRef<{ zones: AuraZoneMap; effects: AuraEffectMap }>({ zones: {}, effects: {} });
  useEffect(() => {
    loadAuraData().then(d => { auraRef.current = d; }).catch(() => {});
  }, []);


  // Fatigue system:
  // - Slot mode (roster): key = slot index (0..8). One slot = one bench-able unit instance.
  // - Legacy mode: key = unit type.
  const [playerFatigue, setPlayerFatigue] = useState<Record<string, number>>({});
  const [enemyFatigue, setEnemyFatigue] = useState<Record<string, number>>({});
  // Handicap locks the last `handicap` roster slots for the entire match.
  const handicapBannedSlots: number[] = hasRoster && safeHandicap > 0
    ? Array.from({ length: safeHandicap }, (_, i) => 9 - 1 - i)
    : [];
  const playerBannedSlots: number[] = hasRoster
    ? Array.from(new Set([
        ...roster!.map((_, i) => i).filter(i => (playerFatigue[i] || 0) >= 1),
        ...handicapBannedSlots,
      ]))
    : [];
  const playerBannedUnits: UnitType[] = hasRoster
    ? [] // not used in slot mode (picker uses bannedSlots)
    : UNIT_TYPES.filter(t => (playerFatigue[t] || 0) >= 1);
  const enemyBannedUnits: UnitType[] = UNIT_TYPES.filter(t => (enemyFatigue[t] || 0) >= 1);


  // Morale boost state
  const [moraleBoostUsed, setMoraleBoostUsed] = useState(false);
  const [moraleBoostActive, setMoraleBoostActive] = useState<'buff' | 'debuff' | null>(null);
  const moraleTicksLeft = useRef(0);
  const moralePhase = useRef<'none' | 'buff' | 'debuff'>('none');

  // Focus Fire state
  const [focusFireUsed, setFocusFireUsed] = useState(false);
  const [focusFireActive, setFocusFireActive] = useState(false);
  const focusFireTicksLeft = useRef(0);

  // Sacrifice Ritual state
  const [sacrificeUsed, setSacrificeUsed] = useState(false);

  // Shield Wall state
  const [shieldWallUsed, setShieldWallUsed] = useState(false);
  const [shieldWallActive, setShieldWallActive] = useState(false);
  const shieldWallTicksLeft = useRef(0);

  // Flank state (left=-1, right=+1). One-shot per side per match.
  const [flankLeftUsed, setFlankLeftUsed] = useState(false);
  const [flankRightUsed, setFlankRightUsed] = useState(false);
  const [flankActive, setFlankActive] = useState<'left' | 'right' | null>(null);
  const flankActiveRef = useRef<{ dir: -1 | 1; step: number } | null>(null);


  // AI ability state
  const aiMoraleUsed = useRef(false);
  const aiMoralePhase = useRef<'none' | 'buff' | 'debuff'>('none');
  const aiMoraleTicksLeft = useRef(0);
  const [aiMoraleActive, setAiMoraleActive] = useState<'buff' | 'debuff' | null>(null);
  const aiFocusFireUsed = useRef(false);
  const aiFocusFireTicksLeft = useRef(0);
  const aiSacrificeUsed = useRef(false);

  // Overtime state
  const [overtimeCount, setOvertimeCount] = useState(0);
  const [drawOfferPending, setDrawOfferPending] = useState(false);
  const [gameDraw, setGameDraw] = useState(false);

  // Round-based win check: first to ROUNDS_TO_WIN round wins wins the match
  const checkGameOver = useCallback((pScore: number, eScore: number): { over: boolean; won: boolean; draw: boolean } => {
    if (pScore >= ROUNDS_TO_WIN) return { over: true, won: true, draw: false };
    if (eScore >= ROUNDS_TO_WIN) return { over: true, won: false, draw: false };
    return { over: false, won: false, draw: false };
  }, []);

  // Full reset
  const resetGame = useCallback(() => {
    setGrid(generateTerrain(createEmptyGrid()));
    setPlayerUnits([]);
    setEnemyUnits([]);
    setPhase('place_player');
    setTurnCount(0);
    turnCountRef.current = 0;
    setBattleLog([]);
    setSelectedUnit('warrior');
    setPlayerScore(0); playerScoreRef.current = 0;
    setEnemyScore(0); enemyScoreRef.current = 0;
    setRoundNumber(1);
    setPlayerStarts(true);
    setMoraleBoostUsed(false);
    setMoraleBoostActive(null);
    moraleTicksLeft.current = 0;
    moralePhase.current = 'none';
    setFocusFireUsed(false);
    setFocusFireActive(false);
    focusFireTicksLeft.current = 0;
    setSacrificeUsed(false);
    setShieldWallUsed(false);
    setShieldWallActive(false);
    shieldWallTicksLeft.current = 0;
    setFlankLeftUsed(false);
    setFlankRightUsed(false);
    setFlankActive(null);
    flankActiveRef.current = null;
    aiMoraleUsed.current = false;
    aiMoralePhase.current = 'none';
    aiMoraleTicksLeft.current = 0;
    setAiMoraleActive(null);
    aiFocusFireUsed.current = false;
    aiFocusFireTicksLeft.current = 0;
    aiSacrificeUsed.current = false;
    setOvertimeCount(0);
    setDrawOfferPending(false);
    setGameDraw(false);
    setPlayerFatigue({});
    setEnemyFatigue({});
    setPlaceTimer(PLACE_TIME_LIMIT);
    aiDripStartedRef.current = false;
    for (const t of aiDripTimeoutsRef.current) clearTimeout(t);
    aiDripTimeoutsRef.current = [];
  }, []);

  // Placement timer countdown (difficulty 2+)
  useEffect(() => {
    if (phase !== 'place_player' || !hasPlaceTimer) {
      if (placeTimerRef.current) clearInterval(placeTimerRef.current);
      return;
    }
    setPlaceTimer(PLACE_TIME_LIMIT);
    placeTimerRef.current = setInterval(() => {
      setPlaceTimer(prev => {
        if (prev <= 1) {
          if (placeTimerRef.current) clearInterval(placeTimerRef.current);
          // Auto-confirm placement when timer runs out
          setTimeout(() => {
            if (playerUnitsRef.current.length > 0) {
              // Will be handled by confirmPlacement call below
            }
            // Force confirm even with 0 units - skip turn
            confirmPlacementRef.current?.();
          }, 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (placeTimerRef.current) clearInterval(placeTimerRef.current); };
  }, [phase, hasPlaceTimer, roundNumber]);

  const confirmPlacementRef = useRef<(() => void) | null>(null);

  // Rundenskalierung: Runde 1 = 9 Einheiten, +2 pro Runde bis Runde 5 = 17.
  // Handicap zieht von der eigenen Einheitenzahl ab (Mindestens 1).
  const rosterMaxUnitsBase = Math.min(9 + (roundNumber - 1) * 2, 17);
  const rosterMaxUnits = hasRoster ? Math.max(1, rosterMaxUnitsBase - safeHandicap) : rosterMaxUnitsBase;
  const playerMaxUnits = hasRoster ? rosterMaxUnits : getMaxUnits(playerScore, enemyScore, roundNumber);
  const enemyMaxUnits = hasRoster ? rosterMaxUnitsBase : playerMaxUnits;

  // Slot mode: slots can be reused on the battlefield (mono comps allowed).
  // placedSlots is kept empty so the picker never disables a slot during placement.
  const placedSlots = new Set<number>();

  // Place unit (optionally overriding the selected slot — used by drag-and-drop)
  const placeUnit = useCallback((row: number, col: number, overrideSlot?: number) => {
    if (phase !== 'place_player') return;
    if (!PLAYER_ROWS.includes(row)) return;
    if (playerUnits.length >= playerMaxUnits) return;
    if (grid[row][col].unit?.team === 'player') return;
    if (grid[row][col].terrain === 'water') return;
    // Enemy units conceptually live on their own 8x8 field. They may share
    // the same visible cell during placement, but the player can always
    // build on top — the enemy stays tracked in enemyUnits state and ends
    // up on its own lane row (0-7) once the battle starts.

    let type: UnitType | null = null;
    let color: ColorGroup | undefined;
    let slotIdx: number | undefined;

    if (hasRoster) {
      const useSlot = overrideSlot !== undefined ? overrideSlot : selectedSlot;
      if (useSlot === null || useSlot === undefined) return;
      if (playerBannedSlots.includes(useSlot)) return;
      type = roster![useSlot];
      color = SLOT_COLORS[useSlot];
      slotIdx = useSlot;
    } else {
      if (!selectedUnit) return;
      if (playerBannedUnits.includes(selectedUnit)) return;
      type = selectedUnit;
    }

    const unit = createUnit(type, 'player', row, col, color, slotIdx);
    setPlayerUnits(prev => [...prev, unit]);
    setGrid(prev => {
      const next = prev.map(r => r.map(c => ({ ...c })));
      next[row][col] = { ...next[row][col], unit };
      return next;
    });

    // Keep current slot selected so the user can place the same unit again (mono comps).
  }, [phase, selectedUnit, selectedSlot, hasRoster, roster, playerUnits, grid, playerMaxUnits, playerBannedUnits, playerBannedSlots, placedSlots]);


  // Remove placed unit (and restore any hidden enemy that was on the same cell)
  const removeUnit = useCallback((unitId: string) => {
    if (phase !== 'place_player') return;
    setPlayerUnits(prev => {
      const unit = prev.find(u => u.id === unitId);
      if (!unit) return prev;
      setGrid(g => {
        const next = g.map(r => r.map(c => ({ ...c })));
        const hiddenEnemy = enemyUnitsRef.current.find(e => e.row === unit.row && e.col === unit.col);
        next[unit.row][unit.col].unit = hiddenEnemy ?? null;
        return next;
      });
      return prev.filter(u => u.id !== unitId);
    });
  }, [phase]);

  // Confirm placement → directly start battle (Eliminations-Modus)
  // Enemies are already on the grid via the AI-drip; we just need to lock-in bonds and go.
  const confirmPlacement = useCallback(() => {
    if (placeTimerRef.current) clearInterval(placeTimerRef.current);
    // Cancel any remaining AI-drip placements
    for (const t of aiDripTimeoutsRef.current) clearTimeout(t);
    aiDripTimeoutsRef.current = [];

    const pUnits = playerUnits.map(u => ({ ...u }));
    // If AI drip didn't finish placing all units, fill the rest immediately
    let enemies: Unit[] = enemyUnits.map(u => ({ ...u }));
    if (enemies.length < enemyMaxUnits) {
      const remaining = enemyMaxUnits - enemies.length;
      const extras = generateAIPlacement(pUnits, remaining, grid, difficulty, enemyBannedUnits)
        .filter(p => !enemies.find(e => e.row === p.row && e.col === p.col))
        .slice(0, remaining)
        .map(p => createUnit(p.type, 'enemy', p.row, p.col));
      enemies = [...enemies, ...extras];
    }

    const allUnits = [...pUnits, ...enemies];
    setBondsForPlacement(allUnits);

    // Battle takes place on an invisible 8×24 lane:
    // enemy field = rows 0-7, visible middle = rows 8-15, player field = rows 16-23.
    const battlePlayers = pUnits.map(u => ({ ...u, row: u.row + 16, startRow: u.row + 16, laneCol: u.col }));
    const battleEnemies = enemies.map(u => ({ ...u, startRow: u.row, laneCol: u.col }));
    setPlayerUnits(battlePlayers);
    setEnemyUnits(battleEnemies);

    const worldGrid = createBattleWorldGrid();
    for (const u of battlePlayers) worldGrid[u.row][u.col].unit = u;
    for (const e of battleEnemies) worldGrid[e.row][e.col].unit = e;
    setGrid(worldGrid);

    // Skip place_enemy phase, go directly into battle
    startBattleRef.current?.();
  }, [playerUnits, enemyUnits, enemyBannedUnits, enemyMaxUnits, grid, difficulty]);

  // Keep confirmPlacementRef in sync for auto-confirm timer
  useEffect(() => { confirmPlacementRef.current = confirmPlacement; }, [confirmPlacement]);

  // Forward-ref for startBattle (defined below)
  const startBattleRef = useRef<(() => void) | null>(null);


  // Start battle
  const startBattle = useCallback(() => {
    // Spawn doppelganger phantoms at the start of the round
    setGrid(prevGrid => {
      const newGrid = prevGrid.map(r => r.map(c => ({ ...c, unit: c.unit ? { ...c.unit } : null })));
      const allUnits: Unit[] = [];
      for (const row of newGrid) for (const cell of row) if (cell.unit && cell.unit.hp > 0 && !cell.unit.dead) allUnits.push(cell.unit);
      const logs: string[] = [];
      const phantoms = spawnDoppelgangerPhantoms(allUnits, newGrid, logs);
      if (phantoms.length > 0) {
        setPlayerUnits(prev => [...prev, ...phantoms.filter(p => p.team === 'player')]);
        setEnemyUnits(prev => [...prev, ...phantoms.filter(p => p.team === 'enemy')]);
        if (logs.length > 0) setBattleLog(prev => [...logs, ...prev]);
      }
      return newGrid;
    });
    setPhase('battle');
    setBattleLog([]);
    setTurnCount(0);
    turnCountRef.current = 0;
    setBattleTimer(ROUND_TIME_LIMIT);
    setMoraleBoostUsed(false);
    setMoraleBoostActive(null);
    moraleTicksLeft.current = 0;
    moralePhase.current = 'none';
    setFocusFireUsed(false);
    setFocusFireActive(false);
    focusFireTicksLeft.current = 0;
    setSacrificeUsed(false);
    setShieldWallUsed(false);
    setShieldWallActive(false);
    shieldWallTicksLeft.current = 0;
    setShieldWallUsed(false);
    setShieldWallActive(false);
    shieldWallTicksLeft.current = 0;
    setFlankLeftUsed(false);
    setFlankRightUsed(false);
    setFlankActive(null);
    flankActiveRef.current = null;
    aiMoraleUsed.current = false;
    aiMoralePhase.current = 'none';
    aiMoraleTicksLeft.current = 0;
    setAiMoraleActive(null);
    aiFocusFireUsed.current = false;
    aiFocusFireTicksLeft.current = 0;
    aiSacrificeUsed.current = false;
  }, []);

  // Wire startBattle into the forward-ref so confirmPlacement can call it
  useEffect(() => { startBattleRef.current = startBattle; }, [startBattle]);

  // === AI drip-placement (Eliminations-Modus) ===========================
  // When entering placement, AI spawns its 9 units randomly across the upper
  // half over the first 10s. Player sees them appear live and has the rest
  // of the 30s to react & adjust.
  useEffect(() => {
    if (phase !== 'place_player') return;
    if (aiDripStartedRef.current) return;
    if (enemyUnits.length > 0) return; // already filled (e.g. tutorial pre-fill)
    aiDripStartedRef.current = true;

    // Variable AI skill per placement phase – sometimes great combos, sometimes sloppy.
    // Bias around the chosen difficulty, occasionally one notch worse/better.
    const skillRoll = Math.random();
    const dripDifficulty =
      skillRoll < 0.15 ? 1 :
      skillRoll < 0.50 ? Math.max(1, difficulty - 1) :
      skillRoll < 0.85 ? difficulty :
      Math.min(5, difficulty + 1);

    // Plan placements once with chosen skill (clustering / tank-bonds kick in at higher difficulty).
    const planned = generateAIPlacement([], enemyMaxUnits, grid, dripDifficulty, enemyBannedUnits);
    aiDripPendingRef.current = planned.slice();
    const count = planned.length;
    if (count === 0) return;
    const totalDripMs = 10000; // place all within first 10 seconds
    const stepMs = Math.max(150, Math.floor(totalDripMs / count));

    planned.forEach((p, idx) => {
      const t = setTimeout(() => {
        setEnemyUnits(prev => {
          if (prev.find(u => u.row === p.row && u.col === p.col)) return prev;
          const u = createUnit(p.type, 'enemy', p.row, p.col);
          setGrid(g => {
            if (g[p.row]?.[p.col]?.unit) return g; // occupied (terrain or race)
            const next = g.map(r => r.map(c => ({ ...c })));
            next[p.row][p.col] = { ...next[p.row][p.col], unit: u };
            return next;
          });
          return [...prev, u];
        });
        // Remove from pending plan once placed.
        aiDripPendingRef.current = aiDripPendingRef.current.filter(x => !(x.row === p.row && x.col === p.col));
      }, idx * stepMs);
      aiDripTimeoutsRef.current.push(t);
    });

    return () => {
      // Don't cancel on every render; only on phase exit which is handled below.
    };
  }, [phase, enemyMaxUnits, enemyBannedUnits, difficulty, grid]);

  // Spy: instantly flush all remaining planned AI placements onto the board.
  const revealAIPlacement = useCallback(() => {
    for (const t of aiDripTimeoutsRef.current) clearTimeout(t);
    aiDripTimeoutsRef.current = [];
    const remaining = aiDripPendingRef.current.slice();
    aiDripPendingRef.current = [];
    if (remaining.length === 0) return;
    setEnemyUnits(prev => {
      const occupied = new Set(prev.map(u => `${u.row},${u.col}`));
      const additions: Unit[] = [];
      for (const p of remaining) {
        const key = `${p.row},${p.col}`;
        if (occupied.has(key)) continue;
        occupied.add(key);
        additions.push(createUnit(p.type, 'enemy', p.row, p.col));
      }
      if (additions.length === 0) return prev;
      setGrid(g => {
        const next = g.map(r => r.map(c => ({ ...c })));
        for (const u of additions) {
          if (next[u.row]?.[u.col]?.unit) continue;
          next[u.row][u.col] = { ...next[u.row][u.col], unit: u };
        }
        return next;
      });
      return [...prev, ...additions];
    });
  }, []);

  // Reset AI-drip flag when leaving placement (so a new match drips again)
  useEffect(() => {
    if (phase !== 'place_player') {
      // Clear any pending drips
      for (const t of aiDripTimeoutsRef.current) clearTimeout(t);
      aiDripTimeoutsRef.current = [];
    }
  }, [phase]);



  // Activate morale boost
  const activateMoraleBoost = useCallback(() => {
    if (moraleBoostUsed || phase !== 'battle') return;
    setMoraleBoostUsed(true);
    moralePhase.current = 'buff';
    moraleTicksLeft.current = 3;
    setMoraleBoostActive('buff');
    setBattleLog(prev => ['🔥 KRIEGSSCHREI! +25% Schaden für 3 Züge!', ...prev]);
  }, [moraleBoostUsed, phase]);

  // Activate focus fire – all units target highest HP enemy for 3 ticks
  const activateFocusFire = useCallback(() => {
    if (focusFireUsed || phase !== 'battle') return;
    setFocusFireUsed(true);
    setFocusFireActive(true);
    focusFireTicksLeft.current = 4;
    setBattleLog(prev => ['🎯 FOKUSFEUER! Alle Einheiten greifen das schwächste Ziel an (4 Züge)!', ...prev]);
  }, [focusFireUsed, phase]);

  // Activate sacrifice ritual – kill weakest own unit, heal others +15%
  const activateSacrifice = useCallback(() => {
    if (sacrificeUsed || phase !== 'battle') return;
    
    // Find weakest player unit
    const pUnits = playerUnits.filter(u => u.hp > 0 && !u.dead);
    if (pUnits.length < 2) return; // need at least 2 units
    
    const weakest = pUnits.reduce((a, b) => a.hp < b.hp ? a : b);
    
    setSacrificeUsed(true);
    
    // Kill weakest and heal others
    setGrid(prevGrid => {
      const newGrid = prevGrid.map(r => r.map(c => ({ ...c, unit: c.unit ? { ...c.unit } : null })));
      
      // Kill the weakest
      if (newGrid[weakest.row][weakest.col].unit) {
        newGrid[weakest.row][weakest.col].unit!.hp = 0;
        (newGrid[weakest.row][weakest.col].unit as any).dead = true;
      }
      
      // Heal all other player units by 15% of maxHp
      for (const row of newGrid) {
        for (const cell of row) {
          if (cell.unit && cell.unit.team === 'player' && cell.unit.hp > 0 && cell.unit.id !== weakest.id) {
            const healAmt = Math.round(cell.unit.maxHp * 0.15);
            cell.unit.hp = Math.min(cell.unit.maxHp, cell.unit.hp + healAmt);
          }
        }
      }
      
      return newGrid;
    });
    
    setBattleLog(prev => [`💀 OPFERRITUAL! ${UNIT_DEFS[weakest.type].emoji} geopfert – alle anderen geheilt!`, ...prev]);
  }, [sacrificeUsed, phase, playerUnits]);

  // Activate shield wall – 3 ticks retreat, 50% damage taken, no damage dealt
  const activateShieldWall = useCallback(() => {
    if (shieldWallUsed || phase !== 'battle') return;
    setShieldWallUsed(true);
    setShieldWallActive(true);
    shieldWallTicksLeft.current = 3;
    setBattleLog(prev => ['🛡️ SCHILDWALL! Rückzug zur Base – 50% Schadensreduktion für 3 Züge!', ...prev]);
  }, [shieldWallUsed, phase]);

  // Activate flank maneuver: 2 cells back, then 5 sideways (dir), then 5 forward.
  // One battleTick = one cell shift. Movement clamped at grid edges, blocked by water/units.
  const activateFlank = useCallback((dir: -1 | 1) => {
    if (phase !== 'battle') return;
    if (flankActiveRef.current) return;
    if (dir === -1 && flankLeftUsed) return;
    if (dir === 1 && flankRightUsed) return;
    if (dir === -1) setFlankLeftUsed(true); else setFlankRightUsed(true);
    flankActiveRef.current = { dir, step: 0 };
    setFlankActive(dir === -1 ? 'left' : 'right');
    setBattleLog(prev => [`🏃 FLANKE ${dir === -1 ? '←' : '→'}! Alle Einheiten umfassen den Gegner!`, ...prev]);
  }, [phase, flankLeftUsed, flankRightUsed]);

  // Surrender the current round: enemy gets the point, round ends immediately.
  const surrenderRound = useCallback(() => {
    if (phase !== 'battle') return;
    if (battleRef.current) clearInterval(battleRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    const newES = enemyScoreRef.current + 1;
    enemyScoreRef.current = newES;
    setEnemyScore(newES);
    setBattleLog(prev => ['🏳️ Aufgegeben — Gegner gewinnt die Runde!', ...prev]);
    const result = checkGameOver(playerScoreRef.current, newES);
    if (result.draw) { setGameDraw(true); setPhase('game_draw'); }
    else setPhase('round_lost');
  }, [phase, checkGameOver]);

  // Run one battle tick
  const battleTick = useCallback(() => {
    setGrid(prevGrid => {
      const newGrid = prevGrid.map(r => r.map(c => ({ ...c, unit: c.unit ? { ...c.unit } : null })));
      const allUnits: Unit[] = [];
      for (const row of newGrid) for (const cell of row) if (cell.unit && cell.unit.hp > 0 && !cell.unit.dead) allUnits.push(cell.unit);

      // === Aura stacks: recompute every tick from current positions ===
      applyAuraStacks(allUnits, auraRef.current.zones, auraRef.current.effects);
      // Apply per-tick regen / drain auras
      applyAuraTick(allUnits, []);
      // Source-driven per-tick effects (doppelganger lifedrain)
      applyAuraSourceEffects(allUnits, auraRef.current.zones, auraRef.current.effects, []);




      // Visible 8x8 battlefield window = rows [GRID_SIZE .. 2*GRID_SIZE).
      // Combat (targeting + attacks) only happens against units inside this window.
      const VIEW_TOP = GRID_SIZE;
      const VIEW_BOTTOM = GRID_SIZE * 2;
      const inBattlefield = (u: Unit) => u.row >= VIEW_TOP && u.row < VIEW_BOTTOM;

      // Safety net: if an already-entered unit somehow got pushed/retreated outside
      // the visible arena in an older tick, immediately put it back on-screen.
      for (const u of allUnits) {
        if (!u.enteredArena || inBattlefield(u)) continue;
        const preferredRow = u.row < VIEW_TOP ? VIEW_TOP : VIEW_BOTTOM - 1;
        const rowOrder = Array.from({ length: VIEW_BOTTOM - VIEW_TOP }, (_, i) => VIEW_TOP + i)
          .sort((a, b) => Math.abs(a - preferredRow) - Math.abs(b - preferredRow));
        const colOrder = Array.from({ length: GRID_SIZE }, (_, i) => i)
          .sort((a, b) => Math.abs(a - u.col) - Math.abs(b - u.col));
        let placed = false;
        for (const r of rowOrder) {
          for (const c of colOrder) {
            const cell = newGrid[r]?.[c];
            if (!cell || cell.unit || cell.terrain === 'water') continue;
            if (newGrid[u.row]?.[u.col]?.unit?.id === u.id) newGrid[u.row][u.col].unit = null;
            u.row = r; u.col = c;
            newGrid[r][c].unit = u;
            placed = true;
            break;
          }
          if (placed) break;
        }
      }

      // === Stalemate detection: if no HP changes for 15 ticks, force a rush ===
      {
        const totalHp = allUnits.reduce((s, u) => s + u.hp, 0);
        if (totalHp === stalemateHpRef.current) {
          stalemateTicksRef.current += 1;
        } else {
          stalemateHpRef.current = totalHp;
          stalemateTicksRef.current = 0;
          if (stalemateRushRef.current === 0) {
            // no active rush + HP changed naturally
          }
        }
        if (stalemateTicksRef.current >= 15 && stalemateRushRef.current === 0) {
          stalemateRushRef.current = 4;
          stalemateTicksRef.current = 0;
          setBattleLog(prev => ['⚡ Pattsituation! Alle Einheiten stürmen aufeinander zu!', ...prev]);
        }
        if (stalemateRushRef.current > 0) {
          stalemateRushRef.current -= 1;
          // For each unit, take ONE forced step toward the nearest enemy (ignores terrain, respects unit collisions and grid bounds).
          const ordered = [...allUnits].sort(() => Math.random() - 0.5);
          for (const u of ordered) {
            if (u.hp <= 0 || u.dead) continue;
            if ((u.frozen ?? 0) > 0 || (u.webbed ?? 0) > 0) continue;
            let best: Unit | null = null;
            let bestDist = Infinity;
            for (const e of allUnits) {
              if (e.team === u.team || e.hp <= 0 || e.dead) continue;
              const d = Math.max(Math.abs(e.row - u.row), Math.abs(e.col - u.col));
              if (d < bestDist) { bestDist = d; best = e; }
            }
            if (!best || bestDist <= 1) continue;
            const dr = Math.sign(best.row - u.row);
            const dc = Math.sign(best.col - u.col);
            const candidates: [number, number][] = [
              [u.row + dr, u.col + dc],
              [u.row + dr, u.col],
              [u.row, u.col + dc],
            ];
            for (const [nr, nc] of candidates) {
              if (nr < 0 || nr >= GRID_SIZE * 3 || nc < 0 || nc >= GRID_SIZE) continue;
              // Stay inside arena once entered
              if (u.enteredArena && (nr < VIEW_TOP || nr >= VIEW_BOTTOM)) continue;
              if (newGrid[nr][nc].unit) continue;
              newGrid[u.row][u.col].unit = null;
              u.row = nr; u.col = nc;
              if (nr >= VIEW_TOP && nr < VIEW_BOTTOM) u.enteredArena = true;
              u.stuckTurns = 0;
              newGrid[nr][nc].unit = u;
              break;
            }
          }
        }
      }



      // Morale boost tick-down
      if (moralePhase.current !== 'none' && moraleTicksLeft.current > 0) {
        moraleTicksLeft.current -= 1;
        if (moraleTicksLeft.current <= 0) {
          if (moralePhase.current === 'buff') {
            // Transition to debuff phase
            moralePhase.current = 'debuff';
            moraleTicksLeft.current = 3;
            setMoraleBoostActive('debuff');
          } else {
            // Debuff expired
            moralePhase.current = 'none';
            setMoraleBoostActive(null);
          }
        }
      }

      // Focus fire tick-down
      if (focusFireTicksLeft.current > 0) {
        focusFireTicksLeft.current -= 1;
        if (focusFireTicksLeft.current <= 0) {
          setFocusFireActive(false);
        }
      }

      // Shield wall tick-down
      if (shieldWallTicksLeft.current > 0) {
        shieldWallTicksLeft.current -= 1;
        if (shieldWallTicksLeft.current <= 0) {
          setShieldWallActive(false);
        }
        if (!FORMATION_MODE) {
          // Retreat: move all player units toward their base rows (5,6,7) as fast as possible
          const playerAlive = allUnits.filter(u => u.team === 'player' && u.hp > 0 && !u.dead);
          for (const unit of playerAlive) {
            // Move toward closest base row (maximize row number)
            if (unit.row < 5) {
              // Move as far south as possible (up to 2 steps for speed)
              for (let step = 2; step >= 1; step--) {
                const targetRow = Math.min(7, unit.row + step);
                if (targetRow <= 7 && !newGrid[targetRow][unit.col].unit && newGrid[targetRow][unit.col].terrain !== 'water') {
                  newGrid[unit.row][unit.col].unit = null;
                  unit.row = targetRow;
                  newGrid[unit.row][unit.col].unit = unit;
                  break;
                }
              }
            }
          }
        }
      }


      if (aiMoralePhase.current !== 'none' && aiMoraleTicksLeft.current > 0) {
        aiMoraleTicksLeft.current -= 1;
        if (aiMoraleTicksLeft.current <= 0) {
          if (aiMoralePhase.current === 'buff') {
            aiMoralePhase.current = 'debuff';
            aiMoraleTicksLeft.current = 3;
            setAiMoraleActive('debuff');
          } else {
            aiMoralePhase.current = 'none';
            setAiMoraleActive(null);
          }
        }
      }

      // AI focus fire tick-down
      if (aiFocusFireTicksLeft.current > 0) {
        aiFocusFireTicksLeft.current -= 1;
      }

      // --- AI ability decisions (singleplayer, difficulty-aware) ---
      const pAliveNow = allUnits.filter(u => u.team === 'player' && u.hp > 0);
      const eAliveNow = allUnits.filter(u => u.team === 'enemy' && u.hp > 0);
      const currentTurnNum = turnCountRef.current;

      // Difficulty 1-2: AI never uses abilities. Difficulty 3+: uses them with increasing intelligence
      const aiUsesAbilities = difficulty >= 3;

      // AI Kriegsschrei
      if (aiUsesAbilities && !aiMoraleUsed.current && currentTurnNum >= (difficulty >= 5 ? 2 : 3)) {
        const triggerChance = difficulty === 3 ? 0.15 : difficulty === 4 ? 0.3 : 0.5;
        const shouldUse = eAliveNow.length < pAliveNow.length
          || (currentTurnNum >= 5 && Math.random() < triggerChance)
          || (currentTurnNum >= 8 && Math.random() < triggerChance * 2);
        if (shouldUse) {
          aiMoraleUsed.current = true;
          aiMoralePhase.current = 'buff';
          aiMoraleTicksLeft.current = 3;
          setAiMoraleActive('buff');
          setBattleLog(prev => ['🔥 GEGNER: KRIEGSSCHREI! +25% Schaden für 3 Züge!', ...prev]);
          setBattleEvents([{ type: 'hit', attackerId: 'ai', attackerRow: 0, attackerCol: 4, attackerEmoji: '🔥', targetId: '', targetRow: 0, targetCol: 0, damage: 0, isStrong: false, isWeak: false, isRanged: false }]);
        }
      }

      // AI Fokusfeuer
      if (aiUsesAbilities && !aiFocusFireUsed.current && currentTurnNum >= (difficulty >= 5 ? 3 : 4)) {
        const highHpPlayer = pAliveNow.find(u => u.hp > u.maxHp * 0.7);
        const triggerChance = difficulty === 3 ? 0.2 : difficulty === 4 ? 0.4 : 0.6;
        const shouldUse = (highHpPlayer && Math.random() < triggerChance)
          || (currentTurnNum >= 7 && Math.random() < triggerChance * 0.5);
        if (shouldUse) {
          aiFocusFireUsed.current = true;
          aiFocusFireTicksLeft.current = 3;
          setBattleLog(prev => ['🎯 GEGNER: FOKUSFEUER! Alle feindlichen Einheiten greifen ein Ziel an!', ...prev]);
        }
      }

      // AI Opferritual
      if (aiUsesAbilities && !aiSacrificeUsed.current && eAliveNow.length >= 2 && currentTurnNum >= (difficulty >= 5 ? 4 : 5)) {
        const avgEnemyHp = eAliveNow.reduce((s, u) => s + u.hp / u.maxHp, 0) / eAliveNow.length;
        const triggerChance = difficulty === 3 ? 0.25 : difficulty === 4 ? 0.4 : 0.6;
        const shouldUse = (avgEnemyHp < 0.5 && Math.random() < triggerChance)
          || (eAliveNow.length <= 2 && Math.random() < triggerChance * 0.6);
        if (shouldUse) {
          aiSacrificeUsed.current = true;
          const weakest = eAliveNow.reduce((a, b) => a.hp < b.hp ? a : b);
          if (newGrid[weakest.row][weakest.col].unit) {
            newGrid[weakest.row][weakest.col].unit!.hp = 0;
            (newGrid[weakest.row][weakest.col].unit as any).dead = true;
          }
          for (const eu of eAliveNow) {
            if (eu.id !== weakest.id && eu.hp > 0) {
              const healAmt = Math.round(eu.maxHp * 0.15);
              eu.hp = Math.min(eu.maxHp, eu.hp + healAmt);
            }
          }
          setBattleLog(prev => [`💀 GEGNER: OPFERRITUAL! ${UNIT_DEFS[weakest.type].emoji} geopfert – alle anderen geheilt!`, ...prev]);
        }
      }

      // Calculate player damage modifier from morale (+ shield wall: player deals 0 damage)
      const playerDmgMod = shieldWallTicksLeft.current > 0 ? 0 : (moralePhase.current === 'buff' ? 1.25 : moralePhase.current === 'debuff' ? 0.85 : 1.0);
      // Calculate enemy damage modifier from AI morale
      const enemyDmgMod = aiMoralePhase.current === 'buff' ? 1.25 : aiMoralePhase.current === 'debuff' ? 0.85 : 1.0;
      // Shield wall: enemies deal only 50% damage to player units
      const shieldWallDefMod = shieldWallTicksLeft.current > 0 ? 0.5 : 1.0;

      // Focus fire: determine lowest HP enemy target (player ability) – finish off weak units
      const focusTarget = focusFireTicksLeft.current > 0
        ? allUnits.filter(u => u.team === 'enemy' && u.hp > 0).sort((a, b) => a.hp - b.hp)[0] ?? null
        : null;
      // AI focus fire: determine highest HP player target
      const aiFocusTarget = aiFocusFireTicksLeft.current > 0
        ? allUnits.filter(u => u.team === 'player' && u.hp > 0).sort((a, b) => b.hp - a.hp)[0] ?? null
        : null;

      const logs: string[] = [];
      const events: BattleEvent[] = [];
      const currentTurn = turnCountRef.current;
      const acting = allUnits.filter(u => {
        if (u.hp <= 0) return false;
        // Staggered activation: units don't act until their activation turn
        if (!FORMATION_MODE && u.activationTurn !== undefined && currentTurn < u.activationTurn) return false;
        return true;
      }).sort((a, b) => a.maxCooldown - b.maxCooldown);

      // Doppelgänger phantoms must lose invulnerability in formation combat too.
      // This used to live only in the non-formation branch, making phantoms unattackable forever.
      tickPhantomTimers(allUnits, newGrid, logs);

      // === FORMATION_MODE (SP-only rewrite, Step 3+4) ============================
      // Individual movement AIs (lock-on, kiting, terrain seekers, dash, flying,
      // special tick patterns) are skipped here. Each unit auto-attacks the
      // lowest-HP adjacent enemy (Chebyshev 1) when its cooldown is ready.
      // calcDamage() preserves color RPS + crit/variance. Player and enemy
      // formations both shift one cell toward the nearest opposing unit each tick.
      if (FORMATION_MODE) {
        // 1) Per-unit attack honoring each unit's attackRange (Chebyshev distance).
        //    Includes status effects (vampire bleed, arsonist burn, frost freeze,
        //    healer heal, shadowpriest curse) + applyPostAttackEffects + applyDeathEffects.
        for (const unit of acting) {
          if (unit.hp <= 0 || unit.dead) continue;
          if (unit.webbed && unit.webbed > 0) { unit.webbed -= 1; continue; }
          unit.cooldown = Math.max(0, unit.cooldown - 1);
          if (unit.cooldown > 0) continue;

          // Healer: heal lowest-HP ally in range first; only attack if nothing to heal.
          if (unit.type === 'healer') {
            const range = UNIT_DEFS.healer.attackRange ?? 1;
            let healTarget: Unit | null = null;
            let healPriority = Infinity;
            for (const ally of allUnits) {
              if (ally === unit || ally.team !== unit.team) continue;
              if (ally.hp <= 0 || ally.dead || ally.unhealable) continue;
              if (ally.hp >= ally.maxHp) continue;
              const adr = Math.abs(ally.row - unit.row);
              const adc = Math.abs(ally.col - unit.col);
              if (Math.max(adr, adc) > range) continue;
              const p = ally.hp / ally.maxHp;
              if (p < healPriority) { healPriority = p; healTarget = ally; }
            }
            if (healTarget) {
              const healAmt = Math.min(28, healTarget.maxHp - healTarget.hp);
              healTarget.hp += healAmt;
              unit.cooldown = unit.maxCooldown;
              logs.push(`🌿 ${unit.team === 'player' ? '👤' : '💀'} Schamane → ${UNIT_DEFS[healTarget.type].emoji} +${healAmt} ❤️`);
              events.push({
                type: 'heal',
                attackerId: unit.id, attackerRow: unit.row, attackerCol: unit.col,
                attackerEmoji: '🌿', attackerType: unit.type,
                targetId: healTarget.id, targetRow: healTarget.row, targetCol: healTarget.col,
                damage: 0, isStrong: false, isWeak: false,
                isRanged: Math.max(Math.abs(unit.row - healTarget.row), Math.abs(unit.col - healTarget.col)) > 1,
                healAmount: healAmt,
              });
              continue;
            }
          }

          const range = UNIT_DEFS[unit.type].attackRange ?? 1;
          let best: Unit | null = null;
          let bestDist = Infinity;
          for (const other of allUnits) {
            if (other === unit || other.team === unit.team) continue;
            if (other.hp <= 0 || other.dead) continue;
            if (!inBattlefield(other)) continue; // off-field foes can't be struck
            if (other.isPhantom && (other.phantom ?? 0) > 0) continue;
            const adr = Math.abs(other.row - unit.row);
            const adc = Math.abs(other.col - unit.col);
            const d = Math.max(adr, adc);
            if (d > range) continue;
            // Prefer lowest HP, tie-break by closest.
            if (!best || other.hp < best.hp || (other.hp === best.hp && d < bestDist)) {
              best = other; bestDist = d;
            }
          }
          if (!best) continue;
          // Frozen attackers deal reduced damage.
          const isFrozenNow = !!(unit.frozen && unit.frozen > 0);
          const frozenMul = isFrozenNow ? (unit.frozenDmgMul ?? 0.5) : 1;
          if (isFrozenNow) {
            unit.frozen = (unit.frozen || 0) - 1;
            if ((unit.frozen || 0) <= 0) unit.frozenDmgMul = undefined;
          }
          let dmg = Math.round(calcDamage(unit, best, newGrid) * frozenMul);
          if (unit.team === 'player') dmg = Math.round(dmg * playerDmgMod);
          else {
            dmg = Math.round(dmg * enemyDmgMod);
            if (best.team === 'player') dmg = Math.round(dmg * shieldWallDefMod);
          }
          best.hp = Math.max(0, best.hp - dmg);
          unit.cooldown = effectiveCooldown(unit, newGrid);
          unit.lastAttackedId = best.id;

          // Color RPS flags for event display.
          const uColor = unit.color || UNIT_COLOR_GROUPS[unit.type];
          const tColor = best.color || UNIT_COLOR_GROUPS[best.type];
          const isStrong = (uColor === 'red' && tColor === 'green') || (uColor === 'green' && tColor === 'blue') || (uColor === 'blue' && tColor === 'red');
          const isWeak = (tColor === 'red' && uColor === 'green') || (tColor === 'green' && uColor === 'blue') || (tColor === 'blue' && uColor === 'red');

          // Status effects on hit.
          if (unit.type === 'vampire' && dmg > 0) {
            const heal = Math.round(dmg * 0.3);
            const before = unit.hp;
            unit.hp = Math.min(unit.maxHp, unit.hp + heal);
            if (unit.hp - before > 0) logs.push(`🧛 Vampir saugt ${unit.hp - before} ❤️`);
            if (best.hp > 0) {
              best.bleeding = [10, 5, 3, 1];
              logs.push(`🩸 ${UNIT_DEFS[best.type].emoji} blutet!`);
            }
          }
          if (unit.type === 'arsonist' && best.hp > 0 && !isImmuneToFire(best, newGrid)) {
            best.burning = [...(best.burning || []), { dmg: 5, turns: 4 }];
          }
          if (unit.type === 'frost' && best.hp > 0 && Math.random() < 0.5 && !isImmuneToFreeze(best, newGrid)) {
            best.frozen = 3;
            best.frozenDmgMul = 0.5;
          }
          if (unit.type === 'shadowpriest' && best.hp > 0) {
            applyShadowpriestCurse(unit, best, logs, events);
          }

          // Generic post-attack effects (mirror reflect, icegolem freeze, spider web, vulkanit lava, shadowblade bonus).
          applyPostAttackEffects(unit, best, dmg, newGrid, logs);

          // Lightning: chain hops within radius 2 around last hit target.
          let lightningChainCells: { row: number; col: number }[] | undefined;
          if (unit.type === 'lightning') {
            lightningChainCells = [{ row: best.row, col: best.col }];
            const hopMults = [0.3, 0.2, 0.15, 0.1, 0.05];
            const hitIds = new Set<string>([best.id]);
            let cur = { row: best.row, col: best.col };
            for (const mult of hopMults) {
              let pick: { u: Unit; d: number } | null = null;
              for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
                if (dr === 0 && dc === 0) continue;
                const ar = cur.row + dr, ac = cur.col + dc;
                if (ar < 0 || ar >= newGrid.length || ac < 0 || ac >= newGrid[0].length) continue;
                const cu = newGrid[ar][ac].unit;
                if (!cu || cu.hp <= 0 || cu.dead) continue;
                if (cu.team === unit.team || hitIds.has(cu.id)) continue;
                if (cu.isPhantom && (cu.phantom ?? 0) > 0) continue;
                const d = Math.max(Math.abs(dr), Math.abs(dc));
                if (!pick || d < pick.d) pick = { u: cu, d };
              }
              if (!pick) break;
              const cu = pick.u;
              const chainDmg = Math.max(1, Math.round(dmg * mult));
              cu.hp = Math.max(0, cu.hp - chainDmg);
              hitIds.add(cu.id);
              lightningChainCells.push({ row: cu.row, col: cu.col });
              logs.push(`⚡ Blitz → ${UNIT_DEFS[cu.type].emoji} ${chainDmg}`);
              if (cu.hp <= 0) {
                const survived = applyDeathEffects(cu, allUnits, newGrid, logs, events);
                if (!survived) (cu as any).dead = true;
              }
              cur = { row: cu.row, col: cu.col };
            }
          }

          // Chaindancer: chain through up to 2 additional diagonal enemies.
          let chaindancerCells: { row: number; col: number }[] | undefined;
          if (unit.type === 'chaindancer') {
            chaindancerCells = applyChainAttack(unit, best, dmg, newGrid, logs);
          }

          // Dragon: 3x3 AOE around the dragon (30% splash to other enemies).
          let aoeCells: { row: number; col: number }[] | undefined;
          if (unit.type === 'dragon') {
            aoeCells = [];
            const splashDmg = Math.round(dmg * 0.3);
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
              const ar = unit.row + dr, ac = unit.col + dc;
              if (ar < 0 || ar >= newGrid.length || ac < 0 || ac >= newGrid[0].length) continue;
              aoeCells.push({ row: ar, col: ac });
              const cu = newGrid[ar][ac].unit;
              if (!cu || cu === best || cu.team === unit.team || cu.hp <= 0 || cu.dead) continue;
              cu.hp = Math.max(0, cu.hp - splashDmg);
              logs.push(`🔥 Drache 🔥→ ${UNIT_DEFS[cu.type].emoji} ${splashDmg}`);
              if (cu.hp <= 0) {
                const survived = applyDeathEffects(cu, allUnits, newGrid, logs, events);
                if (!survived) (cu as any).dead = true;
              }
            }
          }

          const def = UNIT_DEFS[unit.type];
          const tDef = UNIT_DEFS[best.type];
          const suffix = isStrong ? ' 💪' : isWeak ? ' 😰' : '';
          logs.push(`${def.emoji} ${unit.team === 'player' ? '👤' : '💀'} ${def.label} → ${tDef.emoji} ${dmg}${suffix}${best.frozen ? ' 🧊' : ''}${best.hp <= 0 ? ' ☠️' : ''}`);

          events.push({
            type: best.hp <= 0 ? 'kill' : 'hit',
            attackerId: unit.id, attackerRow: unit.row, attackerCol: unit.col,
            attackerEmoji: UNIT_DEFS[unit.type].emoji, attackerType: unit.type,
            targetId: best.id, targetRow: best.row, targetCol: best.col,
            damage: dmg, isStrong, isWeak,
            isRanged: bestDist > 1,
            isAoe: unit.type === 'dragon',
            aoeCells,
            chainCells: lightningChainCells,
          });

          if (chaindancerCells && chaindancerCells.length > 1) {
            events.push({
              type: 'chain',
              attackerId: unit.id, attackerRow: unit.row, attackerCol: unit.col,
              attackerEmoji: '🪢', attackerType: unit.type,
              targetId: best.id, targetRow: best.row, targetCol: best.col,
              damage: 0, isStrong: false, isWeak: false, isRanged: false,
              chainCells: chaindancerCells,
            });
          }

          if (best.hp <= 0) {
            const survived = applyDeathEffects(best, allUnits, newGrid, logs, events);
            if (!survived) (best as any).dead = true;
          }
          if (unit.hp <= 0) {
            const survived = applyDeathEffects(unit, allUnits, newGrid, logs, events);
            if (!survived) (unit as any).dead = true;
          }
        }
        // 2) Formations move one cell toward the nearest opposing formation.
        // (VIEW_TOP/VIEW_BOTTOM/inBattlefield hoisted above)
        const moveTeamFormations = (team: 'player' | 'enemy') => {
          const formations = findFormations(allUnits, team);
          const opponentsAlive = allUnits.filter(u => u.team !== team && u.hp > 0 && !u.dead);
          // Forward direction: player marches up (-1), enemy marches down (+1).
          const forwardDr = team === 'player' ? -1 : 1;
          for (const grp of formations) {
            if (grp.length === 0 || opponentsAlive.length === 0) continue;
            // Sideways movement is only unlocked once at least one of our units
            // shares a row with an opposing unit (regardless of column distance).
            const rowsInGrp = new Set(grp.map(u => u.row));
            const sharesRow = opponentsAlive.some(o => rowsInGrp.has(o.row));
            let target: Unit | null = null;
            let bestDist = Infinity;
            for (const u of grp) for (const opponent of opponentsAlive) {
              const d = Math.abs(opponent.row - u.row) + Math.abs(opponent.col - u.col);
              if (d < bestDist) { bestDist = d; target = opponent; }
            }
            if (!target || bestDist <= 1) continue;
            let cr = 0, cc = 0;
            for (const u of grp) { cr += u.row; cc += u.col; }
            cr /= grp.length; cc /= grp.length;
            const ddr = Math.sign(target.row - cr);
            const ddc = Math.sign(target.col - cc);
            const tries: Array<[number, number]> = [];
            if (sharesRow) {
              // Engagement mode: free to move diagonally / sideways toward the target.
              if (ddr !== 0 && ddc !== 0) tries.push([ddr, ddc]);
              if (ddr !== 0) tries.push([ddr, 0]);
              if (ddc !== 0) tries.push([0, ddc]);
            } else {
              // Approach mode: march straight forward only.
              tries.push([forwardDr, 0]);
            }
            for (const [mdr, mdc] of tries) {
              if (applyFormationMove(grp, mdr, mdc, newGrid)) break;
            }
          }
        };
        // === Flank maneuver: 3-tick burst — Tick1: 2 back, Tick2: up to 5 sideways, Tick3: up to 5 forward.
        // Each unit shifts as far as it can per tick, clamped by edges/water/other units.
        let flankShifting = false;
        if (flankActiveRef.current) {
          flankShifting = true;
          const { dir, step } = flankActiveRef.current;
          const rowCount = newGrid.length;
          const colCount = newGrid[0]?.length ?? GRID_SIZE;
          let dr = 0, dc = 0, maxSteps = 0;
          if (step === 0) { dr = 1;  dc = 0;   maxSteps = 2; }   // 2 back
          else if (step === 1) { dr = 0;  dc = dir; maxSteps = 5; } // up to 5 sideways
          else if (step === 2) { dr = -1; dc = 0;   maxSteps = 5; } // up to 5 forward
          if (dr !== 0 || dc !== 0) {
            const playerAlive = allUnits.filter(u => u.team === 'player' && u.hp > 0 && !u.dead);
            const sorted = [...playerAlive].sort((a, b) => {
              if (dr > 0) return b.row - a.row;
              if (dr < 0) return a.row - b.row;
              if (dc > 0) return b.col - a.col;
              if (dc < 0) return a.col - b.col;
              return 0;
            });
            for (const u of sorted) {
              for (let s = 0; s < maxSteps; s++) {
                const nr = u.row + dr;
                const nc = u.col + dc;
                if (nr < 0 || nr >= rowCount || nc < 0 || nc >= colCount) break;
                if (u.enteredArena && (nr < VIEW_TOP || nr >= VIEW_BOTTOM)) break;
                const tgt = newGrid[nr]?.[nc];
                if (!tgt) break;
                if (tgt.terrain === 'water') break;
                if (tgt.unit && tgt.unit.id !== u.id && !tgt.unit.dead && tgt.unit.hp > 0) break;
                if (newGrid[u.row]?.[u.col]?.unit?.id === u.id) newGrid[u.row][u.col].unit = null;
                u.row = nr; u.col = nc;
                if (u.row >= VIEW_TOP && u.row < VIEW_BOTTOM) u.enteredArena = true;
                newGrid[u.row][u.col].unit = u;
              }
            }
          }
          const nextStep = step + 1;
          if (nextStep >= 3) {
            flankActiveRef.current = null;
            setFlankActive(null);
          } else {
            flankActiveRef.current = { dir, step: nextStep };
          }
        }
        if (!flankShifting) moveTeamFormations('player');
        moveTeamFormations('enemy');

        // === Arena catch-up: off-field units keep marching into the visible 8×8.
        // Units that already entered the arena never retreat back out.
        if (!flankShifting) {
          const rowCount = newGrid.length;
          const colCount = newGrid[0]?.length ?? GRID_SIZE;
          const offField = allUnits.filter(u => u.hp > 0 && !u.dead && !inBattlefield(u) && !u.enteredArena);
          const sorted = [...offField].sort((a, b) => {
            const aDr = a.row < VIEW_TOP ? 1 : -1;
            const bDr = b.row < VIEW_TOP ? 1 : -1;
            if (aDr !== bDr) return bDr - aDr;
            return aDr > 0 ? b.row - a.row : a.row - b.row;
          });
          for (const u of sorted) {
            const moveDr = u.row < VIEW_TOP ? 1 : -1;
            for (let s = 0; s < 3; s++) {
              const nr = u.row + moveDr;
              const nc = u.col;
              if (nr < 0 || nr >= rowCount || nc < 0 || nc >= colCount) break;
              const tgt = newGrid[nr]?.[nc];
              if (!tgt) break;
              if (tgt.terrain === 'water') break;
              if (tgt.unit && tgt.unit.id !== u.id && !tgt.unit.dead && tgt.unit.hp > 0) break;
              if (newGrid[u.row]?.[u.col]?.unit?.id === u.id) newGrid[u.row][u.col].unit = null;
              u.row = nr; u.col = nc;
              if (u.row >= VIEW_TOP && u.row < VIEW_BOTTOM) u.enteredArena = true;
              newGrid[u.row][u.col].unit = u;
              if (u.enteredArena) break;
            }
          }
        }
      } else {



      // === Burn DoT processing (Brandstifter / Arsonist) ===
      for (const u of allUnits) {
        if (!u.burning || u.burning.length === 0 || u.hp <= 0) continue;
        // Mountaineer on hill is immune to fire damage; cloner aura grants fire/frost/poison immunity
        if (isImmuneToFire(u, newGrid) || hasImmuneFFP(u)) {
          u.burning = [];
          continue;
        }
        let totalBurn = 0;
        u.burning = u.burning.filter(b => {
          totalBurn += b.dmg;
          b.turns -= 1;
          return b.turns > 0;
        });
        if (totalBurn > 0) {
          // Aura nerf: double dmg from lightning/fire on this defender
          totalBurn = Math.round(totalBurn * fireLightningTakenMul(u));
          u.hp = Math.max(0, u.hp - totalBurn);
          logs.push(`🔥 ${UNIT_DEFS[u.type].emoji} brennt: -${totalBurn} ❤️${u.hp <= 0 ? ' ☠️' : ''}`);
          if (u.hp <= 0) (u as any).dead = true;
        }
      }

      // === Bleed DoT processing (Vampir bite) ===
      for (const u of allUnits) {
        if (!u.bleeding || u.bleeding.length === 0 || u.hp <= 0 || u.dead) continue;
        const tick = u.bleeding.shift()!;
        if (tick > 0) {
          u.hp = Math.max(0, u.hp - tick);
          logs.push(`🩸 ${UNIT_DEFS[u.type].emoji} blutet: -${tick} ❤️${u.hp <= 0 ? ' ☠️' : ''}`);
          if (u.hp <= 0) (u as any).dead = true;
        }
        if (u.bleeding.length === 0) u.bleeding = undefined;
      }



      // === Lava field DoT (Vulkanit) ===
      processLavaTick(newGrid, logs);
      // === Banshee ghost timer tick-down ===
      processGhostTick(allUnits, newGrid, logs);
      // === Doppelganger phantom timers === handled before the mode split.
      // === Cloner: spawn clones every 6 ticks (max 3 lifetime) ===
      tickClonerSpawns(allUnits, newGrid, logs);
      // === Mage impulse: every 7 ticks push enemies in 7x7 outward ===
      tickMageImpulse(allUnits, newGrid, events, logs);
      // === Magnetiker pull: every 4 ticks, yank all enemies in 7x7 to adjacency ===
      tickMagnetPull(allUnits, newGrid, events, logs);
      // === Frost Nova: every 7 ticks freeze enemies in 3x3 for 5 ticks at 30% dmg ===
      tickFrostNova(allUnits, newGrid, events, logs);
      // === Rider horn: every 9 ticks, +50% dmg buff to allies in 5x5 for 2 ticks ===
      tickRiderHorn(allUnits, newGrid, events, logs);
      // === Archer volley: every 4 ticks, 8-direction infinite-range arrow salvo ===
      tickArcherVolley(allUnits, newGrid, events, logs);
      // === Dragon fire-spin: every 10 ticks, dragon spins 8 ticks firing beams ===
      tickDragonSpin(allUnits, newGrid, events, logs);
      // === Terrain regen: waterwalker heals on water ===
      tickTerrainHeals(allUnits, newGrid, logs);
      // === v3: Obelisk aura/beam (refresh buffs each tick) ===
      tickObeliskAura(allUnits, newGrid, events, logs);
      // === v3: Bomber places bombs / hails on enemies ===
      tickBomberActions(allUnits, newGrid, events, logs);
      // === v3: Bomb fuses count down and detonate ===
      tickBombFuses(newGrid, allUnits, events, logs);
      // === v3: Shadowpriest soul harvest ===
      tickShadowpriestHarvest(allUnits, newGrid, logs);



      for (const unit of acting) {
        if (unit.hp <= 0) continue;

        // Dragon mid fire-spin: skip movement/attack entirely.
        if (unit.type === 'dragon' && (unit.spinTicksLeft ?? 0) > 0) continue;

        // Doppelganger original: idle (no move, no attack) while its phantom is still alive.
        // Doppelganger original: now stays active and fights normally even while phantom lives.

        // Webbed: can't act at all (spiderqueen net)
        if (unit.webbed && unit.webbed > 0) {
          unit.webbed -= 1;
          continue;
        }
        // Frozen: skip movement, attack at reduced dmg (50% default, 30% from frost nova)
        const isFrozenNow = !!(unit.frozen && unit.frozen > 0);
        const frozenDmgMul = unit.frozenDmgMul ?? 0.5;
        if (isFrozenNow) {
          unit.frozen = (unit.frozen || 0) - 1;
          if ((unit.frozen || 0) <= 0) unit.frozenDmgMul = undefined;
        }

        unit.cooldown = Math.max(0, unit.cooldown - 1);

        // === Terrain seekers (ranger / mountaineer / waterwalker) ===
        // Single-minded: head to nearest matching tile, defend it, don't chase.
        let seekerHolds = false;
        if (!isFrozenNow) {
          const seek = handleTerrainSeeker(unit, newGrid, allUnits);
          if (seek === 'moved' || seek === 'wait') continue; // travelling or holding → no attack
          if (seek === 'on_terrain') seekerHolds = true; // attack from here, never step off
        }



        // Shadowblade: custom teleport-strike behavior (every 5 ticks)
        if (unit.type === 'shadowblade' && !isFrozenNow) {
          handleShadowbladeTick(unit, allUnits, newGrid, events, logs, (atk, tgt, dmg) => {
            let d = dmg;
            if (atk.team === 'player') d = Math.round(d * playerDmgMod);
            else {
              d = Math.round(d * enemyDmgMod);
              if (tgt.team === 'player') d = Math.round(d * shieldWallDefMod);
            }
            return d;
          });
          continue;
        }

        // Healer: heal allies first, attack only if no one to heal
        if (unit.type === 'healer') {
          const allies = allUnits.filter(u => u.team === unit.team && u.id !== unit.id && u.hp > 0 && !u.dead);
          const healable = allies.filter(a => a.hp < a.maxHp && !a.unhealable);

          if (healable.length > 0 && unit.cooldown <= 0) {
            // Try to heal someone in range
            let healed = false;
            for (const ally of healable) {
              if (canAttack(unit, ally)) {
                const healAmt = Math.min(28, ally.maxHp - ally.hp);
                ally.hp += healAmt;
                logs.push(`🌿 ${unit.team === 'player' ? '👤' : '💀'} Schamane → ${UNIT_DEFS[ally.type].emoji} +${healAmt} ❤️`);
                healed = true;
                unit.cooldown = unit.maxCooldown;

                // Emit heal event for animation
                events.push({
                  type: 'heal',
                  attackerId: unit.id,
                  attackerRow: unit.row,
                  attackerCol: unit.col,
                  attackerEmoji: '🌿',
                  attackerType: unit.type,
                  targetId: ally.id,
                  targetRow: ally.row,
                  targetCol: ally.col,
                  damage: 0,
                  isStrong: false, isWeak: false,
                  isRanged: Math.abs(unit.row - ally.row) + Math.abs(unit.col - ally.col) > 1,
                  healAmount: healAmt,
                });
                break;
              }
            }
            if (!healed) {
              // Move toward lowest HP ally
              healable.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
              const newPos = moveToward(unit, healable[0], newGrid, allUnits);
              if (newPos.row !== unit.row || newPos.col !== unit.col) {
                newGrid[unit.row][unit.col].unit = null;
                unit.row = newPos.row;
                unit.col = newPos.col;
                if (unit.row >= VIEW_TOP && unit.row < VIEW_BOTTOM) unit.enteredArena = true;
                newGrid[unit.row][unit.col].unit = unit;
              }
            }
            continue;
          }
          // No allies to heal → fall through to normal attack logic below
        }

        // Focus fire override: player units target lowest HP enemy, AI units target highest HP player.
        // Targets must be inside the visible 8x8 battlefield (rows VIEW_TOP..VIEW_BOTTOM).
        const battlefieldUnits = allUnits.filter(u => u.team === unit.team || inBattlefield(u));
        const fT = focusTarget && inBattlefield(focusTarget) ? focusTarget : null;
        const afT = aiFocusTarget && inBattlefield(aiFocusTarget) ? aiFocusTarget : null;
        const target = (fT && unit.team === 'player') ? fT
          : (afT && unit.team === 'enemy') ? afT
          : findTarget(unit, battlefieldUnits);
        if (!target) {
          // No reachable enemy on the battlefield. Units that have already entered
          // the arena (one-way lock) MUST NOT retreat — they hold position. Units
          // still outside walk FORWARD into the arena instead of backward.
          const rowCount = newGrid.length;
          const colCount = newGrid[0]?.length ?? GRID_SIZE;
          const forwardDr = unit.team === 'player' ? -1 : 1; // toward arena center
          if (!isFrozenNow && !seekerHolds && !shouldSkipMove(unit) && !unit.enteredArena) {
            for (let s = 0; s < 3; s++) {
              const nr = unit.row + forwardDr;
              const nc = unit.col;
              if (nr < 0 || nr >= rowCount || nc < 0 || nc >= colCount) break;
              const tgt = newGrid[nr]?.[nc];
              if (!tgt) break;
              if (tgt.terrain === 'water') break;
              if (tgt.unit && tgt.unit.id !== unit.id && !tgt.unit.dead && tgt.unit.hp > 0) break;
              if (newGrid[unit.row]?.[unit.col]?.unit?.id === unit.id) newGrid[unit.row][unit.col].unit = null;
              unit.row = nr;
              if (unit.row >= VIEW_TOP && unit.row < VIEW_BOTTOM) unit.enteredArena = true;
              newGrid[unit.row][unit.col].unit = unit;
            }
          }
          continue;
        }


        if (!canAttack(unit, target)) {
          // Track stuck turns for anti-stalemate
          unit.stuckTurns = (unit.stuckTurns || 0) + 1;
          const skipMove = isFrozenNow || seekerHolds || shouldSkipMove(unit);
          const newPos = skipMove ? { row: unit.row, col: unit.col } : moveToward(unit, target, newGrid, allUnits);
          if (newPos.row !== unit.row || newPos.col !== unit.col) {
            // If tank, move bonded units first
            if (unit.type === 'tank') {
              moveTankFormation(unit, newPos, newGrid, allUnits);
            }
            leaveArsonistTrail(newGrid, unit);
            newGrid[unit.row][unit.col].unit = null;
            unit.row = newPos.row;
            unit.col = newPos.col;
            if (unit.row >= VIEW_TOP && unit.row < VIEW_BOTTOM) unit.enteredArena = true;
            newGrid[unit.row][unit.col].unit = unit;
          }
        } else {
          // Can attack → reset stuck counter, but ranged kiters still reposition (unless frozen / seeker holding)
          unit.stuckTurns = 0;
          if (!isFrozenNow && !seekerHolds) {
            const kitePos = moveToward(unit, target, newGrid, allUnits);
            if (kitePos.row !== unit.row || kitePos.col !== unit.col) {
              if (unit.type === 'tank') {
                moveTankFormation(unit, kitePos, newGrid, allUnits);
              }
              leaveArsonistTrail(newGrid, unit);
              newGrid[unit.row][unit.col].unit = null;
              unit.row = kitePos.row;
              unit.col = kitePos.col;
              if (unit.row >= VIEW_TOP && unit.row < VIEW_BOTTOM) unit.enteredArena = true;
              newGrid[unit.row][unit.col].unit = unit;
            }
          }
        }



        if (canAttack(unit, target) && unit.cooldown <= 0) {
          // Phantoms (doppelganger phantom): completely invulnerable
          if (target.isPhantom && (target.phantom ?? 0) > 0) {
            unit.cooldown = effectiveCooldown(unit, newGrid);
            continue;
          }
          let dmg = calcDamage(unit, target, newGrid);
          // Frozen attacker: 50% damage penalty
          if (isFrozenNow) dmg = Math.round(dmg * frozenDmgMul);
          // Apply morale modifier + shield wall
          if (unit.team === 'player') dmg = Math.round(dmg * playerDmgMod);
          else {
            dmg = Math.round(dmg * enemyDmgMod);
            // Shield wall: enemy attacks on player units deal 50% damage
            if (target.team === 'player') dmg = Math.round(dmg * shieldWallDefMod);
          }
          // === Phase-3 aura: miss-chance (obelisk), taunt-reduction (magnetiker), damage-share (icegolem) ===
          dmg = applyDefenderShare(unit, target, dmg, allUnits, logs);
          target.hp = Math.max(0, target.hp - dmg);
          // Aura: generic lifesteal from stacks (independent of vampire-specific block below)
          if (dmg > 0 && unit.auraStacks && unit.auraStacks.lifesteal30 > 0 && unit.hp < unit.maxHp) {
            const pct = Math.min(1, 0.30 * unit.auraStacks.lifesteal30);
            const heal = Math.min(unit.maxHp - unit.hp, Math.round(dmg * pct));
            if (heal > 0) {
              unit.hp += heal;
              unit._justRegen = Date.now();
            }
          }
          // === Phase-2 aura triggers (splash, chain, bleed, fire, freeze, web, reflect, drain, self-effects, lava-splash, poison, curse)
          if (dmg > 0) {
            applyAuraOnAttack({ attacker: unit, defender: target, dmg, allUnits, grid: newGrid, logs, events });
          }
          if (dmg > 0 && unit.type === 'waterwalker') {
            unit.seekerIdleTicks = 0;
          }
          // Cooldown reset honors terrain bonuses (ranger=1 on forest, mountaineer=2 on hill)
          unit.cooldown = effectiveCooldown(unit, newGrid);
          // Track last attacked target (used by targeting logic: lock-on for warrior/stormrunner/archer, switch for rider/assassin/frost/mage)
          unit.lastAttackedId = target.id;

          // Shadowpriest: stack curse on target (3 stacks → 30% HP burst + −50% ATK + unhealable)
          if (unit.type === 'shadowpriest' && target.hp > 0) {
            applyShadowpriestCurse(unit, target, logs, events);
          }

          // Frost: 50% chance to freeze target for 3 ticks at 50% damage (skip immune)
          let didFreeze = false;
          if (unit.type === 'frost' && target.hp > 0 && Math.random() < 0.5 && !isImmuneToFreeze(target, newGrid)) {
            target.frozen = 3;
            target.frozenDmgMul = 0.5;
            didFreeze = true;
          }

          // === NEW UNIT EFFECTS ===
          // Vampire: lifesteal 30% (capped to maxHp, no overheal/explosion) + bleeding DoT (10/5/3/1)
          if (unit.type === 'vampire' && dmg > 0) {
            const heal = Math.round(dmg * 0.3);
            const before = unit.hp;
            unit.hp = Math.min(unit.maxHp, unit.hp + heal);
            const healed = unit.hp - before;
            if (healed > 0) {
              logs.push(`🧛 Vampir saugt ${healed} ❤️`);
            }
            // Apply / refresh bleeding DoT on the target
            if (target.hp > 0) {
              target.bleeding = [10, 5, 3, 1];
              logs.push(`🩸 ${UNIT_DEFS[target.type].emoji} blutet!`);
            }
          }

          // Arsonist: apply burning DoT stack (5 dmg / turn, 4 turns) – skip fire-immune
          if (unit.type === 'arsonist' && target.hp > 0 && !isImmuneToFire(target, newGrid)) {
            target.burning = [...(target.burning || []), { dmg: 5, turns: 4 }];
          }


          // Judge: +8 ATK for each fallen ally — recalculated below at end of tick.

          // Lightning: chain hops within radius 2 around last hit target.
          // Damage multipliers per hop after primary: 50%, 40%, 30%, 20%, 10%.
          let lightningChainCells: { row: number; col: number }[] | undefined;
          if (unit.type === 'lightning') {
            lightningChainCells = [{ row: target.row, col: target.col }];
            const hopMults = [0.3, 0.2, 0.15, 0.1, 0.05];
            const hit = new Set<string>([target.id]);
            let current: { row: number; col: number } = { row: target.row, col: target.col };
            for (const mult of hopMults) {
              // Find nearest enemy (Chebyshev ≤2) to current that hasn't been hit.
              let best: { u: any; dist: number } | null = null;
              for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
                if (dr === 0 && dc === 0) continue;
                const ar = current.row + dr, ac = current.col + dc;
                if (ar < 0 || ar >= GRID_SIZE || ac < 0 || ac >= GRID_SIZE) continue;
                const cu = newGrid[ar][ac].unit;
                if (!cu || cu.hp <= 0 || cu.dead) continue;
                if (cu.team === unit.team) continue;
                if (hit.has(cu.id)) continue;
                if (cu.isPhantom && (cu.phantom ?? 0) > 0) continue;
                const d = Math.max(Math.abs(dr), Math.abs(dc));
                if (!best || d < best.dist) best = { u: cu, dist: d };
              }
              if (!best) break;
              const cu = best.u;
              const chainDmg = Math.max(1, Math.round(dmg * mult));
              cu.hp = Math.max(0, cu.hp - chainDmg);
              if (cu.hp <= 0) (cu as any).dead = true;
              hit.add(cu.id);
              lightningChainCells.push({ row: cu.row, col: cu.col });
              logs.push(`⚡ Blitz → ${UNIT_DEFS[cu.type].emoji} ${chainDmg} (Kettenblitz ${Math.round(mult * 100)}%)`);
              // Mirror reflects chain-lightning hops too.
              applyMirrorReflect(unit, cu, chainDmg, logs);
              current = { row: cu.row, col: cu.col };
            }
          }

          // Chaindancer: chain attack through up to 2 additional diagonal enemies (70% dmg)
          let chaindancerCells: { row: number; col: number }[] | undefined;
          if (unit.type === 'chaindancer') {
            chaindancerCells = applyChainAttack(unit, target, dmg, newGrid, logs);
          }


          const def = UNIT_DEFS[unit.type];
          const tDef = UNIT_DEFS[target.type];
          const uColor = unit.color || UNIT_COLOR_GROUPS[unit.type];
          const tColor = target.color || UNIT_COLOR_GROUPS[target.type];
          const isStrong = (uColor === 'red' && tColor === 'green') || (uColor === 'green' && tColor === 'blue') || (uColor === 'blue' && tColor === 'red');
          const isWeak = (tColor === 'red' && uColor === 'green') || (tColor === 'green' && uColor === 'blue') || (tColor === 'blue' && uColor === 'red');
          const suffix = isStrong ? ' 💪' : isWeak ? ' 😰' : '';
          const dist = Math.abs(unit.row - target.row) + Math.abs(unit.col - target.col);
          logs.push(`${def.emoji} ${unit.team === 'player' ? '👤' : '💀'} ${def.label} → ${tDef.emoji} ${dmg}${suffix}${target.frozen ? ' 🧊' : ''}${target.hp <= 0 ? ' ☠️' : ''}`);

          // Dragon AOE: collect all cells in 3x3 around the dragon for fire effect
          let aoeCells: { row: number; col: number }[] | undefined;
          if (unit.type === 'dragon') {
            aoeCells = [];
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                const ar = unit.row + dr;
                const ac = unit.col + dc;
                if (ar >= 0 && ar < GRID_SIZE && ac >= 0 && ac < GRID_SIZE) {
                  aoeCells.push({ row: ar, col: ac });
                }
              }
            }

            // Splash damage: 30% to other enemies in the 3x3 area
            const splashDmg = Math.round(dmg * 0.3);
            for (const aoePos of aoeCells) {
              const cellUnit = newGrid[aoePos.row][aoePos.col].unit;
              if (cellUnit && cellUnit.hp > 0 && !cellUnit.dead && cellUnit.team !== unit.team && cellUnit.id !== target.id) {
                cellUnit.hp = Math.max(0, cellUnit.hp - splashDmg);
                const splashDef = UNIT_DEFS[cellUnit.type];
                logs.push(`🔥 ${unit.team === 'player' ? '👤' : '💀'} Drache 🔥→ ${splashDef.emoji} ${splashDmg} (Flächenschaden)`);
                events.push({
                  type: cellUnit.hp <= 0 ? 'kill' : 'hit',
                  attackerId: unit.id,
                  attackerRow: unit.row,
                  attackerCol: unit.col,
                  attackerEmoji: '🔥',
                  attackerType: unit.type,
                  targetId: cellUnit.id,
                  targetRow: aoePos.row,
                  targetCol: aoePos.col,
                  damage: splashDmg,
                  isStrong: false, isWeak: false,
                  isRanged: false,
                  isAoe: true,
                });
                if (cellUnit.hp <= 0) {
                  (cellUnit as any).dead = true;
                }
              }
            }
          }

          events.push({
            type: target.hp <= 0 ? 'kill' : 'hit',
            attackerId: unit.id,
            attackerRow: unit.row,
            attackerCol: unit.col,
            attackerEmoji: def.emoji,
            attackerType: unit.type,
            targetId: target.id,
            targetRow: target.row,
            targetCol: target.col,
            damage: dmg,
            isStrong, isWeak,
            isRanged: dist > 1,
            isAoe: unit.type === 'dragon',
            aoeCells: aoeCells,
            isFrozen: didFreeze,
            chainCells: lightningChainCells,
          });

          // Emit a separate chain event for the chaindancer (visual chain through diagonal enemies)
          if (chaindancerCells && chaindancerCells.length > 1) {
            events.push({
              type: 'chain',
              attackerId: unit.id,
              attackerRow: unit.row,
              attackerCol: unit.col,
              attackerEmoji: '🪢',
              attackerType: unit.type,
              targetId: target.id,
              targetRow: target.row,
              targetCol: target.col,
              damage: 0,
              isStrong: false, isWeak: false,
              isRanged: false,
              chainCells: chaindancerCells,
            });
          }


          // Emit freeze event for ice animation
          if (didFreeze) {
            events.push({
              type: 'freeze',
              attackerId: unit.id,
              attackerRow: unit.row,
              attackerCol: unit.col,
              attackerEmoji: '🥶',
              attackerType: unit.type,
              targetId: target.id,
              targetRow: target.row,
              targetCol: target.col,
              damage: 0,
              isStrong: false, isWeak: false,
              isRanged: dist > 1,
            });
          }

          // Apply post-attack specials (mirror reflect, magnet, spider web, shadowblade bonus, vulkanit lava, icegolem freeze-on-hit)
          applyPostAttackEffects(unit, target, dmg, newGrid, logs);

          if (target.hp <= 0) {
            const stillAlive = applyDeathEffects(target, allUnits, newGrid, logs, events);
            if (!stillAlive) (target as any).dead = true;
          }
          if (unit.hp <= 0) {
            const stillAlive = applyDeathEffects(unit, allUnits, newGrid, logs, events);
            if (!stillAlive) (unit as any).dead = true;
          }
        }
      }
      } // end if (!FORMATION_MODE)



      // === Judge: +8 ATK per fallen ally (recomputed each tick) ===
      for (const u of allUnits) {
        if (u.type !== 'judge' || u.hp <= 0) continue;
        const fallenAllies = allUnits.filter(a => a.team === u.team && a.dead && a.id !== u.id).length
          + (u.team === 'player' ? (playerUnits.length - allUnits.filter(a => a.team === 'player' && a.hp > 0).length) : 0);
        u.judgeBonus = Math.max(u.judgeBonus || 0, fallenAllies * 8);
      }




      // === Phase-3 on-death aura sweep (sniper-death, bomber-death-splash) ===
      for (const u of allUnits) {
        if (u.dead && !(u as any)._auraDeathHandled) {
          (u as any)._auraDeathHandled = true;
          applyAuraOnDeath(u, allUnits, newGrid, auraRef.current.zones, auraRef.current.effects, logs);
        }
      }

      if (logs.length > 0) {
        setBattleLog(prev => [...logs, ...prev].slice(0, 40));
      }
      if (events.length > 0) {
        setBattleEvents(events);
        // Play SFX for battle events
        let hasKill = false;
        let hasHit = false;
        let hasCrit = false;
        let hasRanged = false;
        for (const evt of events) {
          if (evt.type === 'kill') hasKill = true;
          else if (evt.isStrong) hasCrit = true;
          else hasHit = true;
          if (evt.isRanged) hasRanged = true;
        }
        // Play most impactful sound (don't stack too many)
        if (hasKill) sfxKill();
        else if (hasCrit) sfxCriticalHit();
        else if (hasHit) sfxHit();
        if (hasRanged) sfxProjectile();
      }

      const alive = allUnits.filter(u => u.hp > 0);
      // Banshees in mid-revival count as alive (they appear dead on the grid but will return).
      const revivingBanshees: Unit[] = [];
      for (let r = 0; r < GRID_SIZE; r++) for (let c = 0; c < GRID_SIZE; c++) {
        const cu = newGrid[r]?.[c]?.unit;
        if (cu && cu.type === 'banshee' && cu.reviveIn !== undefined && cu.reviveIn > 0) {
          revivingBanshees.push(cu);
        }
      }
      const pAliveAll = [...alive.filter(u => u.team === 'player'), ...revivingBanshees.filter(u => u.team === 'player')];
      const eAliveAll = [...alive.filter(u => u.team === 'enemy'), ...revivingBanshees.filter(u => u.team === 'enemy')];
      // Clones don't count for win evaluation
      const pAlive = pAliveAll.filter(u => !u.isClone);
      const eAlive = eAliveAll.filter(u => !u.isClone);

      const roundEnding = eAlive.length === 0 || pAlive.length === 0;
      if (roundEnding) {
        // Instantly despawn all clones from the board
        for (let r = 0; r < GRID_SIZE; r++) {
          for (let c = 0; c < GRID_SIZE; c++) {
            const cu = newGrid[r][c].unit;
            if (cu?.isClone) newGrid[r][c].unit = undefined;
          }
        }
        setPlayerUnits(pAlive);
        setEnemyUnits(eAlive);
      } else {
        setPlayerUnits(pAliveAll);
        setEnemyUnits(eAliveAll);
      }

      if (eAlive.length === 0) {
        const newPS = playerScoreRef.current + 1;
        playerScoreRef.current = newPS;
        setPlayerScore(newPS);
        const result = checkGameOver(newPS, enemyScoreRef.current);
        if (result.draw) {
          setGameDraw(true);
          setPhase('game_draw');
        } else {
          setPhase('round_won');
        }
      } else if (pAlive.length === 0) {
        const newES = enemyScoreRef.current + 1;
        enemyScoreRef.current = newES;
        setEnemyScore(newES);
        const result = checkGameOver(playerScoreRef.current, newES);
        if (result.draw) {
          setGameDraw(true);
          setPhase('game_draw');
        } else {
          setPhase('round_lost');
        }
      }

      setTurnCount(prev => { turnCountRef.current = prev + 1; return prev + 1; });
      return newGrid;
    });
  }, []);

  // Battle loop
  useEffect(() => {
    if (phase !== 'battle') {
      if (battleRef.current) clearInterval(battleRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    stalemateHpRef.current = -1;
    stalemateTicksRef.current = 0;
    stalemateRushRef.current = 0;
    battleTick();
    battleRef.current = setInterval(battleTick, 675);
    timerRef.current = setInterval(() => {
      setBattleTimer(prev => {
        if (prev <= 1) {
          // Time's up - resolve by unit count
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (battleRef.current) clearInterval(battleRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, battleTick]);

  // Handle timer expiry
  useEffect(() => {
    if (phase !== 'battle' || battleTimer > 0) return;
    // Stop the battle
    if (battleRef.current) clearInterval(battleRef.current);
    if (timerRef.current) clearInterval(timerRef.current);

    const pAlive = playerUnits.filter(u => u.hp > 0 && !u.dead && !u.isClone);
    const eAlive = enemyUnits.filter(u => u.hp > 0 && !u.dead && !u.isClone);

    if (pAlive.length > eAlive.length) {
      const newPS = playerScoreRef.current + 1;
      playerScoreRef.current = newPS;
      setPlayerScore(newPS);
      const result = checkGameOver(newPS, enemyScoreRef.current);
      if (result.draw) { setGameDraw(true); setPhase('game_draw'); }
      else setPhase('round_won');
      setBattleLog(prev => ['⏰ Zeit abgelaufen! Du hast mehr Einheiten übrig!', ...prev]);
    } else if (eAlive.length > pAlive.length) {
      const newES = enemyScoreRef.current + 1;
      enemyScoreRef.current = newES;
      setEnemyScore(newES);
      const result = checkGameOver(playerScoreRef.current, newES);
      if (result.draw) { setGameDraw(true); setPhase('game_draw'); }
      else setPhase('round_lost');
      setBattleLog(prev => ['⏰ Zeit abgelaufen! Der Gegner hat mehr Einheiten!', ...prev]);
    } else {
      const newPS = playerScoreRef.current + 1;
      const newES = enemyScoreRef.current + 1;
      playerScoreRef.current = newPS;
      enemyScoreRef.current = newES;
      setPlayerScore(newPS);
      setEnemyScore(newES);
      const result = checkGameOver(newPS, newES);
      if (result.draw) { setGameDraw(true); setPhase('game_draw'); }
      else setPhase('round_draw');
      setBattleLog(prev => ['⏰ Zeit abgelaufen! Gleichstand – beide erhalten einen Punkt!', ...prev]);
    }
  }, [battleTimer, phase, playerUnits, enemyUnits]);

  const gameOverResult = checkGameOver(playerScore, enemyScore);
  const gameOver = gameOverResult.over;
  const gameWon = gameOverResult.won;

  // Overtime no longer used in singleplayer round-based mode
  const inOvertime = false;

  // Accept draw offer (singleplayer: player decides alone)
  const acceptDraw = useCallback(() => {
    setGameDraw(true);
    setPhase('game_draw');
  }, []);

  const nextRound = useCallback(() => {
    // Update fatigue: surviving unit types get +1 fatigue, dead ones reset to 0
    // Also, banned types reset to 0 (they rested this round)
    setPlayerFatigue(prev => {
      const next: Record<string, number> = { ...prev };
      if (hasRoster) {
        const survivingSlots = new Set(
          playerUnits.filter(u => u.hp > 0 && !u.dead && u.slotIndex !== undefined).map(u => u.slotIndex!)
        );
        for (let i = 0; i < 9; i++) {
          if (playerBannedSlots.includes(i)) next[i] = 0;
          else if (survivingSlots.has(i)) next[i] = 1;
          else next[i] = 0;
        }
      } else {
        const survivingTypes = new Set(playerUnits.filter(u => u.hp > 0 && !u.dead).map(u => u.type));
        for (const t of UNIT_TYPES) {
          if (playerBannedUnits.includes(t)) next[t] = 0;
          else if (survivingTypes.has(t)) next[t] = 1;
          else next[t] = 0;
        }
      }
      return next;
    });
    setEnemyFatigue(prev => {
      const next = { ...prev };
      const survivingTypes = new Set(enemyUnits.filter(u => u.hp > 0 && !u.dead).map(u => u.type));
      for (const t of UNIT_TYPES) {
        if (enemyBannedUnits.includes(t)) {
          next[t] = 0; // rested this round
        } else if (survivingTypes.has(t)) {
          next[t] = 1; // survived → immediately banned next round
        } else {
          next[t] = 0;
        }
      }
      return next;
    });

    startNextRound();
  }, [playerStarts, playerUnits, enemyUnits, playerBannedUnits, enemyBannedUnits]);

  const startNextRound = useCallback(() => {
    const newStarts = !playerStarts;
    setRoundNumber(prev => prev + 1);
    setPlayerStarts(newStarts);
    setPlayerUnits([]);
    setTurnCount(0);
    turnCountRef.current = 0;
    setBattleLog([]);
    setSelectedUnit(UNIT_TYPES.find(t => !playerBannedUnits.includes(t)) || 'warrior');
    setPlaceTimer(PLACE_TIME_LIMIT);
    setMoraleBoostUsed(false);
    setMoraleBoostActive(null);
    moraleTicksLeft.current = 0;
    moralePhase.current = 'none';
    setFocusFireUsed(false);
    setFocusFireActive(false);
    focusFireTicksLeft.current = 0;
    setSacrificeUsed(false);
    setShieldWallUsed(false);
    setShieldWallActive(false);
    shieldWallTicksLeft.current = 0;
    setFlankLeftUsed(false);
    setFlankRightUsed(false);
    setFlankActive(null);
    flankActiveRef.current = null;
    aiMoraleUsed.current = false;
    aiMoralePhase.current = 'none';
    aiMoraleTicksLeft.current = 0;
    setAiMoraleActive(null);
    aiFocusFireUsed.current = false;
    aiFocusFireTicksLeft.current = 0;
    aiSacrificeUsed.current = false;

    if (newStarts) {
      setGrid(generateTerrain(createEmptyGrid()));
      setEnemyUnits([]);
      setPhase('place_player');
    } else {
      const terrainGrid = generateTerrain(createEmptyGrid());
      const aiMax = getMaxUnits(playerScore, enemyScore, roundNumber + 1);
      const aiPlacements = generateAIPlacement([], aiMax, terrainGrid, difficulty, enemyBannedUnits);
      const enemies: Unit[] = aiPlacements.map(p => createUnit(p.type, 'enemy', p.row, p.col));
      for (const e of enemies) terrainGrid[e.row][e.col].unit = e;
      setGrid(terrainGrid);
      setEnemyUnits(enemies);
      setPhase('place_player');
    }
  }, [playerStarts]);

  // Continue overtime (decline draw offer)
  const continueOvertime = useCallback(() => {
    setDrawOfferPending(false);
    startNextRound();
  }, [startNextRound]);

  // === Match recording (singleplayer) ===
  const recorderStartedRef = useRef(false);
  const recordedRoundRef = useRef(0);
  const recordedEventsCountRef = useRef(0);
  const matchEndedRef = useRef(false);

  // Start match once on mount (when roster is available)
  useEffect(() => {
    if (recorderStartedRef.current) return;
    if (!hasRoster) return;
    recorderStartedRef.current = true;
    matchRecorder.start({
      mode: 'singleplayer',
      difficulty,
      player1Label: 'Spieler',
      player2Label: `KI (Stufe ${difficulty})`,
    });
    matchRecorder.setRoster('player1', roster!, (slot) => SLOT_COLORS[slot]);
    matchEndedRef.current = false;
    return () => {
      // Don't cancel on unmount if match already ended.
      if (!matchEndedRef.current) matchRecorder.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snapshot placements when entering battle phase
  useEffect(() => {
    if (phase !== 'battle' || !recorderStartedRef.current) return;
    if (recordedRoundRef.current === roundNumber) return;
    recordedRoundRef.current = roundNumber;
    recordedEventsCountRef.current = 0;
    const placements = [
      ...playerUnits.map(u => ({ team: 'player1' as const, type: u.type, color: (u.color as ColorGroup | undefined), row: u.row, col: u.col, hp: u.hp })),
      ...enemyUnits.map(u => ({ team: 'player2' as const, type: u.type, color: (u.color as ColorGroup | undefined), row: u.row, col: u.col, hp: u.hp })),
    ];
    matchRecorder.startRound(roundNumber, placements);
  }, [phase, roundNumber, playerUnits, enemyUnits]);

  // Stream battle events
  useEffect(() => {
    if (!recorderStartedRef.current || phase !== 'battle') return;
    if (battleEvents.length === 0) return;
    matchRecorder.tickAdvance();
    const idMap = new Map<string, { team: 'player1' | 'player2'; type: UnitType }>();
    for (const u of playerUnits) idMap.set(u.id, { team: 'player1', type: u.type });
    for (const u of enemyUnits) idMap.set(u.id, { team: 'player2', type: u.type });
    matchRecorder.addBattleEvents(
      battleEvents,
      (id) => idMap.get(id)?.team,
      (id) => idMap.get(id)?.type,
    );
  }, [battleEvents, phase, playerUnits, enemyUnits]);

  // End match on game over / draw
  useEffect(() => {
    if (!recorderStartedRef.current || matchEndedRef.current) return;
    if (!gameOver && !gameDraw) return;
    matchEndedRef.current = true;
    const winner = gameDraw ? 'draw' : (gameWon ? 'player1' : 'player2');
    matchRecorder.endRound(playerScore, enemyScore, winner);
    matchRecorder.endMatch(winner, { player1: playerScore, player2: enemyScore });
  }, [gameOver, gameWon, gameDraw, playerScore, enemyScore]);

  // Formation movement (player drag during combat / placement)
  const moveFormation = useCallback((unitId: string, dr: number, dc: number) => {
    if (dr === 0 && dc === 0) return false;
    if (Math.abs(dr) > 1 || Math.abs(dc) > 1) return false;
    let success = false;
    setGrid(prevGrid => {
      const newGrid = prevGrid.map(r => r.map(c => ({ ...c, unit: c.unit ? { ...c.unit } : null })));
      const all: Unit[] = [];
      for (const row of newGrid) for (const cell of row) if (cell.unit && cell.unit.hp > 0 && !cell.unit.dead) all.push(cell.unit);
      const formation = findFormationContaining(all, unitId);
      if (!formation || formation.length === 0) return prevGrid;
      // Only allow moving own (player) formations from here
      if (formation[0].team !== 'player') return prevGrid;
      if (!applyFormationMove(formation, dr, dc, newGrid)) return prevGrid;
      success = true;
      // Sync playerUnits state (positions changed)
      setPlayerUnits(prev => prev.map(u => {
        const moved = formation.find(f => f.id === u.id);
        return moved ? { ...u, row: moved.row, col: moved.col } : u;
      }));
      return newGrid;
    });
    return success;
  }, []);



  return {
    grid, phase, selectedUnit, setSelectedUnit,
    selectedSlot, setSelectedSlot,
    roster: hasRoster ? roster! : undefined,
    placedSlots: Array.from(placedSlots),
    playerUnits, enemyUnits, turnCount, battleLog, battleEvents, battleTimer,
    playerScore, enemyScore, roundNumber, playerStarts,
    playerMaxUnits, enemyMaxUnits,
    gameOver, gameWon, gameDraw,
    placeUnit, removeUnit, confirmPlacement, startBattle, revealAIPlacement,
    moveFormation,
    resetGame, nextRound,
    moraleBoostUsed, moraleBoostActive, activateMoraleBoost,
    focusFireUsed, focusFireActive, activateFocusFire,
    sacrificeUsed, activateSacrifice,
    shieldWallUsed, shieldWallActive, activateShieldWall,
    flankLeftUsed, flankRightUsed, flankActive, activateFlank,
    surrenderRound,
    waitingForOpponent: false,
    aiMoraleActive,
    inOvertime: false,
    overtimeCount: 0,
    drawOfferPending: false,
    acceptDraw: () => {},
    continueOvertime: () => {},
    // Fatigue system
    playerBannedUnits,
    playerBannedSlots,
    playerFatigue,
    // Placement timer
    placeTimer: hasPlaceTimer ? placeTimer : undefined,
  };
}
