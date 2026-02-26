import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Unit, UnitType, Cell, Phase,
  createEmptyGrid, createUnit, findTarget, moveToward, canAttack, calcDamage,
  generateAIPlacement, detectSynergies,
  GRID_SIZE, MAX_UNITS, PLAYER_ROWS, UNIT_DEFS, POINTS_TO_WIN,
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
  const [playerStarts, setPlayerStarts] = useState(true); // true = player places blind first
  const [playerSynergies, setPlayerSynergies] = useState<string[]>([]);
  const [enemySynergies, setEnemySynergies] = useState<string[]>([]);
  const battleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Place AI units on the grid (used in both flows)
  const placeAIUnits = useCallback((currentGrid: Cell[][], playerU: Unit[]) => {
    const aiPlacements = generateAIPlacement(playerU);
    const enemies: Unit[] = [];
    const next = currentGrid.map(r => r.map(c => ({ ...c })));
    for (const p of aiPlacements) {
      const unit = createUnit(p.type, 'enemy', p.row, p.col);
      enemies.push(unit);
      next[p.row][p.col].unit = unit;
    }
    return { grid: next, enemies };
  }, []);

  // Initialize round based on who starts
  const initRound = useCallback((pStarts: boolean) => {
    if (pStarts) {
      // Player places blind → then sees enemy
      setGrid(createEmptyGrid());
      setPhase('place_player');
    } else {
      // Enemy places first → player sees enemy, then places reactively
      const emptyGrid = createEmptyGrid();
      // AI places with empty player array (random placement)
      const { grid: newGrid, enemies } = placeAIUnits(emptyGrid, []);
      setGrid(newGrid);
      setEnemyUnits(enemies);
      // Detect enemy synergies
      const eSyn = detectSynergies(enemies);
      setEnemySynergies(eSyn);
      setPhase('place_player'); // Player now sees enemy and places reactively
    }
    setPlayerUnits([]);
    setTurnCount(0);
    setBattleLog([]);
    setSelectedUnit('warrior');
    setPlayerSynergies([]);
  }, [placeAIUnits]);

  // Full reset
  const resetGame = useCallback(() => {
    setPlayerScore(0);
    setEnemyScore(0);
    setRoundNumber(1);
    setPlayerStarts(true);
    setEnemyUnits([]);
    setEnemySynergies([]);
    initRound(true);
  }, [initRound]);

  // Initialize on mount
  useEffect(() => { resetGame(); }, [resetGame]);

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

  // Confirm placement
  const confirmPlacement = useCallback(() => {
    if (playerUnits.length === 0) return;

    // Detect player synergies
    const pUnits = [...playerUnits];
    const pSyn = detectSynergies(pUnits);
    setPlayerSynergies(pSyn);
    // Update player units with synergy buffs
    setPlayerUnits(pUnits);

    if (playerStarts) {
      // Player placed blind → now AI places seeing player units, then reveal
      setGrid(prev => {
        const next = prev.map(r => r.map(c => ({ ...c })));
        // Update player units on grid with buffed stats
        for (const u of pUnits) {
          next[u.row][u.col].unit = u;
        }
        return next;
      });

      const aiResult = placeAIUnits(grid, pUnits);
      const eSyn = detectSynergies(aiResult.enemies);
      setEnemySynergies(eSyn);

      setGrid(prev => {
        const next = prev.map(r => r.map(c => ({ ...c })));
        // Keep player units with buffs
        for (const u of pUnits) {
          next[u.row][u.col].unit = u;
        }
        // Add enemy units
        for (const e of aiResult.enemies) {
          next[e.row][e.col].unit = e;
        }
        return next;
      });
      setEnemyUnits(aiResult.enemies);
    } else {
      // Enemy already placed → just update grid with buffed player
      setGrid(prev => {
        const next = prev.map(r => r.map(c => ({ ...c })));
        for (const u of pUnits) {
          next[u.row][u.col].unit = u;
        }
        return next;
      });
    }

    setPhase('place_enemy'); // Review phase before battle
  }, [playerUnits, playerStarts, grid, placeAIUnits]);

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
      for (const row of newGrid) for (const cell of row) if (cell.unit && cell.unit.hp > 0) allUnits.push(cell.unit);

      const logs: string[] = [];
      const acting = allUnits.filter(u => u.hp > 0).sort((a, b) => a.maxCooldown - b.maxCooldown);

      for (const unit of acting) {
        if (unit.hp <= 0) continue;
        unit.cooldown = Math.max(0, unit.cooldown - 1);

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

  const gameOver = playerScore >= POINTS_TO_WIN || enemyScore >= POINTS_TO_WIN;
  const gameWon = playerScore >= POINTS_TO_WIN;

  const nextRound = useCallback(() => {
    const newStarts = !playerStarts;
    setRoundNumber(prev => prev + 1);
    setPlayerStarts(newStarts);
    setEnemyUnits([]);
    setEnemySynergies([]);
    initRound(newStarts);
  }, [playerStarts, initRound]);

  return {
    grid, phase, selectedUnit, setSelectedUnit,
    playerUnits, enemyUnits, turnCount, battleLog,
    playerScore, enemyScore, roundNumber, playerStarts,
    playerSynergies, enemySynergies,
    gameOver, gameWon,
    placeUnit, removeUnit, confirmPlacement, startBattle,
    resetGame, nextRound,
  };
}
