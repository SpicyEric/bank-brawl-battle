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

// Legacy DB rows that contain the actual data for some code unit-types.
const UNIT_TYPE_ALIASES: Record<string, UnitType> = {
  frostmage: 'frost',
  volcanit: 'vulkanit',
  shieldbearer: 'tank',
  shaman: 'healer',
};

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
      // Two-pass merge: alias rows (e.g. 'frostmage') and canonical rows (e.g. 'frost')
      // can each carry only zones OR only effects. We merge per-canonical-type so that
      // a non-empty value never gets overwritten by an empty one — regardless of the
      // (unordered) row sequence returned by the DB.
      for (const row of data ?? []) {
        const rawType = row.unit_type as string;
        const ut = (UNIT_TYPE_ALIASES[rawType] ?? rawType) as UnitType;

        // --- zones ---
        const z: Partial<Record<ZonePos, Exclude<ZoneType, 'neutral'>>> = {};
        const stored = (row.aura_zones as any)?.zones;
        if (Array.isArray(stored)) {
          for (const e of stored) {
            if (e && (e.type === 'buff' || e.type === 'nerf') && ZONE_POSITIONS.includes(e.pos)) {
              z[e.pos as ZonePos] = e.type;
            }
          }
        }
        const existingZ = zones[ut];
        const existingHasZones = existingZ && Object.keys(existingZ).length > 0;
        const newHasZones = Object.keys(z).length > 0;
        if (!existingHasZones || newHasZones) {
          // Only overwrite when we actually have something better (or nothing yet).
          if (newHasZones || !existingZ) zones[ut] = z;
        }

        // --- effects ---
        const ae = row.aura_effect as any;
        if (ae && typeof ae === 'object') {
          const eff = { buff: ae.buff ?? null, nerf: ae.nerf ?? null };
          const cur = effects[ut];
          const curHas = !!(cur && (cur.buff || cur.nerf));
          const newHas = !!(eff.buff || eff.nerf);
          if (!cur) {
            effects[ut] = eff;
          } else if (newHas && !curHas) {
            // Replace empty with populated.
            effects[ut] = eff;
          } else if (newHas && curHas) {
            // Merge: keep existing fields, fill in missing ones from the new row.
            effects[ut] = {
              buff: cur.buff ?? eff.buff,
              nerf: cur.nerf ?? eff.nerf,
            };
          }
          // else: new row is empty and we already have something → keep current.
        }
      }
      cachedZones = zones;
      cachedEffects = effects;
    })();
  }
  await pending;
  return { zones: cachedZones ?? {}, effects: cachedEffects ?? {} };
}

/** Per-cell aura counts: how many buff- and nerf-sources affect each cell.
 *  Buffs and nerfs stack independently and can both be > 0 on the same cell. */
export type AuraOverlayCell = { buff: number; nerf: number };
export type AuraOverlayMap = Map<string, AuraOverlayCell>;

export function computeAuraOverlay(units: Unit[], zones: AuraZoneMap, flipped = false): AuraOverlayMap {
  const out: AuraOverlayMap = new Map();
  for (const u of units) {
    if (!u || u.dead || u.hp <= 0) continue;
    const z = zones[u.type];
    if (!z) continue;
    for (const pos of ZONE_POSITIONS) {
      const kind = z[pos];
      if (!kind) continue;
      const { dr, dc } = ZONE_DELTA[pos];
      // For the flipped (player2) view the board is rendered vertically mirrored,
      // so the aura overlay relative to the unit must also be vertically flipped
      // to keep the visual relationship intact from that player's perspective.
      const r = u.row + (flipped ? -dr : dr);
      const c = u.col + dc;
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
      const key = `${r}-${c}`;
      const cur = out.get(key) ?? { buff: 0, nerf: 0 };
      if (kind === 'buff') cur.buff += 1; else cur.nerf += 1;
      out.set(key, cur);
    }
  }
  return out;
}

/** Synchronously returns the cached zones (or {} if not yet loaded). */
export function getCachedAuraZones(): AuraZoneMap { return cachedZones ?? {}; }

/** Detect whether placing `type` at (row,col) would trigger any buff or nerf
 *  given the units currently on the grid. Uses cached zones (sync). */
export function detectPlacementAura(
  type: UnitType,
  row: number,
  col: number,
  units: Unit[],
  team: 'player' | 'enemy',
): { buff: boolean; nerf: boolean } {
  const zones = getCachedAuraZones();
  let buff = false;
  let nerf = false;

  // 1) Aura zones of the freshly placed unit covering an existing unit on the grid.
  const ownCells = auraCellsAround(type, row, col, zones);
  for (const u of units) {
    if (!u || u.dead || u.hp <= 0) continue;
    const kind = ownCells.get(`${u.row}-${u.col}`);
    if (!kind) continue;
    if (kind === 'buff' && u.team === team) buff = true;
    if (kind === 'nerf' && u.team !== team) nerf = true;
  }

  // 2) The placement cell itself stepping into an existing aura zone.
  for (const u of units) {
    if (!u || u.dead || u.hp <= 0) continue;
    const otherCells = auraCellsAround(u.type, u.row, u.col, zones);
    const k = otherCells.get(`${row}-${col}`);
    if (!k) continue;
    if (k === 'buff' && u.team === team) buff = true;
    if (k === 'nerf' && u.team !== team) nerf = true;
  }
  return { buff, nerf };
}

