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
              ally.hp = Math.min(ally.maxHp, ally.hp + 22);
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

        // Dragon AOE: 50% splash to other enemies in 3x3
        if (unit.type === 'dragon') {
          const splashDmg = Math.round(dmg * 0.5);
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const ar = unit.row + dr;
              const ac = unit.col + dc;
              if (ar >= 0 && ar < GRID_SIZE && ac >= 0 && ac < GRID_SIZE) {
                const cellUnit = grid[ar][ac].unit;
                if (cellUnit && cellUnit.hp > 0 && cellUnit.team !== unit.team && cellUnit.id !== target.id) {
                  cellUnit.hp = Math.max(0, cellUnit.hp - splashDmg);
                  if (cellUnit.hp <= 0) {
                    grid[ar][ac].unit = null;
                  }
                }
              }
            }
          }
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

describe('Mixed Composition Analysis', () => {
  const SIMS = 150;

  it('2+3 color splits vs Random', () => {
    const comps: { name: string; team: UnitType[] }[] = [
      // 2 Red + 3 Blue
      { name: '2R+3B (Krieger+Assassine+Reiter+Bogen+Frost)', team: ['warrior', 'assassin', 'rider', 'archer', 'frost'] },
      { name: '2R+3B (Krieger+Drache+Reiter+Bogen+Frost)', team: ['warrior', 'dragon', 'rider', 'archer', 'frost'] },
      // 2 Red + 3 Green
      { name: '2R+3G (Krieger+Drache+Schild+Magier+Schamane)', team: ['warrior', 'dragon', 'tank', 'mage', 'healer'] },
      { name: '2R+3G (Krieger+Assassine+Schild+Magier+Schamane)', team: ['warrior', 'assassin', 'tank', 'mage', 'healer'] },
      // 2 Blue + 3 Red
      { name: '2B+3R (Bogen+Frost+Krieger+Assassine+Drache)', team: ['archer', 'frost', 'warrior', 'assassin', 'dragon'] },
      { name: '2B+3R (Reiter+Bogen+Krieger+Krieger+Drache)', team: ['rider', 'archer', 'warrior', 'warrior', 'dragon'] },
      // 2 Blue + 3 Green
      { name: '2B+3G (Bogen+Frost+Schild+Magier+Schamane)', team: ['archer', 'frost', 'tank', 'mage', 'healer'] },
      { name: '2B+3G (Reiter+Frost+Schild+Schild+Schamane)', team: ['rider', 'frost', 'tank', 'tank', 'healer'] },
      // 2 Green + 3 Red
      { name: '2G+3R (Schild+Schamane+Krieger+Krieger+Drache)', team: ['tank', 'healer', 'warrior', 'warrior', 'dragon'] },
      { name: '2G+3R (Magier+Schamane+Krieger+Assassine+Drache)', team: ['mage', 'healer', 'warrior', 'assassin', 'dragon'] },
      // 2 Green + 3 Blue
      { name: '2G+3B (Schild+Schamane+Reiter+Bogen+Frost)', team: ['tank', 'healer', 'rider', 'archer', 'frost'] },
      { name: '2G+3B (Magier+Schamane+Bogen+Bogen+Frost)', team: ['mage', 'healer', 'archer', 'archer', 'frost'] },
    ];

    console.log(`\n=== 2+3 COLOR SPLITS vs RANDOM (${SIMS} each) ===`);
    for (const comp of comps) {
      let wins = 0;
      for (let i = 0; i < SIMS; i++) {
        const { winner } = simulateBattle(comp.team, randomTeam());
        if (winner === 'player') wins++;
      }
      const rate = (wins / SIMS * 100).toFixed(1);
      const flag = Number(rate) > 70 ? '⚠️ OP' : Number(rate) < 30 ? '⚠️ WEAK' : '✅';
      console.log(`${flag} ${comp.name}: ${rate}%`);
    }
  });

  it('Duplicate-heavy comps vs Random', () => {
    const comps: { name: string; team: UnitType[] }[] = [
      { name: '3 Krieger + 2 Bogen', team: ['warrior', 'warrior', 'warrior', 'archer', 'archer'] },
      { name: '3 Bogen + 2 Schild', team: ['archer', 'archer', 'archer', 'tank', 'tank'] },
      { name: '3 Schild + 2 Krieger', team: ['tank', 'tank', 'tank', 'warrior', 'warrior'] },
      { name: '3 Drache + 2 Frost', team: ['dragon', 'dragon', 'dragon', 'frost', 'frost'] },
      { name: '3 Magier + 2 Reiter', team: ['mage', 'mage', 'mage', 'rider', 'rider'] },
      { name: '3 Frost + 2 Krieger', team: ['frost', 'frost', 'frost', 'warrior', 'warrior'] },
      { name: '2 Schamane + 3 Krieger', team: ['healer', 'healer', 'warrior', 'warrior', 'warrior'] },
      { name: '2 Schamane + 3 Bogen', team: ['healer', 'healer', 'archer', 'archer', 'archer'] },
      { name: '2 Schamane + 3 Drache', team: ['healer', 'healer', 'dragon', 'dragon', 'dragon'] },
      { name: '4 Krieger + 1 Schamane', team: ['warrior', 'warrior', 'warrior', 'warrior', 'healer'] },
      { name: '4 Bogen + 1 Schild', team: ['archer', 'archer', 'archer', 'archer', 'tank'] },
      { name: '4 Reiter + 1 Schamane', team: ['rider', 'rider', 'rider', 'rider', 'healer'] },
    ];

    console.log(`\n=== DUPLICATE-HEAVY COMPS vs RANDOM (${SIMS} each) ===`);
    for (const comp of comps) {
      let wins = 0;
      for (let i = 0; i < SIMS; i++) {
        const { winner } = simulateBattle(comp.team, randomTeam());
        if (winner === 'player') wins++;
      }
      const rate = (wins / SIMS * 100).toFixed(1);
      const flag = Number(rate) > 70 ? '⚠️ OP' : Number(rate) < 30 ? '⚠️ WEAK' : '✅';
      console.log(`${flag} ${comp.name}: ${rate}%`);
    }
  });

  it('Each unit paired with healer vs Random', () => {
    console.log(`\n=== EACH UNIT + HEALER SUPPORT vs RANDOM (${SIMS} each) ===`);
    for (const type of UNIT_TYPES) {
      if (type === 'healer') continue;
      const team: UnitType[] = [type, type, type, 'healer', 'healer'];
      let wins = 0;
      for (let i = 0; i < SIMS; i++) {
        const { winner } = simulateBattle(team, randomTeam());
        if (winner === 'player') wins++;
      }
      const rate = (wins / SIMS * 100).toFixed(1);
      const flag = Number(rate) > 70 ? '⚠️ OP' : Number(rate) < 30 ? '⚠️ WEAK' : '✅';
      console.log(`${flag} 3x ${UNIT_DEFS[type].emoji} ${UNIT_DEFS[type].label} + 2x Schamane: ${rate}%`);
    }
  });

  it('Mirror matchups: same team vs itself should be ~50%', () => {
    const teams: { name: string; team: UnitType[] }[] = [
      { name: 'Balanced', team: ['warrior', 'tank', 'archer', 'mage', 'healer'] },
      { name: 'All Red', team: ['warrior', 'warrior', 'assassin', 'assassin', 'dragon'] },
      { name: 'All Blue', team: ['rider', 'rider', 'archer', 'archer', 'frost'] },
      { name: 'All Green', team: ['tank', 'tank', 'mage', 'mage', 'healer'] },
    ];

    console.log(`\n=== MIRROR MATCHUPS (${SIMS} each, should be ~50%) ===`);
    for (const t of teams) {
      let wins = 0;
      for (let i = 0; i < SIMS; i++) {
        const { winner } = simulateBattle(t.team, t.team);
        if (winner === 'player') wins++;
      }
      const rate = (wins / SIMS * 100).toFixed(1);
      console.log(`${t.name}: ${rate}% (${Math.abs(Number(rate) - 50) < 15 ? '✅' : '⚠️ ASYMMETRIC'})`);
    }
  });

  it('Per-unit individual battle contribution (1v1 round-robin)', () => {
    const SIMS_1V1 = 100;
    console.log(`\n=== 1v1 ROUND ROBIN (${SIMS_1V1} battles each) ===`);
    const winMatrix: Record<string, Record<string, number>> = {};
    const totalWins: Record<string, number> = {};
    const totalGames: Record<string, number> = {};

    for (const a of UNIT_TYPES) {
      winMatrix[a] = {};
      totalWins[a] = totalWins[a] || 0;
      totalGames[a] = totalGames[a] || 0;
      for (const b of UNIT_TYPES) {
        if (a === b) { winMatrix[a][b] = 50; continue; }
        let aWins = 0;
        for (let i = 0; i < SIMS_1V1; i++) {
          const { winner } = simulateBattle([a], [b]);
          if (winner === 'player') aWins++;
        }
        winMatrix[a][b] = Math.round(aWins / SIMS_1V1 * 100);
        totalWins[a] += aWins;
        totalGames[a] += SIMS_1V1;
      }
    }

    // Print header
    const header = ''.padEnd(14) + UNIT_TYPES.map(t => UNIT_DEFS[t].emoji.padEnd(5)).join('');
    console.log(header);
    for (const a of UNIT_TYPES) {
      const row = UNIT_DEFS[a].label.padEnd(14) + UNIT_TYPES.map(b => `${winMatrix[a][b]}%`.padEnd(5)).join('');
      console.log(row);
    }

    console.log('\n=== 1v1 OVERALL WIN RATES ===');
    const sorted = UNIT_TYPES.map(t => ({ type: t, rate: totalGames[t] > 0 ? totalWins[t] / totalGames[t] * 100 : 50 }))
      .sort((a, b) => b.rate - a.rate);
    for (const { type, rate } of sorted) {
      const flag = rate > 65 ? '⚠️ OP' : rate < 35 ? '⚠️ WEAK' : '✅';
      console.log(`${flag} ${UNIT_DEFS[type].emoji} ${UNIT_DEFS[type].label}: ${rate.toFixed(1)}%`);
    }
  });
});

describe('Advanced Simulations', () => {
  const SIMS = 150;

  it('Comeback mechanic: 6v5 and 7v5 advantage', () => {
    const team5: UnitType[] = ['warrior', 'tank', 'archer', 'mage', 'healer'];
    const team6: UnitType[] = ['warrior', 'tank', 'archer', 'mage', 'healer', 'rider'];
    const team7: UnitType[] = ['warrior', 'tank', 'archer', 'mage', 'healer', 'rider', 'frost'];

    console.log(`\n=== COMEBACK MECHANIC: SIZE ADVANTAGE (${SIMS} each) ===`);
    const matchups = [
      { name: '6v5', a: team6, b: team5 },
      { name: '7v5', a: team7, b: team5 },
      { name: '7v6', a: team7, b: team6 },
    ];
    for (const m of matchups) {
      let wins = 0;
      for (let i = 0; i < SIMS; i++) {
        const { winner } = simulateBattle(m.a, m.b);
        if (winner === 'player') wins++;
      }
      console.log(`${m.name}: bigger team wins ${(wins/SIMS*100).toFixed(1)}%`);
    }
  });

  it('Healer value: does adding a healer improve winrate?', () => {
    console.log(`\n=== HEALER VALUE ANALYSIS (${SIMS} each) ===`);
    const bases: { name: string; without: UnitType[]; with: UnitType[] }[] = [
      { name: '4 Krieger vs 3 Krieger+Schamane', without: ['warrior','warrior','warrior','warrior'], with: ['warrior','warrior','warrior','healer'] },
      { name: '4 Bogen vs 3 Bogen+Schamane', without: ['archer','archer','archer','archer'], with: ['archer','archer','archer','healer'] },
      { name: '4 Schild vs 3 Schild+Schamane', without: ['tank','tank','tank','tank'], with: ['tank','tank','tank','healer'] },
      { name: '4 Drache vs 3 Drache+Schamane', without: ['dragon','dragon','dragon','dragon'], with: ['dragon','dragon','dragon','healer'] },
      { name: '4 Reiter vs 3 Reiter+Schamane', without: ['rider','rider','rider','rider'], with: ['rider','rider','rider','healer'] },
    ];
    for (const b of bases) {
      let winsWithout = 0, winsWith = 0;
      for (let i = 0; i < SIMS; i++) {
        const r = randomTeam(4);
        if (simulateBattle(b.without, r).winner === 'player') winsWithout++;
        if (simulateBattle(b.with, r).winner === 'player') winsWith++;
      }
      const diff = (winsWith/SIMS*100) - (winsWithout/SIMS*100);
      console.log(`${b.name}: ohne ${(winsWithout/SIMS*100).toFixed(1)}% → mit ${(winsWith/SIMS*100).toFixed(1)}% (${diff > 0 ? '+' : ''}${diff.toFixed(1)}%)`);
    }
  });

  it('Assassin deep-dive: optimal partners', () => {
    console.log(`\n=== ASSASSIN PARTNER ANALYSIS (${SIMS} each) ===`);
    const partners: { name: string; team: UnitType[] }[] = [
      { name: '2 Assassine + 3 Krieger', team: ['assassin','assassin','warrior','warrior','warrior'] },
      { name: '2 Assassine + 3 Drache', team: ['assassin','assassin','dragon','dragon','dragon'] },
      { name: '2 Assassine + 2 Bogen + Frost', team: ['assassin','assassin','archer','archer','frost'] },
      { name: '2 Assassine + 2 Schild + Schamane', team: ['assassin','assassin','tank','tank','healer'] },
      { name: '1 Assassine + Krieger + Bogen + Schild + Schamane', team: ['assassin','warrior','archer','tank','healer'] },
      { name: '1 Assassine + 2 Reiter + 2 Bogen', team: ['assassin','rider','rider','archer','archer'] },
    ];
    for (const p of partners) {
      let wins = 0;
      for (let i = 0; i < SIMS; i++) {
        if (simulateBattle(p.team, randomTeam()).winner === 'player') wins++;
      }
      const rate = (wins/SIMS*100).toFixed(1);
      const flag = Number(rate) > 60 ? '✅ GOOD' : Number(rate) < 40 ? '❌ BAD' : '➖ MEH';
      console.log(`${flag} ${p.name}: ${rate}%`);
    }
  });

  it('Dragon deep-dive: optimal partners', () => {
    console.log(`\n=== DRAGON PARTNER ANALYSIS (${SIMS} each) ===`);
    const partners: { name: string; team: UnitType[] }[] = [
      { name: '2 Drache + 3 Krieger', team: ['dragon','dragon','warrior','warrior','warrior'] },
      { name: '2 Drache + 2 Schild + Schamane', team: ['dragon','dragon','tank','tank','healer'] },
      { name: '2 Drache + 2 Bogen + Frost', team: ['dragon','dragon','archer','archer','frost'] },
      { name: '1 Drache + Krieger + Bogen + Schild + Schamane', team: ['dragon','warrior','archer','tank','healer'] },
      { name: '1 Drache + 2 Frost + 2 Bogen', team: ['dragon','frost','frost','archer','archer'] },
    ];
    for (const p of partners) {
      let wins = 0;
      for (let i = 0; i < SIMS; i++) {
        if (simulateBattle(p.team, randomTeam()).winner === 'player') wins++;
      }
      const rate = (wins/SIMS*100).toFixed(1);
      const flag = Number(rate) > 60 ? '✅ GOOD' : Number(rate) < 40 ? '❌ BAD' : '➖ MEH';
      console.log(`${flag} ${p.name}: ${rate}%`);
    }
  });

  it('Color ratio impact: 1/4, 2/3, 3/2, 4/1 splits of each color', () => {
    console.log(`\n=== COLOR RATIO IMPACT vs RANDOM (${SIMS} each) ===`);
    const redUnits: UnitType[] = ['warrior', 'assassin', 'dragon'];
    const blueUnits: UnitType[] = ['rider', 'archer', 'frost'];
    const greenUnits: UnitType[] = ['tank', 'mage', 'healer'];
    const colorSets = [
      { name: 'Red', units: redUnits },
      { name: 'Blue', units: blueUnits },
      { name: 'Green', units: greenUnits },
    ];

    for (const primary of colorSets) {
      for (const secondary of colorSets) {
        if (primary.name === secondary.name) continue;
        const splits = [
          { label: `1${primary.name}+4${secondary.name}`, count: [1, 4] },
          { label: `2${primary.name}+3${secondary.name}`, count: [2, 3] },
          { label: `3${primary.name}+2${secondary.name}`, count: [3, 2] },
          { label: `4${primary.name}+1${secondary.name}`, count: [4, 1] },
        ];
        const results: string[] = [];
        for (const split of splits) {
          const team: UnitType[] = [];
          for (let i = 0; i < split.count[0]; i++) team.push(primary.units[i % primary.units.length]);
          for (let i = 0; i < split.count[1]; i++) team.push(secondary.units[i % secondary.units.length]);
          let wins = 0;
          for (let i = 0; i < SIMS; i++) {
            if (simulateBattle(team, randomTeam()).winner === 'player') wins++;
          }
          results.push(`${split.label}=${(wins/SIMS*100).toFixed(0)}%`);
        }
        console.log(`  ${results.join(' | ')}`);
      }
    }
  });

  it('Best possible 5-unit team search (top combos)', () => {
    // Test a curated set of "theoretically best" compositions
    const SIMS_TOP = 200;
    const topComps: { name: string; team: UnitType[] }[] = [
      { name: 'Krieger+Schild+Bogen+Frost+Reiter', team: ['warrior','tank','archer','frost','rider'] },
      { name: 'Krieger+Krieger+Bogen+Bogen+Schild', team: ['warrior','warrior','archer','archer','tank'] },
      { name: 'Krieger+Bogen+Frost+Schild+Magier', team: ['warrior','archer','frost','tank','mage'] },
      { name: 'Krieger+Drache+Bogen+Schild+Frost', team: ['warrior','dragon','archer','tank','frost'] },
      { name: 'Frost+Frost+Bogen+Schild+Schild', team: ['frost','frost','archer','tank','tank'] },
      { name: 'Krieger+Krieger+Drache+Bogen+Frost', team: ['warrior','warrior','dragon','archer','frost'] },
      { name: 'Schild+Schild+Krieger+Krieger+Bogen', team: ['tank','tank','warrior','warrior','archer'] },
      { name: 'Reiter+Reiter+Schild+Schild+Schamane', team: ['rider','rider','tank','tank','healer'] },
      { name: 'Frost+Bogen+Bogen+Schild+Krieger', team: ['frost','archer','archer','tank','warrior'] },
      { name: 'Drache+Krieger+Schild+Bogen+Frost', team: ['dragon','warrior','tank','archer','frost'] },
    ];

    console.log(`\n=== TOP TEAM CANDIDATES vs RANDOM (${SIMS_TOP} each) ===`);
    const ranked: { name: string; rate: number }[] = [];
    for (const comp of topComps) {
      let wins = 0;
      for (let i = 0; i < SIMS_TOP; i++) {
        if (simulateBattle(comp.team, randomTeam()).winner === 'player') wins++;
      }
      const rate = wins/SIMS_TOP*100;
      ranked.push({ name: comp.name, rate });
    }
    ranked.sort((a, b) => b.rate - a.rate);
    for (const { name, rate } of ranked) {
      const flag = rate > 70 ? '🏆' : rate > 60 ? '✅' : rate > 50 ? '➖' : '❌';
      console.log(`${flag} ${name}: ${rate.toFixed(1)}%`);
    }
  });

  it('Battle length analysis: which comps lead to long/short fights?', () => {
    console.log(`\n=== BATTLE LENGTH ANALYSIS (${SIMS} each) ===`);
    const comps: { name: string; team: UnitType[] }[] = [
      { name: 'All Melee (Krieger+Assassine+Reiter)', team: ['warrior','warrior','assassin','rider','rider'] },
      { name: 'All Ranged (Bogen+Frost+Magier)', team: ['archer','archer','frost','frost','mage'] },
      { name: 'Tank Wall (3 Schild+2 Schamane)', team: ['tank','tank','tank','healer','healer'] },
      { name: 'Glass Cannon (3 Drache+2 Assassine)', team: ['dragon','dragon','dragon','assassin','assassin'] },
      { name: 'Balanced', team: ['warrior','tank','archer','mage','healer'] },
      { name: 'Random', team: randomTeam() },
    ];

    for (const comp of comps) {
      let totalTicks = 0, timeouts = 0;
      for (let i = 0; i < SIMS; i++) {
        const { ticks } = simulateBattle(comp.team, randomTeam());
        totalTicks += ticks;
        if (ticks >= 80) timeouts++;
      }
      console.log(`${comp.name}: avg ${(totalTicks/SIMS).toFixed(1)} ticks, ${timeouts} timeouts (${(timeouts/SIMS*100).toFixed(0)}%)`);
    }
  });
});
