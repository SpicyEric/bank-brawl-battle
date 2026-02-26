import { useState } from 'react';
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

interface UnitPickerProps {
  selected: UnitType | null;
  onSelect: (type: UnitType) => void;
  placedCount: number;
  maxUnits: number;
}

export function UnitPicker({ selected, onSelect, placedCount, maxUnits }: UnitPickerProps) {
  const [infoUnit, setInfoUnit] = useState<UnitType | null>(null);

  return (
    <>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground text-center">{placedCount}/{maxUnits} platziert</p>
        <div className="grid grid-cols-3 gap-2">
          {UNIT_TYPES.map(type => {
            const def = UNIT_DEFS[type];
            const color = UNIT_COLOR_GROUPS[type];
            const isSelected = selected === type;
            return (
              <button
                key={type}
                onClick={() => onSelect(type)}
                className={`p-2 rounded-xl border-2 transition-all text-center relative ${
                  isSelected
                    ? `${COLOR_BORDER[color]} ${COLOR_BG[color]} ring-1 ring-primary`
                    : `border-border ${COLOR_BG[color]} hover:${COLOR_BORDER[color]}`
                }`}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); setInfoUnit(type); }}
                  className="absolute top-1 right-1 w-4 h-4 rounded-full bg-muted text-muted-foreground text-[9px] flex items-center justify-center hover:bg-accent"
                >
                  i
                </button>
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