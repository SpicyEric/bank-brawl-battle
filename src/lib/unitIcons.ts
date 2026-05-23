import type { UnitType } from './battleGame';

const STORAGE_KEY = 'unitIconMap.v1';

export type UnitIconMap = Partial<Record<UnitType, string>>; // value = icon filename e.g. "icon042.png"

// Build list of available icon filenames (1023 icons: icon001.png .. icon1023.png)
export const ALL_ICONS: string[] = Array.from({ length: 1023 }, (_, i) =>
  `icon${String(i + 1).padStart(3, '0')}.png`
);

export function iconUrl(filename: string): string {
  return `/unit-icons/${filename}`;
}

let cache: UnitIconMap | null = null;
const listeners = new Set<() => void>();

export function loadIconMap(): UnitIconMap {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? JSON.parse(raw) : {};
  } catch {
    cache = {};
  }
  return cache!;
}

export function saveIconMap(map: UnitIconMap) {
  cache = { ...map };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); } catch {}
  listeners.forEach(l => l());
}

export function getUnitIcon(type: UnitType): string | null {
  const map = loadIconMap();
  return map[type] ?? null;
}

export function subscribeIconMap(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
