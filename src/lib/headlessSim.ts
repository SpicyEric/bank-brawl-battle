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
  generateAIPlacement,
} from '@/lib/battleGame';
import { applyAuraStacks, applyAuraTick, applyAuraSourceEffects, applyAuraOnAttack, applyAuraOnDeath, applyDefenderShare } from '@/lib/auraEffects';
import { loadAuraData, ZONE_POSITIONS, ZONE_DELTA, type AuraZoneMap, type AuraEffectMap } from '@/lib/auraData';
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

// Aggregated buff/nerf attribution across the whole simulation.
// Key encodes recipient + source + effectKey + kind so we can find
// "this unit, buffed by THIS unit with THIS effect, has X% winrate."
export interface AuraAttribCell {
  recipient: UnitType;
  source: UnitType;
  effectKey: string;
  kind: 'buff' | 'nerf';
  games: number;          // # battles where recipient had ≥1 stack from this source/effect
  wins: number;           // # of those won by recipient's team
  stacksSum: number;      // sum of max-stacks per battle (→ avg = stacksSum/games)
  recipientSurvSum: number; // sum of recipient final HP% (→ avg)
  recipientDmgSum: number;  // sum of recipient damage dealt (→ avg)
}

export interface BuffPerUnitCell {
  recipient: UnitType;
  effectKey: string;
  kind: 'buff' | 'nerf';
  games: number;
  wins: number;
  stacksSum: number;
  recipientSurvSum: number;
  recipientDmgSum: number;
}

export interface SimReport {
  battles: number;
  ticksTotal: number;
  draws: number;
  durationMs: number;
  perUnit: Record<UnitType, UnitStat>;
  vsMatrix: Record<UnitType, Record<UnitType, { games: number; wins: number }>>;
  synergyMatrix: Record<UnitType, Record<UnitType, { games: number; wins: number }>>;
  // recipient|source|effectKey|kind  →  attribution cell
  auraAttrib: Map<string, AuraAttribCell>;
  // recipient|effectKey|kind  →  per-unit buff cell (collapsed across sources)
  buffPerUnit: Map<string, BuffPerUnitCell>;
  rosterP1?: UnitType[];
  rosterP2?: UnitType[];
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
  return {
    battles: 0, ticksTotal: 0, draws: 0, durationMs: 0,
    perUnit, vsMatrix, synergyMatrix,
    auraAttrib: new Map(), buffPerUnit: new Map(),
  };
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
  rosterSize?: number;        // roster pool per side, drawn WITHOUT replacement (default 9)
  mode?: TeamMode;
  rosterP1?: UnitType[];
  rosterP2?: UnitType[];
  pureType?: UnitType;
  onProgress?: (done: number, total: number) => void;
  yieldEvery?: number;
}

// Draw a roster of `n` UNIQUE units (no duplicates within a roster).
// Mirrors the in-game team builder where each unit can only be picked once.
function drawUniqueRoster(n: number): UnitType[] {
  return shuffle([...UNIT_TYPES]).slice(0, Math.min(n, UNIT_TYPES.length));
}

// Pick `k` units WITH replacement from the roster — so the placed team can
// contain duplicates (e.g. 5x the same unit if RNG hits it).
function pickWithReplacement(roster: UnitType[], k: number): UnitType[] {
  const out: UnitType[] = [];
  for (let i = 0; i < k; i++) out.push(roster[Math.floor(Math.random() * roster.length)]);
  return out;
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
  // For each unit id, the MAX stacks observed for each (sourceType|effectKey|kind)
  // during the whole battle. Used to attribute "who buffed whom" in the report.
  auraSources: Record<string, Map<string, { source: UnitType; effectKey: string; kind: 'buff' | 'nerf'; stacks: number }>>;
}

// Per-tick recorder: walks aura zones (same logic as applyAuraStacks) and pushes
// 1 stack per affected target into `sink`. We then take the per-(target,src,eff)
// MAX across all ticks to get the recipient's peak buff exposure for this battle.
function recordAuraSources(
  units: Unit[],
  zones: AuraZoneMap,
  effects: AuraEffectMap,
  sink: Record<string, Map<string, { source: UnitType; effectKey: string; kind: 'buff' | 'nerf'; stacks: number }>>,
): void {
  // Per-tick scratch: targetId -> key -> stacks-this-tick
  const tick: Record<string, Map<string, { source: UnitType; effectKey: string; kind: 'buff' | 'nerf'; stacks: number }>> = {};
  for (const src of units) {
    if (src.dead || src.hp <= 0) continue;
    const z = zones[src.type as UnitType];
    if (!z) continue;
    const eff = effects[src.type as UnitType];
    if (!eff) continue;
    for (const pos of ZONE_POSITIONS) {
      const kind = z[pos];
      if (!kind) continue;
      const ek = kind === 'buff' ? eff.buff : eff.nerf;
      if (!ek) continue;
      const { dr, dc } = ZONE_DELTA[pos];
      const r = src.row + dr, c = src.col + dc;
      const tgt = units.find(u => u.row === r && u.col === c && u.team === src.team && !u.dead && u.hp > 0);
      if (!tgt) continue;
      const key = `${src.type}|${ek}|${kind}`;
      let m = tick[tgt.id];
      if (!m) { m = new Map(); tick[tgt.id] = m; }
      const cur = m.get(key);
      if (cur) cur.stacks += 1;
      else m.set(key, { source: src.type, effectKey: ek, kind, stacks: 1 });
    }
  }
  // Merge into sink with MAX per key
  for (const [id, m] of Object.entries(tick)) {
    let agg = sink[id];
    if (!agg) { agg = new Map(); sink[id] = agg; }
    for (const [k, v] of m) {
      const prev = agg.get(k);
      if (!prev || v.stacks > prev.stacks) agg.set(k, { ...v });
    }
  }
}

// ============== The full headless tick loop ==============
function simulateOneBattle(
  teamSize: number, difficultyP1: number, difficultyP2: number,
  zones: AuraZoneMap, effects: AuraEffectMap,
): BattleResult {
  const grid = generateTerrain(createEmptyGrid());
  const colorOf = (i: number): ColorGroup => (i < 3 ? 'red' : i < 6 ? 'green' : 'blue');

  // Team 1 placement: use real AI formation builder (auras, tank-bonds, clustering).
  const p1Plan = generateAIPlacement([], teamSize, grid, difficultyP1, []);
  const pUnits: Unit[] = [];
  p1Plan.forEach((p, i) => {
    if (grid[p.row][p.col].unit) return;
    const u = createUnit(p.type, 'player', p.row, p.col, colorOf(i), i);
    grid[p.row][p.col].unit = u;
    pUnits.push(u);
  });

  // Team 2 placement: passes pUnits so AI can counter player's color composition.
  const p2Plan = generateAIPlacement(pUnits, teamSize, grid, difficultyP2, []);
  const eUnits: Unit[] = [];
  p2Plan.forEach((p, i) => {
    if (grid[p.row][p.col].unit) return;
    const u = createUnit(p.type, 'enemy', p.row, p.col, colorOf(i), i);
    grid[p.row][p.col].unit = u;
    eUnits.push(u);
  });

  setBondsForPlacement([...pUnits, ...eUnits]);
  const p1Types = pUnits.map(u => u.type);
  const p2Types = eUnits.map(u => u.type);
  void p1Types; void p2Types;

  // Per-id stats accumulator (covers original placed units; clones/phantoms still get the kill credit via attacker id mapping below)
  const allUnitsIdx = new Map<string, { type: UnitType; team: 'player' | 'enemy' }>();
  for (const u of [...pUnits, ...eUnits]) allUnitsIdx.set(u.id, { type: u.type, team: u.team });
  const perId: BattleResult['perId'] = {};
  const ensureStats = (id: string) => {
    if (!perId[id]) perId[id] = { kills: 0, damageDealt: 0, damageTaken: 0, healingGiven: 0, survivedHpPct: 0, died: false };
    return perId[id];
  };
  for (const u of [...pUnits, ...eUnits]) ensureStats(u.id);

  // Per-battle aura source attribution: targetId -> Map<src|eff|kind, {…, maxStacks}>
  const auraSources: BattleResult['auraSources'] = {};

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

    // === Aura engine: recompute per tick + record per-unit attribution ===
    applyAuraStacks(allUnits, zones, effects);
    applyAuraTick(allUnits, logs);
    applyAuraSourceEffects(allUnits, zones, effects, logs);
    recordAuraSources(allUnits, zones, effects, auraSources);

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
      // Doppelganger original: stays active (no idle gate).
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
        handleShadowbladeTick(unit, allUnits, grid, events, logs, (atk, tgt, dmg) => {
          const applied = Math.min(dmg, tgt.hp);
          if (applied > 0) {
            ensureStats(atk.id).damageDealt += applied;
            ensureStats(tgt.id).damageTaken += applied;
            if (tgt.hp - applied <= 0) {
              ensureStats(tgt.id).died = true;
              ensureStats(atk.id).kills += 1;
            }
          }
          return dmg;
        });
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
        // Phase-3 aura: damage-share / miss-chance / taunt reduction
        dmg = applyDefenderShare(unit, target, dmg, allUnits, logs);

        const beforeHp = target.hp;
        target.hp = Math.max(0, target.hp - dmg);
        const dealt = beforeHp - target.hp;
        ensureStats(unit.id).damageDealt += dealt;
        ensureStats(target.id).damageTaken += dealt;

        // Phase-2 aura on-attack triggers (splash, chain, bleed, fire, freeze, web, reflect, drain, weaken)
        if (dmg > 0) {
          applyAuraOnAttack({ attacker: unit, defender: target, dmg, allUnits, grid, logs, events });
        }

        if (dmg > 0 && unit.type === 'waterwalker') {
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
          target.burning = [...(target.burning || []), { dmg: 3, turns: 4 }];
        }

        // Lightning chain
        if (unit.type === 'lightning') {
          const hopMults = [0.3, 0.2, 0.15, 0.1, 0.05];
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

    // === Aura on-death sweep ===
    for (const u of allUnits) {
      if (u.dead && !(u as { _auraDeathHandled?: boolean })._auraDeathHandled) {
        (u as { _auraDeathHandled?: boolean })._auraDeathHandled = true;
        applyAuraOnDeath(u, allUnits, grid, zones, effects, logs);
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
  return { winner, ticks: turn + 1, unitMeta, perId, finalAlive, auraSources };
}

// ============== Public API ==============
export async function runSimulation(battlesTotal: number, opts: SimOptions = {}): Promise<SimReport> {
  const report = emptyReport();
  const t0 = performance.now();
  const yieldEvery = opts.yieldEvery ?? 50;

  // Always 9v9, AI builds full formations (auras, tank-bonds, clustering) per match.
  const n = opts.teamSize ?? 9;

  // Load aura zones/effects once (admin-managed in unit_types table).
  const { zones, effects } = await loadAuraData();

  for (let i = 0; i < battlesTotal; i++) {
    // Randomized difficulty per match → mix of weak / mid / OP formations.
    const diffP1 = 2 + Math.floor(Math.random() * 4);
    const diffP2 = 2 + Math.floor(Math.random() * 4);

    let result: BattleResult;
    try {
      result = simulateOneBattle(n, diffP1, diffP2, zones, effects);
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
      const won = (result.winner === 'player' && m.team === 'player') || (result.winner === 'enemy' && m.team === 'enemy');
      if (result.winner === 'draw') s.draws += 1;
      else if (won) s.wins += 1;
      else s.losses += 1;
      s.kills += r.kills;
      if (r.died) s.deaths += 1;
      s.damageDealt += r.damageDealt;
      s.damageTaken += r.damageTaken;
      s.healingGiven += r.healingGiven;
      s.survivedHpPctSum += r.survivedHpPct;

      // === Buff/Nerf attribution for this unit instance ===
      const auraMap = result.auraSources[m.id];
      if (auraMap) {
        // Deduplicate per (effectKey,kind) at unit-level (recipient summary):
        const seenPerUnit = new Set<string>();
        for (const { source, effectKey, kind, stacks } of auraMap.values()) {
          // Per (recipient, source, effect, kind) attribution
          const akey = `${m.type}|${source}|${effectKey}|${kind}`;
          let cell = report.auraAttrib.get(akey);
          if (!cell) {
            cell = { recipient: m.type, source, effectKey, kind, games: 0, wins: 0, stacksSum: 0, recipientSurvSum: 0, recipientDmgSum: 0 };
            report.auraAttrib.set(akey, cell);
          }
          cell.games += 1;
          if (won) cell.wins += 1;
          cell.stacksSum += stacks;
          cell.recipientSurvSum += r.survivedHpPct;
          cell.recipientDmgSum += r.damageDealt;

          // Per (recipient, effect, kind) — collapsed across sources
          const bkey = `${m.type}|${effectKey}|${kind}`;
          if (!seenPerUnit.has(bkey)) {
            seenPerUnit.add(bkey);
            let bcell = report.buffPerUnit.get(bkey);
            if (!bcell) {
              bcell = { recipient: m.type, effectKey, kind, games: 0, wins: 0, stacksSum: 0, recipientSurvSum: 0, recipientDmgSum: 0 };
              report.buffPerUnit.set(bkey, bcell);
            }
            bcell.games += 1;
            if (won) bcell.wins += 1;
            bcell.stacksSum += stacks;
            bcell.recipientSurvSum += r.survivedHpPct;
            bcell.recipientDmgSum += r.damageDealt;
          }
        }
      }
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

  lines.push('');
  lines.push('# Aura-Effekt pro Einheit (Empfänger × Effekt, min 5 games)');
  lines.push('recipient,kind,effectKey,games,wins,winRate%,avgStacks,avgSurvivedHp%,avgDmgDealt');
  for (const b of flattenBuffPerUnit(report, 5).sort((a, b) => b.winRate - a.winRate)) {
    lines.push([b.recipient, b.kind, b.effectKey, b.games, b.wins, b.winRate.toFixed(1),
      b.avgStacks.toFixed(2), (b.avgSurvivedHp * 100).toFixed(1), b.avgDmgDealt.toFixed(1)].join(','));
  }

  lines.push('');
  lines.push('# Buff/Nerf-Quellen (Quelle → Empfänger × Effekt, min 5 games)');
  lines.push('source,kind,effectKey,recipient,games,wins,winRate%,avgStacks');
  for (const a of flattenAuraAttrib(report, 5).sort((a, b) => b.winRate - a.winRate)) {
    lines.push([a.source, a.kind, a.effectKey, a.recipient, a.games, a.wins,
      a.winRate.toFixed(1), a.avgStacks.toFixed(2)].join(','));
  }

  return lines.join('\n');
}

// ============== Buff/Nerf analytics ==============
export interface FlatBuffCell {
  recipient: UnitType; effectKey: string; kind: 'buff' | 'nerf';
  games: number; wins: number; winRate: number;
  avgStacks: number; avgSurvivedHp: number; avgDmgDealt: number;
}
export function flattenBuffPerUnit(report: SimReport, minGames = 5): FlatBuffCell[] {
  const out: FlatBuffCell[] = [];
  for (const c of report.buffPerUnit.values()) {
    if (c.games < minGames) continue;
    out.push({
      recipient: c.recipient, effectKey: c.effectKey, kind: c.kind,
      games: c.games, wins: c.wins, winRate: (c.wins / c.games) * 100,
      avgStacks: c.stacksSum / c.games,
      avgSurvivedHp: c.recipientSurvSum / c.games,
      avgDmgDealt: c.recipientDmgSum / c.games,
    });
  }
  return out;
}

export interface FlatAttribCell {
  source: UnitType; recipient: UnitType; effectKey: string; kind: 'buff' | 'nerf';
  games: number; wins: number; winRate: number; avgStacks: number;
}
export function flattenAuraAttrib(report: SimReport, minGames = 5): FlatAttribCell[] {
  const out: FlatAttribCell[] = [];
  for (const c of report.auraAttrib.values()) {
    if (c.games < minGames) continue;
    out.push({
      source: c.source, recipient: c.recipient, effectKey: c.effectKey, kind: c.kind,
      games: c.games, wins: c.wins, winRate: (c.wins / c.games) * 100,
      avgStacks: c.stacksSum / c.games,
    });
  }
  return out;
}
