import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { UNIT_TYPES, UNIT_DEFS, type UnitType } from '@/lib/battleGame';
import { ALL_ICONS, iconUrl, loadIconMap, saveIconMap, type UnitIconMap } from '@/lib/unitIcons';
import { toast } from '@/hooks/use-toast';

const AdminIcons = () => {
  const navigate = useNavigate();
  const [map, setMap] = useState<UnitIconMap>(() => ({ ...loadIconMap() }));
  const [selectedUnit, setSelectedUnit] = useState<UnitType>(UNIT_TYPES[0]);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter.trim()) return ALL_ICONS;
    return ALL_ICONS.filter(n => n.includes(filter.trim()));
  }, [filter]);

  const assign = (icon: string) => {
    const next = { ...map, [selectedUnit]: icon };
    setMap(next);
    saveIconMap(next);
  };
  const clear = () => {
    const next = { ...map };
    delete next[selectedUnit];
    setMap(next);
    saveIconMap(next);
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="flex items-center gap-2 p-3 border-b border-border sticky top-0 bg-background z-20">
        <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-accent"><ChevronLeft size={20} /></button>
        <h1 className="font-bold text-base flex-1">Admin · Icons zuweisen</h1>
        <button
          onClick={() => { saveIconMap(map); toast({ title: 'Gespeichert' }); }}
          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
        >Speichern</button>
      </header>

      {/* Unit roster (selectable) */}
      <div className="p-3 border-b border-border">
        <p className="text-xs text-muted-foreground mb-2">Einheit auswählen ({UNIT_TYPES.length})</p>
        <div className="grid grid-cols-5 gap-1.5">
          {UNIT_TYPES.map(t => {
            const isSel = t === selectedUnit;
            const assigned = map[t];
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

      {/* Selected unit detail */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg border-2 border-primary bg-primary/5 flex items-center justify-center">
          {map[selectedUnit]
            ? <img src={iconUrl(map[selectedUnit]!)} alt="" className="w-10 h-10" style={{ imageRendering: 'pixelated' }} />
            : <span className="text-2xl">{UNIT_DEFS[selectedUnit].emoji}</span>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm">{UNIT_DEFS[selectedUnit].label}</p>
          <p className="text-[10px] text-muted-foreground truncate">{map[selectedUnit] ?? 'Kein Icon (Emoji-Fallback)'}</p>
        </div>
        {map[selectedUnit] && (
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
          {filtered.map(name => {
            const isAssigned = map[selectedUnit] === name;
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
    </div>
  );
};

export default AdminIcons;
