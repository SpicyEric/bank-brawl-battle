import { UnitType, UNIT_DEFS, UNIT_COLOR_GROUPS, COLOR_BEATS, ColorGroup, getPatternDisplay } from '@/lib/battleGame';

const COLOR_LABEL: Record<ColorGroup, string> = {
  red: '🔴 Rot',
  blue: '🔵 Blau',
  green: '🟢 Grün',
};

interface UnitInfoModalProps {
  unitType: UnitType;
  onClose: () => void;
}

export function UnitInfoModal({ unitType, onClose }: UnitInfoModalProps) {
  const def = UNIT_DEFS[unitType];
  const colorGroup = UNIT_COLOR_GROUPS[unitType];
  const beats = COLOR_BEATS[colorGroup];
  const losesTo = (Object.entries(COLOR_BEATS) as [ColorGroup, ColorGroup][]).find(([, v]) => v === colorGroup)?.[0] as ColorGroup;
  const moveGrid = getPatternDisplay(def.movePattern, 7);
  const attackGrid = getPatternDisplay(def.attackPattern, 7);
  const center = 3;

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="text-3xl">{def.emoji}</span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-foreground text-lg">{def.label}</h2>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{
                backgroundColor: `hsl(var(--unit-${colorGroup}) / 0.2)`,
                color: `hsl(var(--unit-${colorGroup}))`,
              }}>{COLOR_LABEL[colorGroup]}</span>
            </div>
            <p className="text-xs text-muted-foreground">{def.description}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-muted rounded-lg p-2">
            <p className="text-[10px] text-muted-foreground uppercase">HP</p>
            <p className="font-bold text-foreground text-sm">{def.hp}</p>
          </div>
          <div className="bg-muted rounded-lg p-2">
            <p className="text-[10px] text-muted-foreground uppercase">Angriff</p>
            <p className="font-bold text-foreground text-sm">{def.attack}</p>
          </div>
          <div className="bg-muted rounded-lg p-2">
            <p className="text-[10px] text-muted-foreground uppercase">Cooldown</p>
            <p className="font-bold text-foreground text-sm">{def.cooldown}</p>
          </div>
        </div>

        {/* Patterns */}
        <div className="grid grid-cols-2 gap-3">
          <PatternGrid title="Bewegung" grid={moveGrid} center={center} color="bg-primary" />
          <PatternGrid title="Angriff" grid={attackGrid} center={center} color="bg-danger" />
        </div>

        {/* Color counter info */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold" style={{ color: `hsl(var(--unit-${colorGroup}))` }}>💪 Stark gegen:</span>
            <span className="text-foreground">{COLOR_LABEL[beats]}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold" style={{ color: `hsl(var(--unit-${losesTo}))` }}>😰 Schwach gegen:</span>
            <span className="text-foreground">{COLOR_LABEL[losesTo]}</span>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-secondary text-secondary-foreground font-semibold text-sm hover:opacity-90 transition-all"
        >
          Schließen
        </button>
      </div>
    </div>
  );
}

function PatternGrid({ title, grid, center, color }: { title: string; grid: boolean[][]; center: number; color: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center">{title}</p>
      <div className="grid gap-[1px] mx-auto" style={{ gridTemplateColumns: `repeat(${grid[0].length}, 1fr)`, width: 'fit-content' }}>
        {grid.map((row, r) =>
          row.map((active, c) => {
            const isCenter = r === center && c === center;
            return (
              <div
                key={`${r}-${c}`}
                className={`w-4 h-4 rounded-sm ${
                  isCenter ? 'bg-primary/60 border border-primary' :
                  active ? `${color}/60` : 'bg-muted/40'
                }`}
              />
            );
          })
        )}
      </div>
    </div>
  );
}