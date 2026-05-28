// ============================================================
// Stackable aura buff/nerf engine (Phase 1 + Phase 2)
// ------------------------------------------------------------
// Phase 1: passive stat stacks (atk%, hp%, cd, dodge, crit,
//          lifesteal, incoming dmg, dmg-mali, regen/drain).
// Phase 2: on-attack & on-death triggers (splash, chain,
//          bleed, burn, freeze, web, reflect, permanent atk
//          drain, weaken/strengthen DoT, self-burn/-damage,
//          poison, curse stack, first-attack penalty,
//          damage-only-below-70%, double dmg from fire/lit).
// ============================================================
import type { Unit, UnitType, Cell } from './battleGame';
import { GRID_SIZE, UNIT_DEFS, applyShadowpriestCurse } from './battleGame';
import { ZONE_POSITIONS, ZONE_DELTA, type AuraZoneMap, type AuraEffectMap } from './auraData';
import type { BattleEvent } from './battleEvents';

/** Runtime per-unit stack counters. */
export interface AuraStacks {
  // === Phase 1 — passive stats ===
  atkPlus50: number; atkMinus50: number;
  maxHpPlus15: number; maxHpMinus10: number;
  cdMinus1: number; cdPlus1: number;
  dodge30: number; crit20Dmg100: number;
  lifesteal30: number; incomingMinus60: number;
  ownDmgMinus20: number; ownDmgMinus50: number; weaken60: number;
  hpRegen3: number; hpDrain3: number;
  doubleFromLightningFire: number;
  // === Phase 2 — triggers ===
  splash7: number;
  chain20: number;
  chain30Then10: number;
  chainOnAttack: number;
  bleedOnAttack: number;
  fireOnAttack: number;
  freeze50: number;
  webTrap5: number;
  permAtkDrain2: number;
  reflect20: number;
  weaken50_2t: number;
  archerDebuffEnemy: number;
  archerBuffEnemy: number;
  selfBurn20: number;
  selfDamage5: number;
  lavaSplash: number;
  selfFreeze20: number;
  poisonOnAttack: number;
  curseOnAttack: number;
  firstAttack10: number;
  damageBelow70: number;
  immuneFFP: number;
  lightning50Bonus: number;
  // === Phase 3 — aggro / share / death ===
  forceAggro: number;           // enemies prioritise this unit
  tauntDmgRed50: number;        // magnetiker: −50% incoming dmg while taunting
  missChance10: number;         // obelisk nerf: 10% miss chance per stack
  damageShareToIce: number;     // icegolem: 50% redirect of incoming dmg
  doppelChance50Plus5: number;  // doppel buff: 50% chance +5 ATK + aggro
  // aggregate counts for UI
  totalBuff: number; totalNerf: number;
}

const EMPTY: AuraStacks = {
  atkPlus50: 0, atkMinus50: 0, maxHpPlus15: 0, maxHpMinus10: 0,
  cdMinus1: 0, cdPlus1: 0, dodge30: 0, crit20Dmg100: 0,
  lifesteal30: 0, incomingMinus60: 0, ownDmgMinus20: 0, ownDmgMinus50: 0,
  weaken60: 0, hpRegen3: 0, hpDrain3: 0, doubleFromLightningFire: 0,
  splash7: 0, chain20: 0, chain30Then10: 0, chainOnAttack: 0,
  bleedOnAttack: 0, fireOnAttack: 0, freeze50: 0, webTrap5: 0,
  permAtkDrain2: 0, reflect20: 0, weaken50_2t: 0,
  archerDebuffEnemy: 0, archerBuffEnemy: 0, selfBurn20: 0, selfDamage5: 0,
  lavaSplash: 0, selfFreeze20: 0, poisonOnAttack: 0, curseOnAttack: 0,
  firstAttack10: 0, damageBelow70: 0, immuneFFP: 0, lightning50Bonus: 0,
  forceAggro: 0, tauntDmgRed50: 0, missChance10: 0,
  damageShareToIce: 0, doppelChance50Plus5: 0,
  totalBuff: 0, totalNerf: 0,
};

function emptyStacks(): AuraStacks { return { ...EMPTY }; }

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
      case 'explosion_splash_7dmg_on_attack': return 'splash7';
      case 'chain_lightning_30percent_then_10percent': return 'chain30Then10';
      case 'chain_lightning_on_attack': return 'chainOnAttack';
      case 'bleed_dot_on_attack': return 'bleedOnAttack';
      case 'fire_on_attack_5dmg_3ticks': return 'fireOnAttack';
      case 'freeze_chance_50_3ticks': return 'freeze50';
      case 'reflect_damage_20percent': return 'reflect20';
      case 'weaken_enemy_50percent_2ticks': return 'weaken50_2t';
      case 'weaken_enemy_atk_minus40_3ticks': return 'archerDebuffEnemy';
      case 'lava_splash_5plus3': return 'lavaSplash';
      case 'curse_stack_on_attack': return 'curseOnAttack';
      case 'immune_to_fire_frost_poison': return 'immuneFFP';
      case 'fire_immune_plus_lightning_50percent_bonus': return 'lightning50Bonus';
      case 'web_trap_5percent_on_hit_10percent_dmg_3ticks': return 'webTrap5';
      case 'poison_on_attack_2dmg_per_tick_minus10percent_atk': return 'poisonOnAttack';
      case 'taunt_50percent_dmg_reduction': return 'tauntDmgRed50';
      case 'damage_share_50percent_to_eisgolem': return 'damageShareToIce';
      case '50percent_chance_plus5_atk_and_force_aggro': return 'doppelChance50Plus5';
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
      case 'permanent_atk_drain_2_per_hit': return 'permAtkDrain2';
      case 'self_burn_20percent_chance_5dmg_3ticks': return 'selfBurn20';
      case 'self_damage_5_per_hit': return 'selfDamage5';
      case 'self_freeze_20percent_on_attack': return 'selfFreeze20';
      case 'first_attack_only_10percent': return 'firstAttack10';
      case 'can_only_damage_below_70percent_hp': return 'damageBelow70';
      case 'strengthen_enemy_atk_plus10_3ticks': return 'archerBuffEnemy';
      case '10percent_miss_chance': return 'missChance10';
    }
  }
  return null;
}

/** Recompute auraStacks for every alive unit. */
export function applyAuraStacks(
  allUnits: Unit[], zones: AuraZoneMap, effects: AuraEffectMap,
): void {
  for (const u of allUnits) {
    if (u.dead || u.hp <= 0) continue;
    u.auraStacks = emptyStacks();
  }
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
      const tgt = allUnits.find(u => u.row === r && u.col === c && u.team === src.team && !u.dead && u.hp > 0);
      if (!tgt || !tgt.auraStacks) continue;
      (tgt.auraStacks[key] as number) += 1;
      if (kind === 'buff') tgt.auraStacks.totalBuff += 1;
      else tgt.auraStacks.totalNerf += 1;
      // Aggro implications: taunt + doppel buff also pull enemy attention
      if (key === 'tauntDmgRed50' || key === 'doppelChance50Plus5') {
        tgt.auraStacks.forceAggro += 1;
      }
    }
    // === Source-self nerfs: force_aggro_on_self → the SOURCE becomes priority target ===
    if (src.auraStacks && eff.nerf === 'force_aggro_on_self') {
      src.auraStacks.forceAggro = Math.max(src.auraStacks.forceAggro, 1);
      if (src.auraStacks.totalNerf === 0) src.auraStacks.totalNerf = 1;
    }
  }
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

/** Per-tick HP regen / drain pass. */
export function applyAuraTick(allUnits: Unit[], logs: string[]): void {
  for (const u of allUnits) {
    if (u.dead || u.hp <= 0 || !u.auraStacks) continue;
    const s = u.auraStacks;
    if (s.hpRegen3 > 0 && u.hp < u.maxHp) {
      const heal = Math.min(u.maxHp - u.hp, 3 * s.hpRegen3);
      const actual = applyHealing(u, heal);
      if (actual > 0) u._justRegen = Date.now();
    }
    if (s.hpDrain3 > 0) {
      const dmg = 3 * s.hpDrain3;
      u.hp = Math.max(0, u.hp - dmg);
      u._justDrain = Date.now();
      if (u.hp <= 0) { u.dead = true; logs.push(`💀 ${UNIT_DEFS[u.type].emoji} verblutet durch Aura-Nerf`); }
    }
    // Decrement temporary debuffs we apply via aura triggers
    if (u.auraWeakenTicks && u.auraWeakenTicks > 0) {
      u.auraWeakenTicks -= 1;
      if (u.auraWeakenTicks <= 0) u.auraDmgTakenMul = undefined;
    }
    if (u.auraAtkDebuffTicks && u.auraAtkDebuffTicks > 0) {
      u.auraAtkDebuffTicks -= 1;
      if (u.auraAtkDebuffTicks <= 0) u.auraAtkDebuff = undefined;
    }
    if (u.auraAtkBuffTicks && u.auraAtkBuffTicks > 0) {
      u.auraAtkBuffTicks -= 1;
      if (u.auraAtkBuffTicks <= 0) u.auraAtkBuff = undefined;
    }
  }
}

/** Per-tick source-driven side-effects (drain from source for doppelganger nerf). */
export function applyAuraSourceEffects(
  allUnits: Unit[], zones: AuraZoneMap, effects: AuraEffectMap, logs: string[],
): void {
  for (const src of allUnits) {
    if (src.dead || src.hp <= 0) continue;
    const eff = effects[src.type as UnitType];
    const z = zones[src.type as UnitType];
    if (!eff || !z) continue;
    // Doppelganger nerf: lose 5 HP per ally currently in the nerf zone (per stack)
    if (eff.nerf === 'lifedrain_5hp_per_tick_to_doppelganger') {
      let stacks = 0;
      for (const pos of ZONE_POSITIONS) {
        if (z[pos] !== 'nerf') continue;
        const { dr, dc } = ZONE_DELTA[pos];
        const r = src.row + dr, c = src.col + dc;
        const ally = allUnits.find(u => u.row === r && u.col === c && u.team === src.team && !u.dead && u.hp > 0);
        if (ally) stacks++;
      }
      if (stacks > 0) {
        const dmg = 5 * stacks;
        src.hp = Math.max(0, src.hp - dmg);
        src._justDrain = Date.now();
        if (src.hp <= 0) { src.dead = true; logs.push(`💀 ${UNIT_DEFS[src.type].emoji} stirbt am Aura-Lebensentzug`); }
      }
    }
  }
}


/** Multiplier applied to fire/lava/burn DoT damage based on defender's aura nerf. */
export function fireLightningTakenMul(target: Unit): number {
  const s = target.auraStacks;
  if (!s || s.doubleFromLightningFire <= 0) return 1;
  return 1 + 1 * s.doubleFromLightningFire;
}

/** Returns true if the unit is currently immune to fire/frost/poison via aura buff. */
export function hasImmuneFFP(u: Unit): boolean {
  return !!(u.auraStacks && u.auraStacks.immuneFFP > 0);
}

/** Adjust calc'd dmg for first-attack-only nerf + damage-only-below-70 nerf. Returns adjusted dmg. */
export function applyAttackerNerfs(attacker: Unit, defender: Unit, dmg: number): number {
  const s = attacker.auraStacks;
  if (!s) return dmg;
  if (s.firstAttack10 > 0 && !attacker.firstAttackUsed) {
    dmg = Math.round(dmg * Math.pow(0.10, s.firstAttack10));
  }
  if (s.damageBelow70 > 0 && defender.hp > defender.maxHp * 0.7) {
    dmg = 0;
  }
  return dmg;
}

/** Apply all on-attack aura triggers. Called AFTER damage is dealt.
 *  Returns extra battle events to display (chain/splash visuals). */
export function applyAuraOnAttack(params: {
  attacker: Unit;
  defender: Unit;
  dmg: number;
  allUnits: Unit[];
  grid: Cell[][];
  logs: string[];
  events?: BattleEvent[];
}): void {
  const { attacker, defender, dmg, allUnits, grid, logs, events } = params;
  if (dmg <= 0) return;
  const s = attacker.auraStacks;
  if (!s) return;

  // Mark first-attack used (after dmg has been applied)
  if (s.firstAttack10 > 0 && !attacker.firstAttackUsed) attacker.firstAttackUsed = true;

  // === Splash (sprengmeister buff): per-stack 7 dmg to enemies adjacent to defender ===
  if (s.splash7 > 0) {
    const splashDmg = 7 * s.splash7;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = defender.row + dr, c = defender.col + dc;
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
      const cu = grid[r][c].unit;
      if (!cu || cu.dead || cu.hp <= 0 || cu.team === attacker.team) continue;
      cu.hp = Math.max(0, cu.hp - splashDmg);
      logs.push(`💥 Aura-Splash → ${UNIT_DEFS[cu.type].emoji} ${splashDmg}`);
      events?.push({
        type: cu.hp <= 0 ? 'kill' : 'hit',
        attackerId: attacker.id, attackerRow: attacker.row, attackerCol: attacker.col,
        attackerEmoji: '💥', attackerType: attacker.type,
        targetId: cu.id, targetRow: cu.row, targetCol: cu.col,
        targetEmoji: UNIT_DEFS[cu.type].emoji, targetType: cu.type,
        damage: splashDmg, ts: Date.now(),
      } as any);
      if (cu.hp <= 0) cu.dead = true;
    }
  }

  // === Chain lightning (chain_lightning_on_attack / chain20 / chain30Then10) ===
  const chainStacks = s.chainOnAttack + s.chain20 + s.chain30Then10;
  if (chainStacks > 0) {
    const chainDmg = Math.max(1, Math.round(dmg * (0.3 + 0.1 * (chainStacks - 1))));
    let cur = { row: defender.row, col: defender.col };
    const hit = new Set<string>([defender.id]);
    const hops = Math.min(3, chainStacks);
    for (let i = 0; i < hops; i++) {
      let best: { u: Unit; d: number } | null = null;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = cur.row + dr, c = cur.col + dc;
        if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
        const cu = grid[r][c].unit;
        if (!cu || cu.dead || cu.hp <= 0 || cu.team === attacker.team || hit.has(cu.id)) continue;
        if (cu.isPhantom && (cu.phantom ?? 0) > 0) continue;
        const dist = Math.max(Math.abs(dr), Math.abs(dc));
        if (!best || dist < best.d) best = { u: cu, d: dist };
      }
      if (!best) break;
      const target = best.u;
      // Defender's double-from-fire/lightning nerf doubles the hop dmg
      const hopDmg = Math.max(1, Math.round(chainDmg * fireLightningTakenMul(target)));
      target.hp = Math.max(0, target.hp - hopDmg);
      hit.add(target.id);
      logs.push(`⚡ Aura-Blitz → ${UNIT_DEFS[target.type].emoji} ${hopDmg}`);
      events?.push({
        type: target.hp <= 0 ? 'kill' : 'hit',
        attackerId: attacker.id, attackerRow: attacker.row, attackerCol: attacker.col,
        attackerEmoji: '⚡', attackerType: attacker.type,
        targetId: target.id, targetRow: target.row, targetCol: target.col,
        targetEmoji: UNIT_DEFS[target.type].emoji, targetType: target.type,
        damage: hopDmg, ts: Date.now(),
      } as any);
      if (target.hp <= 0) target.dead = true;
      cur = { row: target.row, col: target.col };
    }
  }

  // === Bleed on attack ===
  if (s.bleedOnAttack > 0 && defender.hp > 0) {
    const base = [10, 5, 3, 1].map(v => v * s.bleedOnAttack);
    defender.bleeding = base;
    logs.push(`🩸 Aura-Blutung an ${UNIT_DEFS[defender.type].emoji}`);
  }

  // === Fire on attack ===
  if (s.fireOnAttack > 0 && defender.hp > 0 && !hasImmuneFFP(defender)) {
    defender.burning = [...(defender.burning || []), { dmg: 5 * s.fireOnAttack, turns: 3 }];
    logs.push(`🔥 Aura-Brand an ${UNIT_DEFS[defender.type].emoji}`);
  }

  // === Freeze chance ===
  if (s.freeze50 > 0 && defender.hp > 0 && !hasImmuneFFP(defender) && !defender.frozen) {
    const chance = Math.min(0.95, 0.50 * s.freeze50);
    if (Math.random() < chance) {
      defender.frozen = 3;
      defender.frozenDmgMul = 0.5;
      logs.push(`🧊 Aura-Frost friert ${UNIT_DEFS[defender.type].emoji} ein`);
    }
  }

  // === Web trap ===
  if (s.webTrap5 > 0 && defender.hp > 0) {
    const chance = Math.min(0.95, 0.05 * s.webTrap5);
    if (Math.random() < chance) {
      defender.webbed = 3;
      const webDmg = Math.round(dmg * 0.10);
      if (webDmg > 0) defender.hp = Math.max(0, defender.hp - webDmg);
      logs.push(`🕸️ Aura-Netz fängt ${UNIT_DEFS[defender.type].emoji}`);
    }
  }

  // === Permanent ATK drain (banshee aura) ===
  if (s.permAtkDrain2 > 0 && defender.hp > 0) {
    const drain = 2 * s.permAtkDrain2;
    defender.attack = Math.max(0, defender.attack - drain);
    logs.push(`💀 Aura-Drain: ${UNIT_DEFS[defender.type].emoji} −${drain} ATK permanent`);
  }

  // === Reflect (defender aura) — reflect 20% per stack back to attacker ===
  const ds = defender.auraStacks;
  if (ds && ds.reflect20 > 0 && attacker.hp > 0) {
    const ref = Math.round(dmg * Math.min(1, 0.20 * ds.reflect20));
    if (ref > 0) {
      attacker.hp = Math.max(0, attacker.hp - ref);
      logs.push(`🪞 Aura-Reflex → ${UNIT_DEFS[attacker.type].emoji} ${ref}`);
      if (attacker.hp <= 0) attacker.dead = true;
    }
  }

  // === Weaken 50% 2 ticks (lamb aura) — defender takes +50% dmg for 2 ticks ===
  if (s.weaken50_2t > 0 && defender.hp > 0) {
    defender.auraDmgTakenMul = 1 + 0.5 * s.weaken50_2t;
    defender.auraWeakenTicks = 2;
  }

  // === Archer debuff: enemy ATK −40 for 3 ticks (per stack) ===
  if (s.archerDebuffEnemy > 0 && defender.hp > 0) {
    defender.auraAtkDebuff = (defender.auraAtkDebuff || 0) + 40 * s.archerDebuffEnemy;
    defender.auraAtkDebuffTicks = 3;
  }
  // === Archer nerf (buff enemy by mistake): enemy ATK +10 for 3 ticks ===
  if (s.archerBuffEnemy > 0 && defender.hp > 0) {
    defender.auraAtkBuff = (defender.auraAtkBuff || 0) + 10 * s.archerBuffEnemy;
    defender.auraAtkBuffTicks = 3;
  }

  // === Self-burn 20% chance ===
  if (s.selfBurn20 > 0 && !hasImmuneFFP(attacker)) {
    const chance = Math.min(0.95, 0.20 * s.selfBurn20);
    if (Math.random() < chance) {
      attacker.burning = [...(attacker.burning || []), { dmg: 5, turns: 3 }];
      logs.push(`🔥 Selbst-Brand bei ${UNIT_DEFS[attacker.type].emoji}`);
    }
  }
  // === Self-damage 5 per hit ===
  if (s.selfDamage5 > 0) {
    const sd = 5 * s.selfDamage5;
    attacker.hp = Math.max(0, attacker.hp - sd);
    logs.push(`🩹 ${UNIT_DEFS[attacker.type].emoji} verliert ${sd} HP (Aura-Selbstschaden)`);
    if (attacker.hp <= 0) attacker.dead = true;
  }
  // === Self-freeze 20% ===
  if (s.selfFreeze20 > 0 && !attacker.frozen) {
    const chance = Math.min(0.95, 0.20 * s.selfFreeze20);
    if (Math.random() < chance) {
      attacker.frozen = 2;
      attacker.frozenDmgMul = 0.5;
      logs.push(`🧊 ${UNIT_DEFS[attacker.type].emoji} friert sich selbst ein`);
    }
  }

  // === Lava splash (vulkanit buff): 5 dmg + 3-tick lava around defender ===
  if (s.lavaSplash > 0 && grid[defender.row]) {
    const sd = 5 * s.lavaSplash;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = defender.row + dr, c = defender.col + dc;
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
      const cu = grid[r][c].unit;
      if (cu && !cu.dead && cu.hp > 0 && cu.team !== attacker.team) {
        cu.hp = Math.max(0, cu.hp - sd);
        if (cu.hp <= 0) cu.dead = true;
      }
      // Lay short lava
      const cell = grid[r][c];
      cell.lavaTicks = Math.max(cell.lavaTicks || 0, 3);
      cell.lavaOwnerTeam = attacker.team;
      cell.lavaDmg = 3;
    }
    logs.push(`🌋 Aura-Lava um ${UNIT_DEFS[defender.type].emoji}`);
  }

  // === Poison on attack ===
  if (s.poisonOnAttack > 0 && defender.hp > 0 && !hasImmuneFFP(defender)) {
    defender.bleeding = [2, 2, 2, 2].map(v => v * s.poisonOnAttack);
    defender.attack = Math.max(0, Math.round(defender.attack * Math.pow(0.9, s.poisonOnAttack)));
    logs.push(`☠️ Aura-Gift an ${UNIT_DEFS[defender.type].emoji}`);
  }

  // === Curse stack ===
  if (s.curseOnAttack > 0 && defender.hp > 0) {
    for (let i = 0; i < s.curseOnAttack; i++) applyShadowpriestCurse(attacker, defender, logs, events);
  }

  // === Mark trigger visual ===
  if (s.splash7 + chainStacks + s.bleedOnAttack + s.fireOnAttack + s.freeze50
      + s.webTrap5 + s.permAtkDrain2 + s.lavaSplash + s.poisonOnAttack
      + s.curseOnAttack + s.selfBurn20 + s.selfDamage5 + s.selfFreeze20 > 0) {
    attacker._justAuraTrigger = Date.now();
  }
}

/** Damage-share + miss-chance + taunt-reduction + doppel bonus.
 *  Called right before applying damage. Returns adjusted dmg and mutates redirect target. */
export function applyDefenderShare(
  attacker: Unit, defender: Unit, dmg: number, allUnits: Unit[], logs: string[],
): number {
  const ds = defender.auraStacks;
  if (!ds || dmg <= 0) return dmg;
  // Miss chance (obelisk nerf on attacker side actually) — handle if defender forced miss on attacker
  const as = attacker.auraStacks;
  if (as && as.missChance10 > 0) {
    const miss = Math.min(0.95, 0.10 * as.missChance10);
    if (Math.random() < miss) {
      attacker._justDodged = Date.now();
      return 0;
    }
  }
  let adj = dmg;
  // Taunt damage reduction (magnetiker)
  if (ds.tauntDmgRed50 > 0) {
    adj = Math.round(adj * Math.max(0.05, 1 - 0.50 * ds.tauntDmgRed50));
  }
  // Damage share to allied icegolem
  if (ds.damageShareToIce > 0) {
    const frac = Math.min(0.95, 0.50 * ds.damageShareToIce);
    const share = Math.round(adj * frac);
    if (share > 0) {
      const ice = allUnits.find(u => u.team === defender.team && u.type === 'icegolem' && !u.dead && u.hp > 0 && u.id !== defender.id);
      if (ice) {
        ice.hp = Math.max(0, ice.hp - share);
        logs.push(`🧊 Schadens-Teilen → 🧊 ${share}`);
        if (ice.hp <= 0) ice.dead = true;
        adj -= share;
      }
    }
  }
  return Math.max(0, adj);
}

/** Doppel 50% chance: bonus +5 ATK per stack on the hit. */
export function applyDoppelHitBonus(attacker: Unit, dmg: number): number {
  const s = attacker.auraStacks;
  if (!s || s.doppelChance50Plus5 <= 0) return dmg;
  if (Math.random() < 0.5) {
    return dmg + 5 * s.doppelChance50Plus5;
  }
  return dmg;
}

/** On-death aura triggers (sniper death bonus, bomber death splash, etc.). */
export function applyAuraOnDeath(
  deadUnit: Unit, allUnits: Unit[], grid: Cell[][],
  zones: AuraZoneMap, effects: AuraEffectMap, logs: string[],
): void {
  const eff = effects[deadUnit.type as UnitType];
  const z = zones[deadUnit.type as UnitType];
  if (!eff) return;

  // === Sniper death nerf: deals 20 dmg to allies that were in its nerf zone ===
  if (eff.nerf === 'on_sniper_death_20_damage_to_nerved' && z) {
    for (const pos of ZONE_POSITIONS) {
      if (z[pos] !== 'nerf') continue;
      const { dr, dc } = ZONE_DELTA[pos];
      const r = deadUnit.row + dr, c = deadUnit.col + dc;
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
      const ally = grid[r]?.[c]?.unit;
      if (ally && !ally.dead && ally.hp > 0 && ally.team === deadUnit.team) {
        ally.hp = Math.max(0, ally.hp - 20);
        logs.push(`🎯 Sniper-Todesnerf → ${UNIT_DEFS[ally.type].emoji} 20`);
        if (ally.hp <= 0) ally.dead = true;
      }
    }
  }

  // === Bomber death: splash to surrounding allies (death-explosion penalty) ===
  if (eff.nerf === 'on_death_splash_to_allies') {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = deadUnit.row + dr, c = deadUnit.col + dc;
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
      const ally = grid[r]?.[c]?.unit;
      if (ally && !ally.dead && ally.hp > 0 && ally.team === deadUnit.team) {
        ally.hp = Math.max(0, ally.hp - 15);
        logs.push(`💥 Bomber-Tod → ${UNIT_DEFS[ally.type].emoji} 15`);
        if (ally.hp <= 0) ally.dead = true;
      }
    }
  }

  void allUnits;
}

