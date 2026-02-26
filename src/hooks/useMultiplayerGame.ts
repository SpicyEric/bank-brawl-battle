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

// Serialize unit for DB/broadcast (strip functions, keep data)
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
  const battleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const terrainSeedRef = useRef<string | null>(null);

  // Setup broadcast channel
  useEffect(() => {
    const channel = supabase.channel(`game-battle-${roomId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'game_sync' }, ({ payload }) => {
      const { action, data } = payload;

      if (action === 'terrain') {
        // Received terrain from host
        const newGrid = data.grid as Cell[][];
        setGrid(newGrid);
      }

      if (action === 'battle_tick') {
        // Guest receives tick from host
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

      if (action === 'battle_start') {
        setGrid(data.grid as Cell[][]);
        setPhase('battle');
        setBattleTimer(ROUND_TIME_LIMIT);
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
        setPlayerUnits([]);
        setEnemyUnits([]);
        setBattleLog([]);
        setTurnCount(0);
        setSelectedUnit('warrior');
        setBattleTimer(ROUND_TIME_LIMIT);
        setWaitingForOpponent(false);
      }

      if (action === 'opponent_ready') {
        // Other player placed their units
        checkBothReady();
      }
    });

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  // Host generates and shares terrain
  useEffect(() => {
    if (isHost && phase === 'place_player') {
      // Share current grid terrain with opponent
      setTimeout(() => {
        channelRef.current?.send({
          type: 'broadcast',
          event: 'game_sync',
          payload: { action: 'terrain', data: { grid: serializeGrid(grid) } },
        });
      }, 500);
    }
  }, [isHost, phase, roundNumber]);

  // Place unit on my side
  const placeUnit = useCallback((row: number, col: number) => {
    if (phase !== 'place_player' || !selectedUnit) return;
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
  }, [phase, selectedUnit, playerUnits, grid, myRows, myTeam]);

  // Remove placed unit
  const removeUnit = useCallback((unitId: string) => {
    if (phase !== 'place_player') return;
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
  }, [phase]);

  // Confirm placement → save to DB and wait for opponent
  const confirmPlacement = useCallback(async () => {
    if (playerUnits.length === 0) return;

    const unitData = playerUnits.map(serializeUnit);
    const field = isHost ? 'player1_units' : 'player2_units';
    const readyField = isHost ? 'player1_ready' : 'player2_ready';

    await updateRoom(roomId, {
      [field]: unitData,
      [readyField]: true,
    });

    setWaitingForOpponent(true);

    // Notify opponent
    channelRef.current?.send({
      type: 'broadcast',
      event: 'game_sync',
      payload: { action: 'opponent_ready', data: {} },
    });

    // Check if opponent is already ready
    checkBothReady();
  }, [playerUnits, roomId, isHost]);

  // Check if both players are ready → start battle
  const checkBothReady = useCallback(async () => {
    const { data: room } = await supabase
      .from('game_rooms')
      .select('*')
      .eq('id', roomId)
      .single();

    if (!room || !room.player1_ready || !room.player2_ready) return;
    if (!room.player1_units || !room.player2_units) return;

    // Build full grid with both players' units
    setGrid(prevGrid => {
      const newGrid = prevGrid.map(r => r.map(c => ({ ...c, unit: null as Unit | null })));

      // Place player1 units (always on PLAYER_ROWS / 'player' team)
      for (const u of room.player1_units as any[]) {
        const unit: Unit = { ...u, team: 'player' };
        newGrid[unit.row][unit.col].unit = unit;
      }
      // Place player2 units (always on ENEMY_ROWS / 'enemy' team)
      for (const u of room.player2_units as any[]) {
        const unit: Unit = { ...u, team: 'enemy' };
        newGrid[unit.row][unit.col].unit = unit;
      }

      // Broadcast the full grid to start battle
      if (isHost) {
        setTimeout(() => {
          channelRef.current?.send({
            type: 'broadcast',
            event: 'game_sync',
            payload: { action: 'battle_start', data: { grid: serializeGrid(newGrid) } },
          });
        }, 100);
      }

      return newGrid;
    });

    setWaitingForOpponent(false);
    setPhase('battle');
    setBattleTimer(ROUND_TIME_LIMIT);

    // Reset ready flags
    await updateRoom(roomId, { player1_ready: false, player2_ready: false, status: 'playing' });
  }, [roomId, isHost]);

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

      // Broadcast tick to guest
      setBattleTimer(prev => {
        const newTimer = prev - 1;

        channelRef.current?.send({
          type: 'broadcast',
          event: 'game_sync',
          payload: {
            action: 'battle_tick',
            data: {
              grid: serializeGrid(newGrid),
              logs: [...logs, ...[]].slice(0, 40),
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

      // Check win/loss
      if (eAlive.length === 0 || pAlive.length === 0 || battleTimer <= 1) {
        let newPhase: Phase;
        let pScore = playerScore;
        let eScore = enemyScore;

        if (eAlive.length === 0) {
          pScore += 1; newPhase = 'round_won';
        } else if (pAlive.length === 0) {
          eScore += 1; newPhase = 'round_lost';
        } else if (pAlive.length > eAlive.length) {
          pScore += 1; newPhase = 'round_won';
        } else if (eAlive.length > pAlive.length) {
          eScore += 1; newPhase = 'round_lost';
        } else {
          pScore += 1; eScore += 1; newPhase = 'round_draw';
        }

        setPlayerScore(pScore);
        setEnemyScore(eScore);
        setPhase(newPhase);

        // For player2, swap won/lost perspective
        const guestPhase = newPhase === 'round_won' ? 'round_lost' : newPhase === 'round_lost' ? 'round_won' : newPhase;

        channelRef.current?.send({
          type: 'broadcast',
          event: 'game_sync',
          payload: {
            action: 'round_end',
            data: {
              phase: guestPhase,
              playerScore: eScore, // swapped for guest
              enemyScore: pScore,
              grid: serializeGrid(newGrid),
            },
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

    await updateRoom(roomId, {
      player1_units: null, player2_units: null,
      player1_ready: false, player2_ready: false,
      status: 'waiting',
    });

    if (isHost) {
      // Share new terrain with guest (swap scores for their perspective)
      setTimeout(() => {
        channelRef.current?.send({
          type: 'broadcast',
          event: 'game_sync',
          payload: {
            action: 'next_round',
            data: {
              grid: serializeGrid(newGrid),
              roundNumber: newRound,
              playerScore: enemyScore, // swapped
              enemyScore: playerScore,
            },
          },
        });
      }, 300);
    }
  }, [roundNumber, roomId, isHost, playerScore, enemyScore]);

  const resetGame = useCallback(() => {
    // In multiplayer, reset goes back to lobby
  }, []);

  const startBattle = useCallback(() => {
    // Not used in multiplayer - battle starts when both ready
  }, []);

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
    waitingForOpponent,
    isHost,
    myRows,
  };
}
