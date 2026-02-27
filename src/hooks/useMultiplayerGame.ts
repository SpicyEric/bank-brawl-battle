import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Unit, UnitType, Cell, Phase,
  createEmptyGrid, createUnit, findTarget, moveToward, canAttack, calcDamage,
  generateTerrain, getActivationTurn, setBondsForPlacement,
  GRID_SIZE, PLAYER_ROWS, ENEMY_ROWS, UNIT_DEFS, UNIT_TYPES, POINTS_TO_WIN, BASE_UNITS, ROUND_TIME_LIMIT,
  MULTI_PLACE_TIME_LIMIT,
} from '@/lib/battleGame';
import { BattleEvent } from '@/lib/battleEvents';
import { supabase } from '@/integrations/supabase/client';
import { updateRoom, ensureAnonymousSession } from '@/lib/multiplayer';

interface MultiplayerConfig {
  roomId: string;
  role: 'player1' | 'player2';
}

// Use MULTI_PLACE_TIME_LIMIT for multiplayer (20s)

function serializeUnit(u: Unit) {
  return { id: u.id, type: u.type, team: u.team, hp: u.hp, maxHp: u.maxHp, attack: u.attack, row: u.row, col: u.col, cooldown: u.cooldown, maxCooldown: u.maxCooldown, dead: u.dead, frozen: u.frozen, stuckTurns: u.stuckTurns, activationTurn: u.activationTurn, startRow: u.startRow, lastAttackedId: u.lastAttackedId, bondedToTankId: u.bondedToTankId, bondBroken: u.bondBroken };
}

function serializeGrid(grid: Cell[][]) {
  return grid.map(row => row.map(cell => ({
    row: cell.row, col: cell.col, terrain: cell.terrain,
    unit: cell.unit ? serializeUnit(cell.unit) : null,
  })));
}

export function useMultiplayerGame(config: MultiplayerConfig) {
  const { roomId, role } = config;
  const isHost = role === 'player1';
  const myRows = isHost ? PLAYER_ROWS : ENEMY_ROWS;
  const myTeam = isHost ? 'player' as const : 'enemy' as const;

  const [grid, setGrid] = useState<Cell[][]>(() => generateTerrain(createEmptyGrid()));
  const [phase, setPhase] = useState<Phase>('place_player');
  const [selectedUnit, setSelectedUnit] = useState<UnitType | null>('warrior');
  const [playerUnits, setPlayerUnits] = useState<Unit[]>([]);
  const [enemyUnits, setEnemyUnits] = useState<Unit[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [battleLog, setBattleLog] = useState<string[]>([]);
  const [playerScore, setPlayerScore] = useState(0);
  const [enemyScore, setEnemyScore] = useState(0);
  const [roundNumber, setRoundNumber] = useState(1);
  const [battleEvents, setBattleEvents] = useState<BattleEvent[]>([]);
  const [battleTimer, setBattleTimer] = useState(ROUND_TIME_LIMIT);
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
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

  // Fatigue system: tracks how many consecutive rounds each unit type survived
  const [playerFatigue, setPlayerFatigue] = useState<Record<string, number>>({});
  const playerBannedUnits: UnitType[] = UNIT_TYPES.filter(t => (playerFatigue[t] || 0) >= 2);

  // Alternating placement state
  const [placingPlayer, setPlacingPlayer] = useState<1 | 2>(1);
  const [placingPhase, setPlacingPhase] = useState<'first' | 'second' | 'done'>('first');
  const [placeTimer, setPlaceTimer] = useState(MULTI_PLACE_TIME_LIMIT);
  const [isMyTurnToPlace, setIsMyTurnToPlace] = useState(false);
  const [opponentUnitsVisible, setOpponentUnitsVisible] = useState<Unit[]>([]);

  const battleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const placeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const placingPhaseRef = useRef(placingPhase);
  const phaseRef = useRef(phase);
  const playerUnitsRef = useRef(playerUnits);
  const isMyTurnRef = useRef(isMyTurnToPlace);
  const disconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync
  useEffect(() => { placingPhaseRef.current = placingPhase; }, [placingPhase]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { playerUnitsRef.current = playerUnits; }, [playerUnits]);
  useEffect(() => { isMyTurnRef.current = isMyTurnToPlace; }, [isMyTurnToPlace]);

  // Determine if it's my turn
  useEffect(() => {
    if (phase !== 'place_player') {
      setIsMyTurnToPlace(false);
      return;
    }
    const myPlayerNum = isHost ? 1 : 2;
    if (placingPhase === 'first') {
      setIsMyTurnToPlace(myPlayerNum === placingPlayer);
    } else if (placingPhase === 'second') {
      setIsMyTurnToPlace(myPlayerNum !== placingPlayer);
    } else {
      setIsMyTurnToPlace(false);
    }
  }, [phase, placingPhase, placingPlayer, isHost]);

  // Waiting state: it's placement phase but not my turn
  useEffect(() => {
    if (phase === 'place_player') {
      setWaitingForOpponent(!isMyTurnToPlace && placingPhase !== 'done');
    }
  }, [phase, isMyTurnToPlace, placingPhase]);

  // Setup broadcast channel
  useEffect(() => {
    const channel = supabase.channel(`game-battle-${roomId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'game_sync' }, ({ payload }) => {
      const { action, data } = payload;

      if (action === 'terrain') {
        setGrid(data.grid as Cell[][]);
        setPlacingPlayer(data.placingPlayer);
        setPlacingPhase('first');
        setPlaceTimer(MULTI_PLACE_TIME_LIMIT);
      }

      if (action === 'first_placement_done') {
        const firstUnits = (data.units as any[]).map((u: any) => ({ ...u } as Unit));
        setOpponentUnitsVisible(firstUnits);
        setGrid(prev => {
          const next = prev.map(r => r.map(c => ({ ...c })));
          for (const u of firstUnits) {
            next[u.row][u.col] = { ...next[u.row][u.col], unit: u };
          }
          return next;
        });
        setPlacingPhase('second');
        setPlaceTimer(MULTI_PLACE_TIME_LIMIT);
      }

      if (action === 'first_placement_forfeit') {
        setPlayerScore(data.myScore);
        setEnemyScore(data.opponentScore);
        setPhase(data.myPhase);
        setPlacingPhase('done');
      }

      if (action === 'battle_start') {
        setGrid(data.grid as Cell[][]);
        setPhase('battle');
        setBattleTimer(ROUND_TIME_LIMIT);
        setPlacingPhase('done');
        setOpponentUnitsVisible([]);
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
            if ((prev[t] || 0) >= 2) {
              next[t] = 0; // rested this round
            } else if (survivingTypes.has(t)) {
              next[t] = (next[t] || 0) + 1;
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
        setPlacingPlayer(data.placingPlayer);
        setPlacingPhase('first');
        setPlaceTimer(MULTI_PLACE_TIME_LIMIT);
        setPlayerUnits([]);
        setEnemyUnits([]);
        setBattleLog([]);
        setTurnCount(0);
        setSelectedUnit('warrior'); // will be corrected by fatigue check in UI
        setBattleTimer(ROUND_TIME_LIMIT);
        setWaitingForOpponent(false);
        setOpponentUnitsVisible([]);
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
    const DISCONNECT_GRACE_MS = 8000;

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
      return currentPhase === 'place_player' && placingPhaseRef.current !== 'first';
    };

    const scheduleDisconnectCheck = () => {
      if (!hasMatchStarted() || disconnectTimeoutRef.current) return;

      disconnectTimeoutRef.current = setTimeout(() => {
        disconnectTimeoutRef.current = null;
        if (!bothPlayersPresent() && hasMatchStarted()) {
          setOpponentLeft(true);
        }
      }, DISCONNECT_GRACE_MS);
    };

    const handlePresenceChange = () => {
      if (bothPlayersPresent()) {
        clearDisconnectTimer();
        setOpponentLeft(false);
        return;
      }
      scheduleDisconnectCheck();
    };

    presenceChannel
      .on('presence', { event: 'sync' }, handlePresenceChange)
      .on('presence', { event: 'join' }, handlePresenceChange)
      .on('presence', { event: 'leave' }, handlePresenceChange)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({ role });
          handlePresenceChange();
        }
      });

    return () => {
      clearDisconnectTimer();
      supabase.removeChannel(presenceChannel);
    };
  }, [roomId, role]);

  // Host generates terrain and decides who places first
  useEffect(() => {
    if (isHost && phase === 'place_player' && placingPhase === 'first') {
      const whoFirst = Math.random() < 0.5 ? 1 : 2;
      setPlacingPlayer(whoFirst as 1 | 2);

      setTimeout(() => {
        channelRef.current?.send({
          type: 'broadcast',
          event: 'game_sync',
          payload: { action: 'terrain', data: { grid: serializeGrid(grid), placingPlayer: whoFirst } },
        });
      }, 500);
    }
  }, [isHost, roundNumber]); // only on round change

  // Placement timer countdown
  useEffect(() => {
    if (phase !== 'place_player' || placingPhase === 'done') {
      if (placeTimerRef.current) clearInterval(placeTimerRef.current);
      return;
    }

    setPlaceTimer(MULTI_PLACE_TIME_LIMIT);
    placeTimerRef.current = setInterval(() => {
      setPlaceTimer(prev => {
        if (prev <= 1) {
          // Timer expired — auto-confirm
          if (placeTimerRef.current) clearInterval(placeTimerRef.current);
          // Use setTimeout to avoid state update during render
          setTimeout(() => autoConfirmPlacement(), 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (placeTimerRef.current) clearInterval(placeTimerRef.current);
    };
  }, [phase, placingPhase]);

  // Auto-confirm when timer runs out (or player clicks bereit)
  const autoConfirmPlacement = useCallback(() => {
    if (!isMyTurnRef.current) return; // only the active placer triggers this
    confirmPlacement();
  }, []);

  // Place unit on my side
  const placeUnit = useCallback((row: number, col: number) => {
    if (phase !== 'place_player' || !isMyTurnToPlace || !selectedUnit) return;
    if (playerBannedUnits.includes(selectedUnit)) return; // Fatigue ban
    if (!myRows.includes(row)) return;
    if (playerUnits.length >= BASE_UNITS) return;
    if (grid[row][col].unit) return;
    if (grid[row][col].terrain === 'water') return;

    const unit = createUnit(selectedUnit, myTeam, row, col);
    setPlayerUnits(prev => [...prev, unit]);
    setGrid(prev => {
      const next = prev.map(r => r.map(c => ({ ...c })));
      next[row][col] = { ...next[row][col], unit };
      return next;
    });
  }, [phase, isMyTurnToPlace, selectedUnit, playerUnits, grid, myRows, myTeam, playerBannedUnits]);

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

  // Confirm placement
  const confirmPlacement = useCallback(async () => {
    if (!isMyTurnRef.current) return;

    const currentPlacingPhase = placingPhaseRef.current;
    const units = playerUnitsRef.current;

    if (currentPlacingPhase === 'first') {
      // First player done placing
      if (units.length === 0) {
        // No units placed → forfeit! Opponent gets the point
        handleForfeit();
        return;
      }

      const unitData = units.map(serializeUnit);
      const field = isHost ? 'player1_units' : 'player2_units';
      await updateRoom(roomId, { [field]: unitData });

      // Broadcast to opponent: show units, start their turn
      channelRef.current?.send({
        type: 'broadcast',
        event: 'game_sync',
        payload: { action: 'first_placement_done', data: { units: unitData } },
      });

      // For the first placer, switch to waiting
      setPlacingPhase('second');
      setWaitingForOpponent(true);
      setPlaceTimer(MULTI_PLACE_TIME_LIMIT);

    } else if (currentPlacingPhase === 'second') {
      // Second player done placing
      if (units.length === 0) {
        // No units → forfeit
        handleForfeit();
        return;
      }

      const unitData = units.map(serializeUnit);
      const field = isHost ? 'player1_units' : 'player2_units';
      await updateRoom(roomId, { [field]: unitData });

      // Both players have placed → start battle
      await startBattleFromPlacements();
    }
  }, [roomId, isHost]);

  // Handle forfeit (no units placed)
  const handleForfeit = useCallback(async () => {
    const myPlayerNum = isHost ? 1 : 2;
    const currentPhase = placingPhaseRef.current;

    // Who forfeited? The current placer
    const forfeitedPlayerNum = currentPhase === 'first' ? placingPlayer : (placingPlayer === 1 ? 2 : 1);
    const iForfeited = forfeitedPlayerNum === myPlayerNum;

    let newPScore = playerScore;
    let newEScore = enemyScore;
    let myPhase: Phase;
    let opponentPhase: Phase;

    if (iForfeited) {
      // I forfeited → opponent gets point
      newEScore += 1;
      myPhase = 'round_lost';
      opponentPhase = 'round_won';
    } else {
      // Opponent forfeited → I get point
      newPScore += 1;
      myPhase = 'round_won';
      opponentPhase = 'round_lost';
    }

    setPlayerScore(newPScore);
    setEnemyScore(newEScore);
    setPhase(myPhase);
    setPlacingPhase('done');

    channelRef.current?.send({
      type: 'broadcast',
      event: 'game_sync',
      payload: {
        action: 'first_placement_forfeit',
        data: {
          myScore: newEScore, // swapped for opponent
          opponentScore: newPScore,
          myPhase: opponentPhase,
        },
      },
    });
  }, [isHost, placingPlayer, playerScore, enemyScore]);

  // Start battle after both placed
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
    setPlacingPhase('done');
    setOpponentUnitsVisible([]);
    setWaitingForOpponent(false);
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

    // Broadcast battle start
    channelRef.current?.send({
      type: 'broadcast',
      event: 'game_sync',
      payload: { action: 'battle_start', data: { grid: serializeGrid(newGrid) } },
    });

    await updateRoom(roomId, { status: 'playing' });
  }, [roomId, grid]);

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

  // Battle tick - only host runs this
  const battleTick = useCallback(() => {
    if (!isHost) return;

    setGrid(prevGrid => {
      const newGrid = prevGrid.map(r => r.map(c => ({ ...c, unit: c.unit ? { ...c.unit } : null })));
      const allUnits: Unit[] = [];
      for (const row of newGrid) for (const cell of row) if (cell.unit && cell.unit.hp > 0 && !cell.unit.dead) allUnits.push(cell.unit);

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

      // Damage modifiers: host's player = player1, host's enemy = player2
      const playerDmgMod = moralePhase.current === 'buff' ? 1.25 : moralePhase.current === 'debuff' ? 0.85 : 1.0;
      const enemyDmgMod = opponentMoralePhase.current === 'buff' ? 1.25 : opponentMoralePhase.current === 'debuff' ? 0.85 : 1.0;

      // Focus fire targets
      const playerFocusTarget = focusFireTicksLeft.current > 0
        ? allUnits.filter(u => u.team === 'enemy' && u.hp > 0).sort((a, b) => b.hp - a.hp)[0] ?? null
        : null;
      const enemyFocusTarget = opponentFocusFireTicksLeft.current > 0
        ? allUnits.filter(u => u.team === 'player' && u.hp > 0).sort((a, b) => b.hp - a.hp)[0] ?? null
        : null;

      const logs: string[] = [];
      const events: BattleEvent[] = [];
      const currentTurn = turnCount;
      const acting = allUnits.filter(u => {
        if (u.hp <= 0) return false;
        if (u.activationTurn !== undefined && currentTurn < u.activationTurn) return false;
        return true;
      }).sort((a, b) => a.maxCooldown - b.maxCooldown);

      for (const unit of acting) {
        if (unit.hp <= 0) continue;
        if (unit.frozen && unit.frozen > 0) { unit.frozen -= 1; continue; }
        unit.cooldown = Math.max(0, unit.cooldown - 1);

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
          const newPos = moveToward(unit, target, newGrid, allUnits);
          if (newPos.row !== unit.row || newPos.col !== unit.col) {
            newGrid[unit.row][unit.col].unit = null;
            unit.row = newPos.row; unit.col = newPos.col;
            newGrid[unit.row][unit.col].unit = unit;
          }
        } else {
          // Can attack → reset stuck counter, but ranged kiters still reposition
          unit.stuckTurns = 0;
          const kitePos = moveToward(unit, target, newGrid, allUnits);
          if (kitePos.row !== unit.row || kitePos.col !== unit.col) {
            newGrid[unit.row][unit.col].unit = null;
            unit.row = kitePos.row; unit.col = kitePos.col;
            newGrid[unit.row][unit.col].unit = unit;
          }
        }

        if (canAttack(unit, target) && unit.cooldown <= 0) {
          let dmg = calcDamage(unit, target, newGrid);
          // Apply morale damage modifier
          if (unit.team === 'player') dmg = Math.round(dmg * playerDmgMod);
          else dmg = Math.round(dmg * enemyDmgMod);
          target.hp = Math.max(0, target.hp - dmg);
          unit.cooldown = unit.maxCooldown;
          // Warrior: track last attacked for lock-on behavior
          if (unit.type === 'warrior') unit.lastAttackedId = target.id;
          // Rider: track last attacked for target-switching
          if (unit.type === 'rider') unit.lastAttackedId = target.id;

          // Frost: 50% chance to freeze the target for 1 turn
          let didFreeze = false;
          if (unit.type === 'frost' && target.hp > 0 && Math.random() < 0.5) {
            target.frozen = 1;
            didFreeze = true;
          }

          const def = UNIT_DEFS[unit.type];
          const tDef = UNIT_DEFS[target.type];
          const isStrong = def.strongVs.includes(target.type);
          const isWeak = def.weakVs.includes(target.type);
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
            targetId: target.id, targetRow: target.row, targetCol: target.col,
            damage: dmg, isStrong, isWeak, isRanged: dist > 1,
            isAoe: unit.type === 'dragon', aoeCells, isFrozen: didFreeze,
          });

          // Emit freeze event for ice animation
          if (didFreeze) {
            events.push({
              type: 'freeze',
              attackerId: unit.id, attackerRow: unit.row, attackerCol: unit.col, attackerEmoji: '🥶',
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
      const pAlive = alive.filter(u => u.team === 'player');
      const eAlive = alive.filter(u => u.team === 'enemy');
      setPlayerUnits(pAlive);
      setEnemyUnits(eAlive);

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
              playerUnits: pAlive.map(serializeUnit),
              enemyUnits: eAlive.map(serializeUnit),
              turnCount: newTurn,
              // Morale states from host perspective
              playerMorale: moralePhase.current === 'none' ? null : moralePhase.current,
              enemyMorale: opponentMoralePhase.current === 'none' ? null : opponentMoralePhase.current,
              // Focus fire states
              playerFocusFire: focusFireTicksLeft.current > 0,
              enemyFocusFire: opponentFocusFireTicksLeft.current > 0,
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
    battleRef.current = setInterval(battleTick, 800);
    return () => { if (battleRef.current) clearInterval(battleRef.current); };
  }, [phase, isHost, battleTick]);

  const gameOver = playerScore >= POINTS_TO_WIN || enemyScore >= POINTS_TO_WIN;
  const gameWon = playerScore >= POINTS_TO_WIN;

  // Next round
  const nextRound = useCallback(async () => {
    const newRound = roundNumber + 1;
    const newGrid = generateTerrain(createEmptyGrid());
    const whoFirst = Math.random() < 0.5 ? 1 : 2;

    // Update fatigue before resetting units
    setPlayerFatigue(prev => {
      const next = { ...prev };
      const survivingTypes = new Set(playerUnits.filter(u => u.hp > 0 && !u.dead).map(u => u.type));
      for (const t of UNIT_TYPES) {
        if (playerBannedUnits.includes(t)) {
          next[t] = 0; // rested this round
        } else if (survivingTypes.has(t)) {
          next[t] = (next[t] || 0) + 1;
        } else {
          next[t] = 0; // died or wasn't used
        }
      }
      return next;
    });

    setRoundNumber(newRound);
    setPlayerUnits([]);
    setEnemyUnits([]);
    setBattleLog([]);
    setTurnCount(0);
    setSelectedUnit(UNIT_TYPES.find(t => !playerBannedUnits.includes(t)) || 'warrior');
    setGrid(newGrid);
    setPhase('place_player');
    setBattleTimer(ROUND_TIME_LIMIT);
    setWaitingForOpponent(false);
    setPlacingPlayer(whoFirst as 1 | 2);
    setPlacingPhase('first');
    setPlaceTimer(MULTI_PLACE_TIME_LIMIT);
    setOpponentUnitsVisible([]);

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
              placingPlayer: whoFirst === 1 ? 2 : 1, // swap perspective for guest
            },
          },
        });
      }, 300);
    }
  }, [roundNumber, roomId, isHost, playerScore, enemyScore, playerUnits, playerBannedUnits]);

  const resetGame = useCallback(() => {}, []);
  const startBattle = useCallback(() => {}, []);

  return {
    grid, phase, selectedUnit, setSelectedUnit,
    playerUnits, enemyUnits, turnCount, battleLog, battleEvents, battleTimer,
    playerScore, enemyScore, roundNumber,
    playerStarts: true,
    playerMaxUnits: BASE_UNITS,
    enemyMaxUnits: BASE_UNITS,
    gameOver, gameWon, gameDraw: false,
    placeUnit, removeUnit, confirmPlacement, startBattle,
    resetGame, nextRound,
    moraleBoostUsed,
    moraleBoostActive,
    activateMoraleBoost,
    focusFireUsed,
    focusFireActive,
    activateFocusFire,
    sacrificeUsed,
    activateSacrifice,
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
    playerFatigue,
  };
}
