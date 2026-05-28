import { getUnitSound, soundUrl } from './unitIcons';
import { isSfxMuted } from './sfx';
import type { UnitType } from './battleGame';

export type SoundCategory = 'buffs' | 'magic' | 'dungeon';
export type SoundManifest = Record<SoundCategory, string[]>;

let manifest: SoundManifest | null = null;
let manifestPromise: Promise<SoundManifest> | null = null;

export function loadSoundManifest(): Promise<SoundManifest> {
  if (manifest) return Promise.resolve(manifest);
  if (manifestPromise) return manifestPromise;
  manifestPromise = fetch('/sounds/manifest.json')
    .then(r => r.json())
    .then((j: SoundManifest) => { manifest = j; return j; })
    .catch(e => { console.warn('[unitSounds] manifest load failed', e); return { buffs: [], magic: [], dungeon: [] } as SoundManifest; });
  return manifestPromise;
}
export function getSoundManifest(): SoundManifest | null { return manifest; }

if (typeof window !== 'undefined') loadSoundManifest().catch(() => {});

const audioCache = new Map<string, HTMLAudioElement>();

export function playUnitSound(type: UnitType | string | undefined, volume = 0.4): boolean {
  if (isSfxMuted()) return false;
  const rel = getUnitSound(type);
  if (!rel) return false;
  try {
    let a = audioCache.get(rel);
    if (!a) {
      a = new Audio(soundUrl(rel));
      a.preload = 'auto';
      audioCache.set(rel, a);
    }
    // Clone for overlap support
    const inst = a.cloneNode(true) as HTMLAudioElement;
    inst.volume = volume;
    inst.play().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export function previewSound(rel: string, volume = 0.5): HTMLAudioElement | null {
  try {
    const a = new Audio(soundUrl(rel));
    a.volume = volume;
    a.play().catch(() => {});
    return a;
  } catch { return null; }
}
