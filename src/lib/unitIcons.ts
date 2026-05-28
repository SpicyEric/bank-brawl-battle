import type { UnitType } from './battleGame';
import { supabase } from '@/integrations/supabase/client';

const STORAGE_KEY = 'unitIconMap.v1';
const ATTACK_KEY = 'unitAttackIconMap.v1';
const CLONE_KEY = 'unitCloneIconMap.v1';
const ANIM_KEY = 'unitAnimationMap.v1';
const SOUND_KEY = 'unitSoundMap.v1';
const MIGRATED_FLAG = 'unitIconMap.migratedToCloud.v1';

export type UnitIconMap = Partial<Record<UnitType, string>>;
export type Slot = 'unit' | 'attack' | 'clone' | 'animation' | 'sound';

// Build list of available icon filenames (1023 icons)
export const ALL_ICONS: string[] = Array.from({ length: 1023 }, (_, i) =>
  `icon${String(i + 1).padStart(3, '0')}.png`
);

export function iconUrl(filename: string): string {
  return `/unit-icons/${filename}`;
}

/** Animation sprite-sheet manifest entry. Frame size is always 64x64. */
export interface AnimEntry { f: string; c: number; r: number }
let ANIM_MANIFEST: AnimEntry[] = [];
let animManifestPromise: Promise<AnimEntry[]> | null = null;
export function getAnimationManifest(): AnimEntry[] { return ANIM_MANIFEST; }
export function loadAnimationManifest(): Promise<AnimEntry[]> {
  if (ANIM_MANIFEST.length) return Promise.resolve(ANIM_MANIFEST);
  if (animManifestPromise) return animManifestPromise;
  animManifestPromise = fetch('/effect-animations/manifest.json')
    .then(r => r.json())
    .then((j: AnimEntry[]) => { ANIM_MANIFEST = j; return j; })
    .catch(e => { console.warn('[unitIcons] anim manifest load failed', e); return []; });
  return animManifestPromise;
}
export function animationUrl(filename: string): string {
  return `/effect-animations/${filename}`;
}
export function getAnimationEntry(filename: string | null | undefined): AnimEntry | null {
  if (!filename) return null;
  return ANIM_MANIFEST.find(a => a.f === filename) ?? null;
}

interface Caches {
  unit: UnitIconMap;
  attack: UnitIconMap;
  clone: UnitIconMap;
  animation: UnitIconMap;
  sound: UnitIconMap;
}
const cache: Caches = { unit: {}, attack: {}, clone: {}, animation: {}, sound: {} };
const listeners = new Set<() => void>();
let loaded = false;
let loadingPromise: Promise<void> | null = null;

function emit() {
  listeners.forEach(l => l());
}

function loadLocal(key: string): UnitIconMap {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function writeLocalMirror() {
  // Keep localStorage as offline mirror
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache.unit));
    localStorage.setItem(ATTACK_KEY, JSON.stringify(cache.attack));
    localStorage.setItem(CLONE_KEY, JSON.stringify(cache.clone));
    localStorage.setItem(ANIM_KEY, JSON.stringify(cache.animation));
    localStorage.setItem(SOUND_KEY, JSON.stringify(cache.sound));
  } catch {}
}
}

/** Loads assignments from backend. If backend is empty and we have local data, migrate it up. */
export async function initIconAssignments(): Promise<void> {
  if (loaded) return;
  if (loadingPromise) return loadingPromise;

  // Seed cache from local storage immediately so first paint isn't blank
  cache.unit = loadLocal(STORAGE_KEY);
  cache.attack = loadLocal(ATTACK_KEY);
  cache.clone = loadLocal(CLONE_KEY);
  cache.animation = loadLocal(ANIM_KEY);
  emit();

  loadingPromise = (async () => {
    const { data, error } = await supabase
      .from('unit_icon_assignments')
      .select('slot, unit_type, icon_filename');

    if (error) {
      console.warn('[unitIcons] backend load failed, using local cache', error);
      loaded = true;
      return;
    }

    const remote: Caches = { unit: {}, attack: {}, clone: {}, animation: {} };
    for (const row of data ?? []) {
      const slot = row.slot as Slot;
      if (remote[slot]) remote[slot][row.unit_type as UnitType] = row.icon_filename;
    }

    const remoteEmpty =
      Object.keys(remote.unit).length === 0 &&
      Object.keys(remote.attack).length === 0 &&
      Object.keys(remote.clone).length === 0 &&
      Object.keys(remote.animation).length === 0;

    const alreadyMigrated = (() => {
      try { return localStorage.getItem(MIGRATED_FLAG) === '1'; } catch { return false; }
    })();

    const localHasData =
      Object.keys(cache.unit).length +
      Object.keys(cache.attack).length +
      Object.keys(cache.clone).length +
      Object.keys(cache.animation).length > 0;

    if (remoteEmpty && localHasData && !alreadyMigrated) {
      // Migrate local → cloud (one-time)
      const rows: { slot: Slot; unit_type: string; icon_filename: string }[] = [];
      (['unit','attack','clone','animation'] as Slot[]).forEach(slot => {
        for (const [unit_type, icon_filename] of Object.entries(cache[slot])) {
          if (icon_filename) rows.push({ slot, unit_type, icon_filename });
        }
      });
      if (rows.length) {
        const { error: upErr } = await supabase.from('unit_icon_assignments').upsert(rows);
        if (upErr) console.warn('[unitIcons] migration upload failed', upErr);
        else console.log(`[unitIcons] migrated ${rows.length} assignments from localStorage to cloud`);
      }
      try { localStorage.setItem(MIGRATED_FLAG, '1'); } catch {}
    } else {
      // Use remote as source of truth
      cache.unit = remote.unit;
      cache.attack = remote.attack;
      cache.clone = remote.clone;
      cache.animation = remote.animation;
      writeLocalMirror();
      emit();
    }

    loaded = true;

    // Subscribe to realtime changes
    supabase
      .channel('unit_icon_assignments_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'unit_icon_assignments' }, payload => {
        const row: any = payload.new ?? payload.old;
        if (!row) return;
        const slot = row.slot as Slot;
        if (!cache[slot]) return;
        if (payload.eventType === 'DELETE') {
          delete cache[slot][row.unit_type as UnitType];
        } else {
          cache[slot][row.unit_type as UnitType] = row.icon_filename;
        }
        writeLocalMirror();
        emit();
      })
      .subscribe();
  })();

  return loadingPromise;
}

// Fire init on module load (best-effort, non-blocking)
if (typeof window !== 'undefined') {
  initIconAssignments().catch(() => {});
}

export function loadIconMap(): UnitIconMap { return cache.unit; }
export function loadAttackIconMap(): UnitIconMap { return cache.attack; }
export function loadCloneIconMap(): UnitIconMap { return cache.clone; }
export function loadAnimationMap(): UnitIconMap { return cache.animation; }

export function getUnitIcon(type: UnitType): string | null {
  return cache.unit[type] ?? null;
}
export function getAttackIcon(type: UnitType | string | undefined): string | null {
  if (!type) return null;
  return cache.attack[type as UnitType] ?? null;
}
export function getCloneIcon(type: UnitType): string | null {
  return cache.clone[type] ?? null;
}
export function getAnimation(type: UnitType | string | undefined): string | null {
  if (!type) return null;
  return cache.animation[type as UnitType] ?? null;
}

async function persistDiff(slot: Slot, next: UnitIconMap) {
  const prev = cache[slot];
  const toUpsert: { slot: Slot; unit_type: string; icon_filename: string }[] = [];
  const toDelete: string[] = [];

  for (const [k, v] of Object.entries(next)) {
    if (v && prev[k as UnitType] !== v) toUpsert.push({ slot, unit_type: k, icon_filename: v });
  }
  for (const k of Object.keys(prev)) {
    if (!next[k as UnitType]) toDelete.push(k);
  }

  if (toUpsert.length) {
    const { error } = await supabase.from('unit_icon_assignments').upsert(toUpsert);
    if (error) console.warn('[unitIcons] upsert failed', error);
  }
  if (toDelete.length) {
    const { error } = await supabase
      .from('unit_icon_assignments')
      .delete()
      .eq('slot', slot)
      .in('unit_type', toDelete);
    if (error) console.warn('[unitIcons] delete failed', error);
  }
}

function setMap(slot: Slot, next: UnitIconMap) {
  const copy = { ...next };
  // Fire-and-forget backend sync
  persistDiff(slot, copy).catch(e => console.warn('[unitIcons] persist failed', e));
  cache[slot] = copy;
  writeLocalMirror();
  emit();
}

export function saveIconMap(map: UnitIconMap) { setMap('unit', map); }
export function saveAttackIconMap(map: UnitIconMap) { setMap('attack', map); }
export function saveCloneIconMap(map: UnitIconMap) { setMap('clone', map); }
export function saveAnimationMap(map: UnitIconMap) { setMap('animation', map); }

export function subscribeIconMap(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
