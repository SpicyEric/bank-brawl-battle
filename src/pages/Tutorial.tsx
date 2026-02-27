import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronRight } from 'lucide-react';
import { UNIT_DEFS, UnitType } from '@/lib/battleGame';

interface TutorialStep {
  title: string;
  content: string;
  emoji: string;
  highlight?: string;
}

const STEPS: TutorialStep[] = [
  {
    title: 'Willkommen bei Taktika!',
    emoji: '⚔️',
    content: 'Taktika ist ein taktisches Auto-Battler. Du wählst und platzierst Einheiten auf dem Spielfeld – dann kämpfen sie automatisch. Wer die bessere Strategie hat, gewinnt!',
  },
  {
    title: 'Einheiten platzieren',
    emoji: '📍',
    content: 'In jeder Runde platzierst du 5 Einheiten auf deiner Seite des Spielfelds (untere 3 Reihen). Wähle aus 9 verschiedenen Einheiten – jede hat einzigartige Stärken!',
  },
  {
    title: 'Das Farbsystem',
    emoji: '🔴🟢🔵',
    content: 'Einheiten gehören zu einer von drei Farben: Rot (Krieger, Assassine, Drache), Grün (Schildträger, Magier, Schamane) und Blau (Reiter, Bogenschütze, Frostmagier). Rot schlägt Grün, Grün schlägt Blau, Blau schlägt Rot!',
    highlight: 'Rot > Grün > Blau > Rot',
  },
  {
    title: 'Konter sind der Schlüssel',
    emoji: '💪',
    content: 'Wenn du eine Einheit gegen ihre schwache Farbe einsetzt, macht sie +40% mehr Schaden. Gegen ihre starke Farbe nur -40%. Reagiere auf die Aufstellung deines Gegners!',
  },
  {
    title: 'Einheiten-Rollen',
    emoji: '🛡️',
    content: 'Schildträger blocken den Weg und haben viele HP. Fernkämpfer (Bogenschütze, Magier, Frostmagier) greifen aus der Distanz an und halten sich zurück. Der Schamane heilt Verbündete.',
  },
  {
    title: 'Besondere Einheiten',
    emoji: '🐉',
    content: 'Der Drache macht Flächenschaden an alle Gegner um sich herum. Der Frostmagier kann Ziele einfrieren. Der Reiter springt über Hindernisse und wechselt ständig sein Ziel. Der Krieger beißt sich an einem Gegner fest.',
  },
  {
    title: 'Terrain nutzen',
    emoji: '🌲',
    content: 'Wald (🌲) reduziert den erlittenen Schaden um 20%. Hügel (⛰️) erhöhen den verursachten Schaden um 15%. Wasser (🌊) ist unpassierbar – nur der Drache kann darüber fliegen!',
  },
  {
    title: 'Reihen-Strategie',
    emoji: '📊',
    content: 'Einheiten in der vorderen Reihe kämpfen sofort. Mittlere Reihe: ab Zug 2. Hintere Reihe: ab Zug 3. Platziere Fernkämpfer hinten und Tanks vorne für maximale Effizienz!',
  },
  {
    title: 'Fähigkeiten im Kampf',
    emoji: '🔥',
    content: 'Während des Kampfes hast du 3 Fähigkeiten: Kriegsschrei (+25% Schaden, dann Erschöpfung), Fokusfeuer (alle greifen ein Ziel an) und Opferritual (opfere deine schwächste Einheit, heile den Rest).',
  },
  {
    title: 'Bereit zum Kämpfen!',
    emoji: '🏆',
    content: 'Gewinne Runden um Punkte zu sammeln. Wer zuerst 7 Punkte hat (oder 2 Vorsprung in der Verlängerung), gewinnt das Spiel. Viel Erfolg, Kommandant!',
  },
];

const Tutorial = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center px-6 relative overflow-hidden" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[400px] h-[400px] rounded-full bg-primary/5 blur-[100px]" />
      </div>

      {/* Back button */}
      <button
        onClick={() => step === 0 ? navigate('/singleplayer') : setStep(s => s - 1)}
        className="absolute top-6 left-6 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors z-10"
      >
        <ArrowLeft size={20} />
      </button>

      {/* Step counter */}
      <div className="absolute top-6 right-6 text-xs text-muted-foreground font-mono z-10">
        {step + 1}/{STEPS.length}
      </div>

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center space-y-6">
          {/* Emoji */}
          <div className="text-6xl">{current.emoji}</div>

          {/* Title */}
          <h2 className="text-2xl font-black text-foreground">{current.title}</h2>

          {/* Content */}
          <p className="text-sm text-muted-foreground leading-relaxed">{current.content}</p>

          {/* Highlight box */}
          {current.highlight && (
            <div className="py-3 px-4 rounded-xl bg-primary/10 border border-primary/20">
              <p className="text-sm font-bold text-primary">{current.highlight}</p>
            </div>
          )}

          {/* Progress dots */}
          <div className="flex justify-center gap-1.5 pt-2">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-all ${i === step ? 'bg-primary w-5' : i < step ? 'bg-primary/40' : 'bg-muted/30'}`}
              />
            ))}
          </div>

          {/* Navigation */}
          <div className="pt-2">
            {isLast ? (
              <div className="space-y-3">
                <button
                  onClick={() => navigate('/game?difficulty=1')}
                  className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:opacity-90 active:scale-[0.97] transition-all shadow-[0_0_20px_hsl(var(--primary)/0.3)]"
                >
                  ⚔️ Erstes Spiel starten (Einfach)
                </button>
                <button
                  onClick={() => navigate('/singleplayer')}
                  className="w-full py-3 rounded-xl bg-secondary text-secondary-foreground font-semibold text-sm hover:bg-accent active:scale-[0.97] transition-all"
                >
                  Zurück zum Menü
                </button>
              </div>
            ) : (
              <button
                onClick={() => setStep(s => s + 1)}
                className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:opacity-90 active:scale-[0.97] transition-all flex items-center justify-center gap-2"
              >
                Weiter
                <ArrowRight size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Tutorial;
