import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Unit, UnitType, Cell, Phase,
  createEmptyGrid, createUnit, findTarget, moveToward, canAttack, calcDamage,
  generateAIPlacement, GRID_SIZE, MAX_UNITS, PLAYER_ROWS, UNIT_DEFS, POINTS_TO_WIN,
} from '@/lib/battleGame';

export function useBattleGame() {
  const [grid, setGrid] = useState<Cell[][]>(createEmptyGrid);
  const [phase, setPhase] = useState<Phase>('place_player');
  const [selectedUnit, setSelectedUnit] = useState<UnitType | null>('warrior');
  const [playerUnits, setPlayerUnits] = useState<Unit[]>([]);
  const [enemyUnits, setEnemyUnits] = useState<Unit[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [battleLog, setBattleLog] = useState<string[]>([]);
  const [playerScore, setPlayerScore] = useState(0);
  const [enemyScore, setEnemyScore] = useState(0);
  const [roundNumber, setRoundNumber] = useState(1);
  const [playerStarts, setPlayerStarts] = useState(true); // alternating who places first
  const battleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset for new round (keep scores)
  const startNewRound = useCallback(() => {
    setGrid(createEmptyGrid());
    setPlayerUnits([]);
    setEnemyUnits([]);
    setTurnCount(0);
    setBattleLog([]);
    setSelectedUnit('warrior');
    // Alternate: if player started last round, enemy "places first" now (i.e. player sees enemy first)
    setPlayerStarts(prev => !prev);
    setPhase('place_player');
  }, []);

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

  // Place unit
  const placeUnit = useCallback((row: number, col: number) => {
    if (phase !== 'place_player' || !selectedUnit) return;
    if (!PLAYER_ROWS.includes(row)) return;
    if (playerUnits.length >= MAX_UNITS) return;
    if (grid[row][col].unit) return;

    const unit = createUnit(selectedUnit, 'player', row, col);
    setPlayerUnits(prev => [...prev, unit]);
    setGrid(prev => {
      const next = prev.map(r => r.map(c => ({ ...c })));
      next[row][col] = { ...next[row][col], unit };
      return next;
    });
  }, [phase, selectedUnit, playerUnits, grid]);

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

  // Confirm placement → AI places → show enemy → battle
  const confirmPlacement = useCallback(() => {
    if (playerUnits.length === 0) return;

    // AI generates counter-placement
    const aiPlacements = generateAIPlacement(playerUnits);
    const enemies: Unit[] = [];

    setGrid(prev => {
      const next = prev.map(r => r.map(c => ({ ...c })));
      for (const p of aiPlacements) {
        const unit = createUnit(p.type, 'enemy', p.row, p.col);
        enemies.push(unit);
        next[p.row][p.col].unit = unit;
      }
      return next;
    });

    setEnemyUnits(enemies);
    setPhase('place_enemy'); // Show enemy placement briefly
  }, [playerUnits]);

  // Start battle after seeing enemy placement
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
      for (const row of newGrid) for (const cell of row) if (cell.unit && cell.unit.hp > 0) allUnits.push(cell.unit);

      const logs: string[] = [];
      const acting = allUnits.filter(u => u.hp > 0).sort((a, b) => a.maxCooldown - b.maxCooldown);

      for (const unit of acting) {
        if (unit.hp <= 0) continue;
        unit.cooldown = Math.max(0, unit.cooldown - 1);

        const target = findTarget(unit, allUnits);
        if (!target) continue;

        // Move toward target if can't attack
        if (!canAttack(unit, target)) {
          const newPos = moveToward(unit, target, newGrid);
          if (newPos.row !== unit.row || newPos.col !== unit.col) {
            newGrid[unit.row][unit.col].unit = null;
            unit.row = newPos.row;
            unit.col = newPos.col;
            newGrid[unit.row][unit.col].unit = unit;
          }
        }

        // Attack if in range and off cooldown
        if (canAttack(unit, target) && unit.cooldown <= 0) {
          const dmg = calcDamage(unit, target);
          target.hp = Math.max(0, target.hp - dmg);
          unit.cooldown = unit.maxCooldown;

          const def = UNIT_DEFS[unit.type];
          const tDef = UNIT_DEFS[target.type];
          const isStrong = def.strongVs.includes(target.type);
          const isWeak = def.weakVs.includes(target.type);
          const suffix = isStrong ? ' 💪' : isWeak ? ' 😰' : '';
          logs.push(`${def.emoji} ${unit.team === 'player' ? '👤' : '💀'} ${def.label} → ${tDef.emoji} ${dmg}${suffix}${target.hp <= 0 ? ' ☠️' : ''}`);

          if (target.hp <= 0) {
            newGrid[target.row][target.col].unit = null;
          }
        }
      }

      if (logs.length > 0) {
        setBattleLog(prev => [...logs, ...prev].slice(0, 40));
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

  // Check for game over
  const gameOver = playerScore >= POINTS_TO_WIN || enemyScore >= POINTS_TO_WIN;
  const gameWon = playerScore >= POINTS_TO_WIN;

  const nextRound = useCallback(() => {
    setRoundNumber(prev => prev + 1);
    startNewRound();
  }, [startNewRound]);

  return {
    grid, phase, selectedUnit, setSelectedUnit,
    playerUnits, enemyUnits, turnCount, battleLog,
    playerScore, enemyScore, roundNumber, playerStarts,
    gameOver, gameWon,
    placeUnit, removeUnit, confirmPlacement, startBattle,
    resetGame, nextRound,
  };
}
