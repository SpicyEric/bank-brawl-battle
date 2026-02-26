import { Transaction } from '@/lib/gameState';

interface TransactionFeedProps {
  transactions: Transaction[];
}

export function TransactionFeed({ transactions }: TransactionFeedProps) {
  if (transactions.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        Noch keine Transaktionen
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {transactions.map((tx, i) => (
        <div
          key={tx.id}
          className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors animate-slide-up"
          style={{ animationDelay: `${i * 30}ms` }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
              tx.type === 'earn' ? 'bg-success/10' :
              tx.type === 'attack' ? 'bg-warning/10' :
              tx.type === 'received_attack' ? 'bg-danger/10' :
              'bg-primary/10'
            }`}>
              {tx.type === 'earn' ? '↗' : tx.type === 'attack' ? '⚔' : tx.type === 'received_attack' ? '🛡' : '✓'}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{tx.label}</p>
              <p className="text-[10px] text-muted-foreground">
                {new Date(tx.timestamp).toLocaleTimeString('de-DE')}
              </p>
            </div>
          </div>
          <span className={`font-mono text-sm font-semibold whitespace-nowrap ${
            tx.amount > 0 ? 'text-success' : tx.amount < 0 ? 'text-danger' : 'text-muted-foreground'
          }`}>
            {tx.amount > 0 ? '+' : ''}{tx.amount === 0 ? '—' : `€${Math.abs(tx.amount).toLocaleString('de-DE')}`}
          </span>
        </div>
      ))}
    </div>
  );
}
