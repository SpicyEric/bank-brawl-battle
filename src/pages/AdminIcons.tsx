import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { UNIT_TYPES, UNIT_DEFS, type UnitType } from '@/lib/battleGame';
import {
  ALL_ICONS, iconUrl,
  loadIconMap, saveIconMap,
  loadAttackIconMap, saveAttackIconMap,
  loadCloneIconMap, saveCloneIconMap,
  loadAnimationMap, saveAnimationMap,
  loadAnimationManifest, getAnimationManifest, getAnimationEntry,
  type UnitIconMap, type AnimEntry,
} from '@/lib/unitIcons';
import { EffectAnimationPreview } from '@/components/EffectAnimationPreview';
import { toast } from '@/hooks/use-toast';

type Slot = 'unit' | 'attack' | 'clone' | 'animation';

const AdminIcons = () => {
  const navigate = useNavigate();
  const [unitMap, setUnitMap] = useState<UnitIconMap>(() => ({ ...loadIconMap() }));
  const [attackMap, setAttackMap] = useState<UnitIconMap>(() => ({ ...loadAttackIconMap() }));
  const [cloneMap, setCloneMap] = useState<UnitIconMap>(() => ({ ...loadCloneIconMap() }));
  const [animMap, setAnimMap] = useState<UnitIconMap>(() => ({ ...loadAnimationMap() }));
  const [selectedUnit, setSelectedUnit] = useState<UnitType>(UNIT_TYPES[0]);
  const [slot, setSlot] = useState<Slot>('unit');
  const [filter, setFilter] = useState('');
  const [animManifest, setAnimManifest] = useState<AnimEntry[]>(() => getAnimationManifest());
  const [previewRow, setPreviewRow] = useState(0);

  useEffect(() => {
    if (animManifest.length === 0) {
      loadAnimationManifest().then(setAnimManifest);
    }
  }, [animManifest.length]);

  const filteredIcons = useMemo(() => {
    if (!filter.trim()) return ALL_ICONS;
    return ALL_ICONS.filter(n => n.includes(filter.trim()));
  }, [filter]);

  const filteredAnims = useMemo(() => {
    if (!filter.trim()) return animManifest;
    return animManifest.filter(a => a.f.includes(filter.trim()));
  }, [filter, animManifest]);

  // Reset slot when switching away from cloner with clone slot active
  const effectiveSlot: Slot = slot === 'clone' && selectedUnit !== 'cloner' ? 'unit' : slot;

  const currentMap =
    effectiveSlot === 'unit' ? unitMap :
    effectiveSlot === 'attack' ? attackMap :
    effectiveSlot === 'clone' ? cloneMap :
    animMap;

  const setCurrentMap = (next: UnitIconMap) => {
    if (effectiveSlot === 'unit') { setUnitMap(next); saveIconMap(next); }
    else if (effectiveSlot === 'attack') { setAttackMap(next); saveAttackIconMap(next); }
    else if (effectiveSlot === 'clone') { setCloneMap(next); saveCloneIconMap(next); }
    else { setAnimMap(next); saveAnimationMap(next); }
  };

  const assign = (file: string) => {
    const next = { ...currentMap, [selectedUnit]: file };
    setCurrentMap(next);
  };
  const clear = () => {
    const next = { ...currentMap };
    delete next[selectedUnit];
    setCurrentMap(next);
  };

  const slotLabel =
    effectiveSlot === 'unit' ? 'Einheit-Icon' :
    effectiveSlot === 'attack' ? 'Angriffs-/Projektil-Icon' :
    effectiveSlot === 'clone' ? 'Klon-Icon' :
    'Effekt-Animation';

  const currentAnimEntry = effectiveSlot === 'animation' ? getAnimationEntry(currentMap[selectedUnit]) : null;
  const maxRows = currentAnimEntry?.r ?? 9;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="flex items-center gap-2 p-3 border-b border-border sticky top-0 bg-background z-20">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-accent"><ChevronLeft size={20} /></button>
        <h1 className="font-bold text-base flex-1">Admin · Icons zuweisen</h1>
        <button
          onClick={() => {
            saveIconMap(unitMap); saveAttackIconMap(attackMap); saveCloneIconMap(cloneMap); saveAnimationMap(animMap);
            toast({ title: 'Gespeichert' });
          }}
          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
        >Speichern</button>
      </header>

      {/* Unit roster (selectable) */}
      <div className="p-3 border-b border-border">
        <p className="text-xs text-muted-foreground mb-2">Einheit auswählen ({UNIT_TYPES.length})</p>
        <div className="grid grid-cols-5 gap-1.5">
          {UNIT_TYPES.map(t => {
            const isSel = t === selectedUnit;
            const assigned = unitMap[t];
            return (
              <button
                key={t}
                onClick={() => setSelectedUnit(t)}
                className={`p-1.5 rounded-lg border-2 text-center transition-all ${isSel ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}
              >
                <div className="h-8 flex items-center justify-center">
                  {assigned
                    ? <img src={iconUrl(assigned)} alt="" className="w-7 h-7" style={{ imageRendering: 'pixelated' }} />
                    : <span className="text-xl">{UNIT_DEFS[t].emoji}</span>}
                </div>
                <p className="text-[9px] truncate mt-0.5">{UNIT_DEFS[t].label}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Slot tabs */}
      <div className="px-3 pt-3 border-b border-border">
        <div className="flex gap-1.5 flex-wrap">
          {(['unit','attack', ...(selectedUnit === 'cloner' ? ['clone' as Slot] : []), 'animation'] as Slot[]).map(s => {
            const label = s === 'unit' ? 'Einheit' : s === 'attack' ? 'Angriff' : s === 'clone' ? 'Klon' : 'Animation';
            const active = effectiveSlot === s;
            const map = s === 'unit' ? unitMap : s === 'attack' ? attackMap : s === 'clone' ? cloneMap : animMap;
            const ic = map[selectedUnit];
            const animEntry = s === 'animation' ? getAnimationEntry(ic) : null;
            return (
              <button
                key={s}
                onClick={() => setSlot(s)}
                className={`flex-1 min-w-[70px] px-2 py-2 rounded-lg border-2 text-xs font-semibold flex items-center justify-center gap-1.5 ${active ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}
              >
                {s === 'animation' && animEntry
                  ? <EffectAnimationPreview entry={animEntry} size={20} />
                  : ic
                  ? <img src={iconUrl(ic)} alt="" className="w-4 h-4" style={{ imageRendering: 'pixelated' }} />
                  : <span className="text-sm opacity-60">·</span>}
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          {effectiveSlot === 'attack' && 'Fliegt vom Angreifer zum Ziel (auch im Nahkampf).'}
          {effectiveSlot === 'unit' && 'Wird auf dem Spielfeld als Einheit angezeigt.'}
          {effectiveSlot === 'clone' && 'Aussehen der vom Kloner erzeugten Klone.'}
          {effectiveSlot === 'animation' && 'Special-Effekt-Animation (Impuls, Treffer, Schuss, …). 64×64 Sprite-Sheet.'}
        </p>
      </div>

      {/* Selected slot detail */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg border-2 border-primary bg-primary/5 flex items-center justify-center overflow-hidden">
          {effectiveSlot === 'animation'
            ? currentAnimEntry
              ? <EffectAnimationPreview entry={currentAnimEntry} size={44} row={previewRow} />
              : <span className="text-2xl">{UNIT_DEFS[selectedUnit].emoji}</span>
            : currentMap[selectedUnit]
            ? <img src={iconUrl(currentMap[selectedUnit]!)} alt="" className="w-10 h-10" style={{ imageRendering: 'pixelated' }} />
            : <span className="text-2xl">{UNIT_DEFS[selectedUnit].emoji}</span>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm">{UNIT_DEFS[selectedUnit].label} · <span className="text-muted-foreground font-normal">{slotLabel}</span></p>
          <p className="text-[10px] text-muted-foreground truncate">{currentMap[selectedUnit] ?? 'Kein Icon (Fallback)'}</p>
        </div>
        {currentMap[selectedUnit] && (
          <button onClick={clear} className="text-xs px-2 py-1 rounded-md bg-secondary">Entfernen</button>
        )}
      </div>

      {/* Row picker for animations */}
      {effectiveSlot === 'animation' && (
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground uppercase">Zeile (Variante):</span>
          <div className="flex gap-1 flex-wrap">
            {Array.from({ length: maxRows }, (_, i) => (
              <button
                key={i}
                onClick={() => setPreviewRow(i)}
                className={`w-7 h-7 rounded text-[11px] font-mono border ${previewRow === i ? 'border-primary bg-primary/20' : 'border-border bg-card'}`}
              >{i}</button>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="p-3 border-b border-border">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={effectiveSlot === 'animation' ? 'Suche (z. B. 776)' : 'Suche (z. B. 042)'}
          className="w-full px-3 py-2 rounded-lg bg-card border border-border text-sm"
        />
      </div>

      {/* Grid: icons or animations */}
      <div className="flex-1 overflow-y-auto p-2">
        {effectiveSlot === 'animation' ? (
          <div className="grid grid-cols-5 gap-2">
            {filteredAnims.map(entry => {
              const isAssigned = currentMap[selectedUnit] === entry.f;
              return (
                <button
                  key={entry.f}
                  onClick={() => assign(entry.f)}
                  title={`${entry.f} (${entry.c}×${entry.r})`}
                  className={`aspect-square rounded-md border-2 flex flex-col items-center justify-center gap-0.5 p-1 transition-all ${
                    isAssigned ? 'border-primary bg-primary/20' : 'border-border bg-card hover:border-primary/50'
                  }`}
                >
                  <EffectAnimationPreview entry={entry} size={56} row={previewRow < entry.r ? previewRow : 0} />
                  <span className="text-[9px] text-muted-foreground font-mono">{entry.f.replace('.png','')}</span>
                </button>
              );
            })}
            {filteredAnims.length === 0 && (
              <p className="col-span-5 text-center text-muted-foreground text-sm py-8">Lade Animationen…</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-8 gap-1">
            {filteredIcons.map(name => {
              const isAssigned = currentMap[selectedUnit] === name;
              return (
                <button
                  key={name}
                  onClick={() => assign(name)}
                  title={name}
                  className={`aspect-square rounded-md border-2 flex items-center justify-center transition-all ${
                    isAssigned ? 'border-primary bg-primary/20' : 'border-border bg-card hover:border-primary/50'
                  }`}
                >
                  <img
                    src={iconUrl(name)}
                    alt={name}
                    loading="lazy"
                    className="w-full h-full object-contain p-0.5"
                    style={{ imageRendering: 'pixelated' }}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminIcons;
