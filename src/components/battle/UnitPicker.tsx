import { useState, useRef, useCallback } from 'react';
import { UnitType, UNIT_DEFS, UNIT_TYPES, UNIT_COLOR_GROUPS, ColorGroup } from '@/lib/battleGame';
import { UnitInfoModal } from './UnitInfoModal';

const COLOR_BORDER: Record<ColorGroup, string> = {
  red: 'border-unit-red',
  blue: 'border-unit-blue',
  green: 'border-unit-green',
};
const COLOR_BG: Record<ColorGroup, string> = {
  red: 'bg-unit-red/15',
  blue: 'bg-unit-blue/15',
  green: 'bg-unit-green/15',
};

const LONG_PRESS_MS = 400;

interface UnitPickerProps {
  selected: UnitType | null;
  onSelect: (type: UnitType) => void;
  placedCount: number;
  maxUnits: number;
  bannedUnits?: UnitType[];
  fatigue?: Record<string, number>;
}

export function UnitPicker({ selected, onSelect, placedCount, maxUnits, bannedUnits = [], fatigue = {} }: UnitPickerProps) {
  const [infoUnit, setInfoUnit] = useState<UnitType | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  const startPress = useCallback((type: UnitType) => {
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      setInfoUnit(type);
    }, LONG_PRESS_MS);
  }, []);

  const cancelPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleClick = useCallback((type: UnitType) => {
    if (didLongPress.current) {
      didLongPress.current = false;
      return; // was a long press, don't select
    }
    onSelect(type);
  }, [onSelect]);

  return (
    <>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground text-center">{placedCount}/{maxUnits} platziert · <span className="text-[10px] opacity-60">gedrückt halten = Info</span></p>
        <div className="grid grid-cols-3 gap-2">
          {UNIT_TYPES.map(type => {
            const def = UNIT_DEFS[type];
            const color = UNIT_COLOR_GROUPS[type];
            const isSelected = selected === type;
            const isBanned = bannedUnits.includes(type);
            const fatigueLevel = fatigue[type] || 0;
            return (
              <button
                key={type}
                onClick={() => !isBanned && handleClick(type)}
                onTouchStart={() => startPress(type)}
                onTouchEnd={cancelPress}
                onTouchCancel={cancelPress}
                onMouseDown={() => startPress(type)}
                onMouseUp={cancelPress}
                onMouseLeave={cancelPress}
                onContextMenu={(e) => e.preventDefault()}
                disabled={isBanned}
                className={`p-2 rounded-xl border-2 transition-all text-center relative select-none ${
                  isBanned
                    ? 'border-border bg-muted/30 opacity-40 cursor-not-allowed grayscale'
                    : isSelected
                    ? `${COLOR_BORDER[color]} ${COLOR_BG[color]} ring-1 ring-primary`
                    : `border-border ${COLOR_BG[color]} hover:${COLOR_BORDER[color]}`
                }`}
              >
                {isBanned && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <span className="text-lg">💤</span>
                  </div>
                )}
                <span className="text-xl block">{def.emoji}</span>
                <p className="text-[10px] font-semibold text-foreground mt-1">{def.label}</p>
                <p className="text-[9px] text-muted-foreground">
                  {isBanned ? 'Ermüdet' : <>❤️{def.hp} ⚔️{def.attack}</>}
                </p>
                {!isBanned && fatigueLevel > 0 && (
                  <div className="absolute top-0.5 right-0.5 w-3 h-3 rounded-full bg-warning/80 flex items-center justify-center">
                    <span className="text-[7px] font-bold text-warning-foreground">{fatigueLevel}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {infoUnit && (
        <UnitInfoModal unitType={infoUnit} onClose={() => setInfoUnit(null)} />
      )}
    </>
  );
}
