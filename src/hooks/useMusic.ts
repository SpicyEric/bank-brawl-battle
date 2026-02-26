import { useRef, useEffect, useState, useCallback } from 'react';

const TRACKS = ['/music/background.mp3', '/music/stoischer-ringkampf.mp3'];

let globalAudio: HTMLAudioElement | null = null;
let globalTrackIndex = 0;
let globalMuted = false;
let globalStarted = false;

function playNextTrack() {
  if (globalAudio) {
    globalAudio.pause();
    globalAudio.removeEventListener('ended', playNextTrack);
  }
  globalTrackIndex = (globalTrackIndex) % TRACKS.length;
  const audio = new Audio(TRACKS[globalTrackIndex]);
  audio.volume = 0.15;
  audio.muted = globalMuted;
  audio.loop = false;
  audio.addEventListener('ended', () => {
    globalTrackIndex = (globalTrackIndex + 1) % TRACKS.length;
    playNextTrack();
  });
  globalAudio = audio;
  audio.play().catch(() => {});
}

export function useMusic() {
  const [muted, setMuted] = useState(globalMuted);

  useEffect(() => {
    if (globalStarted) return;

    const startOnInteraction = () => {
      if (globalStarted) return;
      globalStarted = true;
      playNextTrack();
      document.removeEventListener('click', startOnInteraction);
    };
    document.addEventListener('click', startOnInteraction);
    return () => {
      document.removeEventListener('click', startOnInteraction);
    };
  }, []);

  const toggleMute = useCallback(() => {
    const next = !globalMuted;
    globalMuted = next;
    if (globalAudio) globalAudio.muted = next;
    setMuted(next);
  }, []);

  return { muted, toggleMute };
}
