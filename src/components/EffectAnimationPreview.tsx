import { useEffect, useMemo, useState } from 'react';
import { animationUrl, type AnimEntry } from '@/lib/unitIcons';

interface Props {
  entry: AnimEntry;
  /** Render size in px (square). Frame is 64×64 in source. */
  size?: number;
  /** Which row of the sprite-sheet to play (0-based). Defaults to 0. */
  row?: number;
  /** Frames per second. Defaults to 14. */
  fps?: number;
  className?: string;
}

/**
 * Plays a 64×64 sprite-sheet animation using CSS steps().
 * Sheets are N cols × 9 rows of 64×64 frames.
 */
export function EffectAnimationPreview({ entry, size = 64, row = 0, fps = 14, className }: Props) {
  const url = animationUrl(entry.f);
  const cols = entry.c;
  const rows = entry.r;
  const scale = size / 64;
  const sheetW = cols * size;
  const sheetH = rows * size;
  const duration = cols / fps;
  // Unique animation name so each sprite can have its own keyframe range
  const animName = useMemo(() => `sprite-${entry.f.replace('.png','')}-c${cols}`, [entry.f, cols]);

  return (
    <>
      <style>{`
        @keyframes ${animName} {
          from { background-position: 0 ${-row * size}px; }
          to   { background-position: ${-sheetW}px ${-row * size}px; }
        }
      `}</style>
      <div
        className={className}
        style={{
          width: size,
          height: size,
          backgroundImage: `url(${url})`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${sheetW}px ${sheetH}px`,
          backgroundPosition: `0 ${-row * size}px`,
          imageRendering: 'pixelated',
          animation: `${animName} ${duration}s steps(${cols}) infinite`,
        }}
      />
    </>
  );
}
