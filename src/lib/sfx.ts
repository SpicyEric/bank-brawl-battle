/**
 * Game Sound Effects using Web Audio API
 * Synthesized retro-style sounds that match the game's aesthetic
 */

let audioCtx: AudioContext | null = null;
let sfxMuted = false;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function setSfxMuted(muted: boolean) {
  sfxMuted = muted;
}

export function isSfxMuted(): boolean {
  return sfxMuted;
}

// --- Low-level helpers ---

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'square',
  volume: number = 0.15,
  detune: number = 0,
) {
  if (sfxMuted) return;
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.value = frequency;
  osc.detune.value = detune;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

function playNoise(duration: number, volume: number = 0.08) {
  if (sfxMuted) return;
  const ctx = getCtx();
  const bufferSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 800;

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start();
}

// --- Game Sound Effects ---

/** Unit placed on grid – short pop/click */
export function sfxPlace() {
  if (sfxMuted) return;
  const ctx = getCtx();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, t);
  osc.frequency.exponentialRampToValueAtTime(1200, t + 0.05);
  gain.gain.setValueAtTime(0.2, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}

/** Unit removed from grid – reverse pop */
export function sfxRemove() {
  if (sfxMuted) return;
  const ctx = getCtx();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1000, t);
  osc.frequency.exponentialRampToValueAtTime(400, t + 0.08);
  gain.gain.setValueAtTime(0.15, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}

/** Battle starts – war horn / fanfare */
export function sfxBattleStart() {
  if (sfxMuted) return;
  const ctx = getCtx();
  const t = ctx.currentTime;

  // Horn-like rising tone
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(220, t);
  osc1.frequency.linearRampToValueAtTime(440, t + 0.3);
  gain1.gain.setValueAtTime(0.12, t);
  gain1.gain.setValueAtTime(0.12, t + 0.25);
  gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(t);
  osc1.stop(t + 0.5);

  // Second tone (harmony)
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sawtooth';
  osc2.frequency.setValueAtTime(330, t + 0.1);
  osc2.frequency.linearRampToValueAtTime(550, t + 0.4);
  gain2.gain.setValueAtTime(0, t);
  gain2.gain.linearRampToValueAtTime(0.08, t + 0.15);
  gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(t + 0.1);
  osc2.stop(t + 0.55);
}

/** Attack hit – impact thud */
export function sfxHit() {
  if (sfxMuted) return;
  const ctx = getCtx();
  const t = ctx.currentTime;

  // Impact bass
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(50, t + 0.15);
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.15);

  // Noise crack
  playNoise(0.08, 0.12);
}

/** Critical/strong hit */
export function sfxCriticalHit() {
  if (sfxMuted) return;
  sfxHit();
  setTimeout(() => playTone(200, 0.1, 'square', 0.1), 50);
}

/** Unit killed – dark thud + descending tone */
export function sfxKill() {
  if (sfxMuted) return;
  const ctx = getCtx();
  const t = ctx.currentTime;

  // Deep impact
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(200, t);
  osc.frequency.exponentialRampToValueAtTime(30, t + 0.3);
  gain.gain.setValueAtTime(0.3, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.35);

  // Descending whistle
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(800, t);
  osc2.frequency.exponentialRampToValueAtTime(100, t + 0.25);
  gain2.gain.setValueAtTime(0.08, t);
  gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(t);
  osc2.stop(t + 0.25);

  playNoise(0.1, 0.15);
}

/** Round won – triumphant ascending arpeggio */
export function sfxVictory() {
  if (sfxMuted) return;
  const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    setTimeout(() => playTone(freq, 0.25, 'square', 0.12), i * 100);
  });
  // Final chord
  setTimeout(() => {
    playTone(523, 0.4, 'triangle', 0.08);
    playTone(659, 0.4, 'triangle', 0.08);
    playTone(784, 0.4, 'triangle', 0.08);
  }, 450);
}

/** Round lost – sad descending tones */
export function sfxDefeat() {
  if (sfxMuted) return;
  const notes = [392, 349, 311, 262]; // G4 F4 Eb4 C4
  notes.forEach((freq, i) => {
    setTimeout(() => playTone(freq, 0.3, 'triangle', 0.1), i * 150);
  });
}

/** Confirm placement – ready sound */
export function sfxConfirm() {
  if (sfxMuted) return;
  playTone(880, 0.08, 'square', 0.1);
  setTimeout(() => playTone(1100, 0.12, 'square', 0.1), 80);
}

/** Ranged projectile – pew sound */
export function sfxProjectile() {
  if (sfxMuted) return;
  const ctx = getCtx();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, t);
  osc.frequency.exponentialRampToValueAtTime(300, t + 0.12);
  gain.gain.setValueAtTime(0.1, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.12);
}

/** War cry / morale boost – aggressive rising roar */
export function sfxWarCry() {
  if (sfxMuted) return;
  const ctx = getCtx();
  const t = ctx.currentTime;

  // Aggressive rising sawtooth
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(150, t);
  osc1.frequency.linearRampToValueAtTime(600, t + 0.25);
  gain1.gain.setValueAtTime(0.18, t);
  gain1.gain.setValueAtTime(0.18, t + 0.2);
  gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(t);
  osc1.stop(t + 0.4);

  // Power chord harmony
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'square';
  osc2.frequency.setValueAtTime(220, t + 0.05);
  osc2.frequency.linearRampToValueAtTime(880, t + 0.3);
  gain2.gain.setValueAtTime(0.1, t + 0.05);
  gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(t + 0.05);
  osc2.stop(t + 0.45);

  playNoise(0.15, 0.1);
}

/** Freeze effect */
export function sfxFreeze() {
  if (sfxMuted) return;
  const ctx = getCtx();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(2000, t);
  osc.frequency.exponentialRampToValueAtTime(800, t + 0.15);
  gain.gain.setValueAtTime(0.08, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.2);

  // Shimmer
  setTimeout(() => playTone(3000, 0.1, 'sine', 0.04), 50);
}

/** Focus Fire – targeting lock-on beeps */
export function sfxFocusFire() {
  if (sfxMuted) return;
  const ctx = getCtx();
  const t = ctx.currentTime;

  // Rapid targeting beeps
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1400 + i * 200, t + i * 0.08);
    gain.gain.setValueAtTime(0.12, t + i * 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t + i * 0.08);
    osc.stop(t + i * 0.08 + 0.06);
  }

  // Lock-on confirmation tone
  setTimeout(() => playTone(2000, 0.15, 'sine', 0.1), 250);
}

/** Sacrifice Ritual – dark rumble + soul release */
export function sfxSacrifice() {
  if (sfxMuted) return;
  const ctx = getCtx();
  const t = ctx.currentTime;

  // Deep rumble
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(80, t);
  osc1.frequency.exponentialRampToValueAtTime(40, t + 0.4);
  gain1.gain.setValueAtTime(0.2, t);
  gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(t);
  osc1.stop(t + 0.5);

  // Soul ascending whistle
  setTimeout(() => {
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(300, t + 0.15);
    osc2.frequency.exponentialRampToValueAtTime(2000, t + 0.5);
    gain2.gain.setValueAtTime(0.1, t + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(t + 0.15);
    osc2.stop(t + 0.55);
  }, 150);

  playNoise(0.2, 0.08);
}
