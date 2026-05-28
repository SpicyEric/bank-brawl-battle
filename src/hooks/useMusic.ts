import { useEffect, useState, useCallback } from 'react';
import {
  startMenuTrack,
  stopMenuTrack,
  isMenuMuted,
  setMenuMuted,
  subscribeMute,
} from '@/lib/menuAudio';

const BATTLE_TRACKS = [
  '/music/cracked-sand.mp3',
  '/music/cracked-sand-1.mp3',
];

let battleAudio: HTMLAudioElement | null = null;
let battleStarted = false;
let battleQueue: string[] = [];
let battleQueueIndex = 0;
let currentMode: 'menu' | 'battle' | null = null;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function onBattleTrackEnded() {
  if (currentMode !== 'battle') return;
  battleQueueIndex++;
  if (battleQueueIndex >= battleQueue.length) {
    battleQueue = shuffle(BATTLE_TRACKS);
    battleQueueIndex = 0;
  }
  playBattleTrack(battleQueue[battleQueueIndex]);
}

function playBattleTrack(src: string) {
  if (battleAudio) {
    battleAudio.pause();
    battleAudio.removeEventListener('ended', onBattleTrackEnded);
  }
  const a = new Audio(src);
  a.volume = 0.15;
  a.muted = isMenuMuted();
  a.addEventListener('ended', onBattleTrackEnded);
  battleAudio = a;
  a.play().catch(() => {});
}

function startBattleMusic() {
  currentMode = 'battle';
  battleQueue = shuffle(BATTLE_TRACKS);
  battleQueueIndex = 0;
  playBattleTrack(battleQueue[0]);
}

function stopBattleMusic() {
  if (battleAudio) {
    battleAudio.pause();
    battleAudio.removeEventListener('ended', onBattleTrackEnded);
  }
}

export function useMusic(mode: 'menu' | 'battle' = 'menu') {
  const [muted, setMutedState] = useState(isMenuMuted());

  useEffect(() => {
    if (mode === 'menu') {
      // Stop battle audio if it was playing
      if (currentMode === 'battle') stopBattleMusic();
      currentMode = 'menu';
      // Restart menu track from beginning on every menu mount
      startMenuTrack(true);

      // Fallback if autoplay was blocked: kick off on first interaction
      const resume = () => {
        startMenuTrack(false);
        document.removeEventListener('pointerdown', resume);
        document.removeEventListener('keydown', resume);
      };
      document.addEventListener('pointerdown', resume);
      document.addEventListener('keydown', resume);
      return () => {
        document.removeEventListener('pointerdown', resume);
        document.removeEventListener('keydown', resume);
      };
    } else {
      // Battle: stop menu, start battle
      stopMenuTrack();
      if (!battleStarted || currentMode !== 'battle') {
        battleStarted = true;
        startBattleMusic();
      }
    }
  }, [mode]);

  // Stay in sync with global mute changes (e.g. toggled elsewhere)
  useEffect(() => subscribeMute(setMutedState), []);

  const toggleMute = useCallback(() => {
    const next = !isMenuMuted();
    setMenuMuted(next);
    if (battleAudio) battleAudio.muted = next;
    setMutedState(next);
  }, []);

  return { muted, toggleMute };
}
