interface BattleLogProps {
  logs: string[];
}

export function BattleLog({ logs }: BattleLogProps) {
  if (logs.length === 0) return null;
  
  return (
    <div className="space-y-1 max-h-32 overflow-y-auto">
      {logs.slice(0, 8).map((log, i) => (
        <p
          key={i}
          className={`text-[11px] py-1 px-2 rounded-md transition-opacity ${
            i === 0 ? 'bg-muted text-foreground font-medium animate-slide-up' : 'text-muted-foreground'
          }`}
        >
          {log}
        </p>
      ))}
    </div>
  );
}
