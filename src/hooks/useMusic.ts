import { useEffect, useState, useCallback } from 'react';
import {
  startMenuTrack,
  stopMenuTrack,
  isMenuMuted,
  setMenuMuted,
  subscribeMute,
} from '@/lib/menuAudio';

const BATTLE_TRACK = '/music/Cracked_Sand_2.mp3';

let battleAudio: HTMLAudioElement | null = null;
let battleStarted = false;
let currentMode: 'menu' | 'battle' | null = null;

function playBattleTrack() {
  if (battleAudio) {
    battleAudio.pause();
  }
  const a = new Audio(BATTLE_TRACK);
  a.volume = 0.25;
  a.loop = true;
  a.muted = isMenuMuted();
  battleAudio = a;
  a.play().catch(() => {});
}

function startBattleMusic() {
  currentMode = 'battle';
  playBattleTrack();
}

function stopBattleMusic() {
  if (battleAudio) {
    battleAudio.pause();
  }
}

export function useMusic(mode: 'menu' | 'battle' = 'menu') {
  const [muted, setMutedState] = useState(isMenuMuted());

  useEffect(() => {
    if (mode === 'menu') {
      // Stop battle audio if it was playing
      if (currentMode === 'battle') stopBattleMusic();
      currentMode = 'menu';
      // Continue menu track across screens — never restart from 0 here.
      startMenuTrack(false);


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
