// Menu music + bass-kick analyser shared across all menu screens.
// Plays /audio/Pixel_Void_Depths.mp3, restarts from 0 on every menu mount,
// and broadcasts a "kick" event whenever a low-frequency transient is detected.

const TRACK = '/audio/Pixel_Void_Depths.mp3';

let audio: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let sourceNode: MediaElementAudioSourceNode | null = null;
let rafId: number | null = null;
let muted = false;
let started = false;

type Listener = () => void;
const kickListeners = new Set<Listener>();
const muteListeners = new Set<(m: boolean) => void>();

// Kick detection state
let bassEMA = 0;            // slow moving average of low-band energy
let lastKickAt = 0;

function ensureGraph() {
  if (audio && ctx) return;
  audio = new Audio(TRACK);
  audio.loop = true;
  audio.volume = 0.35;
  audio.crossOrigin = 'anonymous';
  audio.muted = muted;
  try {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    sourceNode = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.2;
    sourceNode.connect(analyser);
    analyser.connect(ctx.destination);
  } catch (e) {
    // Web Audio failed — keep plain audio playback
    ctx = null;
    analyser = null;
  }
}

function tick() {
  if (!analyser) { rafId = null; return; }
  const bins = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(bins);
  // Low band: first ~6 bins (~ 0-260 Hz at 44.1kHz / fftSize 512)
  let sum = 0;
  for (let i = 1; i <= 5; i++) sum += bins[i];
  const energy = sum / 5;

  // Slow EMA for adaptive threshold
  bassEMA = bassEMA * 0.96 + energy * 0.04;

  const now = performance.now();
  const threshold = Math.max(140, bassEMA * 1.45);
  if (energy > threshold && now - lastKickAt > 140) {
    lastKickAt = now;
    kickListeners.forEach(l => { try { l(); } catch {} });
  }
  rafId = requestAnimationFrame(tick);
}

function startLoop() {
  if (rafId != null) return;
  rafId = requestAnimationFrame(tick);
}

/** Start (or restart) the menu track from the beginning. Idempotent per call. */
export function startMenuTrack(restart = true) {
  ensureGraph();
  if (!audio) return;
  started = true;
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (restart) {
    try { audio.currentTime = 0; } catch { }
  }
  audio.play().catch(() => {});
  startLoop();
}

export function stopMenuTrack() {
  if (audio) {
    audio.pause();
  }
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

export function isMenuMuted() { return muted; }
export function setMenuMuted(next: boolean) {
  muted = next;
  if (audio) audio.muted = next;
  muteListeners.forEach(l => { try { l(next); } catch {} });
}
export function toggleMenuMuted() { setMenuMuted(!muted); return muted; }

export function subscribeBassKick(cb: Listener): () => void {
  kickListeners.add(cb);
  return () => kickListeners.delete(cb);
}
export function subscribeMute(cb: (m: boolean) => void): () => void {
  muteListeners.add(cb);
  return () => muteListeners.delete(cb);
}

export function menuTrackStarted() { return started; }
