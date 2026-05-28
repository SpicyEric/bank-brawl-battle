import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Unit, UnitType, Cell, Phase,
  createEmptyGrid, createUnit, findTarget, moveToward, canAttack, calcDamage,
  generateTerrain, getActivationTurn, setBondsForPlacement, moveTankFormation,
  GRID_SIZE, PLAYER_ROWS, ENEMY_ROWS, UNIT_DEFS, UNIT_TYPES, UNIT_COLOR_GROUPS, ROUNDS_TO_WIN, ROUND_TIME_LIMIT,
  MULTI_PLACE_TIME_LIMIT, getMaxUnits, tickClonerSpawns, tickMageImpulse, tickFrostNova, tickRiderHorn, tickArcherVolley, tickDragonSpin, tickMagnetPull, handleShadowbladeTick, shouldSkipMove, leaveArsonistTrail,
  handleTerrainSeeker, isImmuneToFreeze, isImmuneToFire, effectiveCooldown, tickTerrainHeals,
  processLavaTick, processGhostTick, tickPhantomTimers,
  tickBomberActions, tickBombFuses, tickObeliskAura, tickShadowpriestHarvest,
  spawnDoppelgangerPhantoms, applyPostAttackEffects, applyDeathEffects, applyChainAttack, applyShadowpriestCurse, applyMirrorReflect,
  applyHealing, MAX_HEAL_PER_TICK,
} from '@/lib/battleGame';
import { BattleEvent } from '@/lib/battleEvents';
import { supabase } from '@/integrations/supabase/client';
import { updateRoom, ensureAnonymousSession } from '@/lib/multiplayer';
import { matchRecorder } from '@/lib/matchRecorder';
import { loadAuraData, type AuraZoneMap, type AuraEffectMap } from '@/lib/auraData';
import { applyAuraStacks, applyAuraTick, applyAuraOnAttack, applyAuraOnDeath, applyAuraSourceEffects, applyDefenderShare, fireLightningTakenMul, hasImmuneFFP } from '@/lib/auraEffects';
import { findFormations, applyFormationMove } from '@/lib/formations';
import { playUnitSound } from '@/lib/unitSounds';

function playEventSounds(events: BattleEvent[]) {
  const played = new Set<string>();
  for (const evt of events) {
    const t = evt.attackerType;
    if (t && (evt.type === 'hit' || evt.type === 'kill') && !played.has(t)) {
      if (playUnitSound(t)) played.add(t);
    }
  }
}

interface MultiplayerConfig {
  roomId: string;
  role: 'player1' | 'player2';
  roster?: UnitType[];
  opponentRoster?: UnitType[];
  ownHandicap?: number;
  opponentHandicap?: number;
}

// Slot color layout matches UnitRoster: slots 0-2 red, 3-5 green, 6-8 blue
const SLOT_COLORS: ('red' | 'green' | 'blue')[] = ['red','red','red','green','green','green','blue','blue','blue'];
const FORMATION_MODE = true;
const BATTLE_WORLD_ROWS = GRID_SIZE * 3;

function createBattleWorldGrid(): Cell[][] {
  return Array.from({ length: BATTLE_WORLD_ROWS }, (_, row) =>
    Array.from({ length: GRID_SIZE }, (_, col) => ({ row, col, unit: null, terrain: 'none' as const }))
  );
}

function getRoundUnitLimit(roundNumber: number, handicap: number = 0): number {
  const base = Math.min(2 + roundNumber * 2, 20);
  return Math.max(1, base - Math.max(0, Math.min(3, handicap | 0)));
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
  const { roomId, role, roster, opponentRoster, ownHandicap = 0, opponentHandicap = 0 } = config;
  const hasRoster = !!(roster && roster.length === 9);
  const isHost = role === 'player1';
  const myRows = isHost ? PLAYER_ROWS : ENEMY_ROWS;
  const myTeam = isHost ? 'player' as const : 'enemy' as const;
  const safeOwnHandicap = Math.max(0, Math.min(3, ownHandicap | 0));
  const safeOppHandicap = Math.max(0, Math.min(3, opponentHandicap | 0));

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
  const playerMaxUnits = getRoundUnitLimit(roundNumber, safeOwnHandicap);
  const enemyMaxUnits = getRoundUnitLimit(roundNumber, safeOppHandicap);
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
  const stalemateHpRef = useRef<number>(-1);
  const stalemateTicksRef = useRef<number>(0);
  const stalemateRushRef = useRef<number>(0);
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
        setPlayerUnits(data.enemyUnits || []);
        setEnemyUnits(data.playerUnits || []);
        setPhase('battle');
        setBattleTimer(ROUND_TIME_LIMIT);
        setTurnCount(0);
        setMyReady(false);
        setOpponentReady(false);
        setOpponentSnapshot([]);
      }

      if (action === 'battle_tick') {
        if (!isHost) {
          setGrid(data.grid as Cell[][]);
          setBattleLog(data.logs);
          setBattleEvents(data.events || []);
          if (data.events?.length) playEventSounds(data.events);
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
    if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) return;
    if (playerUnits.length >= playerMaxUnits) return;
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
  }, [phase, isMyTurnToPlace, selectedUnit, selectedSlot, hasRoster, roster, playerUnits, grid, myTeam, playerBannedUnits, playerMaxUnits]);

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

    const battlePlayers: Unit[] = (room.player1_units as any[]).map((u: any) => ({
      ...u,
      team: 'player' as const,
      row: u.row + GRID_SIZE * 2,
      startRow: u.row + GRID_SIZE * 2,
      laneCol: u.col,
      activationTurn: undefined,
      enteredArena: false,
    }));
    const battleEnemies: Unit[] = (room.player2_units as any[]).map((u: any) => ({
      ...u,
      team: 'enemy' as const,
      row: u.row,
      startRow: u.row,
      laneCol: u.col,
      activationTurn: undefined,
      enteredArena: false,
    }));
    const allNewUnits: Unit[] = [...battlePlayers, ...battleEnemies];
    setBondsForPlacement(allNewUnits);

    const newGrid = createBattleWorldGrid();
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        newGrid[r + GRID_SIZE][c].terrain = grid[r][c].terrain;
      }
    }
    for (const u of battlePlayers) newGrid[u.row][u.col].unit = u;
    for (const u of battleEnemies) newGrid[u.row][u.col].unit = u;

    const logs: string[] = [];
    const phantoms = spawnDoppelgangerPhantoms(allNewUnits, newGrid, logs);
    if (phantoms.length > 0) allNewUnits.push(...phantoms);

    setGrid(newGrid);
    setPlayerUnits(allNewUnits.filter(u => u.team === 'player'));
    setEnemyUnits(allNewUnits.filter(u => u.team === 'enemy'));
    setPhase('battle');
    setTurnCount(0);
    turnCountRef.current = 0;
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
    if (logs.length > 0) setBattleLog(logs);

    // Broadcast battle start
    channelRef.current?.send({
      type: 'broadcast',
      event: 'game_sync',
      payload: {
        action: 'battle_start',
        data: {
          grid: serializeGrid(newGrid),
          playerUnits: allNewUnits.filter(u => u.team === 'player').map(serializeUnit),
          enemyUnits: allNewUnits.filter(u => u.team === 'enemy').map(serializeUnit),
        },
      },
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
    // Mirror axes for enemy team (host perspective: player marches upward, enemy downward).
    const sign = team === 'player' ? 1 : -1;
    let dr = 0, dc = 0, maxSteps = 0;
    if (step === 0) { dr = 1 * sign;  dc = 0;          maxSteps = 2; }
    else if (step === 1) { dr = 0;     dc = dir * sign; maxSteps = 5; }
    else if (step === 2) { dr = -1 * sign; dc = 0;     maxSteps = 5; }
    if (dr === 0 && dc === 0) return;
    const rowCount = grid.length;
    const colCount = grid[0]?.length ?? GRID_SIZE;
    const arenaTop = GRID_SIZE;
    const arenaBottom = GRID_SIZE * 2;
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
        if (nr < 0 || nr >= rowCount || nc < 0 || nc >= colCount) break;
        if (u.enteredArena && (nr < arenaTop || nr >= arenaBottom)) break;
        const tgt = grid[nr]?.[nc];
        if (!tgt) break;
        if (tgt.terrain === 'water') break;
        if (tgt.unit && tgt.unit.id !== u.id && !tgt.unit.dead && tgt.unit.hp > 0) break;
        if (grid[u.row]?.[u.col]?.unit?.id === u.id) grid[u.row][u.col].unit = null;
        u.row = nr; u.col = nc;
        if (u.row >= arenaTop && u.row < arenaBottom) u.enteredArena = true;
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

      // Reset per-tick healing cap tracker
      for (const u of allUnits) u._healedThisTick = 0;

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
          // Multiplayer must never resolve stalemates by moving individual units;
          // formation movement below keeps the exact built shape intact.
          stalemateRushRef.current -= 1;
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

      // AI focus fire tick-down
      if (opponentFocusFireTicksLeft.current > 0) {
        opponentFocusFireTicksLeft.current -= 1;
      }

      // Multiplayer has no AI-only ability decisions; host only resolves player-vs-player state.

      // Calculate player damage modifier from morale (+ shield wall: player deals 0 damage)
      const playerDmgMod = shieldWallTicksLeft.current > 0 ? 0 : (moralePhase.current === 'buff' ? 1.25 : moralePhase.current === 'debuff' ? 0.85 : 1.0);
      // Calculate enemy damage modifier from AI morale
      const enemyDmgMod = opponentMoralePhase.current === 'buff' ? 1.25 : opponentMoralePhase.current === 'debuff' ? 0.85 : 1.0;
      // Shield wall: enemies deal only 50% damage to player units
      const shieldWallDefMod = shieldWallTicksLeft.current > 0 ? 0.5 : 1.0;

      // Focus fire: determine lowest HP enemy target (player ability) – finish off weak units
      const playerFocusTarget = focusFireTicksLeft.current > 0
        ? allUnits.filter(u => u.team === 'enemy' && u.hp > 0).sort((a, b) => a.hp - b.hp)[0] ?? null
        : null;
      // AI focus fire: determine highest HP player target
      const enemyFocusTarget = opponentFocusFireTicksLeft.current > 0
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
            const approachDr = ddr || forwardDr;
            const tries: Array<[number, number]> = [];
            if (sharesRow) {
              // Engagement mode: free to move diagonally / sideways toward the target.
              if (ddr !== 0 && ddc !== 0) tries.push([ddr, ddc]);
              if (ddr !== 0) tries.push([ddr, 0]);
              if (ddc !== 0) tries.push([0, ddc]);
            } else {
              // Approach mode: march toward the opposing formation's current row.
              // This also turns formations around if they crossed past each other.
              tries.push([approachDr, 0]);
            }
            for (const [mdr, mdc] of tries) {
              if (applyFormationMove(grp, mdr, mdc, newGrid)) break;
            }
          }
        };
        // === Flank maneuver: 3-tick burst — Tick1: 2 back, Tick2: up to 5 sideways, Tick3: up to 5 forward.
        // Multiplayer keeps this as a rigid formation shift, never per-unit movement.
        let flankShifting = false;
        if (flankActiveRef.current) {
          flankShifting = true;
          const { dir, step } = flankActiveRef.current;
          const dr = step === 0 ? 1 : step === 2 ? -1 : 0;
          const dc = step === 1 ? dir : 0;
          const playerGroup = findFormations(allUnits, 'player').flat();
          if (playerGroup.length > 0 && (dr !== 0 || dc !== 0)) applyFormationMove(playerGroup, dr, dc, newGrid);
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

        // No individual arena catch-up in multiplayer: off-field units enter only as formations.
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
                const requestedHeal = Math.min(28, ally.maxHp - ally.hp);
                const healAmt = applyHealing(ally, requestedHeal, logs, `🌿 ${unit.team === 'player' ? '👤' : '💀'} Schamane → ${UNIT_DEFS[ally.type].emoji}`);
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
        const fT = playerFocusTarget && inBattlefield(playerFocusTarget) ? playerFocusTarget : null;
        const afT = enemyFocusTarget && inBattlefield(enemyFocusTarget) ? enemyFocusTarget : null;
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
            const requestedHeal = Math.min(unit.maxHp - unit.hp, Math.round(dmg * pct));
            const heal = applyHealing(unit, requestedHeal);
            if (heal > 0) {
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
        playEventSounds(events);
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

      const newTurn = turnCountRef.current + 1;
      turnCountRef.current = newTurn;
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
              playerMorale: moralePhase.current === 'none' ? null : moralePhase.current,
              enemyMorale: opponentMoralePhase.current === 'none' ? null : opponentMoralePhase.current,
              playerFocusFire: focusFireTicksLeft.current > 0,
              enemyFocusFire: opponentFocusFireTicksLeft.current > 0,
              playerFlankActive: flankActiveRef.current?.dir ?? null,
              enemyFlankActive: opponentFlankRef.current?.dir ?? null,
            },
          },
        });
        return newTimer;
      });

      if (eAlive.length === 0 || pAlive.length === 0 || battleTimer <= 1) {
        let newPhase: Phase;
        let pScore = playerScoreRef.current;
        let eScore = enemyScoreRef.current;

        if (eAlive.length === 0) { pScore += 1; newPhase = 'round_won'; }
        else if (pAlive.length === 0) { eScore += 1; newPhase = 'round_lost'; }
        else if (pAlive.length > eAlive.length) { pScore += 1; newPhase = 'round_won'; }
        else if (eAlive.length > pAlive.length) { eScore += 1; newPhase = 'round_lost'; }
        else { pScore += 1; eScore += 1; newPhase = 'round_draw'; }

        playerScoreRef.current = pScore;
        enemyScoreRef.current = eScore;
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
  }, [isHost, battleTimer]);

  // Battle loop - only host
  useEffect(() => {
    if (phase !== 'battle' || !isHost) {
      if (battleRef.current) clearInterval(battleRef.current);
      return;
    }
    battleRef.current = setInterval(battleTick, 675);
    return () => { if (battleRef.current) clearInterval(battleRef.current); };
  }, [phase, isHost, battleTick]);

  const gameOver = playerScore >= ROUNDS_TO_WIN || enemyScore >= ROUNDS_TO_WIN;
  const gameWon = playerScore >= ROUNDS_TO_WIN;

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
      ...playerUnits.map(u => ({ team: 'player1' as const, type: u.type, color: (u as any).color, row: Math.max(0, u.row - GRID_SIZE * 2), col: u.col, hp: u.hp })),
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
    playerMaxUnits,
    enemyMaxUnits,
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
    playerBannedSlots: (hasRoster && safeOwnHandicap > 0
      ? Array.from({ length: safeOwnHandicap }, (_, i) => 9 - 1 - i)
      : []) as number[],
    selectedSlot,
    setSelectedSlot,
    roster: hasRoster ? roster! : undefined,
    placedSlots: [] as number[],
    playerFatigue,
  };
}
