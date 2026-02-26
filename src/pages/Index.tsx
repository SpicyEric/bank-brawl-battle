import { useGame } from '@/hooks/useGame';
import { BalanceCard } from '@/components/game/BalanceCard';
import { ActionButton } from '@/components/game/ActionButton';
import { TransactionFeed } from '@/components/game/TransactionFeed';
import { GameOverScreen } from '@/components/game/GameOverScreen';
import { MenuScreen } from '@/components/game/MenuScreen';
import { EARN_ACTIONS, ATTACK_ACTIONS } from '@/lib/gameState';
import { useState } from 'react';

const Index = () => {
  const game = useGame();
  const [tab, setTab] = useState<'earn' | 'attack'>('earn');

  if (game.gameStatus === 'menu') {
    return <MenuScreen onStart={game.startGame} />;
  }

  if (game.gameStatus === 'won' || game.gameStatus === 'lost') {
    return (
      <GameOverScreen
        status={game.gameStatus}
        playerBalance={game.playerBalance}
        enemyBalance={game.enemyBalance}
        onRestart={game.startGame}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-md mx-auto">
      {/* Header */}
      <header className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <span className="text-sm">🏦</span>
          </div>
          <span className="font-semibold text-sm text-foreground">BankBattle</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse-green" />
          <span className="text-[11px] text-muted-foreground">Live</span>
        </div>
      </header>

      {/* Balances */}
      <div className="px-4 space-y-2 mt-2">
        <BalanceCard
          balance={game.playerBalance}
          label="Dein Konto"
          isPlayer
          isUnderAttack={!!game.lastAttack}
        />
        <BalanceCard
          balance={game.enemyBalance}
          label="Gegner"
        />
      </div>

      {/* Attack notification */}
      {game.lastAttack && (
        <div className="mx-4 mt-2 p-2.5 rounded-lg bg-danger/10 border border-danger/20 animate-slide-up">
          <p className="text-xs text-danger font-medium">⚠️ Angriff: {game.lastAttack}</p>
        </div>
      )}

      {/* Action tabs */}
      <div className="px-4 mt-4">
        <div className="flex rounded-xl bg-muted p-1 gap-1">
          <button
            onClick={() => setTab('earn')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === 'earn' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            💰 Verdienen
          </button>
          <button
            onClick={() => setTab('attack')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === 'attack' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            ⚔️ Angreifen
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 mt-3 space-y-2">
        {(tab === 'earn' ? EARN_ACTIONS : ATTACK_ACTIONS).map(action => (
          <ActionButton
            key={action.id}
            action={action}
            cooldownEnd={game.cooldowns[action.id]}
            onAction={game.performAction}
          />
        ))}
      </div>

      {/* Transaction history */}
      <div className="px-4 mt-4 flex-1">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Transaktionen
        </h3>
        <TransactionFeed transactions={game.transactions} />
      </div>

      <div className="h-6" />
    </div>
  );
};

export default Index;
