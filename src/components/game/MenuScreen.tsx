interface MenuScreenProps {
  onStart: () => void;
}

export function MenuScreen({ onStart }: MenuScreenProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
      <div className="text-center animate-slide-up max-w-sm w-full">
        <div className="mb-6">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
            <span className="text-4xl">🏦</span>
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">BankBattle</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Mach deinen Gegner pleite. Erreiche €10.000 zuerst.
          </p>
        </div>

        <div className="space-y-3 mb-8 text-left">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
            <span className="text-lg">💰</span>
            <div>
              <p className="text-sm font-medium text-foreground">Geld verdienen</p>
              <p className="text-[11px] text-muted-foreground">Jobs, Investments & Crypto</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
            <span className="text-lg">⚔️</span>
            <div>
              <p className="text-sm font-medium text-foreground">Gegner angreifen</p>
              <p className="text-[11px] text-muted-foreground">Gebühren, Hacks & Phishing</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
            <span className="text-lg">🤖</span>
            <div>
              <p className="text-sm font-medium text-foreground">KI-Gegner</p>
              <p className="text-[11px] text-muted-foreground">Greift zurück & verdient auch Geld</p>
            </div>
          </div>
        </div>

        <button
          onClick={onStart}
          className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-semibold text-lg hover:opacity-90 active:scale-[0.97] transition-all animate-pulse-green"
        >
          Spiel starten
        </button>
      </div>
    </div>
  );
}
