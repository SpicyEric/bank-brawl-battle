import { useEffect, useState, useCallback } from 'react';

const MENU_TRACK = '/music/background.mp3';
const BATTLE_TRACKS = [
  '/music/stoischer-ringkampf.mp3',
  '/music/stoischer-kreis.mp3',
  '/music/stoischer-kreis-1.mp3',
  '/music/stoischer-kreis-2.mp3',
  '/music/stoischer-kreis-3.mp3',
  '/music/ewige-klinge.mp3',
  '/music/ewige-klinge-1.mp3',
  '/music/endloser-stahl.mp3',
  '/music/endloser-stahl-1.mp3',
  '/music/stahlring-der-schritte.mp3',
  '/music/stahlring-der-schritte-1.mp3',
];

let globalAudio: HTMLAudioElement | null = null;
let globalMuted = false;
let globalStarted = false;
let currentMode: 'menu' | 'battle' = 'menu';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let battleQueue: string[] = [];
let battleQueueIndex = 0;

function playTrack(src: string, loop: boolean) {
  if (globalAudio) {
    globalAudio.pause();
    globalAudio.removeEventListener('ended', onBattleTrackEnded);
  }
  const audio = new Audio(src);
  audio.volume = 0.15;
  audio.muted = globalMuted;
  audio.loop = loop;
  if (!loop) {
    audio.addEventListener('ended', onBattleTrackEnded);
  }
  globalAudio = audio;
  audio.play().catch(() => {});
}

function onBattleTrackEnded() {
  if (currentMode !== 'battle') return;
  battleQueueIndex++;
  if (battleQueueIndex >= battleQueue.length) {
    battleQueue = shuffle(BATTLE_TRACKS);
    battleQueueIndex = 0;
  }
  playTrack(battleQueue[battleQueueIndex], false);
}

function startMenuMusic() {
  currentMode = 'menu';
  playTrack(MENU_TRACK, true);
}

function startBattleMusic() {
  if (currentMode === 'battle') return;
  currentMode = 'battle';
  battleQueue = shuffle(BATTLE_TRACKS);
  battleQueueIndex = 0;
  playTrack(battleQueue[0], false);
}

function tryAutoplay(mode: 'menu' | 'battle') {
  if (globalStarted) return;
  globalStarted = true;
  if (mode === 'menu') startMenuMusic();
  else startBattleMusic();
}

export function useMusic(mode: 'menu' | 'battle' = 'menu') {
  const [muted, setMuted] = useState(globalMuted);

  useEffect(() => {
    if (!globalStarted) {
      // Try autoplay immediately
      tryAutoplay(mode);

      // Fallback: start on first user interaction if autoplay was blocked
      const startOnInteraction = () => {
        if (globalStarted && globalAudio) {
          // Already started but might be blocked — try playing
          globalAudio.play().catch(() => {});
          document.removeEventListener('click', startOnInteraction);
          document.removeEventListener('touchstart', startOnInteraction);
          return;
        }
        tryAutoplay(mode);
        document.removeEventListener('click', startOnInteraction);
        document.removeEventListener('touchstart', startOnInteraction);
      };
      document.addEventListener('click', startOnInteraction);
      document.addEventListener('touchstart', startOnInteraction);
      return () => {
        document.removeEventListener('click', startOnInteraction);
        document.removeEventListener('touchstart', startOnInteraction);
      };
    }

    // Already started – switch mode if needed
    if (mode === 'menu' && currentMode !== 'menu') {
      startMenuMusic();
    } else if (mode === 'battle' && currentMode !== 'battle') {
      startBattleMusic();
    }
  }, [mode]);

  const toggleMute = useCallback(() => {
    const next = !globalMuted;
    globalMuted = next;
    if (globalAudio) globalAudio.muted = next;
    setMuted(next);
  }, []);

  return { muted, toggleMute };
}
