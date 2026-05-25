ALTER TABLE public.unit_types
ADD COLUMN IF NOT EXISTS aura_effect jsonb NOT NULL DEFAULT '{"buff": null, "nerf": null}'::jsonb;

INSERT INTO public.unit_types (unit_type, aura_effect) VALUES
  ('warrior',      '{"buff": "atk_percent_plus_50", "nerf": "atk_percent_minus_50"}'::jsonb),
  ('assassin',     '{"buff": "bleed_dot_on_attack", "nerf": "cooldown_plus_1"}'::jsonb),
  ('dragon',       '{"buff": "fire_on_attack_5dmg_3ticks", "nerf": null}'::jsonb),
  ('rider',        '{"buff": "dodge_chance_30", "nerf": "hp_drain_3_per_tick"}'::jsonb),
  ('archer',       '{"buff": "weaken_enemy_atk_minus40_3ticks", "nerf": "strengthen_enemy_atk_plus10_3ticks"}'::jsonb),
  ('frostmage',    '{"buff": "freeze_chance_50_3ticks", "nerf": "cooldown_plus_1"}'::jsonb),
  ('shieldbearer', '{"buff": "incoming_dmg_minus60", "nerf": "first_attack_only_10percent"}'::jsonb),
  ('mage',         '{"buff": "crit_chance_20_crit_dmg_100", "nerf": "dmg_minus_20percent"}'::jsonb),
  ('shaman',       '{"buff": "hp_regen_3_per_tick", "nerf": "can_only_damage_below_70percent_hp"}'::jsonb),
  ('banshee',      '{"buff": "permanent_atk_drain_2_per_hit", "nerf": "own_dmg_minus_20percent"}'::jsonb),
  ('vampire',      '{"buff": "lifesteal_30percent", "nerf": null}'::jsonb),
  ('volcanit',     '{"buff": "lava_splash_5plus3", "nerf": "self_damage_5_per_hit"}'::jsonb),
  ('shadowblade',  '{"buff": "cooldown_minus_1_crit_5percent", "nerf": "dmg_minus_50percent"}'::jsonb)
ON CONFLICT (unit_type) DO UPDATE SET aura_effect = EXCLUDED.aura_effect, updated_at = now();