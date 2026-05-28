import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Plus, Minus, Play, Volume2 } from 'lucide-react';
import { UNIT_TYPES, UNIT_DEFS, type UnitType } from '@/lib/battleGame';
import {
  ALL_ICONS, iconUrl,
  loadIconMap, saveIconMap,
  loadAttackIconMap, saveAttackIconMap,
  loadCloneIconMap, saveCloneIconMap,
  loadSoundMap, saveSoundMap,
  getPlacementSound, setPlacementSound,
  type UnitIconMap, type PlacementSoundKind,
} from '@/lib/unitIcons';
import { loadSoundManifest, previewSound, type SoundCategory } from '@/lib/unitSounds';

import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { UnitInfoModal } from '@/components/battle/UnitInfoModal';

const LONG_PRESS_MS = 400;

type Slot = 'unit' | 'attack' | 'clone' | 'buff' | 'sound';
type ZoneType = 'neutral' | 'buff' | 'nerf';
type ZonePos =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

const ZONE_POSITIONS: ZonePos[] = [
  'top-left', 'top', 'top-right',
  'left', 'right',
  'bottom-left', 'bottom', 'bottom-right',
];

const emptyZones = (): Record<ZonePos, ZoneType> =>
  ZONE_POSITIONS.reduce((acc, p) => { acc[p] = 'neutral'; return acc; }, {} as Record<ZonePos, ZoneType>);

const nextZone = (z: ZoneType): ZoneType =>
  z === 'neutral' ? 'buff' : z === 'buff' ? 'nerf' : 'neutral';

const AdminIcons = () => {
  const navigate = useNavigate();
  const [unitMap, setUnitMap] = useState<UnitIconMap>(() => ({ ...loadIconMap() }));
  const [attackMap, setAttackMap] = useState<UnitIconMap>(() => ({ ...loadAttackIconMap() }));
  const [cloneMap, setCloneMap] = useState<UnitIconMap>(() => ({ ...loadCloneIconMap() }));
  const [soundMap, setSoundMap] = useState<UnitIconMap>(() => ({ ...loadSoundMap() }));
  const [soundCategory, setSoundCategory] = useState<SoundCategory>('buffs');
  const [soundManifest, setSoundManifest] = useState<{ buffs: string[]; magic: string[]; dungeon: string[] }>({ buffs: [], magic: [], dungeon: [] });
  useEffect(() => { loadSoundManifest().then(m => setSoundManifest(m)); }, []);
  const [selectedUnit, setSelectedUnit] = useState<UnitType>(UNIT_TYPES[0]);
  const [slot, setSlot] = useState<Slot>('unit');
  // Placement-sound editor mode (speaker tile selected).
  const [placementMode, setPlacementMode] = useState(false);
  const [selectedPlaceKind, setSelectedPlaceKind] = useState<PlacementSoundKind>('default');
  // Force re-render when placement sounds change.
  const [, setPlaceTick] = useState(0);
  const placeKinds: { key: PlacementSoundKind; label: string; emoji: string }[] = [
    { key: 'default', label: 'Standard', emoji: '🎯' },
    { key: 'buff',    label: 'Buff',     emoji: '✨' },
    { key: 'nerf',    label: 'Nerf',     emoji: '💢' },
    { key: 'mixed',   label: 'Gemischt', emoji: '🌀' },
    { key: 'full',    label: 'Voll (max)', emoji: '🔒' },
  ];

  const [filter, setFilter] = useState('');
  const [infoUnit, setInfoUnit] = useState<UnitType | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  const startPress = (t: UnitType) => {
    didLongPress.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      setInfoUnit(t);
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  // Aura zones: per-unit
  const [auraMap, setAuraMap] = useState<Partial<Record<UnitType, Record<ZonePos, ZoneType>>>>({});
  const [auraDirty, setAuraDirty] = useState(false);

  // Load aura zones from backend
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('unit_types').select('unit_type, aura_zones');
      if (cancelled) return;
      if (error) { console.warn('[admin] aura load failed', error); return; }
      const map: Partial<Record<UnitType, Record<ZonePos, ZoneType>>> = {};
      for (const row of data ?? []) {
        const zones = emptyZones();
        const stored = (row.aura_zones as any)?.zones;
        if (Array.isArray(stored)) {
          for (const z of stored) {
            if (z && ZONE_POSITIONS.includes(z.pos) && (z.type === 'buff' || z.type === 'nerf')) {
              zones[z.pos as ZonePos] = z.type;
            }
          }
        }
        map[row.unit_type as UnitType] = zones;
      }
      setAuraMap(map);
    })();
    return () => { cancelled = true; };
  }, []);

  const currentZones: Record<ZonePos, ZoneType> = auraMap[selectedUnit] ?? emptyZones();

  const toggleZone = (pos: ZonePos) => {
    setAuraMap(prev => {
      const cur = prev[selectedUnit] ?? emptyZones();
      const next = { ...cur, [pos]: nextZone(cur[pos]) };
      return { ...prev, [selectedUnit]: next };
    });
    setAuraDirty(true);
  };

  const saveAura = async () => {
    const zones = currentZones;
    const nonNeutral = ZONE_POSITIONS
      .filter(p => zones[p] !== 'neutral')
      .map(p => ({ pos: p, type: zones[p] }));
    const payload = { zones: nonNeutral };
    const { error } = await supabase
      .from('unit_types')
      .upsert({ unit_type: selectedUnit, aura_zones: payload, updated_at: new Date().toISOString() });
    if (error) {
      toast({ title: 'Fehler beim Speichern', description: error.message });
      return;
    }
    setAuraDirty(false);
    toast({ title: 'Buff-Zonen gespeichert' });
  };

  const filteredIcons = useMemo(() => {
    if (!filter.trim()) return ALL_ICONS;
    return ALL_ICONS.filter(n => n.includes(filter.trim()));
  }, [filter]);

  // Reset slot when switching away from cloner with clone slot active
  const effectiveSlot: Slot = slot === 'clone' && selectedUnit !== 'cloner' ? 'unit' : slot;

  const currentMap =
    effectiveSlot === 'unit' ? unitMap :
    effectiveSlot === 'attack' ? attackMap :
    effectiveSlot === 'clone' ? cloneMap :
    unitMap; // buff: not used

  const setCurrentMap = (next: UnitIconMap) => {
    if (effectiveSlot === 'unit') { setUnitMap(next); saveIconMap(next); }
    else if (effectiveSlot === 'attack') { setAttackMap(next); saveAttackIconMap(next); }
    else if (effectiveSlot === 'clone') { setCloneMap(next); saveCloneIconMap(next); }
  };

  const assign = (file: string) => {
    if (effectiveSlot === 'buff' || effectiveSlot === 'sound') return;
    setCurrentMap({ ...currentMap, [selectedUnit]: file });
  };
  const clear = () => {
    if (effectiveSlot === 'buff' || effectiveSlot === 'sound') return;
    const next = { ...currentMap };
    delete next[selectedUnit];
    setCurrentMap(next);
  };

  const slotLabel =
    effectiveSlot === 'unit' ? 'Einheit-Icon' :
    effectiveSlot === 'attack' ? 'Angriffs-/Projektil-Icon' :
    effectiveSlot === 'clone' ? 'Klon-Icon' :
    effectiveSlot === 'sound' ? 'Angriffs-Sound' :
    'Buff-Zonen';

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="flex items-center gap-2 p-3 border-b border-border sticky top-0 bg-background z-20">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-accent"><ChevronLeft size={20} /></button>
        <h1 className="font-bold text-base flex-1">Admin · Icons zuweisen</h1>
        <button
          onClick={() => {
            saveIconMap(unitMap); saveAttackIconMap(attackMap); saveCloneIconMap(cloneMap);
            toast({ title: 'Gespeichert' });
          }}
          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
        >Speichern</button>
      </header>

      {/* Unit roster (selectable) */}
      {/* Unit roster (selectable) + Speaker tile for placement sounds */}
      <div className="p-3 border-b border-border">
        <p className="text-xs text-muted-foreground mb-2">Einheit oder 🔊 auswählen ({UNIT_TYPES.length + 1})</p>
        <div className="grid grid-cols-5 gap-1.5">
          {/* Speaker pseudo-tile */}
          <button
            onClick={() => setPlacementMode(true)}
            className={`p-1.5 rounded-lg border-2 text-center transition-all select-none ${placementMode ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}
          >
            <div className="h-8 flex items-center justify-center">
              <Volume2 size={22} className={placementMode ? 'text-primary' : ''} />
            </div>
            <p className="text-[9px] truncate mt-0.5">Platzieren</p>
          </button>
          {UNIT_TYPES.map(t => {
            const isSel = !placementMode && t === selectedUnit;
            const assigned = unitMap[t];
            return (
              <button
                key={t}
                onClick={() => { if (didLongPress.current) { didLongPress.current = false; return; } setPlacementMode(false); setSelectedUnit(t); }}
                onPointerDown={() => startPress(t)}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onPointerCancel={cancelPress}
                onContextMenu={(e) => e.preventDefault()}
                className={`p-1.5 rounded-lg border-2 text-center transition-all select-none ${isSel ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}
              >
                <div className="h-8 flex items-center justify-center">
                  {assigned
                    ? <img src={iconUrl(assigned)} alt="" className="w-7 h-7" style={{ imageRendering: 'pixelated' }} draggable={false} />
                    : <span className="text-xl">{UNIT_DEFS[t].emoji}</span>}
                </div>
                <p className="text-[9px] truncate mt-0.5">{UNIT_DEFS[t].label}</p>
              </button>
            );
          })}
        </div>
      </div>


      {/* PLACEMENT SOUND MODE (speaker tile selected) */}
      {placementMode ? (
        <>
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs text-muted-foreground mb-2">Welcher Platzierungs-Sound?</p>
            <div className="grid grid-cols-5 gap-1.5">
              {placeKinds.map(pk => {
                const active = pk.key === selectedPlaceKind;
                const has = !!getPlacementSound(pk.key);
                return (
                  <button
                    key={pk.key}
                    onClick={() => setSelectedPlaceKind(pk.key)}
                    className={`p-1.5 rounded-lg border-2 text-center text-[10px] font-semibold ${active ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}
                  >
                    <div className="h-6 flex items-center justify-center text-lg">{pk.emoji}</div>
                    <div className="flex items-center justify-center gap-1">
                      <Volume2 size={10} className={has ? 'text-primary' : 'opacity-40'} />
                      <span className="truncate">{pk.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              {selectedPlaceKind === 'default' && 'Spielt bei jeder Einheit-Platzierung (Standard).'}
              {selectedPlaceKind === 'buff'    && 'Spielt, wenn die platzierte Einheit einen Buff erzeugt oder einen empfängt.'}
              {selectedPlaceKind === 'nerf'    && 'Spielt, wenn die Platzierung einen Nerf auslöst.'}
              {selectedPlaceKind === 'mixed'   && 'Spielt, wenn Platzierung gleichzeitig Buff und Nerf erzeugt.'}
              {selectedPlaceKind === 'full'    && 'Spielt, wenn das Einheiten-Maximum erreicht ist.'}
            </p>
          </div>

          {/* Selected placement sound detail */}
          <div className="px-3 py-2 border-b border-border flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg border-2 border-primary bg-primary/5 flex items-center justify-center">
              <Volume2 size={22} className={getPlacementSound(selectedPlaceKind) ? 'text-primary' : 'opacity-50'} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm">Platzierung · <span className="text-muted-foreground font-normal">{placeKinds.find(p => p.key === selectedPlaceKind)?.label}</span></p>
              <p className="text-[10px] text-muted-foreground truncate">{getPlacementSound(selectedPlaceKind) ?? 'Kein Sound (stumm)'}</p>
            </div>
            {getPlacementSound(selectedPlaceKind) && (
              <>
                <button onClick={() => previewSound(getPlacementSound(selectedPlaceKind)!)} className="text-xs px-2 py-1 rounded-md bg-secondary"><Play size={12} /></button>
                <button
                  onClick={() => { setPlacementSound(selectedPlaceKind, null); setPlaceTick(t => t + 1); }}
                  className="text-xs px-2 py-1 rounded-md bg-secondary"
                >Entfernen</button>
              </>
            )}
          </div>

          {/* Category tabs */}
          <div className="px-3 py-2 border-b border-border flex gap-1.5">
            {(['buffs','magic','dungeon'] as SoundCategory[]).map(cat => (
              <button
                key={cat}
                onClick={() => setSoundCategory(cat)}
                className={`flex-1 px-2 py-1.5 rounded-lg border-2 text-xs font-semibold capitalize ${soundCategory === cat ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}
              >{cat} ({soundManifest[cat].length})</button>
            ))}
          </div>

          {/* Sound list */}
          <div className="flex-1 overflow-y-auto p-2">
            <div className="flex flex-col gap-1">
              {soundManifest[soundCategory].map(file => {
                const rel = `${soundCategory}/${file}`;
                const isAssigned = getPlacementSound(selectedPlaceKind) === rel;
                return (
                  <div
                    key={file}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md border-2 ${isAssigned ? 'border-primary bg-primary/20' : 'border-border bg-card'}`}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); previewSound(rel); }}
                      className="p-1.5 rounded-md bg-secondary hover:bg-secondary/80"
                      aria-label="Vorhören"
                    ><Play size={12} /></button>
                    <button
                      onClick={() => { setPlacementSound(selectedPlaceKind, rel); setPlaceTick(t => t + 1); }}
                      className="flex-1 text-left text-xs truncate"
                    >{file}</button>
                  </div>
                );
              })}
              {soundManifest[soundCategory].length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">Keine Dateien.</p>
              )}
            </div>
          </div>
        </>
      ) : (
        <>

      {/* Slot tabs */}
      <div className="px-3 pt-3 border-b border-border">
        <div className="flex gap-1.5 flex-wrap">
          {(['unit','attack', ...(selectedUnit === 'cloner' ? ['clone' as Slot] : []), 'buff', 'sound'] as Slot[]).map(s => {
            const label = s === 'unit' ? 'Einheit' : s === 'attack' ? 'Angriff' : s === 'clone' ? 'Klon' : s === 'buff' ? 'Buff' : 'Sound';
            const active = effectiveSlot === s;
            const map = s === 'unit' ? unitMap : s === 'attack' ? attackMap : s === 'clone' ? cloneMap : null;
            const ic = map ? map[selectedUnit] : null;
            const hasSound = s === 'sound' && !!soundMap[selectedUnit];
            return (
              <button
                key={s}
                onClick={() => setSlot(s)}
                className={`flex-1 min-w-[70px] px-2 py-2 rounded-lg border-2 text-xs font-semibold flex items-center justify-center gap-1.5 ${active ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}
              >
                {s === 'buff'
                  ? <span className="text-sm">✦</span>
                  : s === 'sound'
                  ? <Volume2 size={14} className={hasSound ? 'text-primary' : 'opacity-60'} />
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
          {effectiveSlot === 'buff' && 'Aura-Zonen rund um diese Einheit (Buff = grün, Nerf = rot).'}
          {effectiveSlot === 'sound' && 'Sound, der bei jedem Angriff dieser Einheit abgespielt wird.'}
        </p>
      </div>

      {/* SOUND PANEL */}
      {effectiveSlot === 'sound' ? (
        <>
          <div className="px-3 py-2 border-b border-border flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg border-2 border-primary bg-primary/5 flex items-center justify-center">
              <Volume2 size={22} className={soundMap[selectedUnit] ? 'text-primary' : 'opacity-50'} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm">{UNIT_DEFS[selectedUnit].label} · <span className="text-muted-foreground font-normal">Angriffs-Sound</span></p>
              <p className="text-[10px] text-muted-foreground truncate">{soundMap[selectedUnit] ?? 'Kein Sound (Standard)'}</p>
            </div>
            {soundMap[selectedUnit] && (
              <>
                <button
                  onClick={() => previewSound(soundMap[selectedUnit]!)}
                  className="text-xs px-2 py-1 rounded-md bg-secondary"
                ><Play size={12} /></button>
                <button
                  onClick={() => {
                    const next = { ...soundMap }; delete next[selectedUnit];
                    setSoundMap(next); saveSoundMap(next);
                  }}
                  className="text-xs px-2 py-1 rounded-md bg-secondary"
                >Entfernen</button>
              </>
            )}
          </div>

          {/* Category tabs */}
          <div className="px-3 py-2 border-b border-border flex gap-1.5">
            {(['buffs','magic','dungeon'] as SoundCategory[]).map(cat => (
              <button
                key={cat}
                onClick={() => setSoundCategory(cat)}
                className={`flex-1 px-2 py-1.5 rounded-lg border-2 text-xs font-semibold capitalize ${soundCategory === cat ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}
              >{cat} ({soundManifest[cat].length})</button>
            ))}
          </div>

          {/* Sound list */}
          <div className="flex-1 overflow-y-auto p-2">
            <div className="flex flex-col gap-1">
              {soundManifest[soundCategory].map(file => {
                const rel = `${soundCategory}/${file}`;
                const isAssigned = soundMap[selectedUnit] === rel;
                return (
                  <div
                    key={file}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md border-2 transition-all ${
                      isAssigned ? 'border-primary bg-primary/20' : 'border-border bg-card'
                    }`}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); previewSound(rel); }}
                      className="p-1.5 rounded-md bg-secondary hover:bg-secondary/80"
                      aria-label="Vorhören"
                    ><Play size={12} /></button>
                    <button
                      onClick={() => {
                        const next = { ...soundMap, [selectedUnit]: rel };
                        setSoundMap(next); saveSoundMap(next);
                      }}
                      className="flex-1 text-left text-xs truncate"
                    >{file}</button>
                  </div>
                );
              })}
              {soundManifest[soundCategory].length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">Keine Dateien.</p>
              )}
            </div>
          </div>
        </>
      ) : effectiveSlot === 'buff' ? (
        <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center gap-4">
          <p className="text-xs text-muted-foreground text-center">
            Klicke eine Zelle, um den Zustand zu wechseln:<br />
            neutral → <span className="text-green-500">grün (Buff)</span> → <span className="text-red-500">rot (Nerf)</span> → neutral
          </p>
          <div className="grid grid-cols-3 gap-2 w-full max-w-[280px] aspect-square">
            {(['top-left','top','top-right','left','center','right','bottom-left','bottom','bottom-right'] as const).map(pos => {
              if (pos === 'center') {
                const assigned = unitMap[selectedUnit];
                return (
                  <div key={pos} className="aspect-square rounded-lg border-2 border-primary bg-primary/10 flex items-center justify-center">
                    {assigned
                      ? <img src={iconUrl(assigned)} alt="" className="w-10 h-10" style={{ imageRendering: 'pixelated' }} />
                      : <span className="text-3xl">{UNIT_DEFS[selectedUnit].emoji}</span>}
                  </div>
                );
              }
              const state = currentZones[pos as ZonePos];
              const styles =
                state === 'buff' ? 'bg-green-500/20 border-green-500 text-green-500' :
                state === 'nerf' ? 'bg-red-500/20 border-red-500 text-red-500' :
                'bg-muted border-border text-muted-foreground';
              return (
                <button
                  key={pos}
                  onClick={() => toggleZone(pos as ZonePos)}
                  className={`aspect-square rounded-lg border-2 flex items-center justify-center transition-colors ${styles}`}
                  aria-label={`${pos}: ${state}`}
                >
                  {state === 'buff' && <Plus size={28} strokeWidth={3} />}
                  {state === 'nerf' && <Minus size={28} strokeWidth={3} />}
                </button>
              );
            })}
          </div>
          <button
            onClick={saveAura}
            disabled={!auraDirty}
            className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
          >
            Buff-Zonen speichern
          </button>
        </div>
      ) : (
        <>
          {/* Selected slot detail */}
          <div className="px-3 py-2 border-b border-border flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg border-2 border-primary bg-primary/5 flex items-center justify-center overflow-hidden">
              {currentMap[selectedUnit]
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

          {/* Search */}
          <div className="p-3 border-b border-border">
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Suche (z. B. 042)"
              className="w-full px-3 py-2 rounded-lg bg-card border border-border text-sm"
            />
          </div>

          {/* Icon grid */}
          <div className="flex-1 overflow-y-auto p-2">
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
          </div>
        </>
      )}
        </>
      )}

      {infoUnit && <UnitInfoModal unitType={infoUnit} onClose={() => setInfoUnit(null)} />}
    </div>
  );
};

export default AdminIcons;
