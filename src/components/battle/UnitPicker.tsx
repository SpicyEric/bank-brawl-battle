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
}

export function UnitPicker({ selected, onSelect, placedCount, maxUnits }: UnitPickerProps) {
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
            return (
              <button
                key={type}
                onClick={() => handleClick(type)}
                onTouchStart={() => startPress(type)}
                onTouchEnd={cancelPress}
                onTouchCancel={cancelPress}
                onMouseDown={() => startPress(type)}
                onMouseUp={cancelPress}
                onMouseLeave={cancelPress}
                onContextMenu={(e) => e.preventDefault()}
                className={`p-2 rounded-xl border-2 transition-all text-center relative select-none ${
                  isSelected
                    ? `${COLOR_BORDER[color]} ${COLOR_BG[color]} ring-1 ring-primary`
                    : `border-border ${COLOR_BG[color]} hover:${COLOR_BORDER[color]}`
                }`}
              >
                <span className="text-xl block">{def.emoji}</span>
                <p className="text-[10px] font-semibold text-foreground mt-1">{def.label}</p>
                <p className="text-[9px] text-muted-foreground">❤️{def.hp} ⚔️{def.attack}</p>
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
