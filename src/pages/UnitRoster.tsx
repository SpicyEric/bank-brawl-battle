import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, X } from 'lucide-react';
import { UNIT_TYPES, UNIT_DEFS, UNIT_COLOR_GROUPS, UnitType, ColorGroup } from '@/lib/battleGame';

const ROSTER_SIZE = 9;

const COLOR_BG: Record<ColorGroup, string> = {
  red: 'bg-unit-red/15 border-unit-red/40',
  blue: 'bg-unit-blue/15 border-unit-blue/40',
  green: 'bg-unit-green/15 border-unit-green/40',
};

export default function UnitRoster() {
  const navigate = useNavigate();
  const [roster, setRoster] = useState<UnitType[]>([]);

  const toggle = (t: UnitType) => {
    setRoster(prev => {
      if (prev.includes(t)) return prev.filter(x => x !== t);
      if (prev.length >= ROSTER_SIZE) return prev;
      return [...prev, t];
    });
  };

  const removeSlot = (idx: number) => {
    setRoster(prev => prev.filter((_, i) => i !== idx));
  };

  const ready = roster.length === ROSTER_SIZE;

  return (
    <div className="min-h-[100dvh] max-h-[100dvh] bg-background flex flex-col max-w-md mx-auto overflow-hidden" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <button onClick={() => navigate('/singleplayer')} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent">
          <ArrowLeft size={18} />
        </button>
        <h1 className="font-bold text-foreground text-sm flex-1">Stelle deinen Trupp auf</h1>
        <span className="text-[11px] text-muted-foreground font-mono">{roster.length}/{ROSTER_SIZE}</span>
      </div>

      {/* Top: 3x3 slots (the chosen squad) */}
      <div className="p-3">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Dein Trupp</p>
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: ROSTER_SIZE }).map((_, i) => {
            const t = roster[i];
            const def = t ? UNIT_DEFS[t] : null;
            const color = t ? UNIT_COLOR_GROUPS[t] : null;
            return (
              <button
                key={i}
                onClick={() => t && removeSlot(i)}
                className={`aspect-square rounded-lg border-2 flex flex-col items-center justify-center transition-all ${
                  t ? `${COLOR_BG[color!]} active:scale-[0.95]` : 'border-dashed border-border bg-muted/20'
                }`}
              >
                {def ? (
                  <>
                    <span className="text-2xl">{def.emoji}</span>
                    <span className="text-[9px] font-semibold text-foreground mt-0.5">{def.label}</span>
                  </>
                ) : (
                  <span className="text-xl text-muted-foreground/40">·</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom: scrollable picker of all 29 units */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Alle Einheiten ({UNIT_TYPES.length})</p>
        <div className="grid grid-cols-3 gap-1.5">
          {UNIT_TYPES.map(t => {
            const def = UNIT_DEFS[t];
            const color = UNIT_COLOR_GROUPS[t];
            const picked = roster.includes(t);
            const full = !picked && roster.length >= ROSTER_SIZE;
            return (
              <button
                key={t}
                onClick={() => toggle(t)}
                disabled={full}
                className={`relative p-1.5 rounded-lg border-2 transition-all text-center ${
                  picked ? `${COLOR_BG[color]} ring-1 ring-primary opacity-70`
                  : full ? 'border-border bg-muted/20 opacity-30 cursor-not-allowed'
                  : `${COLOR_BG[color]} active:scale-[0.95]`
                }`}
              >
                {picked && (
                  <div className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                    <Check size={10} className="text-primary-foreground" />
                  </div>
                )}
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
          onClick={() => navigate(`/game?roster=${roster.join(',')}`)}
          disabled={!ready}
          className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {ready ? `⚔️ Bereit (${roster.length}/${ROSTER_SIZE})` : `Wähle noch ${ROSTER_SIZE - roster.length}…`}
        </button>
      </div>
    </div>
  );
}
