import { useNavigate } from 'react-router-dom';
import { useMusic } from '@/hooks/useMusic';
import { Swords, Users, Volume2, VolumeX } from 'lucide-react';

const MainMenu = () => {
  const navigate = useNavigate();
  const { muted, toggleMute } = useMusic('menu');

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6 relative overflow-hidden bg-background" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Menu buttons */}
      <div className="w-full max-w-xs space-y-3">
        <button
          onClick={() => navigate('/singleplayer')}
          className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:opacity-90 active:scale-[0.97] transition-all flex items-center justify-center gap-3 shadow-[0_0_20px_hsl(var(--primary)/0.3)]"
        >
          <Swords size={20} />
          Einzelspieler
        </button>

        <button
          onClick={() => navigate('/multiplayer')}
          className="w-full py-4 rounded-xl bg-secondary text-secondary-foreground font-bold text-base hover:bg-accent active:scale-[0.97] transition-all flex items-center justify-center gap-3"
        >
          <Users size={20} />
          Multiplayer
        </button>
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-8 flex gap-4 z-10">
        <button
          onClick={toggleMute}
          className="p-3 rounded-xl bg-card/80 backdrop-blur-sm border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
      </div>
    </div>
  );
};

export default MainMenu;
