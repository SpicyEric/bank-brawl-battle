import { useEffect, useMemo, useRef, useState } from 'react';
import { loadIconMap, iconUrl } from '@/lib/unitIcons';
import { subscribeBassKick } from '@/lib/menuAudio';

interface FallingIcon {
  id: number;
  src: string;
  left: number;       // % of viewport width
  size: number;       // px
  duration: number;   // seconds for one fall
  delay: number;      // seconds initial delay
  opacity: number;
  reactive: boolean;  // pulses on bass kicks
  rotate: number;     // deg
}

const COUNT = 28;

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function buildIcons(srcs: string[]): FallingIcon[] {
  if (srcs.length === 0) return [];
  const out: FallingIcon[] = [];
  for (let i = 0; i < COUNT; i++) {
    // Depth: small + faint + slower-ish = far; large + brighter = near.
    const depth = Math.random();
    const size = Math.round(rand(28, 110) * (0.5 + depth * 0.8));
    const opacity = 0.18 + depth * 0.45;
    const duration = rand(18, 38) - depth * 4; // bigger ones fall a bit faster
    out.push({
      id: i,
      src: iconUrl(srcs[Math.floor(Math.random() * srcs.length)]),
      left: rand(-5, 100),
      size,
      duration,
      delay: -rand(0, duration), // negative = already mid-flight
      opacity,
      reactive: Math.random() < 0.5,
      rotate: rand(-12, 12),
    });
  }
  return out;
}

export const MenuBackground = () => {
  const [icons, setIcons] = useState<FallingIcon[]>([]);
  const reactiveRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Build icons once icon map is available; retry briefly if not loaded yet.
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const build = () => {
      if (cancelled) return;
      const map = loadIconMap();
      const srcs = Object.values(map).filter(Boolean) as string[];
      if (srcs.length > 0) {
        setIcons(buildIcons(srcs));
      } else if (tries++ < 20) {
        setTimeout(build, 250);
      }
    };
    build();
    return () => { cancelled = true; };
  }, []);

  // Bass-kick pulse on reactive icons
  useEffect(() => {
    return subscribeBassKick(() => {
      reactiveRefs.current.forEach((el) => {
        // restart animation
        el.classList.remove('menu-bg-pulse');
        // force reflow
        void el.offsetWidth;
        el.classList.add('menu-bg-pulse');
      });
    });
  }, [icons.length]);

  const styleTag = useMemo(() => `
    @keyframes menuBgFall {
      0%   { transform: translate3d(0, -20vh, 0) rotate(var(--rot, 0deg)); }
      100% { transform: translate3d(0, 120vh, 0) rotate(var(--rot, 0deg)); }
    }
    @keyframes menuBgPulse {
      0%   { filter: drop-shadow(0 0 0 hsl(var(--primary) / 0)); transform: scale(1); }
      30%  { filter: drop-shadow(0 0 14px hsl(var(--primary) / 0.85)); transform: scale(1.55); }
      100% { filter: drop-shadow(0 0 0 hsl(var(--primary) / 0)); transform: scale(1); }
    }
    .menu-bg-icon {
      position: absolute;
      top: 0;
      will-change: transform, opacity;
      animation-name: menuBgFall;
      animation-timing-function: linear;
      animation-iteration-count: infinite;
      pointer-events: none;
    }
    .menu-bg-icon img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      image-rendering: pixelated;
    }
    .menu-bg-icon .pulse-wrap {
      width: 100%;
      height: 100%;
      transform-origin: center;
    }
    .menu-bg-pulse { animation: menuBgPulse 320ms ease-out; }
  `, []);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden>
      <style>{styleTag}</style>
      {icons.map(ic => (
        <div
          key={ic.id}
          className="menu-bg-icon"
          style={{
            left: `${ic.left}%`,
            width: ic.size,
            height: ic.size,
            opacity: ic.opacity,
            animationDuration: `${ic.duration}s`,
            animationDelay: `${ic.delay}s`,
            ['--rot' as any]: `${ic.rotate}deg`,
          }}
        >
          <div
            className="pulse-wrap"
            ref={ic.reactive ? (el => {
              if (el) reactiveRefs.current.set(ic.id, el);
              else reactiveRefs.current.delete(ic.id);
            }) : undefined}
          >
            <img src={ic.src} alt="" loading="lazy" draggable={false} />
          </div>
        </div>
      ))}
    </div>
  );
};

export default MenuBackground;
