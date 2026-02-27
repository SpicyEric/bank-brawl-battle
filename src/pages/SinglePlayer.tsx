import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMusic } from '@/hooks/useMusic';
import { ArrowLeft, Swords, BookOpen, Trophy, ChevronRight } from 'lucide-react';

export type Difficulty = 1 | 2 | 3 | 4 | 5;

const DIFFICULTIES: { level: Difficulty; label: string; emoji: string; description: string; color: string }[] = [
  { level: 1, label: 'Einfach', emoji: '😊', description: 'KI spielt zufällig – perfekt zum Lernen', color: 'text-success' },
  { level: 2, label: 'Normal', emoji: '🙂', description: 'KI kontert gelegentlich deine Einheiten', color: 'text-foreground' },
  { level: 3, label: 'Herausfordernd', emoji: '😤', description: 'KI nutzt Konter & taktische Positionierung', color: 'text-warning' },
  { level: 4, label: 'Schwer', emoji: '😈', description: 'KI kontert fast immer und nutzt Terrain', color: 'text-danger' },
  { level: 5, label: 'Unmöglich', emoji: '💀', description: 'Perfekte Konter, optimale Positionierung', color: 'text-danger' },
];

type SubMenu = 'main' | 'difficulty';

const SinglePlayer = () => {
  const navigate = useNavigate();
  const { muted, toggleMute } = useMusic('menu');
  const [subMenu, setSubMenu] = useState<SubMenu>('main');

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center px-6 relative overflow-hidden" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[400px] h-[400px] rounded-full bg-primary/5 blur-[100px]" />
      </div>

      {/* Back button */}
      <button
        onClick={() => subMenu === 'main' ? navigate('/') : setSubMenu('main')}
        className="absolute top-6 left-6 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors z-10"
      >
        <ArrowLeft size={20} />
      </button>

      <div className="w-full max-w-xs relative z-10">
        {subMenu === 'main' && (
          <div className="space-y-6 text-center">
            <div>
              <h1 className="text-3xl font-black text-foreground mb-1">⚔️ Einzelspieler</h1>
              <p className="text-sm text-muted-foreground">Wähle deinen Spielmodus</p>
            </div>

            <div className="space-y-3">
              {/* Kampagne */}
              <button
                onClick={() => {/* TODO: Kampagne */}}
                className="w-full py-4 px-4 rounded-xl bg-card border border-border text-foreground font-bold text-base hover:bg-accent active:scale-[0.97] transition-all flex items-center gap-3 opacity-50 cursor-not-allowed"
                disabled
              >
                <Trophy size={20} className="text-warning shrink-0" />
                <div className="text-left flex-1">
                  <span className="block">Kampagne</span>
                  <span className="text-xs font-normal text-muted-foreground">Demnächst verfügbar</span>
                </div>
                <ChevronRight size={16} className="text-muted-foreground" />
              </button>

              {/* Vs KI */}
              <button
                onClick={() => setSubMenu('difficulty')}
                className="w-full py-4 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:opacity-90 active:scale-[0.97] transition-all flex items-center gap-3 shadow-[0_0_20px_hsl(var(--primary)/0.3)]"
              >
                <Swords size={20} className="shrink-0" />
                <div className="text-left flex-1">
                  <span className="block">Gegen KI</span>
                  <span className="text-xs font-normal text-primary-foreground/70">Freies Spiel mit Schwierigkeitsgrad</span>
                </div>
                <ChevronRight size={16} className="opacity-70" />
              </button>

              {/* Tutorial */}
              <button
                onClick={() => navigate('/tutorial')}
                className="w-full py-4 px-4 rounded-xl bg-secondary text-secondary-foreground font-bold text-base hover:bg-accent active:scale-[0.97] transition-all flex items-center gap-3"
              >
                <BookOpen size={20} className="text-primary shrink-0" />
                <div className="text-left flex-1">
                  <span className="block">Tutorial</span>
                  <span className="text-xs font-normal text-muted-foreground">Lerne die Grundlagen</span>
                </div>
                <ChevronRight size={16} className="text-muted-foreground" />
              </button>
            </div>
          </div>
        )}

        {subMenu === 'difficulty' && (
          <div className="space-y-5 text-center">
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-1">Schwierigkeit</h2>
              <p className="text-sm text-muted-foreground">Wie stark soll die KI sein?</p>
            </div>

            <div className="space-y-2">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.level}
                  onClick={() => navigate(`/game?difficulty=${d.level}`)}
                  className="w-full py-3 px-4 rounded-xl bg-card border border-border text-foreground font-semibold text-sm hover:bg-accent active:scale-[0.97] transition-all flex items-center gap-3"
                >
                  <span className="text-xl w-8 text-center">{d.emoji}</span>
                  <div className="text-left flex-1">
                    <span className={`block font-bold ${d.color}`}>{d.label}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">{d.description}</span>
                  </div>
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }, (_, i) => (
                      <div
                        key={i}
                        className={`w-1.5 h-3 rounded-sm ${i < d.level ? 'bg-danger' : 'bg-muted/30'}`}
                      />
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SinglePlayer;
