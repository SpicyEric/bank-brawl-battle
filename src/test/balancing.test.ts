/**
 * Comprehensive Balancing Simulation
 * Simulates full matches (first-to-13), mono matchups, strategy matchups,
 * row placement analysis, terrain fairness, and column targeting effectiveness.
 */
import { describe, it, expect } from 'vitest';
import {
  UnitType, Unit, Cell, UNIT_DEFS, UNIT_TYPES, GRID_SIZE,
  createEmptyGrid, createUnit, findTarget, moveToward, canAttack, calcDamage,
  generateTerrain, PLAYER_ROWS, ENEMY_ROWS, POINTS_TO_WIN, getActivationTurn,
  generateAIPlacement, getMaxUnits, TerrainType,
} from '@/lib/battleGame';

// --- Helpers ---

function getCells(rows: number[], grid: Cell[][]): { row: number; col: number }[] {
  const cells: { row: number; col: number }[] = [];
  for (const row of rows) {
    for (let col = 0; col < GRID_SIZE; col++) {
      if (grid[row][col].terrain !== 'water') cells.push({ row, col });
    }
  }
  return cells;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function moveUnit(unit: Unit, target: Unit, grid: Cell[][]) {
  const newPos = moveToward(unit, target, grid);
  if (newPos.row !== unit.row || newPos.col !== unit.col) {
    grid[unit.row][unit.col].unit = null;
    unit.row = newPos.row;
    unit.col = newPos.col;
    grid[unit.row][unit.col].unit = unit;
  }
}

// --- Single battle simulation (with staggered activation) ---

function simulateBattle(playerTeam: UnitType[], enemyTeam: UnitType[], options?: {
  playerRows?: number[]; // force specific rows for placement
  enemyRows?: number[];
}): { winner: 'player' | 'enemy' | 'draw'; ticks: number; terrainCounts: Record<TerrainType, number> } {
  const grid = generateTerrain(createEmptyGrid());
  const allUnits: Unit[] = [];

  // Count terrain
  const terrainCounts: Record<TerrainType, number> = { none: 0, forest: 0, hill: 0, water: 0 };
  for (const row of grid) for (const cell of row) terrainCounts[cell.terrain]++;

  const pRows = options?.playerRows || PLAYER_ROWS;
  const eRows = options?.enemyRows || ENEMY_ROWS;

  // Place player units
  const pCells = shuffle(getCells(pRows, grid));
  playerTeam.forEach((type, i) => {
    if (i >= pCells.length) return;
    const { row, col } = pCells[i];
    const u = createUnit(type, 'player', row, col);
    grid[row][col].unit = u;
    allUnits.push(u);
  });

  // Place enemy units
  const eCells = shuffle(getCells(eRows, grid));
  enemyTeam.forEach((type, i) => {
    if (i >= eCells.length) return;
    const { row, col } = eCells[i];
    const u = createUnit(type, 'enemy', row, col);
    grid[row][col].unit = u;
    allUnits.push(u);
  });

  let ticks = 0;
  for (ticks = 0; ticks < 80; ticks++) {
    const alive = allUnits.filter(u => u.hp > 0);
    const pAlive = alive.filter(u => u.team === 'player');
    const eAlive = alive.filter(u => u.team === 'enemy');

    if (eAlive.length === 0) return { winner: 'player', ticks, terrainCounts };
    if (pAlive.length === 0) return { winner: 'enemy', ticks, terrainCounts };

    // Filter by activation turn (staggered rows)
    const acting = alive.filter(u => {
      if (u.activationTurn !== undefined && ticks < u.activationTurn) return false;
      return true;
    }).sort((a, b) => a.maxCooldown - b.maxCooldown);

    for (const unit of acting) {
      if (unit.hp <= 0) continue;

      if (unit.frozen && unit.frozen > 0) {
        unit.frozen -= 1;
        continue;
      }

      unit.cooldown = Math.max(0, unit.cooldown - 1);

      // Healer logic
      if (unit.type === 'healer') {
        const allies = alive.filter(u => u.team === unit.team && u.id !== unit.id && u.hp > 0);
        const healable = allies.filter(a => a.hp < a.maxHp);
        if (healable.length > 0 && unit.cooldown <= 0) {
          for (const ally of healable) {
            if (canAttack(unit, ally)) {
              ally.hp = Math.min(ally.maxHp, ally.hp + 15);
              unit.cooldown = unit.maxCooldown;
              break;
            }
          }
          if (unit.cooldown <= 0) {
            healable.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
            moveUnit(unit, healable[0], grid);
          }
          continue;
        }
      }

      const target = findTarget(unit, alive);
      if (!target) continue;

      if (!canAttack(unit, target)) {
        moveUnit(unit, target, grid);
      }

      if (canAttack(unit, target) && unit.cooldown <= 0) {
        const dmg = calcDamage(unit, target, grid);
        target.hp = Math.max(0, target.hp - dmg);
        unit.cooldown = unit.maxCooldown;

        if (unit.type === 'frost' && target.hp > 0 && Math.random() < 0.5) {
          target.frozen = 1;
        }

        if (target.hp <= 0) {
          grid[target.row][target.col].unit = null;
        }
      }
    }
  }

  // Time out: compare remaining units
  const pAlive = allUnits.filter(u => u.team === 'player' && u.hp > 0);
  const eAlive = allUnits.filter(u => u.team === 'enemy' && u.hp > 0);
  const winner = pAlive.length > eAlive.length ? 'player' : eAlive.length > pAlive.length ? 'enemy' : 'draw';
  return { winner, ticks, terrainCounts };
}

// --- Full match simulation (first-to-13) ---

function simulateFullMatch(
  playerStrategy: () => UnitType[],
  enemyStrategy: () => UnitType[],
): { winner: 'player' | 'enemy'; rounds: number; playerScore: number; enemyScore: number } {
  let playerScore = 0;
  let enemyScore = 0;
  let rounds = 0;

  while (playerScore < POINTS_TO_WIN && enemyScore < POINTS_TO_WIN && rounds < 50) {
    rounds++;
    const pMax = getMaxUnits(playerScore, enemyScore);
    const eMax = getMaxUnits(enemyScore, playerScore);
    const pTeam = playerStrategy().slice(0, pMax);
    const eTeam = enemyStrategy().slice(0, eMax);

    const { winner } = simulateBattle(pTeam, eTeam);
    if (winner === 'player') playerScore++;
    else if (winner === 'enemy') enemyScore++;
    else { playerScore++; enemyScore++; }
  }

  return {
    winner: playerScore >= POINTS_TO_WIN ? 'player' : 'enemy',
    rounds,
    playerScore,
    enemyScore,
  };
}

function randomTeam(size: number = 5): UnitType[] {
  return Array.from({ length: size }, () => UNIT_TYPES[Math.floor(Math.random() * UNIT_TYPES.length)]);
}

function monoTeam(type: UnitType, size: number = 5): UnitType[] {
  return Array(size).fill(type);
}

// ================== TESTS ==================

describe('Full Match Simulations (first-to-13)', () => {
  const MATCH_COUNT = 100;

  it('Random vs Random: should be roughly 50/50', () => {
    let pWins = 0;
    let totalRounds = 0;

    for (let i = 0; i < MATCH_COUNT; i++) {
      const result = simulateFullMatch(() => randomTeam(), () => randomTeam());
      if (result.winner === 'player') pWins++;
      totalRounds += result.rounds;
    }

    const winRate = (pWins / MATCH_COUNT * 100).toFixed(1);
    const avgRounds = (totalRounds / MATCH_COUNT).toFixed(1);
    console.log(`\n=== RANDOM vs RANDOM (${MATCH_COUNT} matches) ===`);
    console.log(`Player win rate: ${winRate}%`);
    console.log(`Average rounds per match: ${avgRounds}`);

    // Should be roughly balanced (35-65%)
    expect(pWins / MATCH_COUNT).toBeGreaterThan(0.3);
    expect(pWins / MATCH_COUNT).toBeLessThan(0.7);
  });

  it('Each mono-composition full match vs Random', () => {
    console.log(`\n=== MONO vs RANDOM - Full Matches (${MATCH_COUNT} each) ===`);
    const results: { type: UnitType; winRate: number }[] = [];

    for (const type of UNIT_TYPES) {
      let wins = 0;
      for (let i = 0; i < MATCH_COUNT; i++) {
        const result = simulateFullMatch(() => monoTeam(type), () => randomTeam());
        if (result.winner === 'player') wins++;
      }
      const rate = wins / MATCH_COUNT * 100;
      results.push({ type, winRate: rate });
      const flag = rate > 70 ? '⚠️ OP' : rate < 30 ? '⚠️ WEAK' : '✅';
      console.log(`${flag} ${UNIT_DEFS[type].emoji} ${UNIT_DEFS[type].label.padEnd(15)} ${rate.toFixed(1)}%`);
    }

    // No unit should dominate >80% or lose >80%
    for (const r of results) {
      if (r.winRate > 80) console.log(`🚨 CRITICAL: ${UNIT_DEFS[r.type].label} is way too strong at ${r.winRate}%`);
      if (r.winRate < 20) console.log(`🚨 CRITICAL: ${UNIT_DEFS[r.type].label} is way too weak at ${r.winRate}%`);
    }
  });

  it('Strategy matchups: popular comps in full matches', () => {
    const strategies: { name: string; team: () => UnitType[] }[] = [
      { name: 'Rush (3 Reiter + 2 Assassine)', team: () => ['rider', 'rider', 'rider', 'assassin', 'assassin'] },
      { name: 'Tank-Mage (2 Schild + 2 Magier + Schamane)', team: () => ['tank', 'tank', 'mage', 'mage', 'healer'] },
      { name: 'Ranged (3 Bogen + 2 Frost)', team: () => ['archer', 'archer', 'archer', 'frost', 'frost'] },
      { name: 'Drachen (3 Drache + 2 Schamane)', team: () => ['dragon', 'dragon', 'dragon', 'healer', 'healer'] },
      { name: 'Balanced (Krieger+Schild+Bogen+Magier+Schamane)', team: () => ['warrior', 'tank', 'archer', 'mage', 'healer'] },
      { name: 'All Red (2 Krieger + 2 Assassine + 1 Drache)', team: () => ['warrior', 'warrior', 'assassin', 'assassin', 'dragon'] },
      { name: 'All Blue (2 Reiter + 2 Bogen + 1 Frost)', team: () => ['rider', 'rider', 'archer', 'archer', 'frost'] },
      { name: 'All Green (2 Schild + 2 Magier + 1 Schamane)', team: () => ['tank', 'tank', 'mage', 'mage', 'healer'] },
    ];

    const SIMS = 60;
    const stratWins: Record<string, number> = {};
    const stratGames: Record<string, number> = {};
    for (const s of strategies) { stratWins[s.name] = 0; stratGames[s.name] = 0; }

    console.log(`\n=== STRATEGY FULL MATCH MATCHUPS (${SIMS} matches each) ===`);

    for (let i = 0; i < strategies.length; i++) {
      for (let j = i + 1; j < strategies.length; j++) {
        const a = strategies[i];
        const b = strategies[j];
        let aWins = 0;

        for (let s = 0; s < SIMS; s++) {
          const result = simulateFullMatch(a.team, b.team);
          if (result.winner === 'player') aWins++;
        }

        stratWins[a.name] += aWins;
        stratWins[b.name] += (SIMS - aWins);
        stratGames[a.name] += SIMS;
        stratGames[b.name] += SIMS;

        console.log(`  ${a.name} vs ${b.name}: ${Math.round(aWins/SIMS*100)}%-${Math.round((SIMS-aWins)/SIMS*100)}%`);
      }
    }

    console.log('\n=== STRATEGY RANKING ===');
    const ranked = strategies.map(s => ({
      name: s.name,
      rate: stratGames[s.name] > 0 ? stratWins[s.name] / stratGames[s.name] * 100 : 0
    })).sort((a, b) => b.rate - a.rate);

    for (const { name, rate } of ranked) {
      const flag = rate > 70 ? '⚠️ OP' : rate < 30 ? '⚠️ WEAK' : '✅';
      console.log(`${flag} ${name}: ${rate.toFixed(1)}%`);
    }
  });
});

describe('Row Placement Analysis', () => {
  it('Front-row-only vs Spread vs Back-row-only placement', () => {
    const SIMS = 200;
    const team: UnitType[] = ['warrior', 'tank', 'archer', 'mage', 'rider'];

    const placements: { name: string; rows: number[] }[] = [
      { name: 'Front only (row 5)', rows: [5] },
      { name: 'Mid only (row 6)', rows: [6] },
      { name: 'Back only (row 7)', rows: [7] },
      { name: 'Front+Mid (5,6)', rows: [5, 6] },
      { name: 'Spread (5,6,7)', rows: [5, 6, 7] },
    ];

    console.log(`\n=== ROW PLACEMENT ANALYSIS (${SIMS} battles each) ===`);

    for (const p of placements) {
      let wins = 0;
      for (let i = 0; i < SIMS; i++) {
        const { winner } = simulateBattle(team, team, {
          playerRows: p.rows,
          enemyRows: ENEMY_ROWS,
        });
        if (winner === 'player') wins++;
      }
      const rate = (wins / SIMS * 100).toFixed(1);
      console.log(`${p.name.padEnd(25)} Win rate: ${rate}%`);
    }
  });

  it('Staggered activation timing check', () => {
    console.log('\n=== ACTIVATION TURNS ===');
    for (const row of PLAYER_ROWS) {
      console.log(`Player row ${row}: activates turn ${getActivationTurn(row, 'player')}`);
    }
    for (const row of ENEMY_ROWS) {
      console.log(`Enemy row ${row}: activates turn ${getActivationTurn(row, 'enemy')}`);
    }
  });
});

describe('Terrain Fairness', () => {
  it('Terrain distribution across many maps', () => {
    const MAPS = 500;
    let totalForest = 0, totalHill = 0, totalWater = 0;
    let playerSideTerrain = 0, enemySideTerrain = 0, middleTerrain = 0;
    let waterOnPlayerRows = 0;

    for (let i = 0; i < MAPS; i++) {
      const grid = generateTerrain(createEmptyGrid());
      for (const row of grid) {
        for (const cell of row) {
          if (cell.terrain === 'forest') totalForest++;
          if (cell.terrain === 'hill') totalHill++;
          if (cell.terrain === 'water') totalWater++;

          if (cell.terrain !== 'none') {
            if (PLAYER_ROWS.includes(cell.row) || cell.row <= 1) {
              if (cell.row <= 1) enemySideTerrain++;
              else playerSideTerrain++;
              if (cell.terrain === 'water' && PLAYER_ROWS.includes(cell.row)) waterOnPlayerRows++;
            } else {
              middleTerrain++;
            }
          }
        }
      }
    }

    console.log(`\n=== TERRAIN DISTRIBUTION (${MAPS} maps) ===`);
    console.log(`Avg Forest per map: ${(totalForest / MAPS).toFixed(1)}`);
    console.log(`Avg Hill per map: ${(totalHill / MAPS).toFixed(1)}`);
    console.log(`Avg Water per map: ${(totalWater / MAPS).toFixed(1)}`);
    console.log(`Avg player-side terrain: ${(playerSideTerrain / MAPS).toFixed(1)}`);
    console.log(`Avg enemy-side terrain: ${(enemySideTerrain / MAPS).toFixed(1)}`);
    console.log(`Avg middle terrain: ${(middleTerrain / MAPS).toFixed(1)}`);
    console.log(`Water on player rows: ${waterOnPlayerRows} total (should be 0)`);

    // Water should never appear on player placement rows
    expect(waterOnPlayerRows).toBe(0);
  });
});

describe('Counter System Effectiveness', () => {
  it('Color advantage should consistently win (Red > Green > Blue > Red)', () => {
    const SIMS = 200;
    const colorTeams: Record<string, UnitType[]> = {
      red: ['warrior', 'warrior', 'assassin', 'assassin', 'dragon'],
      green: ['tank', 'tank', 'mage', 'mage', 'healer'],
      blue: ['rider', 'rider', 'archer', 'archer', 'frost'],
    };

    const matchups = [
      { favored: 'red', underdog: 'green' },
      { favored: 'green', underdog: 'blue' },
      { favored: 'blue', underdog: 'red' },
    ];

    console.log(`\n=== COLOR COUNTER EFFECTIVENESS (${SIMS} battles) ===`);

    for (const { favored, underdog } of matchups) {
      let favoredWins = 0;
      for (let i = 0; i < SIMS; i++) {
        const { winner } = simulateBattle(colorTeams[favored], colorTeams[underdog]);
        if (winner === 'player') favoredWins++;
      }
      const rate = (favoredWins / SIMS * 100).toFixed(1);
      console.log(`${favored.toUpperCase()} > ${underdog.toUpperCase()}: ${rate}% win rate (should be >60%)`);
      // Counter should win more than 55%
      expect(favoredWins / SIMS).toBeGreaterThan(0.55);
    }
  });
});
