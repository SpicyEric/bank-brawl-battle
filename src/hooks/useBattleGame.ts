import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Unit, UnitType, Cell, Phase,
  createEmptyGrid, createUnit, findTarget, moveToward, distance,
  generateEnemyPlacement, GRID_SIZE, MAX_UNITS, PLAYER_ROWS, UNIT_DEFS,
} from '@/lib/battleGame';

export function useBattleGame() {
  const [grid, setGrid] = useState<Cell[][]>(createEmptyGrid);
  const [phase, setPhase] = useState<Phase>('place');
  const [selectedUnit, setSelectedUnit] = useState<UnitType | null>('warrior');
  const [playerUnits, setPlayerUnits] = useState<Unit[]>([]);
  const [enemyUnits, setEnemyUnits] = useState<Unit[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [battleLog, setBattleLog] = useState<string[]>([]);
  const battleRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize enemy placement
  const initEnemies = useCallback(() => {
    const newGrid = createEmptyGrid();
    const placements = generateEnemyPlacement();
    const enemies: Unit[] = [];
    for (const p of placements) {
      const unit = createUnit(p.type, 'enemy', p.row, p.col);
      enemies.push(unit);
      newGrid[p.row][p.col].unit = unit;
    }
    setEnemyUnits(enemies);
    return { newGrid, enemies };
  }, []);

  // Reset game
  const resetGame = useCallback(() => {
    const { newGrid } = initEnemies();
    setGrid(newGrid);
    setPlayerUnits([]);
    setPhase('place');
    setTurnCount(0);
    setBattleLog([]);
    setSelectedUnit('warrior');
  }, [initEnemies]);

  // Initialize on mount
  useEffect(() => { resetGame(); }, [resetGame]);

  // Place unit
  const placeUnit = useCallback((row: number, col: number) => {
    if (phase !== 'place' || !selectedUnit) return;
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
    if (phase !== 'place') return;
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

  // Run one battle tick
  const battleTick = useCallback(() => {
    setGrid(prevGrid => {
      const newGrid = prevGrid.map(r => r.map(c => ({ ...c, unit: c.unit ? { ...c.unit } : null })));
      const allUnits: Unit[] = [];
      for (const row of newGrid) for (const cell of row) if (cell.unit && cell.unit.hp > 0) allUnits.push(cell.unit);
      
      const logs: string[] = [];

      // Sort by speed (lower cooldown = faster)
      const acting = allUnits.filter(u => u.hp > 0).sort((a, b) => a.maxCooldown - b.maxCooldown);

      for (const unit of acting) {
        if (unit.hp <= 0) continue;
        unit.cooldown = Math.max(0, unit.cooldown - 1);
        
        const target = findTarget(unit, allUnits);
        if (!target) continue;

        const dist = distance(unit, target);

        if (dist > unit.range) {
          // Move
          const newPos = moveToward(unit, target, newGrid);
          if (newPos.row !== unit.row || newPos.col !== unit.col) {
            newGrid[unit.row][unit.col].unit = null;
            unit.row = newPos.row;
            unit.col = newPos.col;
            newGrid[unit.row][unit.col].unit = unit;
          }
        }

        if (distance(unit, target) <= unit.range && unit.cooldown <= 0) {
          // Attack
          const dmg = Math.floor(unit.attack * (0.8 + Math.random() * 0.4));
          target.hp = Math.max(0, target.hp - dmg);
          unit.cooldown = unit.maxCooldown;
          const def = UNIT_DEFS[unit.type];
          const tDef = UNIT_DEFS[target.type];
          logs.push(`${def.emoji} ${unit.team === 'player' ? 'Dein' : 'Feind'} ${def.label} → ${tDef.emoji} ${dmg} Schaden${target.hp <= 0 ? ' 💀' : ''}`);
          
          if (target.hp <= 0) {
            newGrid[target.row][target.col].unit = null;
          }
        }
      }

      if (logs.length > 0) {
        setBattleLog(prev => [...logs, ...prev].slice(0, 30));
      }

      // Update unit lists
      const alive = allUnits.filter(u => u.hp > 0);
      const pAlive = alive.filter(u => u.team === 'player');
      const eAlive = alive.filter(u => u.team === 'enemy');
      setPlayerUnits(pAlive);
      setEnemyUnits(eAlive);

      if (eAlive.length === 0) setPhase('won');
      else if (pAlive.length === 0) setPhase('lost');

      setTurnCount(prev => prev + 1);
      return newGrid;
    });
  }, []);

  // Start battle
  const startBattle = useCallback(() => {
    if (playerUnits.length === 0) return;
    setPhase('battle');
    setBattleLog([]);
    setTurnCount(0);
  }, [playerUnits]);

  // Battle loop
  useEffect(() => {
    if (phase !== 'battle') {
      if (battleRef.current) clearInterval(battleRef.current);
      return;
    }
    battleRef.current = setInterval(battleTick, 800);
    return () => { if (battleRef.current) clearInterval(battleRef.current); };
  }, [phase, battleTick]);

  return {
    grid, phase, selectedUnit, setSelectedUnit,
    playerUnits, enemyUnits, turnCount, battleLog,
    placeUnit, removeUnit, startBattle, resetGame,
  };
}
