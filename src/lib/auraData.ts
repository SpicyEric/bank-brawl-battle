// Aura zones & effects loaded from `unit_types` (admin-managed).
// Used to render placement-time buff/nerf overlays and (later) gameplay logic.
import { supabase } from '@/integrations/supabase/client';
import type { UnitType, Unit } from '@/lib/battleGame';
import { GRID_SIZE } from '@/lib/battleGame';

export type ZoneType = 'neutral' | 'buff' | 'nerf';
export type ZonePos =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

export const ZONE_POSITIONS: ZonePos[] = [
  'top-left', 'top', 'top-right',
  'left', 'right',
  'bottom-left', 'bottom', 'bottom-right',
];

export const ZONE_DELTA: Record<ZonePos, { dr: number; dc: number }> = {
  'top-left':     { dr: -1, dc: -1 },
  'top':          { dr: -1, dc:  0 },
  'top-right':    { dr: -1, dc:  1 },
  'left':         { dr:  0, dc: -1 },
  'right':        { dr:  0, dc:  1 },
  'bottom-left':  { dr:  1, dc: -1 },
  'bottom':       { dr:  1, dc:  0 },
  'bottom-right': { dr:  1, dc:  1 },
};

/** Aura cells around (row,col) for a unit type. Returns map "r-c" -> 'buff' | 'nerf'. */
export function auraCellsAround(
  type: UnitType,
  row: number,
  col: number,
  zones: AuraZoneMap,
): Map<string, 'buff' | 'nerf'> {
  const out = new Map<string, 'buff' | 'nerf'>();
  const z = zones[type];
  if (!z) return out;
  for (const pos of ZONE_POSITIONS) {
    const kind = z[pos];
    if (!kind) continue;
    const { dr, dc } = ZONE_DELTA[pos];
    const r = row + dr;
    const c = col + dc;
    if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
    out.set(`${r}-${c}`, kind);
  }
  return out;
}

export type AuraZoneMap = Partial<Record<UnitType, Partial<Record<ZonePos, Exclude<ZoneType, 'neutral'>>>>>;
export type AuraEffectMap = Partial<Record<UnitType, { buff: string | null; nerf: string | null }>>;

let cachedZones: AuraZoneMap | null = null;
let cachedEffects: AuraEffectMap | null = null;
let pending: Promise<void> | null = null;

export async function loadAuraData(): Promise<{ zones: AuraZoneMap; effects: AuraEffectMap }> {
  if (cachedZones && cachedEffects) return { zones: cachedZones, effects: cachedEffects };
  if (!pending) {
    pending = (async () => {
      const { data, error } = await supabase
        .from('unit_types')
        .select('unit_type, aura_zones, aura_effect');
      if (error) { console.warn('[aura] load failed', error); cachedZones = {}; cachedEffects = {}; return; }
      const zones: AuraZoneMap = {};
      const effects: AuraEffectMap = {};
      for (const row of data ?? []) {
        const ut = row.unit_type as UnitType;
        const z: Partial<Record<ZonePos, Exclude<ZoneType, 'neutral'>>> = {};
        const stored = (row.aura_zones as any)?.zones;
        if (Array.isArray(stored)) {
          for (const e of stored) {
            if (e && (e.type === 'buff' || e.type === 'nerf') && ZONE_POSITIONS.includes(e.pos)) {
              z[e.pos as ZonePos] = e.type;
            }
          }
        }
        zones[ut] = z;
        const ae = row.aura_effect as any;
        if (ae && typeof ae === 'object') effects[ut] = { buff: ae.buff ?? null, nerf: ae.nerf ?? null };
      }
      cachedZones = zones;
      cachedEffects = effects;
    })();
  }
  await pending;
  return { zones: cachedZones ?? {}, effects: cachedEffects ?? {} };
}

/** Compute per-cell aura overlay map ("r-c" -> 'buff' | 'nerf') from all placed units.
 *  Buff wins over nerf if both occur on the same cell.
 *  Cells already occupied by a unit are still marked (visual hint). */
export function computeAuraOverlay(units: Unit[], zones: AuraZoneMap): Map<string, 'buff' | 'nerf'> {
  const out = new Map<string, 'buff' | 'nerf'>();
  for (const u of units) {
    if (!u || u.dead || u.hp <= 0) continue;
    const z = zones[u.type];
    if (!z) continue;
    for (const pos of ZONE_POSITIONS) {
      const kind = z[pos];
      if (!kind) continue;
      const { dr, dc } = ZONE_DELTA[pos];
      const r = u.row + dr;
      const c = u.col + dc;
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
      const key = `${r}-${c}`;
      const cur = out.get(key);
      if (cur === 'buff') continue;
      out.set(key, kind);
    }
  }
  return out;
}
