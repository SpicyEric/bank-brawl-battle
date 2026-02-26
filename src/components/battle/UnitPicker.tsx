import { useState } from 'react';
import { UnitType, UNIT_DEFS, UNIT_TYPES, MAX_UNITS } from '@/lib/battleGame';
import { UnitInfoModal } from './UnitInfoModal';

interface UnitPickerProps {
  selected: UnitType | null;
  onSelect: (type: UnitType) => void;
  placedCount: number;
}

export function UnitPicker({ selected, onSelect, placedCount }: UnitPickerProps) {
  const [infoUnit, setInfoUnit] = useState<UnitType | null>(null);

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Einheit wählen</p>
          <p className="text-xs text-muted-foreground">{placedCount}/{MAX_UNITS} platziert</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {UNIT_TYPES.map(type => {
            const def = UNIT_DEFS[type];
            const isSelected = selected === type;
            return (
              <button
                key={type}
                onClick={() => onSelect(type)}
                className={`p-2 rounded-xl border transition-all text-center relative ${
                  isSelected
                    ? 'border-primary bg-primary/10 ring-1 ring-primary'
                    : 'border-border bg-card hover:border-primary/40'
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
