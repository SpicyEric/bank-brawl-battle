import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Unit, UnitType, Cell, Phase,
  createEmptyGrid, createUnit, findTarget, moveToward, canAttack, calcDamage,
  generateAIPlacement, getMaxUnits,
  GRID_SIZE, MAX_UNITS, PLAYER_ROWS, UNIT_DEFS, POINTS_TO_WIN, BASE_UNITS,
} from '@/lib/battleGame';
import { BattleEvent } from '@/lib/battleEvents';

export function useBattleGame() {
  const [grid, setGrid] = useState<Cell[][]>(() => createEmptyGrid());
  const [phase, setPhase] = useState<Phase>('place_player');
  const [selectedUnit, setSelectedUnit] = useState<UnitType | null>('warrior');
  const [playerUnits, setPlayerUnits] = useState<Unit[]>([]);
  const [enemyUnits, setEnemyUnits] = useState<Unit[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [battleLog, setBattleLog] = useState<string[]>([]);
  const [playerScore, setPlayerScore] = useState(0);
  const [enemyScore, setEnemyScore] = useState(0);
  const [roundNumber, setRoundNumber] = useState(1);
  const [playerStarts, setPlayerStarts] = useState(true);
  const battleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [battleEvents, setBattleEvents] = useState<BattleEvent[]>([]);

  // Full reset
  const resetGame = useCallback(() => {
    setGrid(createEmptyGrid());
    setPlayerUnits([]);
    setEnemyUnits([]);
    setPhase('place_player');
    setTurnCount(0);
    setBattleLog([]);
    setSelectedUnit('warrior');
    setPlayerScore(0);
    setEnemyScore(0);
    setRoundNumber(1);
    setPlayerStarts(true);
  }, []);

  const playerMaxUnits = getMaxUnits(playerScore, enemyScore);
  const enemyMaxUnits = getMaxUnits(enemyScore, playerScore);

  // Place unit
  const placeUnit = useCallback((row: number, col: number) => {
    if (phase !== 'place_player' || !selectedUnit) return;
    if (!PLAYER_ROWS.includes(row)) return;
    if (playerUnits.length >= playerMaxUnits) return;
    if (grid[row][col].unit) return;

    const unit = createUnit(selectedUnit, 'player', row, col);
    setPlayerUnits(prev => [...prev, unit]);
    setGrid(prev => {
      const next = prev.map(r => r.map(c => ({ ...c })));
      next[row][col] = { ...next[row][col], unit };
      return next;
    });
  }, [phase, selectedUnit, playerUnits, grid, playerMaxUnits]);

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

  // Confirm placement
  const confirmPlacement = useCallback(() => {
    if (playerUnits.length === 0) return;

    const pUnits = playerUnits.map(u => ({ ...u }));
    setPlayerUnits(pUnits);

    const aiPlacements = generateAIPlacement(pUnits, enemyMaxUnits);
    const enemies: Unit[] = aiPlacements.map(p => createUnit(p.type, 'enemy', p.row, p.col));
    setEnemyUnits(enemies);

    // Build full grid
    const newGrid = createEmptyGrid();
    for (const u of pUnits) newGrid[u.row][u.col].unit = u;
    for (const e of enemies) newGrid[e.row][e.col].unit = e;
    setGrid(newGrid);

    setPhase('place_enemy');
  }, [playerUnits]);

  // Start battle
  const startBattle = useCallback(() => {
    setPhase('battle');
    setBattleLog([]);
    setTurnCount(0);
  }, []);

  // Run one battle tick
  const battleTick = useCallback(() => {
    setGrid(prevGrid => {
      const newGrid = prevGrid.map(r => r.map(c => ({ ...c, unit: c.unit ? { ...c.unit } : null })));
      const allUnits: Unit[] = [];
      for (const row of newGrid) for (const cell of row) if (cell.unit && cell.unit.hp > 0 && !cell.unit.dead) allUnits.push(cell.unit);

      const logs: string[] = [];
      const events: BattleEvent[] = [];
      const acting = allUnits.filter(u => u.hp > 0).sort((a, b) => a.maxCooldown - b.maxCooldown);

      for (const unit of acting) {
        if (unit.hp <= 0) continue;

        // Frozen units can't act, just tick down
        if (unit.frozen && unit.frozen > 0) {
          unit.frozen -= 1;
          continue;
        }

        unit.cooldown = Math.max(0, unit.cooldown - 1);

        // Healer: heal allies instead of attacking
        if (unit.type === 'healer') {
          if (unit.cooldown <= 0) {
            const allies = allUnits.filter(u => u.team === unit.team && u.id !== unit.id && u.hp > 0 && !u.dead);
            const def = UNIT_DEFS[unit.type];
            let healed = false;
            for (const ally of allies) {
              if (canAttack(unit, ally) && ally.hp < ally.maxHp) {
                const healAmt = Math.min(15, ally.maxHp - ally.hp);
                ally.hp += healAmt;
                if (!healed) {
                  logs.push(`🌿 ${unit.team === 'player' ? '👤' : '💀'} Schamane → ${UNIT_DEFS[ally.type].emoji} +${healAmt} ❤️`);
                  healed = true;
                  unit.cooldown = unit.maxCooldown;
                }
              }
            }
            if (!healed) {
              // Move toward lowest HP ally
              const injured = allies.filter(a => a.hp < a.maxHp).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
              if (injured.length > 0) {
                const newPos = moveToward(unit, injured[0], newGrid);
                if (newPos.row !== unit.row || newPos.col !== unit.col) {
                  newGrid[unit.row][unit.col].unit = null;
                  unit.row = newPos.row;
                  unit.col = newPos.col;
                  newGrid[unit.row][unit.col].unit = unit;
                }
              }
            }
          }
          continue;
        }

        const target = findTarget(unit, allUnits);
        if (!target) continue;

        if (!canAttack(unit, target)) {
          const newPos = moveToward(unit, target, newGrid);
          if (newPos.row !== unit.row || newPos.col !== unit.col) {
            newGrid[unit.row][unit.col].unit = null;
            unit.row = newPos.row;
            unit.col = newPos.col;
            newGrid[unit.row][unit.col].unit = unit;
          }
        }

        if (canAttack(unit, target) && unit.cooldown <= 0) {
          const dmg = calcDamage(unit, target);
          target.hp = Math.max(0, target.hp - dmg);
          unit.cooldown = unit.maxCooldown;

          // Frost: freeze the target for 1 turn
          if (unit.type === 'frost' && target.hp > 0) {
            target.frozen = 1;
          }

          const def = UNIT_DEFS[unit.type];
          const tDef = UNIT_DEFS[target.type];
          const isStrong = def.strongVs.includes(target.type);
          const isWeak = def.weakVs.includes(target.type);
          const suffix = isStrong ? ' 💪' : isWeak ? ' 😰' : '';
          const dist = Math.abs(unit.row - target.row) + Math.abs(unit.col - target.col);
          logs.push(`${def.emoji} ${unit.team === 'player' ? '👤' : '💀'} ${def.label} → ${tDef.emoji} ${dmg}${suffix}${target.frozen ? ' 🧊' : ''}${target.hp <= 0 ? ' ☠️' : ''}`);
          events.push({
            type: target.hp <= 0 ? 'kill' : 'hit',
            attackerId: unit.id,
            attackerRow: unit.row,
            attackerCol: unit.col,
            attackerEmoji: def.emoji,
            targetId: target.id,
            targetRow: target.row,
            targetCol: target.col,
            damage: dmg,
            isStrong, isWeak,
            isRanged: dist > 1,
          });

          if (target.hp <= 0) {
            target.type = target.type;
            (target as any).dead = true;
          }
        }
      }

      if (logs.length > 0) {
        setBattleLog(prev => [...logs, ...prev].slice(0, 40));
      }
      if (events.length > 0) {
        setBattleEvents(events);
      }

      const alive = allUnits.filter(u => u.hp > 0);
      const pAlive = alive.filter(u => u.team === 'player');
      const eAlive = alive.filter(u => u.team === 'enemy');
      setPlayerUnits(pAlive);
      setEnemyUnits(eAlive);

      if (eAlive.length === 0) {
        setPlayerScore(prev => prev + 1);
        setPhase('round_won');
      } else if (pAlive.length === 0) {
        setEnemyScore(prev => prev + 1);
        setPhase('round_lost');
      }

      setTurnCount(prev => prev + 1);
      return newGrid;
    });
  }, []);

  // Battle loop
  useEffect(() => {
    if (phase !== 'battle') {
      if (battleRef.current) clearInterval(battleRef.current);
      return;
    }
    battleRef.current = setInterval(battleTick, 800);
    return () => { if (battleRef.current) clearInterval(battleRef.current); };
  }, [phase, battleTick]);

  const gameOver = playerScore >= POINTS_TO_WIN || enemyScore >= POINTS_TO_WIN;
  const gameWon = playerScore >= POINTS_TO_WIN;

  const nextRound = useCallback(() => {
    const newStarts = !playerStarts;
    setRoundNumber(prev => prev + 1);
    setPlayerStarts(newStarts);
    setPlayerUnits([]);
    setTurnCount(0);
    setBattleLog([]);
    setSelectedUnit('warrior');

    if (newStarts) {
      setGrid(createEmptyGrid());
      setEnemyUnits([]);
      setPhase('place_player');
    } else {
      const emptyGrid = createEmptyGrid();
      const aiMax = getMaxUnits(enemyScore, playerScore);
      const aiPlacements = generateAIPlacement([], aiMax);
      const enemies: Unit[] = aiPlacements.map(p => createUnit(p.type, 'enemy', p.row, p.col));
      for (const e of enemies) emptyGrid[e.row][e.col].unit = e;
      setGrid(emptyGrid);
      setEnemyUnits(enemies);
      setPhase('place_player');
    }
  }, [playerStarts]);

  return {
    grid, phase, selectedUnit, setSelectedUnit,
    playerUnits, enemyUnits, turnCount, battleLog, battleEvents,
    playerScore, enemyScore, roundNumber, playerStarts,
    playerMaxUnits, enemyMaxUnits,
    gameOver, gameWon,
    placeUnit, removeUnit, confirmPlacement, startBattle,
    resetGame, nextRound,
  };
}
