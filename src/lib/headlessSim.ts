// Headless battle simulator with full effect fidelity.
// Mirrors the battleTick() loop from useBattleGame.ts but without any React state,
// rendering, refs or animation pipeline. Used by the Simulator page to crunch
// thousands of matches and produce balance analytics.

import {
  UnitType, Unit, Cell, ColorGroup, UNIT_TYPES, UNIT_DEFS, UNIT_COLOR_GROUPS,
  GRID_SIZE, PLAYER_ROWS, ENEMY_ROWS,
  createEmptyGrid, generateTerrain, createUnit, setBondsForPlacement,
  findTarget, moveToward, canAttack, calcDamage, moveTankFormation,
  effectiveCooldown, isImmuneToFire, isImmuneToFreeze, shouldSkipMove,
  leaveArsonistTrail, handleTerrainSeeker,
  processLavaTick, processGhostTick, tickPhantomTimers, tickClonerSpawns,
  tickMageImpulse, tickMagnetPull, tickFrostNova, tickRiderHorn,
  tickArcherVolley, tickDragonSpin, tickTerrainHeals,
  tickObeliskAura, tickBomberActions, tickBombFuses, tickShadowpriestHarvest,
  applyPostAttackEffects, applyDeathEffects, applyMirrorReflect, applyChainAttack,
  applyShadowpriestCurse, handleShadowbladeTick,
} from '@/lib/battleGame';
import type { BattleEvent } from '@/lib/battleEvents';

const MAX_TICKS = 80;

export interface UnitStat {
  type: UnitType;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  healingGiven: number;
  survivedHpPctSum: number; // accumulator → divide by games for avg
  ticksAlive: number;
}

export interface PairStat {
  a: UnitType;
  b: UnitType;
  // Same team
  withGames: number;
  withWins: number;
  // Opposing teams (a on side1, b on side2)
  vsGames: number;
  vsWins: number; // a's wins
}

export interface SimReport {
  battles: number;
  ticksTotal: number;
  draws: number;
  durationMs: number;
  perUnit: Record<UnitType, UnitStat>;
  // Matchup matrix: matrix[a][b] = win rate (%) of a's team when b is on opposing team
  vsMatrix: Record<UnitType, Record<UnitType, { games: number; wins: number }>>;
  // Synergy matrix: synergy[a][b] = win rate when a & b on same team (a !== b)
  synergyMatrix: Record<UnitType, Record<UnitType, { games: number; wins: number }>>;
}

function emptyUnitStat(type: UnitType): UnitStat {
  return {
    type, games: 0, wins: 0, draws: 0, losses: 0,
    kills: 0, deaths: 0,
    damageDealt: 0, damageTaken: 0, healingGiven: 0,
    survivedHpPctSum: 0, ticksAlive: 0,
  };
}

function emptyReport(): SimReport {
  const perUnit = {} as Record<UnitType, UnitStat>;
  const vsMatrix = {} as Record<UnitType, Record<UnitType, { games: number; wins: number }>>;
  const synergyMatrix = {} as Record<UnitType, Record<UnitType, { games: number; wins: number }>>;
  for (const t of UNIT_TYPES) {
    perUnit[t] = emptyUnitStat(t);
    vsMatrix[t] = {} as Record<UnitType, { games: number; wins: number }>;
    synergyMatrix[t] = {} as Record<UnitType, { games: number; wins: number }>;
    for (const u of UNIT_TYPES) {
      vsMatrix[t][u] = { games: 0, wins: 0 };
      synergyMatrix[t][u] = { games: 0, wins: 0 };
    }
  }
  return { battles: 0, ticksTotal: 0, draws: 0, durationMs: 0, perUnit, vsMatrix, synergyMatrix };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickN<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, Math.min(n, arr.length));
}

function getOpenCells(rows: number[], grid: Cell[][]): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  for (const r of rows) for (let c = 0; c < GRID_SIZE; c++) {
    if (!grid[r][c].unit && grid[r][c].terrain !== 'water') out.push({ row: r, col: c });
  }
  return out;
}

export type TeamMode = 'random' | 'pure' | 'roster';

export interface SimOptions {
  teamSize?: number;          // units actually placed on the board (default 5)
  rosterSize?: number;        // roster pool per side, drawn WITH replacement (default 9)
  mode?: TeamMode;
  rosterP1?: UnitType[];
  rosterP2?: UnitType[];
  pureType?: UnitType;
  /** Guarantee at least one mono-vs-random battle per unit type at the start. */
  monoSweep?: boolean;
  onProgress?: (done: number, total: number) => void;
  yieldEvery?: number;
}

// Draw a roster WITH replacement → matches the in-game picker where the
// same unit can be chosen multiple times (e.g. 3 archers in a 9-slot roster).
function drawRoster(n: number): UnitType[] {
  const out: UnitType[] = [];
  for (let i = 0; i < n; i++) out.push(UNIT_TYPES[Math.floor(Math.random() * UNIT_TYPES.length)]);
  return out;
}

// Pick `k` of the roster slots (without re-using a slot), so duplicates in the
// roster naturally propagate to the placed team.
function pickFromRoster(roster: UnitType[], k: number): UnitType[] {
  const idx = shuffle(roster.map((_, i) => i)).slice(0, Math.min(k, roster.length));
  return idx.map(i => roster[i]);
}

function buildTeams(opts: SimOptions): { p1: UnitType[]; p2: UnitType[] } {
  const n = opts.teamSize ?? 5;
  const rSize = opts.rosterSize ?? 9;
  const mode = opts.mode ?? 'random';
  if (mode === 'pure' && opts.pureType) {
    return { p1: Array.from({ length: n }, () => opts.pureType!), p2: pickFromRoster(drawRoster(rSize), n) };
  }
  if (mode === 'roster' && opts.rosterP1 && opts.rosterP2) {
    return { p1: pickFromRoster(opts.rosterP1, n), p2: pickFromRoster(opts.rosterP2, n) };
  }
  return { p1: pickFromRoster(drawRoster(rSize), n), p2: pickFromRoster(drawRoster(rSize), n) };
}

interface BattleResult {
  winner: 'player' | 'enemy' | 'draw';
  ticks: number;
  // per-unit-id stats for this battle (mapped back to type for aggregation)
  unitMeta: { id: string; type: UnitType; team: 'player' | 'enemy' }[];
  perId: Record<string, {
    kills: number; damageDealt: number; damageTaken: number; healingGiven: number;
    survivedHpPct: number; died: boolean;
  }>;
  finalAlive: { player: Unit[]; enemy: Unit[] };
}

// ============== The full headless tick loop ==============
function simulateOneBattle(p1Types: UnitType[], p2Types: UnitType[]): BattleResult {
  const grid = generateTerrain(createEmptyGrid());
  const colorOf = (i: number): ColorGroup => (i < 3 ? 'red' : i < 6 ? 'green' : 'blue');

  const place = (types: UnitType[], team: 'player' | 'enemy', rows: number[]) => {
    const cells = shuffle(getOpenCells(rows, grid));
    const units: Unit[] = [];
    types.forEach((t, i) => {
      if (i >= cells.length) return;
      const { row, col } = cells[i];
      const u = createUnit(t, team, row, col, colorOf(i), i);
      grid[row][col].unit = u;
      units.push(u);
    });
    return units;
  };

  const pUnits = place(p1Types, 'player', PLAYER_ROWS);
  const eUnits = place(p2Types, 'enemy', ENEMY_ROWS);
  setBondsForPlacement([...pUnits, ...eUnits]);

  // Per-id stats accumulator (covers original placed units; clones/phantoms still get the kill credit via attacker id mapping below)
  const allUnitsIdx = new Map<string, { type: UnitType; team: 'player' | 'enemy' }>();
  for (const u of [...pUnits, ...eUnits]) allUnitsIdx.set(u.id, { type: u.type, team: u.team });
  const perId: BattleResult['perId'] = {};
  const ensureStats = (id: string) => {
    if (!perId[id]) perId[id] = { kills: 0, damageDealt: 0, damageTaken: 0, healingGiven: 0, survivedHpPct: 0, died: false };
    return perId[id];
  };
  for (const u of [...pUnits, ...eUnits]) ensureStats(u.id);

  let turn = 0;
  let winner: 'player' | 'enemy' | 'draw' = 'draw';

  for (turn = 0; turn < MAX_TICKS; turn++) {
    const allUnits: Unit[] = [];
    for (const row of grid) for (const cell of row) {
      if (cell.unit && cell.unit.hp > 0 && !cell.unit.dead) allUnits.push(cell.unit);
    }
    const pAlive = allUnits.filter(u => u.team === 'player' && !u.isClone);
    const eAlive = allUnits.filter(u => u.team === 'enemy' && !u.isClone);
    if (eAlive.length === 0 && pAlive.length === 0) { winner = 'draw'; break; }
    if (eAlive.length === 0) { winner = 'player'; break; }
    if (pAlive.length === 0) { winner = 'enemy'; break; }

    const events: BattleEvent[] = [];
    const logs: string[] = [];

    // === DoTs ===
    for (const u of allUnits) {
      if (!u.burning || u.burning.length === 0 || u.hp <= 0) continue;
      if (isImmuneToFire(u, grid)) { u.burning = []; continue; }
      let total = 0;
      u.burning = u.burning.filter(b => { total += b.dmg; b.turns -= 1; return b.turns > 0; });
      if (total > 0) {
        u.hp = Math.max(0, u.hp - total);
        const s = ensureStats(u.id); s.damageTaken += total;
        if (u.hp <= 0) { (u as { dead?: boolean }).dead = true; s.died = true; }
      }
    }
    for (const u of allUnits) {
      if (!u.bleeding || u.bleeding.length === 0 || u.hp <= 0 || u.dead) continue;
      const t = u.bleeding.shift()!;
      if (t > 0) {
        u.hp = Math.max(0, u.hp - t);
        const s = ensureStats(u.id); s.damageTaken += t;
        if (u.hp <= 0) { (u as { dead?: boolean }).dead = true; s.died = true; }
      }
      if (u.bleeding.length === 0) u.bleeding = undefined;
    }

    // === Field / global ticks (full fidelity) ===
    processLavaTick(grid, logs);
    processGhostTick(allUnits, grid, logs);
    tickPhantomTimers(allUnits, grid, logs);
    tickClonerSpawns(allUnits, grid, logs);
    tickMageImpulse(allUnits, grid, events, logs);
    tickMagnetPull(allUnits, grid, events, logs);
    tickFrostNova(allUnits, grid, events, logs);
    tickRiderHorn(allUnits, grid, events, logs);
    tickArcherVolley(allUnits, grid, events, logs);
    tickDragonSpin(allUnits, grid, events, logs);
    tickTerrainHeals(allUnits, grid, logs);
    tickObeliskAura(allUnits, grid, events, logs);
    tickBomberActions(allUnits, grid, events, logs);
    tickBombFuses(grid, allUnits, events, logs);
    tickShadowpriestHarvest(allUnits, grid, logs);

    // Per-unit acting loop (sorted by maxCooldown like real game)
    const acting = allUnits
      .filter(u => {
        if (u.hp <= 0) return false;
        if (u.activationTurn !== undefined && turn < u.activationTurn) return false;
        return true;
      })
      .sort((a, b) => a.maxCooldown - b.maxCooldown);

    for (const unit of acting) {
      if (unit.hp <= 0) continue;
      if (unit.type === 'dragon' && (unit.spinTicksLeft ?? 0) > 0) continue;
      if (unit.type === 'doppelganger' && !unit.isPhantom && unit.phantomId) {
        if (allUnits.some(u => u.id === unit.phantomId && !u.dead && u.hp > 0)) continue;
      }
      if (unit.webbed && unit.webbed > 0) { unit.webbed -= 1; continue; }

      const isFrozenNow = !!(unit.frozen && unit.frozen > 0);
      const frozenMul = unit.frozenDmgMul ?? 0.5;
      if (isFrozenNow) {
        unit.frozen = (unit.frozen || 0) - 1;
        if ((unit.frozen || 0) <= 0) unit.frozenDmgMul = undefined;
      }
      unit.cooldown = Math.max(0, unit.cooldown - 1);

      // Terrain seekers
      let seekerHolds = false;
      if (!isFrozenNow) {
        const seek = handleTerrainSeeker(unit, grid, allUnits);
        if (seek === 'moved' || seek === 'wait') continue;
        if (seek === 'on_terrain') seekerHolds = true;
      }

      // Shadowblade custom teleport-strike
      if (unit.type === 'shadowblade' && !isFrozenNow) {
        handleShadowbladeTick(unit, allUnits, grid, events, logs, (_atk, _tgt, dmg) => dmg);
        continue;
      }

      // Healer behaviour
      if (unit.type === 'healer') {
        const allies = allUnits.filter(u => u.team === unit.team && u.id !== unit.id && u.hp > 0 && !u.dead);
        const healable = allies.filter(a => a.hp < a.maxHp && !a.unhealable);
        if (healable.length > 0 && unit.cooldown <= 0) {
          let healed = false;
          for (const ally of healable) {
            if (canAttack(unit, ally)) {
              const amt = Math.min(28, ally.maxHp - ally.hp);
              ally.hp += amt;
              ensureStats(unit.id).healingGiven += amt;
              unit.cooldown = unit.maxCooldown;
              healed = true;
              break;
            }
          }
          if (!healed) {
            healable.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
            const newPos = moveToward(unit, healable[0], grid, allUnits);
            if (newPos.row !== unit.row || newPos.col !== unit.col) {
              grid[unit.row][unit.col].unit = null;
              unit.row = newPos.row; unit.col = newPos.col;
              grid[unit.row][unit.col].unit = unit;
            }
          }
          continue;
        }
      }

      const target = findTarget(unit, allUnits);
      if (!target) continue;

      if (!canAttack(unit, target)) {
        unit.stuckTurns = (unit.stuckTurns || 0) + 1;
        const skipMove = isFrozenNow || seekerHolds || shouldSkipMove(unit);
        const newPos = skipMove ? { row: unit.row, col: unit.col } : moveToward(unit, target, grid, allUnits);
        if (newPos.row !== unit.row || newPos.col !== unit.col) {
          if (unit.type === 'tank') moveTankFormation(unit, newPos, grid, allUnits);
          leaveArsonistTrail(grid, unit);
          grid[unit.row][unit.col].unit = null;
          unit.row = newPos.row; unit.col = newPos.col;
          grid[unit.row][unit.col].unit = unit;
        }
      } else {
        unit.stuckTurns = 0;
        if (!isFrozenNow && !seekerHolds) {
          const kite = moveToward(unit, target, grid, allUnits);
          if (kite.row !== unit.row || kite.col !== unit.col) {
            if (unit.type === 'tank') moveTankFormation(unit, kite, grid, allUnits);
            leaveArsonistTrail(grid, unit);
            grid[unit.row][unit.col].unit = null;
            unit.row = kite.row; unit.col = kite.col;
            grid[unit.row][unit.col].unit = unit;
          }
        }
      }

      if (canAttack(unit, target) && unit.cooldown <= 0) {
        if (target.isPhantom && (target.phantom ?? 0) > 0) {
          unit.cooldown = effectiveCooldown(unit, grid);
          continue;
        }
        let dmg = calcDamage(unit, target, grid);
        if (isFrozenNow) dmg = Math.round(dmg * frozenMul);

        const beforeHp = target.hp;
        target.hp = Math.max(0, target.hp - dmg);
        const dealt = beforeHp - target.hp;
        ensureStats(unit.id).damageDealt += dealt;
        ensureStats(target.id).damageTaken += dealt;

        if (dmg > 0 && (unit.type === 'ranger' || unit.type === 'mountaineer' || unit.type === 'waterwalker')) {
          unit.seekerIdleTicks = 0;
        }
        unit.cooldown = effectiveCooldown(unit, grid);
        unit.lastAttackedId = target.id;

        if (unit.type === 'shadowpriest' && target.hp > 0) {
          applyShadowpriestCurse(unit, target, logs, events);
        }

        if (unit.type === 'frost' && target.hp > 0 && Math.random() < 0.5 && !isImmuneToFreeze(target, grid)) {
          target.frozen = 3;
          target.frozenDmgMul = 0.5;
        }

        if (unit.type === 'vampire' && dmg > 0) {
          const heal = Math.round(dmg * 0.3);
          const before = unit.hp;
          unit.hp = Math.min(unit.maxHp, unit.hp + heal);
          ensureStats(unit.id).healingGiven += unit.hp - before;
          if (target.hp > 0) target.bleeding = [10, 5, 3, 1];
        }
        if (unit.type === 'arsonist' && target.hp > 0 && !isImmuneToFire(target, grid)) {
          target.burning = [...(target.burning || []), { dmg: 5, turns: 4 }];
        }

        // Lightning chain
        if (unit.type === 'lightning') {
          const hopMults = [0.5, 0.4, 0.3, 0.2, 0.1];
          const hit = new Set<string>([target.id]);
          let current = { row: target.row, col: target.col };
          for (const mult of hopMults) {
            let best: { u: Unit; dist: number } | null = null;
            for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
              if (dr === 0 && dc === 0) continue;
              const ar = current.row + dr, ac = current.col + dc;
              if (ar < 0 || ar >= GRID_SIZE || ac < 0 || ac >= GRID_SIZE) continue;
              const cu = grid[ar][ac].unit;
              if (!cu || cu.hp <= 0 || cu.dead || cu.team === unit.team || hit.has(cu.id)) continue;
              if (cu.isPhantom && (cu.phantom ?? 0) > 0) continue;
              const d = Math.max(Math.abs(dr), Math.abs(dc));
              if (!best || d < best.dist) best = { u: cu, dist: d };
            }
            if (!best) break;
            const cu = best.u;
            const chainDmg = Math.max(1, Math.round(dmg * mult));
            const cb = cu.hp;
            cu.hp = Math.max(0, cu.hp - chainDmg);
            const realDmg = cb - cu.hp;
            ensureStats(unit.id).damageDealt += realDmg;
            ensureStats(cu.id).damageTaken += realDmg;
            if (cu.hp <= 0) { (cu as { dead?: boolean }).dead = true; ensureStats(cu.id).died = true; ensureStats(unit.id).kills += 1; }
            hit.add(cu.id);
            applyMirrorReflect(unit, cu, chainDmg, logs);
            current = { row: cu.row, col: cu.col };
          }
        }

        if (unit.type === 'chaindancer') {
          applyChainAttack(unit, target, dmg, grid, logs);
        }

        // Dragon splash
        if (unit.type === 'dragon') {
          const splashDmg = Math.round(dmg * 0.3);
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            const ar = unit.row + dr, ac = unit.col + dc;
            if (ar < 0 || ar >= GRID_SIZE || ac < 0 || ac >= GRID_SIZE) continue;
            const cu = grid[ar][ac].unit;
            if (cu && cu.hp > 0 && !cu.dead && cu.team !== unit.team && cu.id !== target.id) {
              const before = cu.hp;
              cu.hp = Math.max(0, cu.hp - splashDmg);
              const d = before - cu.hp;
              ensureStats(unit.id).damageDealt += d;
              ensureStats(cu.id).damageTaken += d;
              if (cu.hp <= 0) {
                (cu as { dead?: boolean }).dead = true;
                ensureStats(cu.id).died = true;
                ensureStats(unit.id).kills += 1;
              }
            }
          }
        }

        if (target.hp <= 0) {
          ensureStats(unit.id).kills += 1;
          ensureStats(target.id).died = true;
          const stillAlive = applyDeathEffects(target, allUnits, grid, logs, events);
          if (!stillAlive) (target as { dead?: boolean }).dead = true;
        }
        applyPostAttackEffects(unit, target, dmg, grid, logs);
        if (unit.hp <= 0) {
          ensureStats(unit.id).died = true;
          const stillAlive = applyDeathEffects(unit, allUnits, grid, logs, events);
          if (!stillAlive) (unit as { dead?: boolean }).dead = true;
        }
      }
    }

    // Judge bonus
    for (const u of allUnits) {
      if (u.type !== 'judge' || u.hp <= 0) continue;
      const fallen = allUnits.filter(a => a.team === u.team && a.dead && a.id !== u.id).length;
      u.judgeBonus = Math.max(u.judgeBonus || 0, fallen * 8);
    }

    // Tick "alive" credit
    for (const u of allUnits) {
      if (u.hp > 0) {
        const s = ensureStats(u.id);
        // accumulator (will be overwritten by final survived check at the end)
        s.survivedHpPct = u.hp / Math.max(1, u.maxHp);
      }
    }
  }

  // Final alive accounting
  const finalAlive = { player: [] as Unit[], enemy: [] as Unit[] };
  for (const row of grid) for (const cell of row) {
    if (cell.unit && cell.unit.hp > 0 && !cell.unit.dead && !cell.unit.isClone) {
      if (cell.unit.team === 'player') finalAlive.player.push(cell.unit);
      else finalAlive.enemy.push(cell.unit);
    }
  }
  if (turn >= MAX_TICKS) {
    if (finalAlive.player.length > finalAlive.enemy.length) winner = 'player';
    else if (finalAlive.enemy.length > finalAlive.player.length) winner = 'enemy';
    else winner = 'draw';
  }

  // Mark survived HP% for units still standing (and 0 for dead originals)
  for (const [id, meta] of allUnitsIdx) {
    const stats = ensureStats(id);
    const alive = [...finalAlive.player, ...finalAlive.enemy].find(u => u.id === id);
    stats.survivedHpPct = alive ? alive.hp / Math.max(1, alive.maxHp) : 0;
    if (!alive) stats.died = true;
    void meta;
  }

  const unitMeta = Array.from(allUnitsIdx.entries()).map(([id, meta]) => ({ id, type: meta.type, team: meta.team }));
  return { winner, ticks: turn + 1, unitMeta, perId, finalAlive };
}

// ============== Public API ==============
export async function runSimulation(battlesTotal: number, opts: SimOptions = {}): Promise<SimReport> {
  const report = emptyReport();
  const t0 = performance.now();
  const yieldEvery = opts.yieldEvery ?? 50;

  const monoSweep = opts.monoSweep ?? true;
  const rSize = opts.rosterSize ?? 9;
  const n = opts.teamSize ?? 5;
  // Build the mono-sweep queue: one mono-vs-random battle per unit type at the start.
  const monoQueue: UnitType[] = monoSweep ? [...UNIT_TYPES] : [];

  for (let i = 0; i < battlesTotal; i++) {
    let p1: UnitType[]; let p2: UnitType[];
    if (monoQueue.length > 0 && (opts.mode ?? 'random') === 'random') {
      const t = monoQueue.shift()!;
      // Alternate which side runs mono so both 'player' and 'enemy' sample positions get hit.
      const enemyRoster = pickFromRoster(drawRoster(rSize), n);
      if (i % 2 === 0) { p1 = Array.from({ length: n }, () => t); p2 = enemyRoster; }
      else { p1 = enemyRoster; p2 = Array.from({ length: n }, () => t); }
    } else {
      const built = buildTeams(opts);
      p1 = built.p1; p2 = built.p2;
    }
    let result: BattleResult;
    try {
      result = simulateOneBattle(p1, p2);
    } catch (err) {
      console.warn('[headlessSim] battle failed, skipping', err);
      continue;
    }

    report.battles += 1;
    report.ticksTotal += result.ticks;
    if (result.winner === 'draw') report.draws += 1;

    // Per-unit-type aggregation
    const p1Types = new Set<UnitType>();
    const p2Types = new Set<UnitType>();
    for (const m of result.unitMeta) {
      if (m.team === 'player') p1Types.add(m.type);
      else p2Types.add(m.type);
    }

    for (const m of result.unitMeta) {
      const s = report.perUnit[m.type];
      const r = result.perId[m.id];
      if (!r) continue;
      s.games += 1;
      if (result.winner === 'draw') s.draws += 1;
      else if ((result.winner === 'player' && m.team === 'player') || (result.winner === 'enemy' && m.team === 'enemy')) s.wins += 1;
      else s.losses += 1;
      s.kills += r.kills;
      if (r.died) s.deaths += 1;
      s.damageDealt += r.damageDealt;
      s.damageTaken += r.damageTaken;
      s.healingGiven += r.healingGiven;
      s.survivedHpPctSum += r.survivedHpPct;
    }

    // vs-matrix (a from p1, b from p2)
    for (const a of p1Types) for (const b of p2Types) {
      report.vsMatrix[a][b].games += 1;
      if (result.winner === 'player') report.vsMatrix[a][b].wins += 1;
      report.vsMatrix[b][a].games += 1;
      if (result.winner === 'enemy') report.vsMatrix[b][a].wins += 1;
    }
    // Synergy (same team)
    const sym = (set: Set<UnitType>, winning: boolean) => {
      const arr = Array.from(set);
      for (let i = 0; i < arr.length; i++) for (let j = 0; j < arr.length; j++) {
        if (i === j) continue;
        report.synergyMatrix[arr[i]][arr[j]].games += 1;
        if (winning) report.synergyMatrix[arr[i]][arr[j]].wins += 1;
      }
    };
    sym(p1Types, result.winner === 'player');
    sym(p2Types, result.winner === 'enemy');

    if (opts.onProgress && (i % yieldEvery === 0 || i === battlesTotal - 1)) {
      opts.onProgress(i + 1, battlesTotal);
      // Yield to UI so progress bar updates and tab doesn't lock
      await new Promise(r => setTimeout(r, 0));
    }
  }
  report.durationMs = performance.now() - t0;
  return report;
}

// ============== Analytics helpers ==============
export interface RankedUnit {
  type: UnitType;
  label: string;
  emoji: string;
  color: ColorGroup;
  winRate: number;
  games: number;
  kdr: number;
  avgDamageDealt: number;
  avgDamageTaken: number;
  avgHealing: number;
  avgSurvivedHp: number; // 0..1
  opFlag: 'OP' | 'STRONG' | 'BALANCED' | 'WEAK' | 'TRASH';
}

export function rankUnits(report: SimReport): RankedUnit[] {
  const out: RankedUnit[] = [];
  for (const t of UNIT_TYPES) {
    const s = report.perUnit[t];
    if (s.games === 0) continue;
    const winRate = (s.wins / s.games) * 100;
    const kdr = s.deaths === 0 ? s.kills : s.kills / s.deaths;
    const flag: RankedUnit['opFlag'] =
      winRate >= 65 ? 'OP' :
      winRate >= 55 ? 'STRONG' :
      winRate >= 45 ? 'BALANCED' :
      winRate >= 35 ? 'WEAK' : 'TRASH';
    out.push({
      type: t,
      label: UNIT_DEFS[t].label,
      emoji: UNIT_DEFS[t].emoji,
      color: UNIT_COLOR_GROUPS[t],
      winRate,
      games: s.games,
      kdr,
      avgDamageDealt: s.damageDealt / s.games,
      avgDamageTaken: s.damageTaken / s.games,
      avgHealing: s.healingGiven / s.games,
      avgSurvivedHp: s.survivedHpPctSum / s.games,
      opFlag: flag,
    });
  }
  return out.sort((a, b) => b.winRate - a.winRate);
}

export interface MatchupCell { a: UnitType; b: UnitType; games: number; winRate: number }
export function flattenMatchups(report: SimReport, minGames = 10): MatchupCell[] {
  const out: MatchupCell[] = [];
  for (const a of UNIT_TYPES) for (const b of UNIT_TYPES) {
    if (a === b) continue;
    const c = report.vsMatrix[a][b];
    if (c.games < minGames) continue;
    out.push({ a, b, games: c.games, winRate: (c.wins / c.games) * 100 });
  }
  return out;
}

export interface SynergyCell { a: UnitType; b: UnitType; games: number; winRate: number }
export function flattenSynergies(report: SimReport, minGames = 10): SynergyCell[] {
  const seen = new Set<string>();
  const out: SynergyCell[] = [];
  for (const a of UNIT_TYPES) for (const b of UNIT_TYPES) {
    if (a === b) continue;
    const key = [a, b].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const c1 = report.synergyMatrix[a][b];
    const c2 = report.synergyMatrix[b][a];
    const games = c1.games + c2.games;
    if (games < minGames) continue;
    const wins = c1.wins + c2.wins;
    out.push({ a, b, games, winRate: (wins / games) * 100 });
  }
  return out;
}

export function reportToCsv(report: SimReport): string {
  const ranked = rankUnits(report);
  const lines: string[] = [];
  lines.push('# Unit ranking');
  lines.push('type,label,color,winRate%,games,kills,deaths,kdr,avgDmgDealt,avgDmgTaken,avgHealing,avgSurvivedHp%,flag');
  for (const r of ranked) {
    const s = report.perUnit[r.type];
    lines.push([
      r.type, r.label, r.color, r.winRate.toFixed(2), s.games, s.kills, s.deaths,
      r.kdr.toFixed(2), r.avgDamageDealt.toFixed(1), r.avgDamageTaken.toFixed(1),
      r.avgHealing.toFixed(1), (r.avgSurvivedHp * 100).toFixed(1), r.opFlag,
    ].join(','));
  }
  lines.push('');
  lines.push('# Matchups (a-team vs b-team, min 10 games)');
  lines.push('a,b,games,a_winRate%');
  for (const m of flattenMatchups(report, 10).sort((a, b) => b.winRate - a.winRate)) {
    lines.push(`${m.a},${m.b},${m.games},${m.winRate.toFixed(1)}`);
  }
  lines.push('');
  lines.push('# Synergies (a & b same team, min 10 games)');
  lines.push('a,b,games,winRate%');
  for (const s of flattenSynergies(report, 10).sort((x, y) => y.winRate - x.winRate)) {
    lines.push(`${s.a},${s.b},${s.games},${s.winRate.toFixed(1)}`);
  }
  return lines.join('\n');
}
