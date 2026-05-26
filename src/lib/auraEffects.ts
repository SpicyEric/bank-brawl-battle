// ============================================================
// Stackable aura buff/nerf engine — Phase 1 (core stats)
// ------------------------------------------------------------
// Reads the per-unit-type aura zones + aura_effect keys from
// the DB (loaded via loadAuraData) and converts adjacent
// buff/nerf zones into a per-unit `auraStacks` runtime field.
//
// All effects stack additively across sources (e.g. two
// warriors both buffing the same cell → +100% atk).
// ============================================================
import type { Unit, UnitType } from './battleGame';
import { ZONE_POSITIONS, ZONE_DELTA, type AuraZoneMap, type AuraEffectMap } from './auraData';

/** Runtime per-unit stack counters. Every field is a *number of stacks*
 *  unless the field name ends in `Pct` in which case it's an already-
 *  combined fractional value (0..n). */
export interface AuraStacks {
  // raw stack counts
  atkPlus50: number;          // warrior buff
  atkMinus50: number;         // warrior nerf
  maxHpPlus15: number;        // sniper buff (+15% max HP)
  maxHpMinus10: number;       // blitzmagier nerf (-10% max HP)
  cdMinus1: number;           // cooldown −1
  cdPlus1: number;            // cooldown +1
  dodge30: number;            // rider buff (30% dodge / stack)
  crit20Dmg100: number;       // mage buff (20% crit / +100% dmg per stack)
  lifesteal30: number;        // vampire buff
  incomingMinus60: number;    // shieldbearer / tank buff
  ownDmgMinus20: number;      // banshee/mage nerf (-20%)
  ownDmgMinus50: number;      // shadowblade nerf (-50%)
  weaken60: number;           // shadowpriest nerf (-60% dmg)
  hpRegen3: number;           // shaman buff (+3 HP / tick)
  hpDrain3: number;           // rider nerf (−3 HP / tick)
  doubleFromLightningFire: number; // blitzmagier nerf
  // aggregate counts for UI
  totalBuff: number;
  totalNerf: number;
}

const EMPTY: AuraStacks = {
  atkPlus50: 0, atkMinus50: 0,
  maxHpPlus15: 0, maxHpMinus10: 0,
  cdMinus1: 0, cdPlus1: 0,
  dodge30: 0, crit20Dmg100: 0,
  lifesteal30: 0, incomingMinus60: 0,
  ownDmgMinus20: 0, ownDmgMinus50: 0,
  weaken60: 0, hpRegen3: 0, hpDrain3: 0,
  doubleFromLightningFire: 0,
  totalBuff: 0, totalNerf: 0,
};

function emptyStacks(): AuraStacks { return { ...EMPTY }; }

/** Translate an aura_effect string key + buff/nerf kind into the
 *  corresponding AuraStacks field name. Phase 1 only — unknown
 *  keys are silently ignored (will arrive in Phase 2). */
function fieldFor(effectKey: string | null | undefined, kind: 'buff' | 'nerf'): (keyof AuraStacks) | null {
  if (!effectKey) return null;
  if (kind === 'buff') {
    switch (effectKey) {
      case 'atk_percent_plus_50': return 'atkPlus50';
      case 'max_hp_plus_15percent': return 'maxHpPlus15';
      case 'cooldown_minus_1': return 'cdMinus1';
      case 'cooldown_minus_1_chain_lightning_20percent': return 'cdMinus1';
      case 'cooldown_minus_1_crit_5percent': return 'cdMinus1';
      case 'dodge_chance_30': return 'dodge30';
      case 'crit_chance_20_crit_dmg_100': return 'crit20Dmg100';
      case 'lifesteal_30percent': return 'lifesteal30';
      case 'incoming_dmg_minus60': return 'incomingMinus60';
      case 'hp_regen_3_per_tick': return 'hpRegen3';
    }
  } else {
    switch (effectKey) {
      case 'atk_percent_minus_50': return 'atkMinus50';
      case 'max_hp_minus_10': return 'maxHpMinus10';
      case 'cooldown_plus_1': return 'cdPlus1';
      case 'own_dmg_minus_20percent': return 'ownDmgMinus20';
      case 'dmg_minus_20percent': return 'ownDmgMinus20';
      case 'dmg_minus_50percent': return 'ownDmgMinus50';
      case 'weaken_60percent': return 'weaken60';
      case 'hp_drain_3_per_tick': return 'hpDrain3';
      case 'double_dmg_from_lightning_and_fire': return 'doubleFromLightningFire';
    }
  }
  return null;
}

/** Recompute auraStacks for every alive unit. Only counts auras from
 *  *friendly* sources (a warrior buffs his own team only). Adjusts
 *  effective maxHp on the fly while preserving the baseline. */
export function applyAuraStacks(
  allUnits: Unit[],
  zones: AuraZoneMap,
  effects: AuraEffectMap,
): void {
  // Pass 1 — clear stacks & build the source list.
  for (const u of allUnits) {
    if (u.dead || u.hp <= 0) continue;
    u.auraStacks = emptyStacks();
  }

  // Pass 2 — every source projects its zone onto neighbouring allied cells.
  for (const src of allUnits) {
    if (src.dead || src.hp <= 0) continue;
    const z = zones[src.type as UnitType];
    if (!z) continue;
    const eff = effects[src.type as UnitType];
    if (!eff) continue;

    for (const pos of ZONE_POSITIONS) {
      const kind = z[pos];
      if (!kind) continue;
      const key = fieldFor(kind === 'buff' ? eff.buff : eff.nerf, kind);
      if (!key) continue;
      const { dr, dc } = ZONE_DELTA[pos];
      const r = src.row + dr;
      const c = src.col + dc;
      // Find allied unit on that cell
      const tgt = allUnits.find(u => u.row === r && u.col === c && u.team === src.team && !u.dead && u.hp > 0);
      if (!tgt || !tgt.auraStacks) continue;
      (tgt.auraStacks[key] as number) += 1;
      if (kind === 'buff') tgt.auraStacks.totalBuff += 1;
      else tgt.auraStacks.totalNerf += 1;
    }
  }

  // Pass 3 — dynamic maxHp adjustment based on stacks (preserve baseline)
  for (const u of allUnits) {
    if (u.dead || u.hp <= 0 || !u.auraStacks) continue;
    if (!u._baseMaxHp || u._baseMaxHp <= 0) u._baseMaxHp = u.maxHp;
    const base = u._baseMaxHp;
    const mul = Math.max(0.1, 1 + 0.15 * u.auraStacks.maxHpPlus15 - 0.10 * u.auraStacks.maxHpMinus10);
    const target = Math.max(1, Math.round(base * mul));
    if (target !== u.maxHp) {
      const delta = target - u.maxHp;
      u.maxHp = target;
      if (delta > 0) u.hp = Math.min(u.maxHp, u.hp + delta);
      else u.hp = Math.min(u.hp, u.maxHp);
    }
  }
}

/** Per-tick HP regen / drain pass — also applied here so the math
 *  lives next to the stack engine. */
export function applyAuraTick(allUnits: Unit[], logs: string[]): void {
  for (const u of allUnits) {
    if (u.dead || u.hp <= 0 || !u.auraStacks) continue;
    const s = u.auraStacks;
    if (s.hpRegen3 > 0 && u.hp < u.maxHp) {
      const heal = Math.min(u.maxHp - u.hp, 3 * s.hpRegen3);
      if (heal > 0) {
        u.hp += heal;
        u._justRegen = Date.now();
      }
    }
    if (s.hpDrain3 > 0) {
      const dmg = 3 * s.hpDrain3;
      u.hp = Math.max(0, u.hp - dmg);
      u._justDrain = Date.now();
      if (u.hp <= 0) {
        u.dead = true;
        logs.push(`💀 ${u.type} verblutet durch Aura-Nerf`);
      }
    }
  }
}
