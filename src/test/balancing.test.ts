/**
 * Balancing Simulation
 * Simulates thousands of battles with different team compositions
 * to find overpowered (OP) or underpowered combinations.
 */
import { describe, it, expect } from 'vitest';
import {
  UnitType, Unit, Cell, UNIT_DEFS, UNIT_TYPES, GRID_SIZE,
  createEmptyGrid, createUnit, findTarget, moveToward, canAttack, calcDamage,
  generateTerrain, PLAYER_ROWS, ENEMY_ROWS,
} from '@/lib/battleGame';

// --- Headless battle simulation ---

function simulateBattle(playerTeam: UnitType[], enemyTeam: UnitType[]): 'player' | 'enemy' | 'draw' {
  const grid = generateTerrain(createEmptyGrid());
  const allUnits: Unit[] = [];

  // Place player units spread across player rows
  const pCells = shuffle(getCells(PLAYER_ROWS));
  playerTeam.forEach((type, i) => {
    const { row, col } = pCells[i];
    const u = createUnit(type, 'player', row, col);
    grid[row][col].unit = u;
    allUnits.push(u);
  });

  // Place enemy units spread across enemy rows
  const eCells = shuffle(getCells(ENEMY_ROWS));
  enemyTeam.forEach((type, i) => {
    const { row, col } = eCells[i];
    const u = createUnit(type, 'enemy', row, col);
    grid[row][col].unit = u;
    allUnits.push(u);
  });

  // Run up to 100 ticks
  for (let tick = 0; tick < 100; tick++) {
    const alive = allUnits.filter(u => u.hp > 0);
    const pAlive = alive.filter(u => u.team === 'player');
    const eAlive = alive.filter(u => u.team === 'enemy');

    if (eAlive.length === 0) return 'player';
    if (pAlive.length === 0) return 'enemy';

    const acting = alive.sort((a, b) => a.maxCooldown - b.maxCooldown);

    for (const unit of acting) {
      if (unit.hp <= 0) continue;

      // Frozen
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
          // Move toward injured ally
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

  return 'draw';
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

function getCells(rows: number[]): { row: number; col: number }[] {
  const cells: { row: number; col: number }[] = [];
  for (const row of rows) {
    for (let col = 0; col < GRID_SIZE; col++) {
      cells.push({ row, col });
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

// --- Test: All mono compositions (5 of the same unit) vs each other ---

describe('Balancing Simulation', () => {
  const SIMS_PER_MATCHUP = 200;
  const TEAM_SIZE = 5;

  it('Mono-compositions: 5x same unit vs 5x same unit', () => {
    const results: Record<string, Record<string, { wins: number; losses: number; draws: number }>> = {};

    for (const attacker of UNIT_TYPES) {
      results[attacker] = {};
      for (const defender of UNIT_TYPES) {
        let wins = 0, losses = 0, draws = 0;
        const aTeam = Array(TEAM_SIZE).fill(attacker) as UnitType[];
        const dTeam = Array(TEAM_SIZE).fill(defender) as UnitType[];

        for (let i = 0; i < SIMS_PER_MATCHUP; i++) {
          const result = simulateBattle(aTeam, dTeam);
          if (result === 'player') wins++;
          else if (result === 'enemy') losses++;
          else draws++;
        }
        results[attacker][defender] = { wins, losses, draws };
      }
    }

    // Print matchup table
    console.log('\n=== MONO MATCHUP TABLE (Win% as attacker) ===');
    const header = ['          ', ...UNIT_TYPES.map(t => UNIT_DEFS[t].label.padEnd(12))].join('');
    console.log(header);

    for (const a of UNIT_TYPES) {
      const row = UNIT_DEFS[a].label.padEnd(12) + UNIT_TYPES.map(d => {
        const r = results[a][d];
        const winRate = Math.round((r.wins / SIMS_PER_MATCHUP) * 100);
        return `${winRate}%`.padEnd(12);
      }).join('');
      console.log(row);
    }

    // Overall win rate per unit type
    console.log('\n=== OVERALL WIN RATE (avg across all matchups) ===');
    const overallRates: { type: UnitType; rate: number }[] = [];
    for (const a of UNIT_TYPES) {
      let totalWins = 0;
      for (const d of UNIT_TYPES) {
        totalWins += results[a][d].wins;
      }
      const avgRate = totalWins / (UNIT_TYPES.length * SIMS_PER_MATCHUP) * 100;
      overallRates.push({ type: a, rate: avgRate });
      console.log(`${UNIT_DEFS[a].emoji} ${UNIT_DEFS[a].label.padEnd(15)} ${avgRate.toFixed(1)}%`);
    }

    // Flag OP or weak units
    console.log('\n=== BALANCE FLAGS ===');
    for (const { type, rate } of overallRates) {
      if (rate > 65) console.log(`⚠️ OVERPOWERED: ${UNIT_DEFS[type].label} (${rate.toFixed(1)}%)`);
      else if (rate < 35) console.log(`⚠️ UNDERPOWERED: ${UNIT_DEFS[type].label} (${rate.toFixed(1)}%)`);
      else console.log(`✅ OK: ${UNIT_DEFS[type].label} (${rate.toFixed(1)}%)`);
    }

    expect(true).toBe(true); // Always passes, we just want the output
  });

  it('Mixed compositions: popular strategies vs random', () => {
    const strategies: { name: string; team: UnitType[] }[] = [
      { name: '3 Reiter + 2 Schamane', team: ['rider', 'rider', 'rider', 'healer', 'healer'] },
      { name: '3 Krieger + 2 Schildträger', team: ['warrior', 'warrior', 'warrior', 'tank', 'tank'] },
      { name: '2 Drache + 2 Magier + 1 Schamane', team: ['dragon', 'dragon', 'mage', 'mage', 'healer'] },
      { name: '3 Bogenschütze + 2 Frostmagier', team: ['archer', 'archer', 'archer', 'frost', 'frost'] },
      { name: '5 Assassinen', team: ['assassin', 'assassin', 'assassin', 'assassin', 'assassin'] },
      { name: '2 Schildträger + 2 Magier + 1 Schamane', team: ['tank', 'tank', 'mage', 'mage', 'healer'] },
      { name: '1 jede Farbe gemischt', team: ['warrior', 'tank', 'rider', 'mage', 'archer'] },
      { name: '3 Drache + 2 Frostmagier', team: ['dragon', 'dragon', 'dragon', 'frost', 'frost'] },
      { name: '2 Reiter + 2 Assassine + 1 Schamane', team: ['rider', 'rider', 'assassin', 'assassin', 'healer'] },
      { name: '3 Schildträger + 2 Bogenschütze', team: ['tank', 'tank', 'tank', 'archer', 'archer'] },
    ];

    const SIMS = 300;
    console.log('\n=== STRATEGY MATCHUPS (each vs every other) ===');

    const stratWins: Record<string, number> = {};
    const stratGames: Record<string, number> = {};

    for (const s of strategies) {
      stratWins[s.name] = 0;
      stratGames[s.name] = 0;
    }

    for (let i = 0; i < strategies.length; i++) {
      for (let j = i + 1; j < strategies.length; j++) {
        const a = strategies[i];
        const b = strategies[j];
        let aWins = 0, bWins = 0;

        for (let s = 0; s < SIMS; s++) {
          const result = simulateBattle(a.team, b.team);
          if (result === 'player') aWins++;
          else if (result === 'enemy') bWins++;
        }

        stratWins[a.name] += aWins;
        stratWins[b.name] += bWins;
        stratGames[a.name] += SIMS;
        stratGames[b.name] += SIMS;

        const aRate = Math.round(aWins / SIMS * 100);
        console.log(`${a.name} vs ${b.name}: ${aRate}% - ${100 - aRate}%`);
      }
    }

    console.log('\n=== STRATEGY RANKING (overall win rate) ===');
    const ranked = strategies.map(s => ({
      name: s.name,
      rate: stratGames[s.name] > 0 ? (stratWins[s.name] / stratGames[s.name] * 100) : 0
    })).sort((a, b) => b.rate - a.rate);

    for (const { name, rate } of ranked) {
      const flag = rate > 70 ? '⚠️ OP' : rate < 30 ? '⚠️ WEAK' : '✅';
      console.log(`${flag} ${name}: ${rate.toFixed(1)}%`);
    }

    expect(true).toBe(true);
  });
});
