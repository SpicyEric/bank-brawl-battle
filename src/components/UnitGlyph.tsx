import { useEffect, useState } from 'react';
import { UNIT_DEFS, type UnitType } from '@/lib/battleGame';
import { getUnitIcon, getCloneIcon, iconUrl, subscribeIconMap } from '@/lib/unitIcons';

interface Props {
  type: UnitType;
  className?: string;
  /** Pixel size for icon image (defaults to inheriting via class) */
  size?: number;
  /** If true, render the clone variant icon (spawned clone of a cloner). */
  isClone?: boolean;
}

/** Renders the unit's custom icon if assigned, otherwise its emoji. */
export function UnitGlyph({ type, className, size, isClone }: Props) {
  const [, force] = useState(0);
  useEffect(() => subscribeIconMap(() => force(n => n + 1)), []);
  const icon = isClone ? (getCloneIcon(type) ?? getUnitIcon(type)) : getUnitIcon(type);
  if (icon) {
    return (
      <img
        src={iconUrl(icon)}
        alt={UNIT_DEFS[type].label}
        draggable={false}
        className={className}
        style={size ? { width: size, height: size, imageRendering: 'pixelated' } : { imageRendering: 'pixelated' }}
      />
    );
  }
  return <span className={className}>{UNIT_DEFS[type].emoji}</span>;
}
