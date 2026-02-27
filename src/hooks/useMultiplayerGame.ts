import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Unit, UnitType, Cell, Phase,
  createEmptyGrid, createUnit, findTarget, moveToward, canAttack, calcDamage,
  generateTerrain,
  GRID_SIZE, PLAYER_ROWS, ENEMY_ROWS, UNIT_DEFS, POINTS_TO_WIN, BASE_UNITS, ROUND_TIME_LIMIT,
} from '@/lib/battleGame';
import { BattleEvent } from '@/lib/battleEvents';
import { supabase } from '@/integrations/supabase/client';
import { updateRoom, ensureAnonymousSession } from '@/lib/multiplayer';

interface MultiplayerConfig {
  roomId: string;
  role: 'player1' | 'player2';
}

const PLACE_TIME_LIMIT = 10; // seconds for each player to place

function serializeUnit(u: Unit) {
  return { id: u.id, type: u.type, team: u.team, hp: u.hp, maxHp: u.maxHp, attack: u.attack, row: u.row, col: u.col, cooldown: u.cooldown, maxCooldown: u.maxCooldown, dead: u.dead, frozen: u.frozen, stuckTurns: u.stuckTurns };
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

  // Alternating placement state
  const [placingPlayer, setPlacingPlayer] = useState<1 | 2>(1); // who places first this round
  const [placingPhase, setPlacingPhase] = useState<'first' | 'second' | 'done'>('first');
  const [placeTimer, setPlaceTimer] = useState(PLACE_TIME_LIMIT);
  const [isMyTurnToPlace, setIsMyTurnToPlace] = useState(false);
  const [opponentUnitsVisible, setOpponentUnitsVisible] = useState<Unit[]>([]);

  const battleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const placeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const placingPhaseRef = useRef(placingPhase);
  const playerUnitsRef = useRef(playerUnits);
  const isMyTurnRef = useRef(isMyTurnToPlace);

  // Keep refs in sync
  useEffect(() => { placingPhaseRef.current = placingPhase; }, [placingPhase]);
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
        setPlaceTimer(PLACE_TIME_LIMIT);
      }

      if (action === 'first_placement_done') {
        // First player finished placing — show their units and let second player place
        const firstUnits = (data.units as any[]).map((u: any) => ({ ...u } as Unit));
        setOpponentUnitsVisible(firstUnits);
        // Add opponent units to grid
        setGrid(prev => {
          const next = prev.map(r => r.map(c => ({ ...c })));
          for (const u of firstUnits) {
            next[u.row][u.col] = { ...next[u.row][u.col], unit: u };
          }
          return next;
        });
        setPlacingPhase('second');
        setPlaceTimer(PLACE_TIME_LIMIT);
      }

      if (action === 'first_placement_forfeit') {
        // First player placed nothing → they lose the round
        // The scores are already updated by the sender (host handles scoring)
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
        }
      }

      if (action === 'round_end') {
        setPhase(data.phase);
        setPlayerScore(data.playerScore);
        setEnemyScore(data.enemyScore);
        setGrid(data.grid as Cell[][]);
      }

      if (action === 'next_round') {
        setGrid(data.grid as Cell[][]);
        setPhase('place_player');
        setRoundNumber(data.roundNumber);
        setPlayerScore(data.playerScore);
        setEnemyScore(data.enemyScore);
        setPlacingPlayer(data.placingPlayer);
        setPlacingPhase('first');
        setPlaceTimer(PLACE_TIME_LIMIT);
        setPlayerUnits([]);
        setEnemyUnits([]);
        setBattleLog([]);
        setTurnCount(0);
        setSelectedUnit('warrior');
        setBattleTimer(ROUND_TIME_LIMIT);
        setWaitingForOpponent(false);
        setOpponentUnitsVisible([]);
      }
    });

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, isHost]);

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

    setPlaceTimer(PLACE_TIME_LIMIT);
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
  }, [phase, isMyTurnToPlace, selectedUnit, playerUnits, grid, myRows, myTeam]);

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
      setPlaceTimer(PLACE_TIME_LIMIT);

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

    for (const u of room.player1_units as any[]) {
      const unit: Unit = { ...u, team: 'player' };
      newGrid[unit.row][unit.col].unit = unit;
    }
    for (const u of room.player2_units as any[]) {
      const unit: Unit = { ...u, team: 'enemy' };
      newGrid[unit.row][unit.col].unit = unit;
    }

    setGrid(newGrid);
    setPhase('battle');
    setBattleTimer(ROUND_TIME_LIMIT);
    setPlacingPhase('done');
    setOpponentUnitsVisible([]);
    setWaitingForOpponent(false);

    // Broadcast battle start
    channelRef.current?.send({
      type: 'broadcast',
      event: 'game_sync',
      payload: { action: 'battle_start', data: { grid: serializeGrid(newGrid) } },
    });

    await updateRoom(roomId, { status: 'playing' });
  }, [roomId, grid]);

  // Battle tick - only host runs this
  const battleTick = useCallback(() => {
    if (!isHost) return;

    setGrid(prevGrid => {
      const newGrid = prevGrid.map(r => r.map(c => ({ ...c, unit: c.unit ? { ...c.unit } : null })));
      const allUnits: Unit[] = [];
      for (const row of newGrid) for (const cell of row) if (cell.unit && cell.unit.hp > 0 && !cell.unit.dead) allUnits.push(cell.unit);

      const logs: string[] = [];
      const events: BattleEvent[] = [];
      const acting = allUnits.filter(u => u.hp > 0).sort((a, b) => a.maxCooldown - b.maxCooldown);

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
                break;
              }
            }
            if (!healed) {
              healable.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
              const newPos = moveToward(unit, healable[0], newGrid);
              if (newPos.row !== unit.row || newPos.col !== unit.col) {
                newGrid[unit.row][unit.col].unit = null;
                unit.row = newPos.row; unit.col = newPos.col;
                newGrid[unit.row][unit.col].unit = unit;
              }
            }
            continue;
          }
        }

        const target = findTarget(unit, allUnits);
        if (!target) continue;

        if (!canAttack(unit, target)) {
          unit.stuckTurns = (unit.stuckTurns || 0) + 1;
          const newPos = moveToward(unit, target, newGrid);
          if (newPos.row !== unit.row || newPos.col !== unit.col) {
            newGrid[unit.row][unit.col].unit = null;
            unit.row = newPos.row; unit.col = newPos.col;
            newGrid[unit.row][unit.col].unit = unit;
          }
        } else {
          unit.stuckTurns = 0;
        }

        if (canAttack(unit, target) && unit.cooldown <= 0) {
          const dmg = calcDamage(unit, target, newGrid);
          target.hp = Math.max(0, target.hp - dmg);
          unit.cooldown = unit.maxCooldown;
          if (unit.type === 'frost' && target.hp > 0 && Math.random() < 0.5) target.frozen = 1;

          const def = UNIT_DEFS[unit.type];
          const tDef = UNIT_DEFS[target.type];
          const isStrong = def.strongVs.includes(target.type);
          const isWeak = def.weakVs.includes(target.type);
          const suffix = isStrong ? ' 💪' : isWeak ? ' 😰' : '';
          const dist = Math.abs(unit.row - target.row) + Math.abs(unit.col - target.col);
          logs.push(`${def.emoji} ${unit.team === 'player' ? '👤' : '💀'} ${def.label} → ${tDef.emoji} ${dmg}${suffix}${target.frozen ? ' 🧊' : ''}${target.hp <= 0 ? ' ☠️' : ''}`);
          events.push({
            type: target.hp <= 0 ? 'kill' : 'hit',
            attackerId: unit.id, attackerRow: unit.row, attackerCol: unit.col, attackerEmoji: def.emoji,
            targetId: target.id, targetRow: target.row, targetCol: target.col,
            damage: dmg, isStrong, isWeak, isRanged: dist > 1,
          });
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

    setRoundNumber(newRound);
    setPlayerUnits([]);
    setEnemyUnits([]);
    setBattleLog([]);
    setTurnCount(0);
    setSelectedUnit('warrior');
    setGrid(newGrid);
    setPhase('place_player');
    setBattleTimer(ROUND_TIME_LIMIT);
    setWaitingForOpponent(false);
    setPlacingPlayer(whoFirst as 1 | 2);
    setPlacingPhase('first');
    setPlaceTimer(PLACE_TIME_LIMIT);
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
  }, [roundNumber, roomId, isHost, playerScore, enemyScore]);

  const resetGame = useCallback(() => {}, []);
  const startBattle = useCallback(() => {}, []);

  return {
    grid, phase, selectedUnit, setSelectedUnit,
    playerUnits, enemyUnits, turnCount, battleLog, battleEvents, battleTimer,
    playerScore, enemyScore, roundNumber,
    playerStarts: true,
    playerMaxUnits: BASE_UNITS,
    enemyMaxUnits: BASE_UNITS,
    gameOver, gameWon,
    placeUnit, removeUnit, confirmPlacement, startBattle,
    resetGame, nextRound,
    moraleBoostUsed: false as boolean,
    moraleBoostActive: null as 'buff' | 'debuff' | null,
    activateMoraleBoost: () => {},
    waitingForOpponent,
    isHost,
    myRows,
    // New placement state
    placeTimer,
    isMyTurnToPlace,
    placingPhase,
  };
}
