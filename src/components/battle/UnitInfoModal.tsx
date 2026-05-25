import { useEffect, useState } from 'react';
import { UnitType, UNIT_DEFS, UNIT_COLOR_GROUPS, COLOR_BEATS, ColorGroup } from '@/lib/battleGame';
import { UnitGlyph } from '@/components/UnitGlyph';
import { loadAuraData, ZONE_DELTA, type AuraZoneMap, type AuraEffectMap, type ZonePos } from '@/lib/auraData';
import { describeEffect } from '@/lib/effectLabels';

const COLOR_LABEL: Record<ColorGroup, string> = {
  red: '🔴 Rot',
  blue: '🔵 Blau',
  green: '🟢 Grün',
};

interface UnitInfoModalProps {
  unitType: UnitType;
  onClose: () => void;
  hideColorInfo?: boolean;
  colorOverride?: ColorGroup;
}

export function UnitInfoModal({ unitType, onClose, hideColorInfo, colorOverride }: UnitInfoModalProps) {
  const def = UNIT_DEFS[unitType];
  const colorGroup = colorOverride ?? UNIT_COLOR_GROUPS[unitType];
  const beats = COLOR_BEATS[colorGroup];
  const losesTo = (Object.entries(COLOR_BEATS) as [ColorGroup, ColorGroup][]).find(([, v]) => v === colorGroup)?.[0] as ColorGroup;

  const [zones, setZones] = useState<AuraZoneMap>({});
  const [effects, setEffects] = useState<AuraEffectMap>({});
  useEffect(() => {
    let active = true;
    loadAuraData().then(({ zones, effects }) => {
      if (!active) return;
      setZones(zones);
      setEffects(effects);
    });
    return () => { active = false; };
  }, []);

  const myZones = zones[unitType] ?? {};
  const myEffect = effects[unitType] ?? { buff: null, nerf: null };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3">
          <UnitGlyph type={unitType} className="w-10 h-10" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-foreground text-lg">{def.label}</h2>
              {!hideColorInfo && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{
                  backgroundColor: `hsl(var(--unit-${colorGroup}) / 0.2)`,
                  color: `hsl(var(--unit-${colorGroup}))`,
                }}>{COLOR_LABEL[colorGroup]}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{def.description}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label="HP" value={def.hp} />
          <Stat label="Angriff" value={def.attack} />
          <Stat label="Cooldown" value={def.cooldown} />
          <Stat label="Reichweite" value={def.attackRange ?? 1} />
        </div>

        {/* Aura zones (single 3×3 grid centered on the unit) */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Aura-Zonen</p>
          <AuraZoneGrid zones={myZones} />
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-2">
              <div className="font-semibold text-green-500 mb-0.5">＋ Buff</div>
              <div className="text-foreground/90">{describeEffect(myEffect.buff)}</div>
            </div>
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2">
              <div className="font-semibold text-red-500 mb-0.5">− Nerf</div>
              <div className="text-foreground/90">{describeEffect(myEffect.nerf)}</div>
            </div>
          </div>
        </div>

        {/* Color counter info */}
        {!hideColorInfo && (
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
        )}

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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-muted rounded-lg p-2">
      <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
      <p className="font-bold text-foreground text-sm">{value}</p>
    </div>
  );
}

function AuraZoneGrid({ zones }: { zones: Partial<Record<ZonePos, 'buff' | 'nerf'>> }) {
  // 3×3 grid with center = the unit itself, surrounded by 8 aura positions.
  return (
    <div className="grid grid-cols-3 gap-1 w-fit mx-auto">
      {[-1, 0, 1].map(dr =>
        [-1, 0, 1].map(dc => {
          const isCenter = dr === 0 && dc === 0;
          let kind: 'buff' | 'nerf' | undefined;
          if (!isCenter) {
            const pos = (Object.keys(ZONE_DELTA) as ZonePos[]).find(
              p => ZONE_DELTA[p].dr === dr && ZONE_DELTA[p].dc === dc
            );
            if (pos) kind = zones[pos];
          }
          return (
            <div
              key={`${dr}-${dc}`}
              className={`w-9 h-9 rounded-md border flex items-center justify-center text-xs font-bold ${
                isCenter
                  ? 'bg-primary/20 border-primary text-primary'
                  : kind === 'buff'
                  ? 'bg-green-500/20 border-green-500 text-green-500'
                  : kind === 'nerf'
                  ? 'bg-red-500/20 border-red-500 text-red-500'
                  : 'bg-muted/40 border-border'
              }`}
            >
              {isCenter ? '★' : kind === 'buff' ? '＋' : kind === 'nerf' ? '−' : ''}
            </div>
          );
        })
      )}
    </div>
  );
}

// Keep ZONE_POSITIONS import alive (tree-shake safety)
void ZONE_POSITIONS;
