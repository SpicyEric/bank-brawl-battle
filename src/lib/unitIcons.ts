import type { UnitType } from './battleGame';

const STORAGE_KEY = 'unitIconMap.v1';
const ATTACK_KEY = 'unitAttackIconMap.v1';
const CLONE_KEY = 'unitCloneIconMap.v1';

export type UnitIconMap = Partial<Record<UnitType, string>>; // value = icon filename e.g. "icon042.png"

// Build list of available icon filenames (1023 icons: icon001.png .. icon1023.png)
export const ALL_ICONS: string[] = Array.from({ length: 1023 }, (_, i) =>
  `icon${String(i + 1).padStart(3, '0')}.png`
);

export function iconUrl(filename: string): string {
  return `/unit-icons/${filename}`;
}

interface Caches {
  unit: UnitIconMap | null;
  attack: UnitIconMap | null;
  clone: UnitIconMap | null;
}
const cache: Caches = { unit: null, attack: null, clone: null };
const listeners = new Set<() => void>();

function load(key: string): UnitIconMap {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function loadIconMap(): UnitIconMap {
  if (!cache.unit) cache.unit = load(STORAGE_KEY);
  return cache.unit!;
}
export function loadAttackIconMap(): UnitIconMap {
  if (!cache.attack) cache.attack = load(ATTACK_KEY);
  return cache.attack!;
}
export function loadCloneIconMap(): UnitIconMap {
  if (!cache.clone) cache.clone = load(CLONE_KEY);
  return cache.clone!;
}

export function saveIconMap(map: UnitIconMap) {
  cache.unit = { ...map };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache.unit)); } catch {}
  listeners.forEach(l => l());
}
export function saveAttackIconMap(map: UnitIconMap) {
  cache.attack = { ...map };
  try { localStorage.setItem(ATTACK_KEY, JSON.stringify(cache.attack)); } catch {}
  listeners.forEach(l => l());
}
export function saveCloneIconMap(map: UnitIconMap) {
  cache.clone = { ...map };
  try { localStorage.setItem(CLONE_KEY, JSON.stringify(cache.clone)); } catch {}
  listeners.forEach(l => l());
}

export function getUnitIcon(type: UnitType): string | null {
  return loadIconMap()[type] ?? null;
}
export function getAttackIcon(type: UnitType | string | undefined): string | null {
  if (!type) return null;
  return loadAttackIconMap()[type as UnitType] ?? null;
}
export function getCloneIcon(type: UnitType): string | null {
  return loadCloneIconMap()[type] ?? null;
}

export function subscribeIconMap(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
