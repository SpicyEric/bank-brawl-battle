import { useState, useEffect, useCallback } from 'react';
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
  /** Units to pre-place on the grid for this step */
  setupGrid?: (grid: Cell[][]) => Cell[][];
  /** If set, player must place these unit types to proceed */
  playerMustPlace?: { types: UnitType[]; rows: number[] };
  /** Highlight specific cells with a pulsing ring */
  highlightCells?: { row: number; col: number }[];
  /** Show a mini-battle automatically */
  autoBattle?: boolean;
  /** Extra hint shown below main text */
  hint?: string;
}

/* ─── Helper: place a unit on a grid (mutates clone) ─── */
function placeOn(grid: Cell[][], type: UnitType, team: 'player' | 'enemy', row: number, col: number): Cell[][] {
  const g = grid.map(r => r.map(c => ({ ...c })));
  g[row][col] = { ...g[row][col], unit: createUnit(type, team, row, col) };
  return g;
}

function placeMany(grid: Cell[][], units: { type: UnitType; team: 'player' | 'enemy'; row: number; col: number }[]): Cell[][] {
  let g = grid.map(r => r.map(c => ({ ...c })));
  for (const u of units) {
    g[u.row][u.col] = { ...g[u.row][u.col], unit: createUnit(u.type, u.team, u.row, u.col) };
  }
  return g;
}

/* ─── The tutorial steps ─── */
const STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: '⚔️ Willkommen, Kommandant!',
    text: 'Das ist dein Schlachtfeld — ein 8×8 Raster. Du platzierst Einheiten auf deiner Seite (unten), der Gegner auf seiner (oben). Dann kämpfen sie automatisch!',
    hint: 'Tippe auf "Weiter" um fortzufahren.',
  },
  {
    id: 'enemy_setup',
    title: '🔵 Der Gegner stellt auf!',
    text: 'Schau dir die gegnerische Aufstellung an — der Feind hat ein blaulastiges Team gewählt: Reiter, Bogenschützen und Frostmagier. Erkennst du die blauen Punkte oben links an jeder Einheit?',
    setupGrid: (grid) => placeMany(grid, [
      { type: 'rider', team: 'enemy', row: 0, col: 1 },
      { type: 'archer', team: 'enemy', row: 0, col: 4 },
      { type: 'frost', team: 'enemy', row: 0, col: 6 },
      { type: 'archer', team: 'enemy', row: 1, col: 2 },
      { type: 'rider', team: 'enemy', row: 2, col: 5 },
    ]),
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
    text: 'Der Gegner hat BLAU gewählt — du brauchst GRÜNE Einheiten um zu kontern! Platziere jetzt 3 grüne Einheiten (Schildträger, Magier oder Schamane) auf deinen Reihen unten.',
    playerMustPlace: { types: ['tank', 'mage', 'healer'], rows: PLAYER_ROWS },
    hint: 'Tippe unten auf eine grüne Einheit, dann tippe auf ein freies Feld in den unteren 3 Reihen.',
  },
  {
    id: 'variation',
    title: '🎨 Variation ist wichtig!',
    text: 'Gut gemacht! Aber ein reines Mono-Team ist riskant. Platziere jetzt noch 2 weitere Einheiten — diesmal aus einer ANDEREN Farbe für Variation. So bist du flexibler!',
    playerMustPlace: { types: UNIT_TYPES, rows: PLAYER_ROWS },
    hint: 'Wähle z.B. einen Krieger (rot) oder Bogenschütze (blau) für Abwechslung.',
  },
  {
    id: 'unit_roles',
    title: '🛡️ Einheiten-Rollen',
    text: 'Jede Einheit hat eine besondere Rolle:\n\n🛡️ Schildträger — Viele HP, blockt den Weg\n🏹 Bogenschütze — Fernkampf, greift aus 3 Feldern an\n🔮 Magier — Diagonaler Fernkampf, versteckt sich hinten\n🗡️ Assassine — Hoher Schaden, greift Verletzte an\n🐉 Drache — Flächenschaden im 3×3 Bereich\n🥶 Frostmagier — Friert Gegner ein!\n🏇 Reiter — Springt über Hindernisse\n🌿 Schamane — Heilt Verbündete\n⚔️ Krieger — Beißt sich am Ziel fest',
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
      // Add enemies
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
      { row: 5, col: 2 }, { row: 5, col: 5 }, // front
      { row: 6, col: 3 }, // mid
      { row: 7, col: 1 }, { row: 7, col: 6 }, // back
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
    hint: 'Platziere deine Einheiten strategisch auf Wald oder Hügel für einen Vorteil!',
  },
  {
    id: 'abilities',
    title: '🔥 Fähigkeiten im Kampf',
    text: 'Während des Kampfes hast du 3 einmalige Fähigkeiten:\n\n🔥 Kriegsschrei — +25% Schaden für 3 Züge, danach -15% für 2 Züge\n🎯 Fokusfeuer — Alle greifen das stärkste Ziel an\n💀 Opferritual — Opfere deine schwächste Einheit, heile alle anderen um 40%',
    hint: 'Timing ist alles! Nutze den Kriegsschrei wenn viele deiner Einheiten am Leben sind.',
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
  const [overlayVisible, setOverlayVisible] = useState(true);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isPlacingStep = !!current.playerMustPlace;

  // How many units does player need to place in this step?
  const requiredCount = current.id === 'counter_place' ? 3 : current.id === 'variation' ? 2 : 0;
  const [placedCount, setPlacedCount] = useState(0);

  // Setup grid when step changes
  useEffect(() => {
    setOverlayVisible(true);
    setPlacedCount(0);

    if (current.id === 'counter_place') {
      // Show enemy blue team, clear player side
      let g = createEmptyGrid();
      g = placeMany(g, [
        { type: 'rider', team: 'enemy', row: 0, col: 1 },
        { type: 'archer', team: 'enemy', row: 0, col: 4 },
        { type: 'frost', team: 'enemy', row: 0, col: 6 },
        { type: 'archer', team: 'enemy', row: 1, col: 2 },
        { type: 'rider', team: 'enemy', row: 2, col: 5 },
      ]);
      setGrid(g);
      setPlacedUnits([]);
      setSelectedUnit('tank');
    } else if (current.id === 'variation') {
      // Keep existing grid with player's green units, let them add more
      setSelectedUnit('warrior');
      setPlacedCount(0);
    } else if (current.setupGrid) {
      const g = current.setupGrid(createEmptyGrid());
      setGrid(g);
      setPlacedUnits([]);
      setSelectedUnit(null);
    } else if (current.id === 'welcome') {
      setGrid(createEmptyGrid());
      setPlacedUnits([]);
      setSelectedUnit(null);
    } else if (current.id === 'enemy_setup') {
      let g = createEmptyGrid();
      g = placeMany(g, [
        { type: 'rider', team: 'enemy', row: 0, col: 1 },
        { type: 'archer', team: 'enemy', row: 0, col: 4 },
        { type: 'frost', team: 'enemy', row: 0, col: 6 },
        { type: 'archer', team: 'enemy', row: 1, col: 2 },
        { type: 'rider', team: 'enemy', row: 2, col: 5 },
      ]);
      setGrid(g);
      setPlacedUnits([]);
      setSelectedUnit(null);
    } else {
      // Keep grid as-is for text-only steps
      setSelectedUnit(null);
    }
  }, [step]);

  // Handle cell click during placement steps
  const handleCellClick = useCallback((row: number, col: number) => {
    if (!isPlacingStep || !selectedUnit) return;
    if (!current.playerMustPlace!.rows.includes(row)) return;
    if (grid[row][col].unit) {
      // Remove own unit
      const unit = grid[row][col].unit!;
      if (unit.team === 'player') {
        const newGrid = grid.map(r => r.map(c => ({ ...c })));
        newGrid[row][col].unit = null;
        setGrid(newGrid);
        setPlacedUnits(prev => prev.filter(u => u.id !== unit.id));
        setPlacedCount(prev => Math.max(0, prev - 1));
      }
      return;
    }
    if (grid[row][col].terrain === 'water') return;
    if (placedCount >= requiredCount) return;

    // Check allowed types for this step
    if (!current.playerMustPlace!.types.includes(selectedUnit)) return;

    const newUnit = createUnit(selectedUnit, 'player', row, col);
    const newGrid = grid.map(r => r.map(c => ({ ...c })));
    newGrid[row][col].unit = newUnit;
    setGrid(newGrid);
    setPlacedUnits(prev => [...prev, newUnit]);
    setPlacedCount(prev => prev + 1);
  }, [isPlacingStep, selectedUnit, grid, current, requiredCount, placedCount]);

  const canProceed = !isPlacingStep || placedCount >= requiredCount;

  // Unit picker for placement steps
  const availableTypes = current.playerMustPlace?.types || [];

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
        <div className="w-6" /> {/* spacer */}
      </div>

      {/* Grid */}
      <div className="px-4 relative">
        <BattleGrid
          grid={grid}
          phase={isPlacingStep ? 'place_player' : 'battle'}
          onCellClick={handleCellClick}
          battleEvents={[]}
        />

        {/* Highlight rings */}
        {current.highlightCells && overlayVisible && (
          <>
            {current.highlightCells.map((c, i) => {
              const cellSize = 100 / GRID_SIZE;
              return (
                <div
                  key={i}
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
          </>
        )}

        {/* Phase overlay with dim */}
        {overlayVisible && !isPlacingStep && (
          <div
            className="absolute inset-0 z-30 bg-background/70 backdrop-blur-[2px] rounded-xl flex items-center justify-center cursor-pointer"
            onClick={() => setOverlayVisible(false)}
          >
            <div className="text-center px-4">
              <p className="text-2xl font-black text-foreground mb-2">{current.title}</p>
              <p className="text-xs text-muted-foreground">Tippe um das Feld zu sehen</p>
            </div>
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

        {/* Unit picker for placement steps */}
        {isPlacingStep && (
          <div className="space-y-2 mb-3">
            <p className="text-[10px] text-muted-foreground text-center">
              {placedCount}/{requiredCount} platziert — wähle eine Einheit, dann tippe auf das Feld
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {(current.id === 'counter_place' ? ['tank', 'mage', 'healer'] as UnitType[] : UNIT_TYPES).map(type => {
                const def = UNIT_DEFS[type];
                const color = UNIT_COLOR_GROUPS[type];
                const isSelected = selectedUnit === type;
                const allowed = availableTypes.includes(type);
                if (current.id === 'counter_place' && !['tank', 'mage', 'healer'].includes(type)) return null;
                return (
                  <button
                    key={type}
                    onClick={() => allowed && setSelectedUnit(type)}
                    className={`p-1.5 rounded-lg border-2 transition-all text-center select-none ${
                      !allowed ? 'opacity-30 cursor-not-allowed border-border' :
                      isSelected
                        ? `border-primary bg-primary/10 ring-1 ring-primary`
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
            {isPlacingStep && !canProceed ? `Noch ${requiredCount - placedCount} platzieren` : 'Weiter'}
            {canProceed && <ArrowRight size={16} />}
          </button>
        )}
      </div>
    </div>
  );
};

export default Tutorial;
