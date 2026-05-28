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
  type UnitIconMap,
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
    if (effectiveSlot === 'buff') return;
    setCurrentMap({ ...currentMap, [selectedUnit]: file });
  };
  const clear = () => {
    if (effectiveSlot === 'buff') return;
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
      <div className="p-3 border-b border-border">
        <p className="text-xs text-muted-foreground mb-2">Einheit auswählen ({UNIT_TYPES.length})</p>
        <div className="grid grid-cols-5 gap-1.5">
          {UNIT_TYPES.map(t => {
            const isSel = t === selectedUnit;
            const assigned = unitMap[t];
            return (
              <button
                key={t}
                onClick={() => { if (didLongPress.current) { didLongPress.current = false; return; } setSelectedUnit(t); }}
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

      {/* Slot tabs */}
      <div className="px-3 pt-3 border-b border-border">
        <div className="flex gap-1.5 flex-wrap">
          {(['unit','attack', ...(selectedUnit === 'cloner' ? ['clone' as Slot] : []), 'buff'] as Slot[]).map(s => {
            const label = s === 'unit' ? 'Einheit' : s === 'attack' ? 'Angriff' : s === 'clone' ? 'Klon' : 'Buff';
            const active = effectiveSlot === s;
            const map = s === 'unit' ? unitMap : s === 'attack' ? attackMap : s === 'clone' ? cloneMap : null;
            const ic = map ? map[selectedUnit] : null;
            return (
              <button
                key={s}
                onClick={() => setSlot(s)}
                className={`flex-1 min-w-[70px] px-2 py-2 rounded-lg border-2 text-xs font-semibold flex items-center justify-center gap-1.5 ${active ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}
              >
                {s === 'buff'
                  ? <span className="text-sm">✦</span>
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
        </p>
      </div>

      {/* BUFF PANEL */}
      {effectiveSlot === 'buff' ? (
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
      {infoUnit && <UnitInfoModal unitType={infoUnit} onClose={() => setInfoUnit(null)} />}
    </div>
  );
};

export default AdminIcons;
