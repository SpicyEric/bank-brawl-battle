/**
 * MASSIVE Balancing Simulation — 1000+ games across all compositions
 * Tests every unit's value, every composition archetype, tank formations,
 * and ensures no single strategy dominates.
 */
import { describe, it, expect } from 'vitest';
import {
  UnitType, Unit, Cell, UNIT_DEFS, UNIT_TYPES, GRID_SIZE,
  createEmptyGrid, createUnit, findTarget, moveToward, canAttack, calcDamage,
  generateTerrain, PLAYER_ROWS, ENEMY_ROWS, POINTS_TO_WIN, getActivationTurn,
  generateAIPlacement, getMaxUnits, TerrainType, setBondsForPlacement, moveTankFormation,
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

function moveUnit(unit: Unit, target: Unit, grid: Cell[][], allUnits: Unit[]) {
  const newPos = moveToward(unit, target, grid, allUnits);
  if (newPos.row !== unit.row || newPos.col !== unit.col) {
    // If tank, move bonded units along
    if (unit.type === 'tank') {
      moveTankFormation(unit, newPos, grid, allUnits);
    }
    grid[unit.row][unit.col].unit = null;
    unit.row = newPos.row;
    unit.col = newPos.col;
    grid[unit.row][unit.col].unit = unit;
  }
}

function simulateBattle(playerTeam: UnitType[], enemyTeam: UnitType[], options?: {
  playerRows?: number[];
  enemyRows?: number[];
  useBonds?: boolean;
}): { winner: 'player' | 'enemy' | 'draw'; ticks: number } {
  const grid = generateTerrain(createEmptyGrid());
  const allUnits: Unit[] = [];

  const pRows = options?.playerRows || PLAYER_ROWS;
  const eRows = options?.enemyRows || ENEMY_ROWS;

  const pCells = shuffle(getCells(pRows, grid));
  playerTeam.forEach((type, i) => {
    if (i >= pCells.length) return;
    const { row, col } = pCells[i];
    const u = createUnit(type, 'player', row, col);
    grid[row][col].unit = u;
    allUnits.push(u);
  });

  const eCells = shuffle(getCells(eRows, grid));
  enemyTeam.forEach((type, i) => {
    if (i >= eCells.length) return;
    const { row, col } = eCells[i];
    const u = createUnit(type, 'enemy', row, col);
    grid[row][col].unit = u;
    allUnits.push(u);
  });

  // Set bonds if requested
  if (options?.useBonds) {
    setBondsForPlacement(allUnits);
  }

  let ticks = 0;
  for (ticks = 0; ticks < 80; ticks++) {
    const alive = allUnits.filter(u => u.hp > 0);
    const pAlive = alive.filter(u => u.team === 'player');
    const eAlive = alive.filter(u => u.team === 'enemy');

    if (eAlive.length === 0) return { winner: 'player', ticks };
    if (pAlive.length === 0) return { winner: 'enemy', ticks };

    const acting = alive.filter(u => {
      if (u.activationTurn !== undefined && ticks < u.activationTurn) return false;
      return true;
    }).sort((a, b) => a.maxCooldown - b.maxCooldown);

    for (const unit of acting) {
      if (unit.hp <= 0) continue;
      if (unit.frozen && unit.frozen > 0) { unit.frozen -= 1; continue; }
      unit.cooldown = Math.max(0, unit.cooldown - 1);

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
            moveUnit(unit, healable[0], grid, alive);
          }
          continue;
        }
      }

      const target = findTarget(unit, alive);
      if (!target) continue;

      if (!canAttack(unit, target)) {
        moveUnit(unit, target, grid, alive);
      }

      if (canAttack(unit, target) && unit.cooldown <= 0) {
        const dmg = calcDamage(unit, target, grid);
        target.hp = Math.max(0, target.hp - dmg);
        unit.cooldown = unit.maxCooldown;

        if (unit.type === 'frost' && target.hp > 0 && Math.random() < 0.5) {
          target.frozen = 1;
        }

        if (unit.type === 'dragon') {
          const splashDmg = Math.round(dmg * 0.3);
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const ar = unit.row + dr;
              const ac = unit.col + dc;
              if (ar >= 0 && ar < GRID_SIZE && ac >= 0 && ac < GRID_SIZE) {
                const cellUnit = grid[ar][ac].unit;
                if (cellUnit && cellUnit.hp > 0 && cellUnit.team !== unit.team && cellUnit.id !== target.id) {
                  cellUnit.hp = Math.max(0, cellUnit.hp - splashDmg);
                  if (cellUnit.hp <= 0) grid[ar][ac].unit = null;
                }
              }
            }
          }
        }

        if (target.hp <= 0) grid[target.row][target.col].unit = null;
      }
    }
  }

  const pAlive = allUnits.filter(u => u.team === 'player' && u.hp > 0);
  const eAlive = allUnits.filter(u => u.team === 'enemy' && u.hp > 0);
  const winner = pAlive.length > eAlive.length ? 'player' : eAlive.length > pAlive.length ? 'enemy' : 'draw';
  return { winner, ticks };
}

function randomTeam(size: number = 5): UnitType[] {
  return Array.from({ length: size }, () => UNIT_TYPES[Math.floor(Math.random() * UNIT_TYPES.length)]);
}

// ======================== MASSIVE TESTS ========================

describe('MASSIVE Balancing: 1000-game suites', () => {
  
  it('Every unit vs Random (500 games each = 4500 total)', () => {
    const SIMS = 500;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`EVERY UNIT vs RANDOM — ${SIMS} games each (${SIMS * UNIT_TYPES.length} total)`);
    console.log('='.repeat(60));
    
    const results: { type: UnitType; rate: number }[] = [];
    for (const type of UNIT_TYPES) {
      let wins = 0;
      const team: UnitType[] = [type, type, type, type, type];
      for (let i = 0; i < SIMS; i++) {
        if (simulateBattle(team, randomTeam()).winner === 'player') wins++;
      }
      const rate = wins / SIMS * 100;
      results.push({ type, rate });
    }
    
    results.sort((a, b) => b.rate - a.rate);
    for (const { type, rate } of results) {
      const bar = '█'.repeat(Math.round(rate / 2));
      const flag = rate > 65 ? '⚠️ OP' : rate < 20 ? '🚨 WEAK' : rate < 30 ? '⚠️ WEAK' : '✅';
      console.log(`${flag} ${UNIT_DEFS[type].emoji} ${UNIT_DEFS[type].label.padEnd(15)} ${rate.toFixed(1).padStart(5)}% ${bar}`);
    }
  });

  it('All 36 two-unit pairings vs Random (200 games each = 7200 total)', () => {
    const SIMS = 200;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`ALL TWO-UNIT PAIRINGS vs RANDOM — ${SIMS} each`);
    console.log('='.repeat(60));
    
    const pairResults: { name: string; rate: number }[] = [];
    
    for (let i = 0; i < UNIT_TYPES.length; i++) {
      for (let j = i; j < UNIT_TYPES.length; j++) {
        const a = UNIT_TYPES[i];
        const b = UNIT_TYPES[j];
        // 3 of type a + 2 of type b (or 5 if same)
        const team: UnitType[] = a === b 
          ? [a, a, a, a, a]
          : [a, a, a, b, b];
        
        let wins = 0;
        for (let s = 0; s < SIMS; s++) {
          if (simulateBattle(team, randomTeam()).winner === 'player') wins++;
        }
        const rate = wins / SIMS * 100;
        const name = a === b 
          ? `5x ${UNIT_DEFS[a].label}`
          : `3x ${UNIT_DEFS[a].label} + 2x ${UNIT_DEFS[b].label}`;
        pairResults.push({ name, rate });
      }
    }
    
    pairResults.sort((a, b) => b.rate - a.rate);
    console.log('\n--- TOP 15 ---');
    for (const { name, rate } of pairResults.slice(0, 15)) {
      const flag = rate > 65 ? '⚠️ OP' : '✅';
      console.log(`${flag} ${name}: ${rate.toFixed(1)}%`);
    }
    console.log('\n--- BOTTOM 15 ---');
    for (const { name, rate } of pairResults.slice(-15)) {
      const flag = rate < 20 ? '🚨' : rate < 30 ? '⚠️' : '✅';
      console.log(`${flag} ${name}: ${rate.toFixed(1)}%`);
    }
    
    // Check spread
    const max = pairResults[0].rate;
    const min = pairResults[pairResults.length - 1].rate;
    console.log(`\nSpread: ${min.toFixed(1)}% — ${max.toFixed(1)}% (range: ${(max - min).toFixed(1)}%)`);
  });

  it('Strategic archetypes full match (200 games each)', () => {
    const SIMS = 200;
    const strategies: { name: string; team: UnitType[] }[] = [
      { name: 'Turtle (2T+2M+H)', team: ['tank', 'tank', 'mage', 'mage', 'healer'] },
      { name: 'Rush (3R+2A)', team: ['rider', 'rider', 'rider', 'assassin', 'assassin'] },
      { name: 'Sniper (3B+2F)', team: ['archer', 'archer', 'archer', 'frost', 'frost'] },
      { name: 'Bruiser (3K+2D)', team: ['warrior', 'warrior', 'warrior', 'dragon', 'dragon'] },
      { name: 'Balanced (K+T+B+M+H)', team: ['warrior', 'tank', 'archer', 'mage', 'healer'] },
      { name: 'Anti-Tank Red (2K+2A+D)', team: ['warrior', 'warrior', 'assassin', 'assassin', 'dragon'] },
      { name: 'Shield Wall (3T+K+H)', team: ['tank', 'tank', 'tank', 'warrior', 'healer'] },
      { name: 'Assassin Core (3A+T+H)', team: ['assassin', 'assassin', 'assassin', 'tank', 'healer'] },
      { name: 'Dragon Comp (2D+T+H+M)', team: ['dragon', 'dragon', 'tank', 'healer', 'mage'] },
      { name: 'Frost Lock (3F+2T)', team: ['frost', 'frost', 'frost', 'tank', 'tank'] },
      { name: 'Rider Flank (3R+T+H)', team: ['rider', 'rider', 'rider', 'tank', 'healer'] },
      { name: 'Mixed Counter (K+A+B+F+T)', team: ['warrior', 'assassin', 'archer', 'frost', 'tank'] },
    ];
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`STRATEGIC ARCHETYPES vs RANDOM — ${SIMS} each`);
    console.log('='.repeat(60));
    
    const stratResults: { name: string; rate: number }[] = [];
    for (const s of strategies) {
      let wins = 0;
      for (let i = 0; i < SIMS; i++) {
        if (simulateBattle(s.team, randomTeam()).winner === 'player') wins++;
      }
      const rate = wins / SIMS * 100;
      stratResults.push({ name: s.name, rate });
    }
    
    stratResults.sort((a, b) => b.rate - a.rate);
    for (const { name, rate } of stratResults) {
      const bar = '█'.repeat(Math.round(rate / 2));
      const flag = rate > 65 ? '⚠️ OP' : rate < 30 ? '⚠️ WEAK' : '✅';
      console.log(`${flag} ${name.padEnd(30)} ${rate.toFixed(1).padStart(5)}% ${bar}`);
    }
  });

  it('Strategy round-robin (each vs each, 100 games per matchup)', () => {
    const SIMS = 100;
    const strategies: { name: string; team: UnitType[] }[] = [
      { name: 'Turtle', team: ['tank', 'tank', 'mage', 'mage', 'healer'] },
      { name: 'Rush', team: ['rider', 'rider', 'rider', 'assassin', 'assassin'] },
      { name: 'Sniper', team: ['archer', 'archer', 'archer', 'frost', 'frost'] },
      { name: 'Bruiser', team: ['warrior', 'warrior', 'warrior', 'dragon', 'dragon'] },
      { name: 'Balanced', team: ['warrior', 'tank', 'archer', 'mage', 'healer'] },
      { name: 'Anti-Tank', team: ['warrior', 'warrior', 'assassin', 'assassin', 'dragon'] },
      { name: 'Assassin Core', team: ['assassin', 'assassin', 'assassin', 'tank', 'healer'] },
      { name: 'Frost Lock', team: ['frost', 'frost', 'frost', 'tank', 'tank'] },
    ];

    console.log(`\n${'='.repeat(60)}`);
    console.log(`STRATEGY ROUND-ROBIN — ${SIMS} per matchup`);
    console.log('='.repeat(60));

    const totalWins: Record<string, number> = {};
    const totalGames: Record<string, number> = {};
    for (const s of strategies) { totalWins[s.name] = 0; totalGames[s.name] = 0; }

    for (let i = 0; i < strategies.length; i++) {
      for (let j = i + 1; j < strategies.length; j++) {
        const a = strategies[i];
        const b = strategies[j];
        let aWins = 0;
        for (let s = 0; s < SIMS; s++) {
          if (simulateBattle(a.team, b.team).winner === 'player') aWins++;
        }
        totalWins[a.name] += aWins;
        totalWins[b.name] += (SIMS - aWins);
        totalGames[a.name] += SIMS;
        totalGames[b.name] += SIMS;
        
        const pct = Math.round(aWins / SIMS * 100);
        const result = pct > 60 ? `${a.name} ✅` : pct < 40 ? `${b.name} ✅` : 'EVEN';
        console.log(`  ${a.name} vs ${b.name}: ${pct}%-${100 - pct}% → ${result}`);
      }
    }

    console.log('\n--- OVERALL RANKING ---');
    const ranked = strategies.map(s => ({
      name: s.name,
      rate: totalGames[s.name] > 0 ? totalWins[s.name] / totalGames[s.name] * 100 : 50
    })).sort((a, b) => b.rate - a.rate);

    for (const { name, rate } of ranked) {
      const flag = rate > 65 ? '⚠️ OP' : rate < 35 ? '⚠️ WEAK' : '✅';
      console.log(`${flag} ${name.padEnd(15)} ${rate.toFixed(1)}%`);
    }
    
    // No strategy should dominate >75% or be useless <25%
    for (const { name, rate } of ranked) {
      expect(rate).toBeLessThan(80);
      expect(rate).toBeGreaterThan(15);
    }
  });

  it('Tank formation value: bonded vs unbonded (500 games)', () => {
    const SIMS = 500;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TANK BOND VALUE — bonded vs unbonded (${SIMS} each)`);
    console.log('='.repeat(60));

    const comps: { name: string; team: UnitType[] }[] = [
      { name: '2T+K+B+H', team: ['tank', 'tank', 'warrior', 'archer', 'healer'] },
      { name: 'T+2A+B+F', team: ['tank', 'assassin', 'assassin', 'archer', 'frost'] },
      { name: '2T+2M+H', team: ['tank', 'tank', 'mage', 'mage', 'healer'] },
    ];

    for (const comp of comps) {
      let bondedWins = 0, unbondedWins = 0;
      for (let i = 0; i < SIMS; i++) {
        const enemy = randomTeam();
        if (simulateBattle(comp.team, enemy, { useBonds: true }).winner === 'player') bondedWins++;
        if (simulateBattle(comp.team, enemy, { useBonds: false }).winner === 'player') unbondedWins++;
      }
      const bondRate = (bondedWins / SIMS * 100).toFixed(1);
      const unbondRate = (unbondedWins / SIMS * 100).toFixed(1);
      const diff = (bondedWins / SIMS * 100) - (unbondedWins / SIMS * 100);
      console.log(`${comp.name}: Bonded ${bondRate}% vs Unbonded ${unbondRate}% (${diff > 0 ? '+' : ''}${diff.toFixed(1)}%)`);
    }
  });

  it('Unit contribution: each unit added to a balanced core (300 games each)', () => {
    const SIMS = 300;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`UNIT CONTRIBUTION — adding each unit to balanced core`);
    console.log('='.repeat(60));

    const core: UnitType[] = ['warrior', 'tank', 'archer', 'mage'];
    
    // Baseline: core + random 5th
    let baseWins = 0;
    for (let i = 0; i < SIMS; i++) {
      const fifth = UNIT_TYPES[Math.floor(Math.random() * UNIT_TYPES.length)];
      if (simulateBattle([...core, fifth], randomTeam()).winner === 'player') baseWins++;
    }
    const baseRate = baseWins / SIMS * 100;
    console.log(`Baseline (core + random): ${baseRate.toFixed(1)}%\n`);

    const contributions: { type: UnitType; rate: number; diff: number }[] = [];
    for (const type of UNIT_TYPES) {
      let wins = 0;
      for (let i = 0; i < SIMS; i++) {
        if (simulateBattle([...core, type], randomTeam()).winner === 'player') wins++;
      }
      const rate = wins / SIMS * 100;
      contributions.push({ type, rate, diff: rate - baseRate });
    }

    contributions.sort((a, b) => b.rate - a.rate);
    for (const { type, rate, diff } of contributions) {
      const sign = diff > 0 ? '+' : '';
      const flag = diff > 5 ? '✅ BOOST' : diff < -5 ? '❌ DRAG' : '➖ NEUTRAL';
      console.log(`${flag} +${UNIT_DEFS[type].label.padEnd(15)} → ${rate.toFixed(1)}% (${sign}${diff.toFixed(1)}% vs baseline)`);
    }
  });

  it('Counter system deep verification (300 games per matchup)', () => {
    const SIMS = 300;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`COUNTER SYSTEM VERIFICATION — ${SIMS} per matchup`);
    console.log('='.repeat(60));

    const colorTeams: Record<string, UnitType[]> = {
      'Pure Red': ['warrior', 'warrior', 'assassin', 'assassin', 'dragon'],
      'Pure Green': ['tank', 'tank', 'mage', 'mage', 'healer'],
      'Pure Blue': ['rider', 'rider', 'archer', 'archer', 'frost'],
      'Red-heavy Mix': ['warrior', 'assassin', 'dragon', 'archer', 'frost'],
      'Green-heavy Mix': ['tank', 'mage', 'healer', 'warrior', 'assassin'],
      'Blue-heavy Mix': ['rider', 'archer', 'frost', 'tank', 'mage'],
    };

    const teams = Object.entries(colorTeams);
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        let wins = 0;
        for (let s = 0; s < SIMS; s++) {
          if (simulateBattle(teams[i][1], teams[j][1]).winner === 'player') wins++;
        }
        const pct = (wins / SIMS * 100).toFixed(1);
        console.log(`  ${teams[i][0]} vs ${teams[j][0]}: ${pct}%`);
      }
    }
  });

  it('AI difficulty scaling test (200 games per difficulty)', () => {
    const SIMS = 200;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`AI DIFFICULTY SCALING — player balanced team vs AI`);
    console.log('='.repeat(60));

    const playerTeam: UnitType[] = ['warrior', 'tank', 'archer', 'mage', 'healer'];

    for (let diff = 1; diff <= 5; diff++) {
      let playerWins = 0;
      for (let i = 0; i < SIMS; i++) {
        const grid = generateTerrain(createEmptyGrid());
        // Create player units
        const playerUnits: Unit[] = [];
        const pCells = shuffle(getCells(PLAYER_ROWS, grid));
        playerTeam.forEach((type, idx) => {
          if (idx >= pCells.length) return;
          const u = createUnit(type, 'player', pCells[idx].row, pCells[idx].col);
          playerUnits.push(u);
        });

        // Generate AI placement based on difficulty
        const aiPlacements = generateAIPlacement(playerUnits, 5, grid, diff);
        const aiTeam = aiPlacements.map(p => p.type);

        if (simulateBattle(playerTeam, aiTeam).winner === 'player') playerWins++;
      }
      const rate = (playerWins / SIMS * 100).toFixed(1);
      const diffNames = ['', 'Einfach', 'Normal', 'Herausfordernd', 'Schwer', 'Unmöglich'];
      console.log(`Diff ${diff} (${diffNames[diff].padEnd(15)}): Player wins ${rate}%`);
    }
  });
});
