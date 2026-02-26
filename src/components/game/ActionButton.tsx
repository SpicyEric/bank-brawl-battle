import { GameAction } from '@/lib/gameState';

interface ActionButtonProps {
  action: GameAction;
  cooldownEnd?: number;
  onAction: (action: GameAction) => void;
}

export function ActionButton({ action, cooldownEnd, onAction }: ActionButtonProps) {
  const now = Date.now();
  const isOnCooldown = cooldownEnd ? cooldownEnd > now : false;
  const cooldownRemaining = isOnCooldown && cooldownEnd ? Math.ceil((cooldownEnd - now) / 1000) : 0;
  const isAttack = action.type === 'attack';

  return (
    <button
      onClick={() => onAction(action)}
      disabled={isOnCooldown}
      className={`relative w-full rounded-xl p-3 text-left transition-all duration-200 border
        ${isOnCooldown 
          ? 'opacity-40 cursor-not-allowed bg-muted border-border' 
          : isAttack
            ? 'bg-danger/10 border-danger/20 hover:bg-danger/20 active:scale-[0.97]'
            : 'bg-success/10 border-success/20 hover:bg-success/20 active:scale-[0.97]'
        }`}
    >
      <div className="flex items-center gap-3">
        <span className="text-xl">{action.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{action.label}</p>
          <p className="text-[11px] text-muted-foreground">{action.description}</p>
        </div>
        <div className="text-right">
          {isOnCooldown ? (
            <span className="text-xs font-mono text-muted-foreground">{cooldownRemaining}s</span>
          ) : (
            <span className={`text-xs font-mono font-semibold ${isAttack ? 'text-danger' : 'text-success'}`}>
              €{action.minAmount}-{action.maxAmount}
            </span>
          )}
        </div>
      </div>
      {/* Success rate indicator */}
      <div className="mt-2 flex items-center gap-1.5">
        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full ${isAttack ? 'bg-danger/60' : 'bg-success/60'}`}
            style={{ width: `${action.successRate * 100}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground">{Math.round(action.successRate * 100)}%</span>
      </div>
    </button>
  );
}
