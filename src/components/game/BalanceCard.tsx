import { WIN_AMOUNT } from '@/lib/gameState';

interface BalanceCardProps {
  balance: number;
  label: string;
  isPlayer?: boolean;
  isUnderAttack?: boolean;
}

export function BalanceCard({ balance, label, isPlayer = false, isUnderAttack = false }: BalanceCardProps) {
  const percentage = Math.min((balance / WIN_AMOUNT) * 100, 100);
  const isLow = balance < 500;
  const isHigh = balance > 7000;

  return (
    <div className={`rounded-2xl p-5 transition-all duration-300 ${
      isPlayer 
        ? 'bg-card border border-border' 
        : 'bg-secondary border border-border'
    } ${isUnderAttack ? 'animate-shake' : ''}`}>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className={`font-mono text-3xl font-bold tracking-tight transition-colors duration-300 ${
        isLow ? 'text-danger' : isHigh ? 'text-success' : 'text-foreground'
      }`}>
        €{balance.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
      </p>
      <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isLow ? 'bg-danger' : isHigh ? 'bg-success' : 'bg-primary'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">
        {isLow ? '⚠️ Kritisch niedrig' : isHigh ? '🚀 Fast gewonnen!' : `Ziel: €${WIN_AMOUNT.toLocaleString('de-DE')}`}
      </p>
    </div>
  );
}
