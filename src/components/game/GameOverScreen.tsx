import { GameStatus } from '@/hooks/useGame';

interface GameOverScreenProps {
  status: GameStatus;
  playerBalance: number;
  enemyBalance: number;
  onRestart: () => void;
}

export function GameOverScreen({ status, playerBalance, enemyBalance, onRestart }: GameOverScreenProps) {
  const won = status === 'won';

  return (
    <div className="fixed inset-0 z-50 bg-background/95 flex items-center justify-center p-6">
      <div className="text-center animate-slide-up max-w-sm">
        <div className="text-6xl mb-4">{won ? '🏆' : '💸'}</div>
        <h2 className={`text-3xl font-bold mb-2 ${won ? 'text-success' : 'text-danger'}`}>
          {won ? 'Du hast gewonnen!' : 'Du bist pleite!'}
        </h2>
        <p className="text-muted-foreground mb-6">
          Dein Kontostand: <span className="font-mono font-semibold text-foreground">€{playerBalance.toLocaleString('de-DE')}</span>
          <br />
          Gegner: <span className="font-mono font-semibold text-foreground">€{enemyBalance.toLocaleString('de-DE')}</span>
        </p>
        <button
          onClick={onRestart}
          className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-semibold text-lg hover:opacity-90 active:scale-[0.97] transition-all"
        >
          Nochmal spielen
        </button>
      </div>
    </div>
  );
}
