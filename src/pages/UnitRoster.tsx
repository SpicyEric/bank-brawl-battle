import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { UNIT_TYPES, UNIT_DEFS, UnitType, ColorGroup } from '@/lib/battleGame';

// Slot layout: row 0 = red (slots 0-2), row 1 = green (slots 3-5), row 2 = blue (slots 6-8)
const SLOT_COLORS: ColorGroup[] = ['red','red','red','green','green','green','blue','blue','blue'];
const ROSTER_SIZE = 9;

const COLOR_RING: Record<ColorGroup, string> = {
  red: 'border-unit-red/60 bg-unit-red/10',
  green: 'border-unit-green/60 bg-unit-green/10',
  blue: 'border-unit-blue/60 bg-unit-blue/10',
};
const COLOR_DOT: Record<ColorGroup, string> = {
  red: 'bg-unit-red', green: 'bg-unit-green', blue: 'bg-unit-blue',
};
const COLOR_LABEL: Record<ColorGroup, string> = {
  red: '🔴 Rot', green: '🟢 Grün', blue: '🔵 Blau',
};

export default function UnitRoster() {
  const navigate = useNavigate();
  const [slots, setSlots] = useState<(UnitType | null)[]>(Array(ROSTER_SIZE).fill(null));
  const [activeSlot, setActiveSlot] = useState<number>(0);

  const fillSlot = (slotIdx: number, type: UnitType) => {
    setSlots(prev => prev.map((s, i) => (i === slotIdx ? type : s)));
    // Auto-advance to next empty slot
    const nextEmpty = slots.findIndex((s, i) => i !== slotIdx && s === null);
    if (nextEmpty >= 0 && slots[slotIdx] === null) setActiveSlot(nextEmpty);
  };

  const clearSlot = (slotIdx: number) => {
    setSlots(prev => prev.map((s, i) => (i === slotIdx ? null : s)));
    setActiveSlot(slotIdx);
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
      <div className="p-3">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Dein Trupp · 3 Rot · 3 Grün · 3 Blau</p>
        <div className="space-y-1.5">
          {rows.map(({ color, indices }) => (
            <div key={color} className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold w-9 shrink-0 uppercase" style={{ color: `hsl(var(--unit-${color}))` }}>{COLOR_LABEL[color]}</span>
              <div className="grid grid-cols-3 gap-1.5 flex-1">
                {indices.map(i => {
                  const t = slots[i];
                  const def = t ? UNIT_DEFS[t] : null;
                  const isActive = activeSlot === i;
                  return (
                    <button
                      key={i}
                      onClick={() => t ? clearSlot(i) : setActiveSlot(i)}
                      className={`aspect-square rounded-lg border-2 flex flex-col items-center justify-center transition-all relative ${
                        t ? `${COLOR_RING[color]} active:scale-[0.95]`
                          : isActive ? `border-primary bg-primary/10 ring-1 ring-primary`
                          : 'border-dashed border-border bg-muted/20'
                      }`}
                    >
                      <div className={`absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full ${COLOR_DOT[color]}`} />
                      {def ? (
                        <>
                          <span className="text-2xl">{def.emoji}</span>
                          <span className="text-[9px] font-semibold text-foreground mt-0.5">{def.label}</span>
                        </>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/60">Wähle…</span>
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
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
          Tippe eine Einheit → landet im aktiven Slot ({COLOR_LABEL[SLOT_COLORS[activeSlot]]})
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {UNIT_TYPES.map(t => {
            const def = UNIT_DEFS[t];
            return (
              <button
                key={t}
                onClick={() => fillSlot(activeSlot, t)}
                className="relative p-1.5 rounded-lg border-2 border-border bg-card transition-all text-center active:scale-[0.95] hover:border-primary/40"
              >
                <span className="text-xl block">{def.emoji}</span>
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
    </div>
  );
}
