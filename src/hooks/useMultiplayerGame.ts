import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Unit, UnitType, Cell, Phase,
  createEmptyGrid, createUnit, findTarget, moveToward, canAttack, calcDamage,
  generateTerrain, getActivationTurn, setBondsForPlacement,
  GRID_SIZE, PLAYER_ROWS, ENEMY_ROWS, UNIT_DEFS, UNIT_TYPES, UNIT_COLOR_GROUPS, ROUNDS_TO_WIN, ROUND_TIME_LIMIT,
  MULTI_PLACE_TIME_LIMIT, getMaxUnits, tickClonerSpawns, tickMageImpulse, tickFrostNova, tickRiderHorn, tickArcherVolley, tickDragonSpin, tickMagnetPull, handleShadowbladeTick, shouldSkipMove, leaveArsonistTrail,
  handleTerrainSeeker, isImmuneToFreeze, isImmuneToFire, effectiveCooldown, tickTerrainHeals,
  processLavaTick, processGhostTick, tickPhantomTimers,
  tickBomberActions, tickBombFuses, tickObeliskAura, tickShadowpriestHarvest,
  spawnDoppelgangerPhantoms, applyPostAttackEffects, applyDeathEffects, applyChainAttack, applyShadowpriestCurse,
} from '@/lib/battleGame';
import { BattleEvent } from '@/lib/battleEvents';
import { supabase } from '@/integrations/supabase/client';
import { updateRoom, ensureAnonymousSession } from '@/lib/multiplayer';
import { matchRecorder } from '@/lib/matchRecorder';
import { loadAuraData, type AuraZoneMap, type AuraEffectMap } from '@/lib/auraData';
import { applyAuraStacks, applyAuraTick, applyAuraSourceEffects } from '@/lib/auraEffects';
import { findFormations, applyFormationMove } from '@/lib/formations';

interface MultiplayerConfig {
  roomId: string;
  role: 'player1' | 'player2';
  roster?: UnitType[];
  opponentRoster?: UnitType[];
}

// Slot color layout matches UnitRoster: slots 0-2 red, 3-5 green, 6-8 blue
const SLOT_COLORS: ('red' | 'green' | 'blue')[] = ['red','red','red','green','green','green','blue','blue','blue'];
const BATTLE_WORLD_ROWS = GRID_SIZE * 3;

function createBattleWorldGrid(): Cell[][] {
  return Array.from({ length: BATTLE_WORLD_ROWS }, (_, row) =>
    Array.from({ length: GRID_SIZE }, (_, col) => ({ row, col, unit: null, terrain: 'none' as const }))
  );
}

function getRoundUnitLimit(roundNumber: number): number {
  return Math.min(9 + (roundNumber - 1) * 2, 17);
}

// Use MULTI_PLACE_TIME_LIMIT for multiplayer (20s)

function serializeUnit(u: Unit) {
  return {
    id: u.id, type: u.type, team: u.team, hp: u.hp, maxHp: u.maxHp, attack: u.attack,
    row: u.row, col: u.col, cooldown: u.cooldown, maxCooldown: u.maxCooldown,
    dead: u.dead, frozen: u.frozen, frozenDmgMul: u.frozenDmgMul, webbed: u.webbed,
    stuckTurns: u.stuckTurns, enteredArena: u.enteredArena, activationTurn: u.activationTurn,
    startRow: u.startRow, lastAttackedId: u.lastAttackedId, bondedToTankId: u.bondedToTankId,
    bondBroken: u.bondBroken, burning: u.burning, bleeding: u.bleeding,
    ghost: u.ghost, reviveIn: u.reviveIn, bansheeRevived: u.bansheeRevived,
    isClone: u.isClone, cloneTimer: u.cloneTimer, clonesSpawnedTotal: u.clonesSpawnedTotal,
    parentClonerId: u.parentClonerId, isPhantom: u.isPhantom, phantom: u.phantom,
    doppelSpawned: u.doppelSpawned, phantomId: u.phantomId,
    frostNovaTimer: u.frostNovaTimer, hornTimer: u.hornTimer, hornBuff: u.hornBuff,
    volleyTimer: u.volleyTimer, spinTimer: u.spinTimer, spinTicksLeft: u.spinTicksLeft,
    spinDirIdx: u.spinDirIdx, spinClockwise: u.spinClockwise,
    laneCol: u.laneCol, laneBroken: u.laneBroken,
    bombPlaceTimer: (u as any).bombPlaceTimer, bombSpecialTimer: (u as any).bombSpecialTimer,
    obeliskBeamTimer: (u as any).obeliskBeamTimer, obeliskBeamLeft: (u as any).obeliskBeamLeft,
    obeliskBuff: (u as any).obeliskBuff, curseStacks: u.curseStacks, cursed: u.cursed,
    unhealable: u.unhealable, curseAtkMul: u.curseAtkMul, soulHarvestTimer: u.soulHarvestTimer,
    permAtkBonus: u.permAtkBonus, auraStacks: u.auraStacks,
    color: (u as any).color, slotIndex: (u as any).slotIndex,
  };
}

function serializeGrid(grid: Cell[][]) {
  return grid.map(row => row.map(cell => ({
    row: cell.row, col: cell.col, terrain: cell.terrain,
    unit: cell.unit ? serializeUnit(cell.unit) : null,
    lavaTicks: cell.lavaTicks,
    lavaOwnerTeam: cell.lavaOwnerTeam,
    lavaDmg: cell.lavaDmg,
    bomb: cell.bomb ?? null,
    obeliskAura: cell.obeliskAura,
    obeliskAuraTeam: cell.obeliskAuraTeam,
  })));
}

function getDeterministicFirstPlacer(roomId: string, roundNumber: number): 1 | 2 {
  const seed = [...roomId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) + roundNumber * 31;
  return seed % 2 === 0 ? 1 : 2;
}

export function useMultiplayerGame(config: MultiplayerConfig) {
  const { roomId, role, roster, opponentRoster } = config;
  const hasRoster = !!(roster && roster.length === 9);
  const isHost = role === 'player1';
  const myRows = isHost ? PLAYER_ROWS : ENEMY_ROWS;
  const myTeam = isHost ? 'player' as const : 'enemy' as const;
  const playerMaxUnits = getRoundUnitLimit(roundNumber);
  const enemyMaxUnits = playerMaxUnits;

  const [grid, setGrid] = useState<Cell[][]>(() => generateTerrain(createEmptyGrid()));
  const [phase, setPhase] = useState<Phase>('place_player');
  const [selectedUnit, setSelectedUnit] = useState<UnitType | null>(hasRoster ? roster![0] : 'warrior');
  const [selectedSlot, setSelectedSlot] = useState<number | null>(hasRoster ? 0 : null);
  const [playerUnits, setPlayerUnits] = useState<Unit[]>([]);
  const [enemyUnits, setEnemyUnits] = useState<Unit[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [battleLog, setBattleLog] = useState<string[]>([]);
  const [playerScore, setPlayerScore] = useState(0);
  const [enemyScore, setEnemyScore] = useState(0);
  const playerScoreRef = useRef(0);
  const enemyScoreRef = useRef(0);
  const [roundNumber, setRoundNumber] = useState(1);
  const [battleEvents, setBattleEvents] = useState<BattleEvent[]>([]);
  const [battleTimer, setBattleTimer] = useState(ROUND_TIME_LIMIT);
  const [opponentLeft, setOpponentLeft] = useState(false);

  // Morale boost state (each player has their own)
  const [moraleBoostUsed, setMoraleBoostUsed] = useState(false);
  const [moraleBoostActive, setMoraleBoostActive] = useState<'buff' | 'debuff' | null>(null);
  const [opponentMoraleActive, setOpponentMoraleActive] = useState<'buff' | 'debuff' | null>(null);
  const moraleTicksLeft = useRef(0);
  const moralePhase = useRef<'none' | 'buff' | 'debuff'>('none');
  // Host also tracks opponent's morale
  const opponentMoraleTicksLeft = useRef(0);
  const opponentMoralePhase = useRef<'none' | 'buff' | 'debuff'>('none');

  // Focus Fire state
  const [focusFireUsed, setFocusFireUsed] = useState(false);
  const [focusFireActive, setFocusFireActive] = useState(false);
  const focusFireTicksLeft = useRef(0);
  // Host tracks opponent focus fire
  const opponentFocusFireTicksLeft = useRef(0);

  // Sacrifice Ritual state
  const [sacrificeUsed, setSacrificeUsed] = useState(false);

  // Shield Wall state
  const [shieldWallUsed, setShieldWallUsed] = useState(false);
  const [shieldWallActive, setShieldWallActive] = useState(false);
  const shieldWallTicksLeft = useRef(0);

  // Fatigue system: tracks how many consecutive rounds each unit type survived
  const [playerFatigue, setPlayerFatigue] = useState<Record<string, number>>({});
  const playerBannedUnits: UnitType[] = UNIT_TYPES.filter(t => (playerFatigue[t] || 0) >= 1);

  // Simultaneous placement: each player has their own ready flag + 60s timer.
  const [myReady, setMyReady] = useState(false);
  const [opponentReady, setOpponentReady] = useState(false);
  const [placeTimer, setPlaceTimer] = useState(MULTI_PLACE_TIME_LIMIT);
  // Live snapshot of opponent's current placement (for spy button).
  const [opponentSnapshot, setOpponentSnapshot] = useState<Unit[]>([]);

  // Flank state (mine + opponent indicator)
  const [flankLeftUsed, setFlankLeftUsed] = useState(false);
  const [flankRightUsed, setFlankRightUsed] = useState(false);
  const [flankActive, setFlankActive] = useState<'left' | 'right' | null>(null);
  const flankActiveRef = useRef<{ dir: -1 | 1; step: number } | null>(null);
  const opponentFlankRef = useRef<{ dir: -1 | 1; step: number } | null>(null);

  // Battlefield background ID — host picks, both display the same.
  const [battlefieldId, setBattlefieldId] = useState<'grass' | 'desert'>(() =>
    Math.random() < 0.5 ? 'grass' : 'desert'
  );

  const battleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const placeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const phaseRef = useRef(phase);
  const playerUnitsRef = useRef(playerUnits);
  const enemyUnitsRef = useRef(enemyUnits);
  const turnCountRef = useRef(0);
  const disconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hadBothPlayersRef = useRef(false);
  const myReadyRef = useRef(false);
  const opponentReadyRef = useRef(false);
  const snapshotBroadcastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive isMyTurnToPlace and waitingForOpponent from ready flags.
  const isMyTurnToPlace = phase === 'place_player' && !myReady;
  const waitingForOpponent = phase === 'place_player' && myReady && !opponentReady;
  // Compatibility: kept for UI; always 'first' (no alternating anymore).
  const placingPhase: 'first' | 'second' | 'done' = phase === 'place_player' ? 'first' : 'done';

  const isMyTurnRef = useRef(isMyTurnToPlace);

  // Keep refs in sync
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { playerUnitsRef.current = playerUnits; }, [playerUnits]);
  useEffect(() => { enemyUnitsRef.current = enemyUnits; }, [enemyUnits]);
  useEffect(() => { isMyTurnRef.current = isMyTurnToPlace; }, [isMyTurnToPlace]);
  useEffect(() => { myReadyRef.current = myReady; }, [myReady]);
  useEffect(() => { opponentReadyRef.current = opponentReady; }, [opponentReady]);
  useEffect(() => { playerScoreRef.current = playerScore; }, [playerScore]);
  useEffect(() => { enemyScoreRef.current = enemyScore; }, [enemyScore]);

  const auraRef = useRef<{ zones: AuraZoneMap; effects: AuraEffectMap }>({ zones: {}, effects: {} });
  useEffect(() => {
    loadAuraData().then(d => { auraRef.current = d; }).catch(() => {});
  }, []);

  // Setup broadcast channel
  useEffect(() => {
    const channel = supabase.channel(`game-battle-${roomId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'game_sync' }, ({ payload }) => {
      const { action, data } = payload;

      if (action === 'terrain') {
        setGrid(data.grid as Cell[][]);
        setPlaceTimer(MULTI_PLACE_TIME_LIMIT);
        if (data.battlefieldId) setBattlefieldId(data.battlefieldId);
      }

      // Opponent activated flank
      if (action === 'flank') {
        const dir = data.dir as -1 | 1;
        if (isHost) {
          opponentFlankRef.current = { dir, step: 0 };
        }
        setBattleLog(prev => [`🏃 GEGNER FLANKE ${dir === -1 ? '←' : '→'}!`, ...prev]);
      }

      // Live snapshot of opponent's current placement (used by spy button)
      if (action === 'placement_snapshot') {
        const units = (data.units as any[]).map((u: any) => ({ ...u } as Unit));
        setOpponentSnapshot(units);
      }

      // Opponent toggled ready (with their final units, so host can start battle without re-fetch)
      if (action === 'ready_toggle') {
        const ready = !!data.ready;
        setOpponentReady(ready);
        opponentReadyRef.current = ready;
        if (ready && Array.isArray(data.units)) {
          const units = (data.units as any[]).map((u: any) => ({ ...u } as Unit));
          setOpponentSnapshot(units);
        }
        // Host: if both ready, start battle
        if (ready && isHost && myReadyRef.current) {
          setTimeout(() => startBattleRef.current?.(), 100);
        }
      }

      // Opponent surrendered the round
      if (action === 'surrender') {
        setPlayerScore(s => s + 1);
        setPhase('round_won');
      }

      if (action === 'battle_start') {
        setGrid(data.grid as Cell[][]);
        setPhase('battle');
        setBattleTimer(ROUND_TIME_LIMIT);
        setMyReady(false);
        setOpponentReady(false);
        setOpponentSnapshot([]);
      }

      if (action === 'battle_tick') {
        if (!isHost) {
          setGrid(data.grid as Cell[][]);
          setBattleLog(data.logs);
          setBattleEvents(data.events || []);
          setBattleTimer(data.timer);
          setPlayerUnits(data.playerUnits || []);
          setEnemyUnits(data.enemyUnits || []);
          setTurnCount(data.turnCount);
          // Sync morale states from host perspective (swap for guest)
          setMoraleBoostActive(data.enemyMorale || null);
          setOpponentMoraleActive(data.playerMorale || null);
          // Sync focus fire state
          if (data.enemyFocusFire) setFocusFireActive(true);
          else setFocusFireActive(false);
          // Sync flank active state from host (guest's units = enemy team on host)
          const myFlank = data.enemyFlankActive as -1 | 1 | null | undefined;
          setFlankActive(myFlank === -1 ? 'left' : myFlank === 1 ? 'right' : null);
        }
      }

      if (action === 'war_cry') {
        setOpponentMoraleActive('buff');
        setBattleLog(prev => ['🔥 GEGNER KRIEGSSCHREI! +25% Schaden für 3 Züge!', ...prev]);
        if (isHost) {
          opponentMoralePhase.current = 'buff';
          opponentMoraleTicksLeft.current = 3;
        }
      }

      if (action === 'focus_fire') {
        setBattleLog(prev => ['🎯 GEGNER FOKUSFEUER! Alle Einheiten greifen stärkstes Ziel an!', ...prev]);
        if (isHost) {
          opponentFocusFireTicksLeft.current = 3;
        }
      }

      if (action === 'sacrifice') {
        setBattleLog(prev => [`💀 GEGNER OPFERRITUAL! Einheit geopfert – alle anderen geheilt!`, ...prev]);
      }

      if (action === 'shield_wall') {
        setBattleLog(prev => ['🛡️ GEGNER SCHILDWALL! Rückzug zur Base!', ...prev]);
      }

      if (action === 'round_end') {
        setPhase(data.phase);
        setPlayerScore(data.playerScore);
        setEnemyScore(data.enemyScore);
        setGrid(data.grid as Cell[][]);
      }

      if (action === 'next_round') {
        // Update fatigue before resetting
        setPlayerFatigue(prev => {
          const next = { ...prev };
          const survivingTypes = new Set(playerUnits.filter(u => u.hp > 0 && !u.dead).map(u => u.type));
          for (const t of UNIT_TYPES) {
            if ((prev[t] || 0) >= 1) {
              next[t] = 0; // rested this round
            } else if (survivingTypes.has(t)) {
              next[t] = 1; // survived → immediately banned next round
            } else {
              next[t] = 0;
            }
          }
          return next;
        });

        setGrid(data.grid as Cell[][]);
        setPhase('place_player');
        setRoundNumber(data.roundNumber);
        setPlayerScore(data.playerScore);
        setEnemyScore(data.enemyScore);
        setMyReady(false);
        setOpponentReady(false);
        myReadyRef.current = false;
        opponentReadyRef.current = false;
        setOpponentSnapshot([]);
        setPlaceTimer(MULTI_PLACE_TIME_LIMIT);
        setPlayerUnits([]);
        setEnemyUnits([]);
        setBattleLog([]);
        setTurnCount(0);
        setSelectedUnit('warrior'); // will be corrected by fatigue check in UI
        setBattleTimer(ROUND_TIME_LIMIT);
        // Reset morale for new round
        setMoraleBoostUsed(false);
        setMoraleBoostActive(null);
        setOpponentMoraleActive(null);
        moralePhase.current = 'none';
        moraleTicksLeft.current = 0;
        opponentMoralePhase.current = 'none';
        opponentMoraleTicksLeft.current = 0;
        setFocusFireUsed(false);
        setFocusFireActive(false);
        focusFireTicksLeft.current = 0;
        opponentFocusFireTicksLeft.current = 0;
        setSacrificeUsed(false);
        setShieldWallUsed(false);
        setShieldWallActive(false);
        shieldWallTicksLeft.current = 0;
        setFlankLeftUsed(false);
        setFlankRightUsed(false);
        setFlankActive(null);
        flankActiveRef.current = null;
        opponentFlankRef.current = null;
        if (data.battlefieldId) setBattlefieldId(data.battlefieldId);
      }
    });

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, isHost]);

  // Presence channel to detect opponent disconnect
  useEffect(() => {
    const presenceChannel = supabase.channel(`presence-${roomId}`);
    const DISCONNECT_GRACE_MS = 20000;
    hadBothPlayersRef.current = false;

    const clearDisconnectTimer = () => {
      if (disconnectTimeoutRef.current) {
        clearTimeout(disconnectTimeoutRef.current);
        disconnectTimeoutRef.current = null;
      }
    };

    const bothPlayersPresent = () => {
      const state = presenceChannel.presenceState();
      const metas = Object.values(state).flat() as Array<{ role?: string }>;
      const roles = new Set(metas.map(meta => meta.role).filter(Boolean));
      return roles.has('player1') && roles.has('player2');
    };

    const hasMatchStarted = () => {
      const currentPhase = phaseRef.current;
      if (currentPhase === 'battle' || currentPhase === 'round_won' || currentPhase === 'round_lost' || currentPhase === 'round_draw') {
        return true;
      }
      return currentPhase === 'place_player' && (myReadyRef.current || opponentReadyRef.current);
    };

    const scheduleDisconnectCheck = () => {
      if (!hasMatchStarted() || disconnectTimeoutRef.current || !hadBothPlayersRef.current) return;

      disconnectTimeoutRef.current = setTimeout(() => {
        disconnectTimeoutRef.current = null;
        if (!bothPlayersPresent() && hasMatchStarted()) {
          setOpponentLeft(true);
        }
      }, DISCONNECT_GRACE_MS);
    };

    const handleSyncOrJoin = () => {
      if (bothPlayersPresent()) {
        hadBothPlayersRef.current = true;
        clearDisconnectTimer();
        setOpponentLeft(false);
        return;
      }

      if (hadBothPlayersRef.current) {
        scheduleDisconnectCheck();
      }
    };

    const handleLeave = () => {
      scheduleDisconnectCheck();
    };

    presenceChannel
      .on('presence', { event: 'sync' }, handleSyncOrJoin)
      .on('presence', { event: 'join' }, handleSyncOrJoin)
      .on('presence', { event: 'leave' }, handleLeave)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({ role });
        }
      });

    return () => {
      clearDisconnectTimer();
      supabase.removeChannel(presenceChannel);
    };
  }, [roomId, role]);

  // Host generates terrain — round 1 only. Subsequent rounds handled by nextRound().
  const initialTerrainSent = useRef(false);
  useEffect(() => {
    if (isHost && roundNumber === 1 && phase === 'place_player' && !initialTerrainSent.current) {
      initialTerrainSent.current = true;
      setTimeout(() => {
        channelRef.current?.send({
          type: 'broadcast',
          event: 'game_sync',
          payload: { action: 'terrain', data: { grid: serializeGrid(grid), battlefieldId } },
        });
      }, 500);
    }
  }, [isHost, roundNumber, phase]);

  // Placement timer countdown — runs for each player independently.
  useEffect(() => {
    if (phase !== 'place_player' || myReady) {
      if (placeTimerRef.current) clearInterval(placeTimerRef.current);
      return;
    }

    placeTimerRef.current = setInterval(() => {
      setPlaceTimer(prev => {
        if (prev <= 1) {
          if (placeTimerRef.current) clearInterval(placeTimerRef.current);
          setTimeout(() => autoConfirmPlacement(), 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (placeTimerRef.current) clearInterval(placeTimerRef.current);
    };
  }, [phase, myReady]);

  // Auto-confirm when timer runs out (or player clicks bereit)
  const autoConfirmPlacement = useCallback(() => {
    if (!isMyTurnRef.current) return; // only the active placer triggers this
    confirmPlacement();
  }, []);

  // Place unit on my side
  const placeUnit = useCallback((row: number, col: number, overrideSlot?: number) => {
    if (phase !== 'place_player' || !isMyTurnToPlace) return;
    if (!myRows.includes(row)) return;
    if (playerUnits.length >= getMaxUnits(playerScore, enemyScore, roundNumber)) return;
    if (grid[row][col].unit) return;
    if (grid[row][col].terrain === 'water') return;

    let type: UnitType | null = null;
    let color: 'red' | 'green' | 'blue' | undefined;
    let slotIdx: number | undefined;

    if (hasRoster) {
      const useSlot = overrideSlot !== undefined ? overrideSlot : selectedSlot;
      if (useSlot === null || useSlot === undefined) return;
      type = roster![useSlot];
      color = SLOT_COLORS[useSlot];
      slotIdx = useSlot;
    } else {
      if (!selectedUnit) return;
      if (playerBannedUnits.includes(selectedUnit)) return;
      type = selectedUnit;
    }

    const unit = createUnit(type, myTeam, row, col, color, slotIdx);
    setPlayerUnits(prev => [...prev, unit]);
    setGrid(prev => {
      const next = prev.map(r => r.map(c => ({ ...c })));
      next[row][col] = { ...next[row][col], unit };
      return next;
    });
  }, [phase, isMyTurnToPlace, selectedUnit, selectedSlot, hasRoster, roster, playerUnits, grid, myRows, myTeam, playerBannedUnits, playerScore, enemyScore, roundNumber]);

  // Remove placed unit
  const removeUnit = useCallback((unitId: string) => {
    if (phase !== 'place_player' || !isMyTurnToPlace) return;
    setPlayerUnits(prev => {
      const unit = prev.find(u => u.id === unitId);
      if (!unit) return prev;
      setGrid(g => {
        const next = g.map(r => r.map(c => ({ ...c })));
        next[unit.row][unit.col].unit = null;
        return next;
      });
      return prev.filter(u => u.id !== unitId);
    });
  }, [phase, isMyTurnToPlace]);

  // Surrender: end the round, opponent gets the point.
  const surrenderRound = useCallback(() => {
    if (phaseRef.current === 'round_won' || phaseRef.current === 'round_lost' || phaseRef.current === 'round_draw') return;
    setEnemyScore(s => s + 1);
    setPhase('round_lost');
    channelRef.current?.send({
      type: 'broadcast',
      event: 'game_sync',
      payload: { action: 'surrender', data: {} },
    });
  }, []);

  // Confirm placement: simultaneous — set ready, opponent does the same independently.
  // Host starts battle once BOTH are ready.
  const confirmPlacement = useCallback(async () => {
    if (myReadyRef.current || phaseRef.current !== 'place_player') return;
    const units = playerUnitsRef.current;

    // Empty placement = surrender this round
    if (units.length === 0) {
      surrenderRound();
      return;
    }

    const unitData = units.map(serializeUnit);
    const field = isHost ? 'player1_units' : 'player2_units';
    const readyField = isHost ? 'player1_ready' : 'player2_ready';
    await updateRoom(roomId, { [field]: unitData, [readyField]: true });

    setMyReady(true);
    myReadyRef.current = true;

    channelRef.current?.send({
      type: 'broadcast',
      event: 'game_sync',
      payload: { action: 'ready_toggle', data: { ready: true, units: unitData } },
    });

    // Host: if opponent already ready → start battle now.
    if (isHost && opponentReadyRef.current) {
      setTimeout(() => startBattleRef.current?.(), 100);
    }
  }, [roomId, isHost, surrenderRound]);


  // Start battle after both placed
  const startBattleRef = useRef<(() => Promise<void>) | null>(null);
  const startBattleFromPlacements = useCallback(async () => {
    const { data: room } = await supabase
      .from('game_rooms')
      .select('*')
      .eq('id', roomId)
      .single();

    if (!room || !room.player1_units || !room.player2_units) return;

    // Build full grid
    const newGrid = grid.map(r => r.map(c => ({ ...c, unit: null as Unit | null })));
    // Preserve terrain
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        newGrid[r][c].terrain = grid[r][c].terrain;
      }
    }

    const allNewUnits: Unit[] = [];
    for (const u of room.player1_units as any[]) {
      const unit: Unit = { ...u, team: 'player', activationTurn: u.activationTurn ?? getActivationTurn(u.row, 'player'), startRow: u.startRow ?? u.row };
      newGrid[unit.row][unit.col].unit = unit;
      allNewUnits.push(unit);
    }
    for (const u of room.player2_units as any[]) {
      const unit: Unit = { ...u, team: 'enemy', activationTurn: u.activationTurn ?? getActivationTurn(u.row, 'enemy'), startRow: u.startRow ?? u.row };
      newGrid[unit.row][unit.col].unit = unit;
      allNewUnits.push(unit);
    }

    // Set tank bonds for all units
    setBondsForPlacement(allNewUnits);

    setGrid(newGrid);
    setPhase('battle');
    setBattleTimer(ROUND_TIME_LIMIT);
    setMyReady(false);
    setOpponentReady(false);
    myReadyRef.current = false;
    opponentReadyRef.current = false;
    setOpponentSnapshot([]);
    // Reset all abilities for battle start
    setMoraleBoostUsed(false);
    setMoraleBoostActive(null);
    setOpponentMoraleActive(null);
    moralePhase.current = 'none';
    moraleTicksLeft.current = 0;
    opponentMoralePhase.current = 'none';
    opponentMoraleTicksLeft.current = 0;
    setFocusFireUsed(false);
    setFocusFireActive(false);
    focusFireTicksLeft.current = 0;
    opponentFocusFireTicksLeft.current = 0;
    setSacrificeUsed(false);
    setShieldWallUsed(false);
    setShieldWallActive(false);
    shieldWallTicksLeft.current = 0;

    // Broadcast battle start
    channelRef.current?.send({
      type: 'broadcast',
      event: 'game_sync',
      payload: { action: 'battle_start', data: { grid: serializeGrid(newGrid) } },
    });

    await updateRoom(roomId, { status: 'playing' });
  }, [roomId, grid]);
  startBattleRef.current = startBattleFromPlacements;

  // Broadcast a live snapshot of our current placement (throttled) so the opponent can spy it.
  useEffect(() => {
    if (phase !== 'place_player' || myReady) return;
    if (snapshotBroadcastTimer.current) clearTimeout(snapshotBroadcastTimer.current);
    snapshotBroadcastTimer.current = setTimeout(() => {
      const unitData = playerUnitsRef.current.map(serializeUnit);
      channelRef.current?.send({
        type: 'broadcast',
        event: 'game_sync',
        payload: { action: 'placement_snapshot', data: { units: unitData } },
      });
    }, 400);
    return () => { if (snapshotBroadcastTimer.current) clearTimeout(snapshotBroadcastTimer.current); };
  }, [playerUnits, phase, myReady]);

  // Activate morale boost
  const activateMoraleBoost = useCallback(() => {
    if (moraleBoostUsed || phase !== 'battle') return;
    setMoraleBoostUsed(true);
    setMoraleBoostActive('buff');
    setBattleLog(prev => ['🔥 KRIEGSSCHREI! +25% Schaden für 3 Züge!', ...prev]);

    // If host, track own morale locally
    if (isHost) {
      moralePhase.current = 'buff';
      moraleTicksLeft.current = 3;
    }

    // Broadcast to opponent
    channelRef.current?.send({
      type: 'broadcast',
      event: 'game_sync',
      payload: { action: 'war_cry', data: { team: myTeam } },
    });

    // If guest activated, also tell host to track it
    if (!isHost) {
      // Host will pick it up via the 'war_cry' broadcast handler
    }
  }, [moraleBoostUsed, phase, isHost, myTeam]);

  // Activate focus fire
  const activateFocusFire = useCallback(() => {
    if (focusFireUsed || phase !== 'battle') return;
    setFocusFireUsed(true);
    setFocusFireActive(true);
    focusFireTicksLeft.current = 3;
    setBattleLog(prev => ['🎯 FOKUSFEUER! Alle Einheiten greifen das stärkste Ziel an!', ...prev]);

    channelRef.current?.send({
      type: 'broadcast',
      event: 'game_sync',
      payload: { action: 'focus_fire', data: { team: myTeam } },
    });

    if (isHost) {
      // Already tracking locally via focusFireTicksLeft
    }
  }, [focusFireUsed, phase, isHost, myTeam]);

  // Activate sacrifice ritual
  const activateSacrifice = useCallback(() => {
    if (sacrificeUsed || phase !== 'battle') return;
    
    // Find our units on the grid (host sees player team, guest sees enemy team)
    const myUnits = playerUnits.filter(u => u.hp > 0 && !u.dead);
    if (myUnits.length < 2) return;
    
    const weakest = myUnits.reduce((a, b) => a.hp < b.hp ? a : b);
    setSacrificeUsed(true);
    
    // Apply sacrifice on grid
    setGrid(prevGrid => {
      const newGrid = prevGrid.map(r => r.map(c => ({ ...c, unit: c.unit ? { ...c.unit } : null })));
      
      if (newGrid[weakest.row][weakest.col].unit) {
        newGrid[weakest.row][weakest.col].unit!.hp = 0;
        (newGrid[weakest.row][weakest.col].unit as any).dead = true;
      }
      
      // Heal my team units
      const myTeamId = isHost ? 'player' : 'enemy';
      for (const row of newGrid) {
        for (const cell of row) {
          if (cell.unit && cell.unit.team === myTeamId && cell.unit.hp > 0 && cell.unit.id !== weakest.id) {
            const healAmt = Math.round(cell.unit.maxHp * 0.15);
            cell.unit.hp = Math.min(cell.unit.maxHp, cell.unit.hp + healAmt);
          }
        }
      }
      
      return newGrid;
    });
    
    setBattleLog(prev => [`💀 OPFERRITUAL! Einheit geopfert – alle anderen geheilt!`, ...prev]);

    channelRef.current?.send({
      type: 'broadcast',
      event: 'game_sync',
      payload: { action: 'sacrifice', data: { team: myTeam, unitId: weakest.id } },
    });
  }, [sacrificeUsed, phase, playerUnits, isHost, myTeam]);

  // Activate shield wall
  const activateShieldWall = useCallback(() => {
    if (shieldWallUsed || phase !== 'battle') return;
    setShieldWallUsed(true);
    setShieldWallActive(true);
    shieldWallTicksLeft.current = 3;
    setBattleLog(prev => ['🛡️ SCHILDWALL! Rückzug zur Base – 50% Schadensreduktion für 3 Züge!', ...prev]);

    channelRef.current?.send({
      type: 'broadcast',
      event: 'game_sync',
      payload: { action: 'shield_wall', data: { team: myTeam } },
    });
  }, [shieldWallUsed, phase, myTeam]);

  // Activate flank: same logic as SP — 3-tick burst (back, sideways, forward)
  // applied to my team only. Host: applied locally + via flankActiveRef.
  // Guest: broadcasts to host, host applies on enemy team.
  const activateFlank = useCallback((dir: -1 | 1) => {
    if (phase !== 'battle') return;
    if (dir === -1 && flankLeftUsed) return;
    if (dir === 1 && flankRightUsed) return;
    if (dir === -1) setFlankLeftUsed(true); else setFlankRightUsed(true);
    setFlankActive(dir === -1 ? 'left' : 'right');
    if (isHost) {
      flankActiveRef.current = { dir, step: 0 };
    }
    setBattleLog(prev => [`🏃 FLANKE ${dir === -1 ? '←' : '→'}! Alle Einheiten umfassen den Gegner!`, ...prev]);
    channelRef.current?.send({
      type: 'broadcast',
      event: 'game_sync',
      payload: { action: 'flank', data: { dir } },
    });
  }, [phase, flankLeftUsed, flankRightUsed, isHost]);

  // Helper: apply one flank step to a single team's units in-place.
  const applyFlankStep = (
    grid: Cell[][],
    units: Unit[],
    dir: -1 | 1,
    step: number,
    team: 'player' | 'enemy'
  ) => {
    // Mirror axes for enemy team (host's perspective: enemy starts on rows 0-2).
    const sign = team === 'player' ? 1 : -1;
    let dr = 0, dc = 0, maxSteps = 0;
    if (step === 0) { dr = 1 * sign;  dc = 0;          maxSteps = 2; }
    else if (step === 1) { dr = 0;     dc = dir * sign; maxSteps = 5; }
    else if (step === 2) { dr = -1 * sign; dc = 0;     maxSteps = 5; }
    if (dr === 0 && dc === 0) return;
    const teamUnits = units.filter(u => u.team === team && u.hp > 0 && !u.dead);
    const sorted = [...teamUnits].sort((a, b) => {
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
        if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) break;
        const tgt = grid[nr]?.[nc];
        if (!tgt) break;
        if (tgt.terrain === 'water') break;
        if (tgt.unit && tgt.unit.id !== u.id && !tgt.unit.dead && tgt.unit.hp > 0) break;
        if (grid[u.row]?.[u.col]?.unit?.id === u.id) grid[u.row][u.col].unit = null;
        u.row = nr; u.col = nc;
        grid[u.row][u.col].unit = u;
      }
    }
  };


  // Battle tick - only host runs this
  const battleTick = useCallback(() => {
    if (!isHost) return;

    setGrid(prevGrid => {
      const newGrid = prevGrid.map(r => r.map(c => ({ ...c, unit: c.unit ? { ...c.unit } : null })));
      const allUnits: Unit[] = [];
      for (const row of newGrid) for (const cell of row) if (cell.unit && cell.unit.hp > 0 && !cell.unit.dead) allUnits.push(cell.unit);

      // Flank shifts (host applies for both: own = player team, opp = enemy team)
      if (flankActiveRef.current) {
        applyFlankStep(newGrid, allUnits, flankActiveRef.current.dir, flankActiveRef.current.step, 'player');
        const ns = flankActiveRef.current.step + 1;
        if (ns >= 3) { flankActiveRef.current = null; setFlankActive(null); }
        else flankActiveRef.current = { dir: flankActiveRef.current.dir, step: ns };
      }
      if (opponentFlankRef.current) {
        applyFlankStep(newGrid, allUnits, opponentFlankRef.current.dir, opponentFlankRef.current.step, 'enemy');
        const ns = opponentFlankRef.current.step + 1;
        if (ns >= 3) opponentFlankRef.current = null;
        else opponentFlankRef.current = { dir: opponentFlankRef.current.dir, step: ns };
      }


      // Tick down morale for both players (host tracks both)
      if (moralePhase.current !== 'none' && moraleTicksLeft.current > 0) {
        moraleTicksLeft.current -= 1;
        if (moraleTicksLeft.current <= 0) {
          if (moralePhase.current === 'buff') {
            moralePhase.current = 'debuff';
            moraleTicksLeft.current = 3;
            setMoraleBoostActive('debuff');
          } else {
            moralePhase.current = 'none';
            setMoraleBoostActive(null);
          }
        }
      }
      if (opponentMoralePhase.current !== 'none' && opponentMoraleTicksLeft.current > 0) {
        opponentMoraleTicksLeft.current -= 1;
        if (opponentMoraleTicksLeft.current <= 0) {
          if (opponentMoralePhase.current === 'buff') {
            opponentMoralePhase.current = 'debuff';
            opponentMoraleTicksLeft.current = 3;
            setOpponentMoraleActive('debuff');
          } else {
            opponentMoralePhase.current = 'none';
            setOpponentMoraleActive(null);
          }
        }
      }

      // Focus fire tick-down (host tracks both)
      if (focusFireTicksLeft.current > 0) {
        focusFireTicksLeft.current -= 1;
        if (focusFireTicksLeft.current <= 0) setFocusFireActive(false);
      }
      if (opponentFocusFireTicksLeft.current > 0) {
        opponentFocusFireTicksLeft.current -= 1;
      }

      // Shield wall tick-down
      if (shieldWallTicksLeft.current > 0) {
        shieldWallTicksLeft.current -= 1;
        if (shieldWallTicksLeft.current <= 0) {
          setShieldWallActive(false);
        }
        // Retreat player (host) units toward base rows (5,6,7)
        const playerAlive = allUnits.filter(u => u.team === 'player' && u.hp > 0 && !u.dead);
        for (const unit of playerAlive) {
          if (unit.row < 5) {
            for (let step = 2; step >= 1; step--) {
              const targetRow = Math.min(7, unit.row + step);
              if (!newGrid[targetRow][unit.col].unit && newGrid[targetRow][unit.col].terrain !== 'water') {
                newGrid[unit.row][unit.col].unit = null;
                unit.row = targetRow;
                newGrid[unit.row][unit.col].unit = unit;
                break;
              }
            }
          }
        }
      }

      // Damage modifiers: host's player = player1, host's enemy = player2
      const playerDmgMod = shieldWallTicksLeft.current > 0 ? 0 : (moralePhase.current === 'buff' ? 1.25 : moralePhase.current === 'debuff' ? 0.85 : 1.0);
      const enemyDmgMod = opponentMoralePhase.current === 'buff' ? 1.25 : opponentMoralePhase.current === 'debuff' ? 0.85 : 1.0;
      const shieldWallDefMod = shieldWallTicksLeft.current > 0 ? 0.5 : 1.0;

      // Focus fire targets
      const playerFocusTarget = focusFireTicksLeft.current > 0
        ? allUnits.filter(u => u.team === 'enemy' && u.hp > 0).sort((a, b) => b.hp - a.hp)[0] ?? null
        : null;
      const enemyFocusTarget = opponentFocusFireTicksLeft.current > 0
        ? allUnits.filter(u => u.team === 'player' && u.hp > 0).sort((a, b) => b.hp - a.hp)[0] ?? null
        : null;

      const logs: string[] = [];
      const events: BattleEvent[] = [];

      // === Burn DoT (Arsonist) ===
      for (const u of allUnits) {
        if (!u.burning || u.burning.length === 0 || u.hp <= 0) continue;
        if (isImmuneToFire(u, newGrid)) { u.burning = []; continue; }
        let totalBurn = 0;
        u.burning = u.burning.filter(b => { totalBurn += b.dmg; b.turns -= 1; return b.turns > 0; });
        if (totalBurn > 0) {
          u.hp = Math.max(0, u.hp - totalBurn);
          logs.push(`🔥 ${UNIT_DEFS[u.type].emoji} brennt: -${totalBurn} ❤️${u.hp <= 0 ? ' ☠️' : ''}`);
          if (u.hp <= 0) (u as any).dead = true;
        }
      }
      // === Bleed DoT (Vampir) ===
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

      // Lava field DoT (Vulkanit)
      processLavaTick(newGrid, logs);
      // Banshee ghost tick
      processGhostTick(allUnits, newGrid, logs);
      // Doppelganger phantom timers
      tickPhantomTimers(allUnits, newGrid, logs);
      // Cloner: spawn clones every 6 ticks (max 3 lifetime)
      tickClonerSpawns(allUnits, newGrid, logs);
      // Mage impulse: every 7 ticks push enemies in 7x7 outward
      tickMageImpulse(allUnits, newGrid, events, logs);
      tickMagnetPull(allUnits, newGrid, events, logs);
      // Frost Nova: every 7 ticks freeze enemies in 3x3 for 5 ticks at 30% dmg
      tickFrostNova(allUnits, newGrid, events, logs);
      // Rider horn: every 9 ticks, +50% dmg buff to allies in 5x5 for 2 ticks
      tickRiderHorn(allUnits, newGrid, events, logs);
      // Archer volley: every 4 ticks, 8-direction infinite-range arrow salvo
      tickArcherVolley(allUnits, newGrid, events, logs);
      // Dragon fire-spin: every 10 ticks, dragon spins 8 ticks firing beams
      tickDragonSpin(allUnits, newGrid, events, logs);
      // Terrain regen: waterwalker heals on water
      tickTerrainHeals(allUnits, newGrid, logs);
      // Obelisk aura/beam (refresh buffs each tick)
      tickObeliskAura(allUnits, newGrid, events, logs);
      // Bomber places bombs / hails on enemies
      tickBomberActions(allUnits, newGrid, events, logs);
      // Bomb fuses count down and detonate
      tickBombFuses(newGrid, allUnits, events, logs);
      // Shadowpriest soul harvest
      tickShadowpriestHarvest(allUnits, newGrid, logs);
      const currentTurn = turnCount;
      const acting = allUnits.filter(u => {
        if (u.hp <= 0) return false;
        if (u.activationTurn !== undefined && currentTurn < u.activationTurn) return false;
        return true;
      }).sort((a, b) => a.maxCooldown - b.maxCooldown);

      for (const unit of acting) {
        if (unit.hp <= 0) continue;
        // Dragon mid fire-spin: skip movement/attack entirely.
        if (unit.type === 'dragon' && (unit.spinTicksLeft ?? 0) > 0) continue;
        // Frozen: skip movement, attack at reduced dmg (50% default, 30% from frost nova)
        const isFrozenNow = !!(unit.frozen && unit.frozen > 0);
        const frozenDmgMul = unit.frozenDmgMul ?? 0.5;
        if (isFrozenNow) {
          unit.frozen = (unit.frozen || 0) - 1;
          if ((unit.frozen || 0) <= 0) unit.frozenDmgMul = undefined;
        }
        unit.cooldown = Math.max(0, unit.cooldown - 1);

        // === Terrain seekers (ranger / mountaineer / waterwalker) ===
        let seekerHolds = false;
        if (!isFrozenNow) {
          const seek = handleTerrainSeeker(unit, newGrid, allUnits);
          if (seek === 'moved' || seek === 'wait') continue;
          if (seek === 'on_terrain') seekerHolds = true;
        }


        // Shadowblade: custom teleport-strike behavior (every 5 ticks)
        if (unit.type === 'shadowblade') {
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

        if (unit.type === 'healer') {
          const allies = allUnits.filter(u => u.team === unit.team && u.id !== unit.id && u.hp > 0 && !u.dead);
          const healable = allies.filter(a => a.hp < a.maxHp);
          if (healable.length > 0 && unit.cooldown <= 0) {
            let healed = false;
            for (const ally of healable) {
              if (canAttack(unit, ally)) {
                const healAmt = Math.min(15, ally.maxHp - ally.hp);
                ally.hp += healAmt;
                logs.push(`🌿 ${unit.team === 'player' ? '👤' : '💀'} Schamane → ${UNIT_DEFS[ally.type].emoji} +${healAmt} ❤️`);
                healed = true;
                unit.cooldown = unit.maxCooldown;
                events.push({
                  type: 'heal',
                  attackerId: unit.id, attackerRow: unit.row, attackerCol: unit.col, attackerEmoji: '🌿',
                  attackerType: unit.type,
                  targetId: ally.id, targetRow: ally.row, targetCol: ally.col,
                  damage: 0, isStrong: false, isWeak: false,
                  isRanged: Math.abs(unit.row - ally.row) + Math.abs(unit.col - ally.col) > 1,
                  healAmount: healAmt,
                });
                break;
              }
            }
            if (!healed) {
              healable.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
              const newPos = moveToward(unit, healable[0], newGrid, allUnits);
              if (newPos.row !== unit.row || newPos.col !== unit.col) {
                newGrid[unit.row][unit.col].unit = null;
                unit.row = newPos.row; unit.col = newPos.col;
                newGrid[unit.row][unit.col].unit = unit;
              }
            }
            continue;
          }
        }

        // Focus fire override
        const focusOverride = unit.team === 'player' ? playerFocusTarget : unit.team === 'enemy' ? enemyFocusTarget : null;
        const target = focusOverride ?? findTarget(unit, allUnits);
        if (!target) continue;

        if (!canAttack(unit, target)) {
          unit.stuckTurns = (unit.stuckTurns || 0) + 1;
          const skipMove = isFrozenNow || seekerHolds || shouldSkipMove(unit);
          const newPos = skipMove ? { row: unit.row, col: unit.col } : moveToward(unit, target, newGrid, allUnits);
          if (newPos.row !== unit.row || newPos.col !== unit.col) {
            leaveArsonistTrail(newGrid, unit);
            newGrid[unit.row][unit.col].unit = null;
            unit.row = newPos.row; unit.col = newPos.col;
            newGrid[unit.row][unit.col].unit = unit;
          }
        } else {
          // Can attack → reset stuck counter, but ranged kiters still reposition (unless frozen / seeker holding)
          unit.stuckTurns = 0;
          if (!isFrozenNow && !seekerHolds) {
            const kitePos = moveToward(unit, target, newGrid, allUnits);
            if (kitePos.row !== unit.row || kitePos.col !== unit.col) {
              leaveArsonistTrail(newGrid, unit);
              newGrid[unit.row][unit.col].unit = null;
              unit.row = kitePos.row; unit.col = kitePos.col;
              newGrid[unit.row][unit.col].unit = unit;
            }
          }
        }


        if (canAttack(unit, target) && unit.cooldown <= 0) {
          let dmg = calcDamage(unit, target, newGrid);
          // Frozen attacker: reduced damage
          if (isFrozenNow) dmg = Math.round(dmg * frozenDmgMul);
          // Apply morale damage modifier + shield wall
          if (unit.team === 'player') dmg = Math.round(dmg * playerDmgMod);
          else {
            dmg = Math.round(dmg * enemyDmgMod);
            if (target.team === 'player') dmg = Math.round(dmg * shieldWallDefMod);
          }
          target.hp = Math.max(0, target.hp - dmg);
          unit.cooldown = effectiveCooldown(unit, newGrid);
          // Warrior: track last attacked for lock-on behavior
          if (unit.type === 'warrior') unit.lastAttackedId = target.id;
          // Rider: track last attacked for target-switching
          if (unit.type === 'rider') unit.lastAttackedId = target.id;

          // Frost: 50% chance to freeze the target for 3 ticks at 50% damage (skip immune)
          let didFreeze = false;
          if (unit.type === 'frost' && target.hp > 0 && Math.random() < 0.5 && !isImmuneToFreeze(target, newGrid)) {
            target.frozen = 3;
            target.frozenDmgMul = 0.5;
            didFreeze = true;
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
                  attackerId: unit.id, attackerRow: unit.row, attackerCol: unit.col, attackerEmoji: '🔥',
                  attackerType: unit.type,
                  targetId: cellUnit.id, targetRow: aoePos.row, targetCol: aoePos.col,
                  damage: splashDmg, isStrong: false, isWeak: false, isRanged: false, isAoe: true,
                });
                if (cellUnit.hp <= 0) (cellUnit as any).dead = true;
              }
            }
          }

          events.push({
            type: target.hp <= 0 ? 'kill' : 'hit',
            attackerId: unit.id, attackerRow: unit.row, attackerCol: unit.col, attackerEmoji: def.emoji,
            attackerType: unit.type,
            targetId: target.id, targetRow: target.row, targetCol: target.col,
            damage: dmg, isStrong, isWeak, isRanged: dist > 1,
            isAoe: unit.type === 'dragon', aoeCells, isFrozen: didFreeze,
          });

          // Emit freeze event for ice animation
          if (didFreeze) {
            events.push({
              type: 'freeze',
              attackerId: unit.id, attackerRow: unit.row, attackerCol: unit.col, attackerEmoji: '🥶',
              attackerType: unit.type,
              targetId: target.id, targetRow: target.row, targetCol: target.col,
              damage: 0, isStrong: false, isWeak: false, isRanged: dist > 1,
            });
          }

          if (target.hp <= 0) (target as any).dead = true;
        }
      }

      if (logs.length > 0) setBattleLog(prev => [...logs, ...prev].slice(0, 40));
      if (events.length > 0) setBattleEvents(events);

      const alive = allUnits.filter(u => u.hp > 0);
      const pAliveAll = alive.filter(u => u.team === 'player');
      const eAliveAll = alive.filter(u => u.team === 'enemy');
      // Clones don't count for win evaluation
      const pAlive = pAliveAll.filter(u => !u.isClone);
      const eAlive = eAliveAll.filter(u => !u.isClone);
      const roundEnding = eAlive.length === 0 || pAlive.length === 0 || battleTimer <= 1;
      if (roundEnding) {
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

      const newTurn = turnCount + 1;
      setTurnCount(newTurn);

      setBattleTimer(prev => {
        const newTimer = prev - 1;
        channelRef.current?.send({
          type: 'broadcast',
          event: 'game_sync',
          payload: {
            action: 'battle_tick',
            data: {
              grid: serializeGrid(newGrid),
              logs: [...logs].slice(0, 40),
              events,
              timer: newTimer,
              playerUnits: (roundEnding ? pAlive : pAliveAll).map(serializeUnit),
              enemyUnits: (roundEnding ? eAlive : eAliveAll).map(serializeUnit),
              turnCount: newTurn,
              // Morale states from host perspective
              playerMorale: moralePhase.current === 'none' ? null : moralePhase.current,
              enemyMorale: opponentMoralePhase.current === 'none' ? null : opponentMoralePhase.current,
              // Focus fire states
              playerFocusFire: focusFireTicksLeft.current > 0,
              enemyFocusFire: opponentFocusFireTicksLeft.current > 0,
              // Flank active state (host's player team = player1; enemy team = player2/guest)
              playerFlankActive: flankActiveRef.current?.dir ?? null,
              enemyFlankActive: opponentFlankRef.current?.dir ?? null,
            },
          },
        });
        return newTimer;
      });

      if (eAlive.length === 0 || pAlive.length === 0 || battleTimer <= 1) {
        let newPhase: Phase;
        let pScore = playerScore;
        let eScore = enemyScore;

        if (eAlive.length === 0) { pScore += 1; newPhase = 'round_won'; }
        else if (pAlive.length === 0) { eScore += 1; newPhase = 'round_lost'; }
        else if (pAlive.length > eAlive.length) { pScore += 1; newPhase = 'round_won'; }
        else if (eAlive.length > pAlive.length) { eScore += 1; newPhase = 'round_lost'; }
        else { pScore += 1; eScore += 1; newPhase = 'round_draw'; }

        setPlayerScore(pScore);
        setEnemyScore(eScore);
        setPhase(newPhase);

        const guestPhase = newPhase === 'round_won' ? 'round_lost' : newPhase === 'round_lost' ? 'round_won' : newPhase;

        channelRef.current?.send({
          type: 'broadcast',
          event: 'game_sync',
          payload: {
            action: 'round_end',
            data: { phase: guestPhase, playerScore: eScore, enemyScore: pScore, grid: serializeGrid(newGrid) },
          },
        });
      }

      return newGrid;
    });
  }, [isHost, battleTimer, playerScore, enemyScore, turnCount]);

  // Battle loop - only host
  useEffect(() => {
    if (phase !== 'battle' || !isHost) {
      if (battleRef.current) clearInterval(battleRef.current);
      return;
    }
    battleRef.current = setInterval(battleTick, 675);
    return () => { if (battleRef.current) clearInterval(battleRef.current); };
  }, [phase, isHost, battleTick]);

  const gameOver = playerScore >= POINTS_TO_WIN || enemyScore >= POINTS_TO_WIN;
  const gameWon = playerScore >= POINTS_TO_WIN;

  // Next round
  const nextRound = useCallback(async () => {
    const newRound = roundNumber + 1;
    const newGrid = generateTerrain(createEmptyGrid());
    // Host re-picks the battlefield biome each round; guest follows via broadcast.
    const newBattlefieldId: 'grass' | 'desert' = isHost
      ? (Math.random() < 0.5 ? 'grass' : 'desert')
      : battlefieldId;
    if (isHost) setBattlefieldId(newBattlefieldId);

    // Update fatigue before resetting units
    setPlayerFatigue(prev => {
      const next = { ...prev };
      const survivingTypes = new Set(playerUnits.filter(u => u.hp > 0 && !u.dead).map(u => u.type));
      for (const t of UNIT_TYPES) {
        if (playerBannedUnits.includes(t)) {
          next[t] = 0; // rested this round
        } else if (survivingTypes.has(t)) {
          next[t] = 1; // survived → immediately banned next round
        } else {
          next[t] = 0;
        }
      }
      return next;
    });

    setRoundNumber(newRound);
    setPlayerUnits([]);
    setEnemyUnits([]);
    setBattleLog([]);
    setTurnCount(0);
    setSelectedUnit(hasRoster ? roster![0] : (UNIT_TYPES.find(t => !playerBannedUnits.includes(t)) || 'warrior'));
    if (hasRoster) setSelectedSlot(0);
    setGrid(newGrid);
    setPhase('place_player');
    setBattleTimer(ROUND_TIME_LIMIT);
    
    setMyReady(false);
    setOpponentReady(false);
    myReadyRef.current = false;
    opponentReadyRef.current = false;
    setOpponentSnapshot([]);
    setPlaceTimer(MULTI_PLACE_TIME_LIMIT);
    // Reset flank
    setFlankLeftUsed(false);
    setFlankRightUsed(false);
    setFlankActive(null);
    flankActiveRef.current = null;
    opponentFlankRef.current = null;

    await updateRoom(roomId, {
      player1_units: null, player2_units: null,
      player1_ready: false, player2_ready: false,
      status: 'waiting',
    });

    if (isHost) {
      setTimeout(() => {
        channelRef.current?.send({
          type: 'broadcast',
          event: 'game_sync',
          payload: {
            action: 'next_round',
            data: {
              grid: serializeGrid(newGrid),
              roundNumber: newRound,
              playerScore: enemyScore,
              enemyScore: playerScore,
              battlefieldId: newBattlefieldId,
            },

          },
        });
      }, 300);
    }
  }, [roundNumber, roomId, isHost, playerScore, enemyScore, playerUnits, playerBannedUnits, battlefieldId, hasRoster, roster]);

  const resetGame = useCallback(() => {}, []);
  const startBattle = useCallback(() => {}, []);

  // === Match recording (host only — authoritative state) ===
  const recorderStartedRef = useRef(false);
  const recordedRoundRef = useRef(0);
  const matchEndedRef = useRef(false);

  useEffect(() => {
    if (!isHost || recorderStartedRef.current) return;
    if (!hasRoster) return;
    recorderStartedRef.current = true;
    matchRecorder.start({
      mode: 'multiplayer',
      player1Label: 'Spieler 1 (Host)',
      player2Label: 'Spieler 2',
    });
    matchRecorder.setRoster('player1', roster!, (slot) => SLOT_COLORS[slot]);
    if (opponentRoster && opponentRoster.length === 9) {
      matchRecorder.setRoster('player2', opponentRoster, (slot) => SLOT_COLORS[slot]);
    }
    matchEndedRef.current = false;
    return () => { if (!matchEndedRef.current) matchRecorder.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick up opponent roster if it arrives after mount
  useEffect(() => {
    if (!isHost || !recorderStartedRef.current) return;
    if (opponentRoster && opponentRoster.length === 9) {
      matchRecorder.setRoster('player2', opponentRoster, (slot) => SLOT_COLORS[slot]);
    }
  }, [opponentRoster, isHost]);

  useEffect(() => {
    if (!isHost || !recorderStartedRef.current) return;
    if (phase !== 'battle') return;
    if (recordedRoundRef.current === roundNumber) return;
    recordedRoundRef.current = roundNumber;
    // Host: playerUnits = player1, enemyUnits = player2
    const placements = [
      ...playerUnits.map(u => ({ team: 'player1' as const, type: u.type, color: (u as any).color, row: u.row, col: u.col, hp: u.hp })),
      ...enemyUnits.map(u => ({ team: 'player2' as const, type: u.type, color: (u as any).color, row: u.row, col: u.col, hp: u.hp })),
    ];
    matchRecorder.startRound(roundNumber, placements);
  }, [phase, roundNumber, isHost, playerUnits, enemyUnits]);

  useEffect(() => {
    if (!isHost || !recorderStartedRef.current || phase !== 'battle') return;
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
  }, [battleEvents, phase, isHost, playerUnits, enemyUnits]);

  useEffect(() => {
    if (!isHost || !recorderStartedRef.current || matchEndedRef.current) return;
    if (!gameOver) return;
    matchEndedRef.current = true;
    const winner: 'player1' | 'player2' = gameWon ? 'player1' : 'player2';
    matchRecorder.endRound(playerScore, enemyScore, winner);
    matchRecorder.endMatch(winner, { player1: playerScore, player2: enemyScore });
  }, [gameOver, gameWon, playerScore, enemyScore, isHost]);

  return {
    grid, phase, selectedUnit, setSelectedUnit,
    playerUnits, enemyUnits, turnCount, battleLog, battleEvents, battleTimer,
    playerScore, enemyScore, roundNumber,
    playerStarts: true,
    playerMaxUnits: getMaxUnits(playerScore, enemyScore, roundNumber),
    enemyMaxUnits: getMaxUnits(playerScore, enemyScore, roundNumber),
    gameOver, gameWon, gameDraw: false,
    placeUnit, removeUnit, confirmPlacement, startBattle,
    resetGame, nextRound,
    surrenderRound,
    revealAIPlacement: () => {},
    opponentSnapshot,
    moraleBoostUsed,
    moraleBoostActive,
    activateMoraleBoost,
    focusFireUsed,
    focusFireActive,
    activateFocusFire,
    sacrificeUsed,
    activateSacrifice,
    shieldWallUsed,
    shieldWallActive,
    activateShieldWall,
    flankLeftUsed,
    flankRightUsed,
    flankActive,
    activateFlank,
    battlefieldId,
    opponentMoraleActive,
    waitingForOpponent,
    opponentLeft,
    aiMoraleActive: null as 'buff' | 'debuff' | null,
    isHost,
    myRows,
    placeTimer,
    isMyTurnToPlace,
    placingPhase,
    inOvertime: false,
    overtimeCount: 0,
    drawOfferPending: false,
    acceptDraw: () => {},
    continueOvertime: () => {},
    playerBannedUnits,
    playerBannedSlots: [] as number[],
    selectedSlot,
    setSelectedSlot,
    roster: hasRoster ? roster! : undefined,
    placedSlots: [] as number[],
    playerFatigue,
  };
}
