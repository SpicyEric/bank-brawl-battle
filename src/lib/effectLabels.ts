// Human-readable German descriptions for aura buff/nerf effect keys
// stored in unit_types.aura_effect. Unknown keys fall back to a humanized
// version of the raw key.

const EFFECT_LABELS: Record<string, string> = {
  // generic
  cooldown_minus_1: 'Cooldown −1',
  cooldown_plus_1: 'Cooldown +1',
  // arsonist / fire
  fire_on_attack_5dmg_3ticks: 'Brand bei Angriff (5 Dmg / 3 Ticks)',
  self_burn_20percent_chance_5dmg_3ticks: '20% Chance auf Selbst-Brand (5 Dmg / 3 Ticks)',
  // lightning
  chain_lightning_30percent_then_10percent: 'Kettenblitz (30% → 10% Folgeschaden)',
  chain_lightning_on_attack: 'Kettenblitz bei jedem Angriff',
  max_hp_minus_10: '−10% maximales HP',
  double_dmg_from_lightning_and_fire: 'Doppelter Schaden durch Blitz & Feuer',
  cooldown_minus_1_chain_lightning_20percent: 'Cooldown −1 & 20% Kettenblitz',
  // mirror / reflect
  reflect_damage_20percent: 'Reflektiert 20% Schaden',
  // lamb / taunt
  weaken_enemy_50percent_2ticks: 'Schwächt Gegner um 50% (2 Ticks)',
  force_aggro_on_self: 'Zieht alle Aggro auf sich',
  // judge
  atk_plus_5_per_death: '+5 ATK pro Tod',
  atk_minus_5_per_allied_death: '−5 ATK pro verbündetem Tod',
  // icegolem
  damage_share_50percent_to_eisgolem: 'Eisgolem teilt 50% Schaden',
  self_freeze_20percent_on_attack: '20% Chance sich selbst einzufrieren',
  // cloner
  immune_to_fire_frost_poison: 'Immun gegen Feuer, Frost & Gift',
  // magnetiker
  taunt_50percent_dmg_reduction: 'Provoziert, −50% Schaden',
  // spiderqueen
  poison_on_attack_2dmg_per_tick_minus10percent_atk: 'Gift (2 Dmg/Tick, −10% ATK)',
  web_trap_5percent_on_hit_10percent_dmg_3ticks: '5% Netzfalle (10% Dmg, 3 Ticks)',
  // waterwalker
  fire_immune_plus_lightning_50percent_bonus: 'Feuer-Immun, +50% Blitz-Bonus',
  // doppelganger
  '50percent_chance_plus5_atk_and_force_aggro': '50% Chance auf +5 ATK & Aggro-Zug',
  lifedrain_5hp_per_tick_to_doppelganger: 'Lebensentzug 5 HP/Tick an Doppelgänger',
  // sniper
  max_hp_plus_15percent: '+15% maximales HP',
  on_sniper_death_20_damage_to_nerved: 'Bei Tod 20 Dmg an Nerf-Ziele',
  // bomber
  explosion_splash_7dmg_on_attack: 'Explosionssplash 7 Dmg',
  on_death_splash_to_allies: 'Splash an Verbündete beim Tod',
  // obelisk
  '10percent_miss_chance': '10% Chance zu verfehlen',
  // shadowpriest
  curse_stack_on_attack: 'Fluch-Stack bei Angriff',
  weaken_60percent: '−60% Schaden',
  // warrior
  atk_percent_plus_50: '+50% Angriff',
  atk_percent_minus_50: '−50% Angriff',
  // archer
  weaken_enemy_atk_minus40_3ticks: 'Schwächt Gegner ATK −40 (3 Ticks)',
  strengthen_enemy_atk_plus10_3ticks: 'Stärkt Gegner ATK +10 (3 Ticks)',
  // assassin
  bleed_dot_on_attack: 'Blutung bei Angriff',
  // banshee
  permanent_atk_drain_2_per_hit: '−2 ATK permanent pro Treffer',
  own_dmg_minus_20percent: '−20% eigener Schaden',
  // rider
  dodge_chance_30: '30% Ausweichchance',
  hp_drain_3_per_tick: '−3 HP pro Tick',
  // frost
  freeze_chance_50_3ticks: '50% Einfrier-Chance (3 Ticks)',
  // mage
  crit_chance_20_crit_dmg_100: '20% Crit (+100% Dmg)',
  dmg_minus_20percent: '−20% Schaden',
  // shadowblade
  cooldown_minus_1_crit_5percent: 'Cooldown −1 & 5% Crit',
  dmg_minus_50percent: '−50% Schaden',
  // shaman / healer
  hp_regen_3_per_tick: '+3 HP / Tick',
  can_only_damage_below_70percent_hp: 'Kann nur Gegner < 70% HP angreifen',
  // shieldbearer / tank
  incoming_dmg_minus60: '−60% erlittener Schaden',
  first_attack_only_10percent: 'Erstangriff nur 10% Schaden',
  // vampire
  lifesteal_30percent: 'Lebensentzug 30%',
  // vulkanit / volcanit
  lava_splash_5plus3: 'Lava-Splash (5+3)',
  self_damage_5_per_hit: '−5 HP pro Treffer (selbst)',
};

export function describeEffect(key: string | null | undefined): string {
  if (!key) return '—';
  if (EFFECT_LABELS[key]) return EFFECT_LABELS[key];
  // Humanize fallback: snake → words
  return key.replace(/_/g, ' ');
}
