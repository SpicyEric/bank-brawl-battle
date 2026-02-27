import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import {
  Cell, Unit, UnitType, GRID_SIZE, UNIT_DEFS, UNIT_TYPES, UNIT_COLOR_GROUPS,
  createEmptyGrid, createUnit, PLAYER_ROWS, ENEMY_ROWS,
} from '@/lib/battleGame';
import { BattleGrid } from '@/components/battle/BattleGrid';

/* ─── Tutorial step definition ─── */
interface TutorialStep {
  id: string;
  title: string;
  text: string;
  setupGrid?: (grid: Cell[][]) => Cell[][];
  playerMustPlace?: { types: UnitType[]; rows: number[]; oneEach?: boolean; exclude?: UnitType[] };
  highlightCells?: { row: number; col: number }[];
  hint?: string;
  /** Auto-dismiss title overlay then delay before enabling Weiter */
  autoIntro?: { displayMs: number; delayAfterMs: number };
  /** Show ability buttons preview */
  showAbilityPreview?: boolean;
}

/* ─── Helpers ─── */
function placeMany(grid: Cell[][], units: { type: UnitType; team: 'player' | 'enemy'; row: number; col: number }[]): Cell[][] {
  let g = grid.map(r => r.map(c => ({ ...c })));
  for (const u of units) {
    g[u.row][u.col] = { ...g[u.row][u.col], unit: createUnit(u.type, u.team, u.row, u.col) };
  }
  return g;
}

const ENEMY_BLUE_TEAM = [
  { type: 'rider' as UnitType, team: 'enemy' as const, row: 0, col: 1 },
  { type: 'archer' as UnitType, team: 'enemy' as const, row: 0, col: 4 },
  { type: 'frost' as UnitType, team: 'enemy' as const, row: 0, col: 6 },
  { type: 'archer' as UnitType, team: 'enemy' as const, row: 1, col: 2 },
  { type: 'rider' as UnitType, team: 'enemy' as const, row: 2, col: 5 },
];

/* ─── The tutorial steps ─── */
const STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: '⚔️ Willkommen, Kommandant!',
    text: 'Das ist dein Schlachtfeld — ein 8×8 Raster. Du platzierst Einheiten auf deiner Seite (unten, blau), der Gegner auf seiner (oben, rot). Dann kämpfen sie automatisch!',
    hint: 'Schau dir das Spielfeld an — die unteren 3 Reihen gehören dir!',
    autoIntro: { displayMs: 3000, delayAfterMs: 2000 },
  },
  {
    id: 'enemy_setup',
    title: '🔵 Der Gegner stellt auf!',
    text: 'Schau dir die gegnerische Aufstellung an — der Feind hat ein blaulastiges Team gewählt: Reiter, Bogenschützen und Frostmagier. Erkennst du die blauen Punkte oben links an jeder Einheit?',
    setupGrid: (grid) => placeMany(grid, ENEMY_BLUE_TEAM),
    highlightCells: [
      { row: 0, col: 1 }, { row: 0, col: 4 }, { row: 0, col: 6 },
      { row: 1, col: 2 }, { row: 2, col: 5 },
    ],
    hint: 'Die blauen Punkte zeigen: Das sind alles blaue Einheiten!',
  },
  {
    id: 'color_system',
    title: '🔴🟢🔵 Das Farbsystem',
    text: 'Jede Einheit gehört zu einer Farbe: ROT (Krieger, Assassine, Drache), GRÜN (Schildträger, Magier, Schamane) oder BLAU (Reiter, Bogenschütze, Frostmagier). Es funktioniert wie Schere-Stein-Papier:',
    hint: '🔴 Rot → schlägt Grün (+40% Schaden)\n🟢 Grün → schlägt Blau (+40% Schaden)\n🔵 Blau → schlägt Rot (+40% Schaden)\n\nGegen die starke Farbe macht man nur 60% Schaden!',
  },
  {
    id: 'counter_place',
    title: '🎯 Konter den Gegner!',
    text: 'Der Gegner hat BLAU gewählt — du brauchst GRÜNE Einheiten um zu kontern! Platziere von jeder grünen Einheit genau eine: Schildträger, Magier UND Schamane.',
    playerMustPlace: { types: ['tank', 'mage', 'healer'], rows: PLAYER_ROWS, oneEach: true },
    hint: 'Tippe unten auf eine grüne Einheit, dann tippe auf ein freies Feld in den unteren 3 Reihen. Du brauchst von jeder genau eine!',
  },
  {
    id: 'variation',
    title: '🎨 Variation ist wichtig!',
    text: 'Gut gemacht! Aber ein reines Mono-Team ist riskant. Platziere jetzt noch 2 weitere Einheiten — diesmal aus einer ANDEREN Farbe (Rot oder Blau) für Variation. So bist du flexibler!',
    playerMustPlace: { types: ['warrior', 'assassin', 'dragon', 'rider', 'archer', 'frost'], rows: PLAYER_ROWS, exclude: ['tank', 'mage', 'healer'] },
    hint: 'Wähle z.B. einen Krieger (rot) oder Bogenschütze (blau) für Abwechslung.',
  },
  {
    id: 'unit_roles',
    title: '🛡️ Einheiten-Rollen',
    text: 'Jede Einheit hat eine besondere Rolle:\n\n🛡️ Schildträger — Viele HP, schützt Nachbarn (-20% Schaden). Platziere Verbündete direkt daneben für eine Bindung!\n🏹 Bogenschütze — Fernkampf, greift aus 3 Feldern an\n🔮 Magier — Diagonaler Fernkampf, versteckt sich hinten\n🗡️ Assassine — Hoher Schaden, greift Verletzte an\n🐉 Drache — Flächenschaden im 3×3 Bereich\n🥶 Frostmagier — Friert Gegner ein!\n🏇 Reiter — Springt über Hindernisse\n🌿 Schamane — Heilt Verbündete\n⚔️ Krieger — Beißt sich am Ziel fest',
    hint: 'Halte im Spiel lange auf eine Einheit gedrückt, um Details zu sehen.',
  },
  {
    id: 'row_strategy',
    title: '📊 Reihen-Strategie',
    text: 'Wo du platzierst, ist wichtig! Einheiten in der VORDEREN Reihe (Reihe 6) kämpfen sofort. Mittlere Reihe (7): ab Zug 2. Hintere Reihe (8): ab Zug 3.',
    setupGrid: (grid) => {
      let g = placeMany(grid, [
        { type: 'tank', team: 'player', row: 5, col: 2 },
        { type: 'tank', team: 'player', row: 5, col: 5 },
        { type: 'archer', team: 'player', row: 6, col: 3 },
        { type: 'mage', team: 'player', row: 7, col: 1 },
        { type: 'healer', team: 'player', row: 7, col: 6 },
      ]);
      g = placeMany(g, [
        { type: 'warrior', team: 'enemy', row: 2, col: 2 },
        { type: 'warrior', team: 'enemy', row: 2, col: 5 },
        { type: 'assassin', team: 'enemy', row: 1, col: 3 },
        { type: 'dragon', team: 'enemy', row: 0, col: 4 },
        { type: 'rider', team: 'enemy', row: 1, col: 6 },
      ]);
      return g;
    },
    highlightCells: [
      { row: 5, col: 2 }, { row: 5, col: 5 },
      { row: 6, col: 3 },
      { row: 7, col: 1 }, { row: 7, col: 6 },
    ],
    hint: '💡 Tanks vorne als Schutzschild, Fernkämpfer hinten für maximale Effizienz!',
  },
  {
    id: 'terrain',
    title: '🌲 Terrain nutzen',
    text: 'Auf dem Spielfeld gibt es besonderes Terrain:\n\n🌲 Wald — Einheiten nehmen 20% weniger Schaden\n⛰️ Hügel — Einheiten machen 15% mehr Schaden\n🌊 Wasser — Unpassierbar (nur der Drache kann fliegen!)',
    setupGrid: (grid) => {
      const g = grid.map(r => r.map(c => ({ ...c })));
      g[3][2].terrain = 'forest';
      g[3][3].terrain = 'forest';
      g[4][5].terrain = 'hill';
      g[4][6].terrain = 'hill';
      g[3][7].terrain = 'water';
      g[4][0].terrain = 'water';
      return g;
    },
    hint: 'Einheiten versuchen automatisch, nahe Terrain-Felder zu besetzen. Platziere sie in der Nähe von Wald oder Hügel, damit sie den Vorteil im Kampf nutzen!',
  },
  {
    id: 'abilities',
    title: '🔥 Fähigkeiten im Kampf',
    text: 'Während des Kampfes hast du 4 einmalige Fähigkeiten:\n\n🔥 Kriegsschrei — +25% Schaden für 3 Züge, danach -15% für 3 Züge\n🎯 Fokusfeuer — Alle greifen das schwächste Ziel an (4 Züge)\n💀 Opferritual — Opfere deine schwächste Einheit, heile alle anderen um 15%\n🛡️ Schildwall — 3 Züge Rückzug zur Base, 50% Schadensreduktion, kein eigener Schaden',
    hint: '💡 Wann welche Fähigkeit?\n\n🔥 Kriegsschrei — Warte, bis ALLE deine Reihen aktiv sind (ab Zug 3).\n\n🎯 Fokusfeuer — Wenn ein gefährlicher Gegner schnell fallen muss.\n\n💀 Opferritual — Wenn eine Einheit fast tot ist, opfere sie rechtzeitig!\n\n🛡️ Schildwall — Wenn du unter Druck stehst! Deine Einheiten ziehen sich zurück und nehmen nur halben Schaden. Nutze die Pause zum Neuaufbau.',
    showAbilityPreview: true,
  },
  {
    id: 'fatigue',
    title: '💤 Ermüdung',
    text: 'Einheiten, die eine Runde ÜBERLEBEN, sind in der nächsten Runde ERMÜDET und können nicht eingesetzt werden (1 Runde Pause).\n\nDas bedeutet: Wenn dein Krieger die Runde überlebt, kannst du ihn in der nächsten Runde nicht platzieren. Danach ist er wieder verfügbar.',
    hint: '💡 Ermüdung zwingt dich, verschiedene Einheiten zu nutzen! Plane voraus — wenn dein bester Konter ermüdet ist, brauchst du einen Ersatzplan. Einheiten die sterben oder nicht eingesetzt werden, sind NICHT ermüdet.',
  },
  {
    id: 'ready',
    title: '🏆 Bereit zum Kämpfen!',
    text: 'Du kennst jetzt die Basics! Gewinne Runden, sammle Punkte. Wer zuerst 8 Punkte hat, gewinnt. Bei 7:7 brauchst du 2 Punkte Vorsprung.\n\nDenk immer daran: Konter sind der Schlüssel. Schau dir die Farben des Gegners an und reagiere!',
    hint: 'Starte dein erstes Spiel auf "Einfach" und arbeite dich hoch!',
  },
];

/* ─── Tutorial Component ─── */
const Tutorial = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [grid, setGrid] = useState<Cell[][]>(createEmptyGrid());
  const [selectedUnit, setSelectedUnit] = useState<UnitType | null>(null);
  const [placedUnits, setPlacedUnits] = useState<Unit[]>([]);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isPlacingStep = !!current.playerMustPlace;

  // For welcome auto-intro
  const [introVisible, setIntroVisible] = useState(false);
  const [weiterDelayed, setWeiterDelayed] = useState(false);

  // How many units needed
  const requiredCount = current.id === 'counter_place' ? 3 : current.id === 'variation' ? 2 : 0;
  const [placedCount, setPlacedCount] = useState(0);
  // Track which types have been placed (for oneEach)
  const [placedTypes, setPlacedTypes] = useState<Set<UnitType>>(new Set());

  // Row strategy animation state
  const [rowAnimPhase, setRowAnimPhase] = useState(0);
  const rowAnimRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Setup grid when step changes
  useEffect(() => {
    setPlacedCount(0);
    setPlacedTypes(new Set());
    setWeiterDelayed(false);
    setRowAnimPhase(0);

    // Auto-intro for welcome step
    if (current.autoIntro) {
      setIntroVisible(true);
      const t1 = setTimeout(() => setIntroVisible(false), current.autoIntro.displayMs);
      const t2 = setTimeout(() => setWeiterDelayed(false), current.autoIntro.displayMs + current.autoIntro.delayAfterMs);
      setWeiterDelayed(true);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }

    if (current.id === 'counter_place') {
      let g = createEmptyGrid();
      g = placeMany(g, ENEMY_BLUE_TEAM);
      setGrid(g);
      setPlacedUnits([]);
      setSelectedUnit('tank');
    } else if (current.id === 'variation') {
      setSelectedUnit('warrior');
      setPlacedCount(0);
      setPlacedTypes(new Set());
    } else if (current.id === 'row_strategy') {
      // Setup grid and start animation
      if (current.setupGrid) {
        const g = current.setupGrid(createEmptyGrid());
        setGrid(g);
      }
      setPlacedUnits([]);
      setSelectedUnit(null);
      // Start row animation cycle
      setRowAnimPhase(0);
      if (rowAnimRef.current) clearInterval(rowAnimRef.current);
      let phase = 0;
      rowAnimRef.current = setInterval(() => {
        phase = (phase + 1) % 4; // 0=all home, 1=front moves, 2=front+mid, 3=all move
        setRowAnimPhase(phase);
      }, 1500);
    } else if (current.setupGrid) {
      const g = current.setupGrid(createEmptyGrid());
      setGrid(g);
      setPlacedUnits([]);
      setSelectedUnit(null);
    } else if (current.id === 'welcome') {
      setGrid(createEmptyGrid());
      setPlacedUnits([]);
      setSelectedUnit(null);
    } else if (current.id === 'enemy_setup' || current.id === 'color_system') {
      let g = createEmptyGrid();
      g = placeMany(g, ENEMY_BLUE_TEAM);
      setGrid(g);
      setPlacedUnits([]);
      setSelectedUnit(null);
    } else {
      setSelectedUnit(null);
    }

    return () => {
      if (rowAnimRef.current) { clearInterval(rowAnimRef.current); rowAnimRef.current = null; }
    };
  }, [step]);

  // Handle cell click during placement steps
  const handleCellClick = useCallback((row: number, col: number) => {
    if (!isPlacingStep || !selectedUnit) return;
    if (!current.playerMustPlace!.rows.includes(row)) return;
    if (grid[row][col].unit) {
      const unit = grid[row][col].unit!;
      if (unit.team === 'player') {
        const newGrid = grid.map(r => r.map(c => ({ ...c })));
        newGrid[row][col].unit = null;
        setGrid(newGrid);
        setPlacedUnits(prev => prev.filter(u => u.id !== unit.id));
        setPlacedCount(prev => Math.max(0, prev - 1));
        setPlacedTypes(prev => { const s = new Set(prev); s.delete(unit.type); return s; });
      }
      return;
    }
    if (grid[row][col].terrain === 'water') return;
    if (placedCount >= requiredCount) return;

    // Check allowed types
    if (!current.playerMustPlace!.types.includes(selectedUnit)) return;
    // For oneEach, prevent duplicates
    if (current.playerMustPlace!.oneEach && placedTypes.has(selectedUnit)) return;

    const newUnit = createUnit(selectedUnit, 'player', row, col);
    const newGrid = grid.map(r => r.map(c => ({ ...c })));
    newGrid[row][col].unit = newUnit;
    setGrid(newGrid);
    setPlacedUnits(prev => [...prev, newUnit]);
    setPlacedCount(prev => prev + 1);
    setPlacedTypes(prev => new Set(prev).add(selectedUnit));
  }, [isPlacingStep, selectedUnit, grid, current, requiredCount, placedCount, placedTypes]);

  const canProceed = (!isPlacingStep && !weiterDelayed) || (isPlacingStep && placedCount >= requiredCount);

  // Available types for the picker
  const availableTypes = current.playerMustPlace?.types || [];
  const excludeTypes = current.playerMustPlace?.exclude || [];

  // Row strategy highlight animation
  const getRowAnimHighlights = (): { row: number; col: number }[] => {
    if (current.id !== 'row_strategy') return current.highlightCells || [];
    // Phase 0: highlight all positions, 1: front row pulsing, 2: front+mid, 3: all
    const front = [{ row: 5, col: 2 }, { row: 5, col: 5 }];
    const mid = [{ row: 6, col: 3 }];
    const back = [{ row: 7, col: 1 }, { row: 7, col: 6 }];
    if (rowAnimPhase === 1) return front;
    if (rowAnimPhase === 2) return [...front, ...mid];
    if (rowAnimPhase === 3) return [...front, ...mid, ...back];
    return [];
  };

  return (
    <div className="min-h-[100dvh] max-h-[100dvh] bg-background flex flex-col max-w-md mx-auto overflow-hidden" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Header */}
      <div className="mx-3 mt-2 mb-1.5 py-1.5 px-3 rounded-lg bg-card border border-border flex items-center justify-between">
        <button
          onClick={() => step === 0 ? navigate('/singleplayer') : setStep(s => s - 1)}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
          Tutorial <span className="text-foreground font-bold">{step + 1}</span>/{STEPS.length}
        </p>
        <div className="w-6" />
      </div>

      {/* Grid */}
      <div className="px-4 relative">
        <BattleGrid
          grid={grid}
          phase={isPlacingStep ? 'place_player' : 'battle'}
          onCellClick={handleCellClick}
          battleEvents={[]}
          alwaysShowColorDots
          showZoneColors
        />

        {/* Highlight rings */}
        {getRowAnimHighlights().map((c, i) => {
          const cellSize = 100 / GRID_SIZE;
          return (
            <div
              key={`${c.row}-${c.col}-${i}`}
              className="absolute pointer-events-none z-20 rounded-md border-2 border-primary animate-pulse"
              style={{
                left: `${c.col * cellSize}%`,
                top: `${c.row * cellSize}%`,
                width: `${cellSize}%`,
                height: `${cellSize}%`,
              }}
            />
          );
        })}

        {/* Welcome auto-intro overlay */}
        {introVisible && current.autoIntro && (
          <div className="absolute inset-0 z-30 bg-background/80 backdrop-blur-[2px] rounded-xl flex items-center justify-center transition-opacity duration-500">
            <div className="text-center px-4">
              <p className="text-2xl font-black text-foreground mb-2">{current.title}</p>
              <p className="text-xs text-muted-foreground animate-pulse">Lade Schlachtfeld...</p>
            </div>
          </div>
        )}

        {/* Row strategy phase labels */}
        {current.id === 'row_strategy' && rowAnimPhase > 0 && (
          <div className="absolute right-1 top-0 bottom-0 z-20 pointer-events-none flex flex-col justify-end pb-1">
            {[
              { label: 'Zug 1', row: 5, active: rowAnimPhase >= 1 },
              { label: 'Zug 2', row: 6, active: rowAnimPhase >= 2 },
              { label: 'Zug 3', row: 7, active: rowAnimPhase >= 3 },
            ].map(r => (
              <div
                key={r.row}
                className={`text-[8px] font-bold px-1 py-0.5 rounded transition-all ${
                  r.active ? 'text-primary bg-primary/20' : 'text-muted-foreground/30'
                }`}
                style={{ height: `${100/GRID_SIZE}%`, display: 'flex', alignItems: 'center' }}
              >
                {r.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Controls area */}
      <div className="px-4 mt-2 flex-1 overflow-y-auto">
        {/* Text content */}
        <div className="space-y-2 mb-3">
          <h3 className="text-sm font-bold text-foreground">{current.title}</h3>
          <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{current.text}</p>
          {current.hint && (
            <div className="py-2 px-3 rounded-lg bg-primary/10 border border-primary/20">
              <p className="text-[11px] font-medium text-primary whitespace-pre-line">{current.hint}</p>
            </div>
          )}
        </div>

        {/* Ability preview buttons */}
        {current.showAbilityPreview && (
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            <div className="p-2 rounded-lg bg-warning/10 border border-warning/30 text-center">
              <span className="text-lg block">🔥</span>
              <p className="text-[8px] font-bold text-warning">Kriegsschrei</p>
            </div>
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/30 text-center">
              <span className="text-lg block">🎯</span>
              <p className="text-[8px] font-bold text-primary">Fokusfeuer</p>
            </div>
            <div className="p-2 rounded-lg bg-danger/10 border border-danger/30 text-center">
              <span className="text-lg block">💀</span>
              <p className="text-[8px] font-bold text-danger">Opferritual</p>
            </div>
            <div className="p-2 rounded-lg bg-success/10 border border-success/30 text-center">
              <span className="text-lg block">🛡️</span>
              <p className="text-[8px] font-bold text-success">Schildwall</p>
            </div>
          </div>
        )}

        {/* Unit picker for placement steps */}
        {isPlacingStep && (
          <div className="space-y-2 mb-3">
            <p className="text-[10px] text-muted-foreground text-center">
              {placedCount}/{requiredCount} platziert — wähle eine Einheit, dann tippe auf das Feld
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {(current.id === 'counter_place'
                ? (['tank', 'mage', 'healer'] as UnitType[])
                : UNIT_TYPES.filter(t => !excludeTypes.includes(t))
              ).map(type => {
                const def = UNIT_DEFS[type];
                const color = UNIT_COLOR_GROUPS[type];
                const isSelected = selectedUnit === type;
                const allowed = availableTypes.includes(type);
                const alreadyPlaced = current.playerMustPlace?.oneEach && placedTypes.has(type);
                if (!allowed) return null;
                return (
                  <button
                    key={type}
                    onClick={() => !alreadyPlaced && setSelectedUnit(type)}
                    className={`p-1.5 rounded-lg border-2 transition-all text-center select-none ${
                      alreadyPlaced ? 'opacity-30 cursor-not-allowed border-border' :
                      isSelected
                        ? `ring-1 ring-primary ${
                          color === 'red' ? 'border-unit-red bg-unit-red/10' :
                          color === 'blue' ? 'border-unit-blue bg-unit-blue/10' :
                          'border-unit-green bg-unit-green/10'
                        }`
                        : `border-border hover:border-primary/50 ${
                          color === 'red' ? 'bg-unit-red/10' : color === 'blue' ? 'bg-unit-blue/10' : 'bg-unit-green/10'
                        }`
                    }`}
                  >
                    <span className="text-lg block">{def.emoji}</span>
                    <p className="text-[9px] font-semibold text-foreground">{def.label}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Progress dots */}
        <div className="flex justify-center gap-1 mb-2">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-all ${i === step ? 'bg-primary w-4' : i < step ? 'bg-primary/40' : 'bg-muted/30'}`}
            />
          ))}
        </div>

        {/* Navigation */}
        {isLast ? (
          <div className="space-y-2 pb-4">
            <button
              onClick={() => navigate('/game?difficulty=1')}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 active:scale-[0.97] transition-all shadow-[0_0_20px_hsl(var(--primary)/0.3)]"
            >
              ⚔️ Erstes Spiel starten (Einfach)
            </button>
            <button
              onClick={() => navigate('/singleplayer')}
              className="w-full py-2.5 rounded-xl bg-secondary text-secondary-foreground font-semibold text-xs hover:bg-accent active:scale-[0.97] transition-all"
            >
              Zurück zum Menü
            </button>
          </div>
        ) : (
          <button
            onClick={() => canProceed && setStep(s => s + 1)}
            disabled={!canProceed}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 active:scale-[0.97] transition-all flex items-center justify-center gap-2 mb-4 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isPlacingStep && !canProceed ? `Noch ${requiredCount - placedCount} platzieren` : weiterDelayed ? 'Bitte warten...' : 'Weiter'}
            {canProceed && <ArrowRight size={16} />}
          </button>
        )}
      </div>
    </div>
  );
};

export default Tutorial;
