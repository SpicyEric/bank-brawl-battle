import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { UNIT_TYPES, UNIT_DEFS, UnitType, ColorGroup } from '@/lib/battleGame';
import { UnitInfoModal } from '@/components/battle/UnitInfoModal';
import { UnitGlyph } from '@/components/UnitGlyph';

// Slot layout: row 0 = red (slots 0-2), row 1 = green (slots 3-5), row 2 = blue (slots 6-8)
const SLOT_COLORS: ColorGroup[] = ['red','red','red','green','green','green','blue','blue','blue'];
const ROSTER_SIZE = 9;
const LONG_PRESS_MS = 400;

const COLOR_RING: Record<ColorGroup, string> = {
  red: 'border-unit-red/40 bg-unit-red/15',
  green: 'border-unit-green/40 bg-unit-green/15',
  blue: 'border-unit-blue/40 bg-unit-blue/15',
};
const COLOR_EMPTY: Record<ColorGroup, string> = {
  red: 'border-unit-red/30 bg-unit-red/10',
  green: 'border-unit-green/30 bg-unit-green/10',
  blue: 'border-unit-blue/30 bg-unit-blue/10',
};

export default function UnitRoster() {
  const navigate = useNavigate();
  const [slots, setSlots] = useState<(UnitType | null)[]>(Array(ROSTER_SIZE).fill(null));
  const [selectedUnit, setSelectedUnit] = useState<UnitType | null>(null);
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
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  const placedUnits = new Set(slots.filter(Boolean) as UnitType[]);

  const handlePickerClick = (type: UnitType) => {
    if (didLongPress.current) { didLongPress.current = false; return; }
    if (placedUnits.has(type)) return;
    setSelectedUnit(prev => (prev === type ? null : type));
  };

  const handleSlotClick = (slotIdx: number) => {
    const current = slots[slotIdx];
    if (current) {
      // Remove unit from slot → returns to picker
      setSlots(prev => prev.map((s, i) => (i === slotIdx ? null : s)));
      return;
    }
    if (!selectedUnit) return;
    setSlots(prev => prev.map((s, i) => (i === slotIdx ? selectedUnit : s)));
    setSelectedUnit(null);
  };

  const ready = slots.every(s => s !== null);
  const filledCount = slots.filter(Boolean).length;

  const rows: { color: ColorGroup; indices: number[] }[] = [
    { color: 'red', indices: [0,1,2] },
    { color: 'green', indices: [3,4,5] },
    { color: 'blue', indices: [6,7,8] },
  ];

  return (
    <div className="min-h-[100dvh] max-h-[100dvh] bg-background flex flex-col max-w-md mx-auto overflow-hidden" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <button onClick={() => navigate('/singleplayer')} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent">
          <ArrowLeft size={18} />
        </button>
        <h1 className="font-bold text-foreground text-sm flex-1">Stelle deinen Trupp auf</h1>
        <span className="text-[11px] text-muted-foreground font-mono">{filledCount}/{ROSTER_SIZE}</span>
      </div>

      {/* Top: 3 colored rows × 3 slots */}
      <div className="p-3 pt-2">
        <div className="space-y-1.5">
          {rows.map(({ color, indices }) => (
            <div key={color} className="flex items-center gap-1.5">
              <div className="grid grid-cols-3 gap-1.5 flex-1">
                {indices.map(i => {
                  const t = slots[i];
                  const def = t ? UNIT_DEFS[t] : null;
                  const canDrop = !t && !!selectedUnit;
                  return (
                    <button
                      key={i}
                      onClick={() => handleSlotClick(i)}
                      className={`aspect-square rounded-lg border-2 flex flex-col items-center justify-center transition-all relative ${
                        t ? `${COLOR_RING[color]} active:scale-[0.95]`
                          : canDrop ? `border-primary bg-primary/10 ring-1 ring-primary animate-pulse`
                          : `${COLOR_EMPTY[color]} border-dashed`
                      }`}
                    >
                      {def ? (
                        <>
                          <UnitGlyph type={t!} className="w-7 h-7" />
                          <span className="text-[9px] font-semibold text-foreground mt-0.5">{def.label}</span>
                        </>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/60">{canDrop ? 'Hier' : 'Leer'}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom: scrollable picker of all units (color-neutral) */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <p className="text-[10px] text-muted-foreground text-center mb-1.5 opacity-60">
          Gedrückt halten = Info
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {UNIT_TYPES.map(t => {
            const def = UNIT_DEFS[t];
            const isPlaced = placedUnits.has(t);
            const isSelected = selectedUnit === t;
            return (
              <button
                key={t}
                onClick={() => handlePickerClick(t)}
                onTouchStart={() => !isPlaced && startPress(t)}
                onTouchEnd={cancelPress}
                onTouchCancel={cancelPress}
                onMouseDown={() => !isPlaced && startPress(t)}
                onMouseUp={cancelPress}
                onMouseLeave={cancelPress}
                onContextMenu={(e) => e.preventDefault()}
                disabled={isPlaced}
                className={`relative p-1.5 rounded-lg border-2 bg-card transition-all text-center select-none ${
                  isPlaced
                    ? 'border-border opacity-30 grayscale cursor-not-allowed'
                    : isSelected
                    ? 'border-primary ring-2 ring-primary bg-primary/10 scale-[0.97]'
                    : 'border-border active:scale-[0.95] hover:border-primary/40'
                }`}
              >
                {isPlaced && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <span className="text-base">✓</span>
                  </div>
                )}
                <UnitGlyph type={t} className="w-6 h-6 mx-auto block" />
                <p className="text-[9px] font-semibold text-foreground leading-tight mt-0.5">{def.label}</p>
                <p className="text-[8px] text-muted-foreground">❤️{def.hp} ⚔️{def.attack}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Ready button */}
      <div className="p-3 border-t border-border">
        <button
          onClick={() => navigate(`/game?roster=${slots.join(',')}`)}
          disabled={!ready}
          className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {ready ? `⚔️ Bereit (${filledCount}/${ROSTER_SIZE})` : `Fülle noch ${ROSTER_SIZE - filledCount} Slots…`}
        </button>
      </div>

      {infoUnit && <UnitInfoModal unitType={infoUnit} hideColorInfo onClose={() => setInfoUnit(null)} />}
    </div>
  );
}
