import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useBattleGame } from '@/hooks/useBattleGame';
import { useMultiplayerGame } from '@/hooks/useMultiplayerGame';
import { BattleGrid } from '@/components/battle/BattleGrid';
import { UnitPicker } from '@/components/battle/UnitPicker';
import { BattleLog } from '@/components/battle/BattleLog';
import { UnitInfoModal } from '@/components/battle/UnitInfoModal';
import { useMusic } from '@/hooks/useMusic';
import { POINTS_TO_WIN, UnitType, ROUND_TIME_LIMIT, OVERTIME_THRESHOLD } from '@/lib/battleGame';
import { Settings, RotateCcw, Home, VolumeX, Volume2 } from 'lucide-react';
import { sfxPlace, sfxRemove, sfxConfirm, sfxBattleStart, sfxVictory, sfxDefeat, sfxWarCry, sfxFocusFire, sfxSacrifice, setSfxMuted } from '@/lib/sfx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function ScoreDots({ score, max, color }: { score: number; max: number; color: 'success' | 'danger' }) {
  return (
    <div className="flex gap-[3px] items-center">
      {Array.from({ length: max }, (_, i) => (
        <div
          key={i}
          className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
            i < score
              ? color === 'success' ? 'bg-success shadow-[0_0_4px_hsl(var(--success))]' : 'bg-danger shadow-[0_0_4px_hsl(var(--danger))]'
              : 'bg-muted/40'
          }`}
        />
      ))}
    </div>
  );
}

function MultiplayerGame({ roomId, role }: { roomId: string; role: 'player1' | 'player2' }) {
  const game = useMultiplayerGame({ roomId, role });
  return <GameUI game={game} isMultiplayer flipped={role === 'player2'} />;
}

function SinglePlayerGame() {
  const [searchParams] = useSearchParams();
  const difficulty = parseInt(searchParams.get('difficulty') || '2', 10);
  const game = useBattleGame(difficulty);
  return <GameUI game={game} isMultiplayer={false} />;
}

function GameUI({ game, isMultiplayer, flipped }: { game: ReturnType<typeof useBattleGame> & { waitingForOpponent?: boolean; myRows?: number[]; placeTimer?: number; isMyTurnToPlace?: boolean; placingPhase?: string; opponentMoraleActive?: 'buff' | 'debuff' | null; aiMoraleActive?: 'buff' | 'debuff' | null; isHost?: boolean; opponentLeft?: boolean }; isMultiplayer: boolean; flipped?: boolean }) {
  const navigate = useNavigate();
  const { muted, toggleMute } = useMusic('battle');
  const [inspectUnit, setInspectUnit] = useState<UnitType | null>(null);
  const [lastPlaced, setLastPlaced] = useState<{ row: number; col: number; type: UnitType } | null>(null);
  const [phaseOverlay, setPhaseOverlay] = useState<string | null>(null);
  const [overlaySubtext, setOverlaySubtext] = useState<string | null>(null);
  const [nextRoundCountdown, setNextRoundCountdown] = useState<number | null>(null);
  const prevPhase = useRef(game.phase);
  const nextRoundTriggered = useRef(false);

  // Sync SFX mute with music mute
  useEffect(() => { setSfxMuted(muted); }, [muted]);

  useEffect(() => {
    if (game.phase === prevPhase.current) return;
    prevPhase.current = game.phase;
    nextRoundTriggered.current = false;

    let text: string | null = null;
    let sub: string | null = null;

    if (game.phase === 'place_player') {
      text = 'Platziere!';
      setNextRoundCountdown(null);
    } else if (game.phase === 'place_enemy') {
      text = 'Bereit?';
    } else if (game.phase === 'battle') {
      text = 'Kampf!';
      sfxBattleStart();
    } else if (game.phase === 'round_won') {
      text = '🏆 Gewonnen!';
      sfxVictory();
    } else if (game.phase === 'round_lost') {
      text = '💀 Verloren!';
      sfxDefeat();
    } else if (game.phase === 'round_draw') {
      text = '⚖️ Gleichstand!';
    }

    // Start auto-countdown for multiplayer round end (non-game-over)
    if (isMultiplayer && !game.gameOver && (game.phase === 'round_won' || game.phase === 'round_lost' || game.phase === 'round_draw')) {
      setNextRoundCountdown(3);
    }

    if (text) {
      setPhaseOverlay(text);
      setOverlaySubtext(sub);
      setTimeout(() => { setPhaseOverlay(null); setOverlaySubtext(null); }, 1400);
    }
  }, [game.phase, isMultiplayer, game.gameOver]);

  // Auto-countdown for multiplayer next round
  useEffect(() => {
    if (nextRoundCountdown === null || nextRoundCountdown <= 0) return;
    const timer = setTimeout(() => {
      setNextRoundCountdown(prev => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [nextRoundCountdown]);

  // Trigger next round when countdown hits 0 (host only)
  useEffect(() => {
    if (nextRoundCountdown === 0 && isMultiplayer && game.isHost && !nextRoundTriggered.current) {
      nextRoundTriggered.current = true;
      setNextRoundCountdown(null); // Clear countdown to prevent re-trigger after phase change
      game.nextRound();
    }
  }, [nextRoundCountdown, isMultiplayer, game]);

  // Handle opponent disconnect → redirect after 3s
  useEffect(() => {
    if (!game.opponentLeft) return;
    const timer = setTimeout(() => {
      navigate('/');
    }, 3000);
    return () => clearTimeout(timer);
  }, [game.opponentLeft, navigate]);

  return (
    <div className="min-h-[100dvh] max-h-[100dvh] bg-background flex flex-col max-w-md mx-auto overflow-hidden" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Scoreboard */}
      <div className="mx-3 mt-2 mb-1.5 py-1.5 px-3 rounded-lg bg-card border border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-base font-bold font-mono text-success leading-none">{game.playerScore}</p>
          <ScoreDots score={game.playerScore} max={POINTS_TO_WIN} color="success" />
        </div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
          {game.inOvertime ? (
            <span className="text-warning">⚡ Verlängerung {game.overtimeCount}</span>
          ) : (
            <>Runde <span className="text-foreground font-bold">{game.roundNumber}</span></>
          )}
          {isMultiplayer && <span className="ml-1 text-primary">⚡</span>}
        </p>
        <div className="flex items-center gap-2">
          <ScoreDots score={game.enemyScore} max={POINTS_TO_WIN} color="danger" />
          <p className="text-base font-bold font-mono text-danger leading-none">{game.enemyScore}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <Settings size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuItem onClick={toggleMute}>
              {muted ? <Volume2 className="mr-2 h-4 w-4" /> : <VolumeX className="mr-2 h-4 w-4" />}
              {muted ? 'Ton an' : 'Ton aus'}
            </DropdownMenuItem>
            {!isMultiplayer && (
              <DropdownMenuItem onClick={game.resetGame}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Spiel neustarten
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => navigate('/')}>
              <Home className="mr-2 h-4 w-4" />
              Hauptmenü
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Grid */}
      <div className="px-4 relative">
        <BattleGrid
          grid={game.grid}
          phase={game.phase}
          flipped={flipped}
          onCellClick={(row, col) => {
            if (game.phase === 'place_player') {
              const unit = game.grid[row][col].unit;
              if (unit && unit.team === (isMultiplayer ? (game as any).myRows?.includes(unit.row) ? unit.team : null : 'player')) {
                game.removeUnit(unit.id);
                sfxRemove();
                setLastPlaced(null);
                return;
              }
              if (game.selectedUnit && !game.grid[row][col].unit && game.grid[row][col].terrain !== 'water') {
                game.placeUnit(row, col);
                sfxPlace();
                setLastPlaced({ row, col, type: game.selectedUnit });
              }
              return;
            }
            const unit = game.grid[row][col].unit;
            if (unit) setInspectUnit(unit.type);
          }}
          lastPlaced={lastPlaced}
          battleEvents={game.battleEvents}
          moraleBoostActive={game.moraleBoostActive}
          opponentMoraleActive={game.opponentMoraleActive || game.aiMoraleActive}
          focusFireActive={game.focusFireActive}
          sacrificeFlash={game.sacrificeUsed}
        />

        {phaseOverlay && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-30 pointer-events-none phase-overlay-fade">
            <p className="text-4xl font-black text-foreground drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] tracking-tight">
              {phaseOverlay}
            </p>
            {overlaySubtext && (
              <p className="text-sm font-semibold text-primary mt-1 drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)]">
                {overlaySubtext}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="px-4 mt-3 flex-1">
        {game.phase === 'place_player' && !game.waitingForOpponent && (!isMultiplayer || game.isMyTurnToPlace) && (
          <div className="space-y-3">
            {game.placeTimer !== undefined && (
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">
                  {isMultiplayer
                    ? (game.placingPhase === 'first' ? '🎲 Du platzierst zuerst (blind)' : '👀 Du siehst die Aufstellung – reagiere!')
                    : (game.playerBannedUnits?.length > 0 ? '💤 Ermüdete Einheiten rasten' : 'Platziere deine Einheiten')}
                </p>
                <span className={`text-sm font-mono font-bold ${game.placeTimer <= 3 ? 'text-danger animate-pulse' : 'text-warning'}`}>
                  ⏱ {game.placeTimer}s
                </span>
              </div>
            )}
            <UnitPicker
              selected={game.selectedUnit}
              onSelect={game.setSelectedUnit}
              placedCount={game.playerUnits.length}
              maxUnits={game.playerMaxUnits}
              bannedUnits={game.playerBannedUnits}
              fatigue={game.playerFatigue}
            />
            <button
              onClick={() => { game.confirmPlacement(); sfxConfirm(); }}
              disabled={!isMultiplayer && !game.placeTimer && game.playerUnits.length < game.playerMaxUnits}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ✅ Bereit {isMultiplayer && game.playerUnits.length === 0 ? '(Aufgeben)' : ''}
            </button>
          </div>
        )}

        {game.phase === 'place_player' && game.waitingForOpponent && (
          <div className="text-center py-8 space-y-3">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground">
              {isMultiplayer ? 'Gegner platziert seine Einheiten...' : 'Warte auf Gegner...'}
            </p>
            {isMultiplayer && game.placeTimer !== undefined && (
              <span className="text-xs font-mono text-muted-foreground">⏱ {game.placeTimer}s</span>
            )}
          </div>
        )}

        {game.phase === 'place_enemy' && !isMultiplayer && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">Beide Seiten stehen – bereit zum Kampf?</p>
            <button
              onClick={game.startBattle}
              className="w-full py-3.5 rounded-xl bg-warning text-warning-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all"
            >
              ⚔️ Kampf starten!
            </button>
          </div>
        )}

        {game.phase === 'battle' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Kampflog</p>
              <div className="flex items-center gap-3 text-[11px]">
                <span className={`font-mono font-bold ${game.battleTimer <= 10 ? 'text-danger animate-pulse' : 'text-muted-foreground'}`}>
                  ⏱ {game.battleTimer}s
                </span>
                <span className="text-success">👤 {game.playerUnits.length}</span>
                <span className="text-muted-foreground">vs</span>
                <span className="text-danger">💀 {game.enemyUnits.length}</span>
              </div>
            </div>

            {/* Ability Buttons */}
            <div className="grid grid-cols-3 gap-2">
              {/* Kriegsschrei */}
              <button
                onClick={() => { game.activateMoraleBoost(); sfxWarCry(); }}
                disabled={game.moraleBoostUsed}
                className={`py-2 rounded-xl font-semibold text-xs transition-all active:scale-[0.97] ${
                  game.moraleBoostActive === 'buff'
                    ? 'bg-warning/20 border-2 border-warning text-warning animate-pulse cursor-default'
                    : game.moraleBoostActive === 'debuff'
                    ? 'bg-danger/10 border-2 border-danger/40 text-danger/60 cursor-default'
                    : game.moraleBoostUsed
                    ? 'bg-muted text-muted-foreground opacity-40 cursor-not-allowed'
                    : 'bg-warning text-warning-foreground hover:opacity-90 shadow-[0_0_8px_hsl(var(--warning)/0.3)]'
                }`}
              >
                {game.moraleBoostActive === 'buff'
                  ? '🔥 AKTIV!'
                  : game.moraleBoostActive === 'debuff'
                  ? '😮‍💨 Müde'
                  : game.moraleBoostUsed
                  ? '🔥 ✓'
                  : '🔥 Schrei'}
              </button>

              {/* Fokusfeuer */}
              <button
                onClick={() => { game.activateFocusFire(); sfxFocusFire(); }}
                disabled={game.focusFireUsed}
                className={`py-2 rounded-xl font-semibold text-xs transition-all active:scale-[0.97] ${
                  game.focusFireActive
                    ? 'bg-primary/20 border-2 border-primary text-primary animate-pulse cursor-default'
                    : game.focusFireUsed
                    ? 'bg-muted text-muted-foreground opacity-40 cursor-not-allowed'
                    : 'bg-primary text-primary-foreground hover:opacity-90 shadow-[0_0_8px_hsl(var(--primary)/0.3)]'
                }`}
              >
                {game.focusFireActive
                  ? '🎯 FEUER!'
                  : game.focusFireUsed
                  ? '🎯 ✓'
                  : '🎯 Fokus'}
              </button>

              {/* Opferritual */}
              <button
                onClick={() => { game.activateSacrifice(); sfxSacrifice(); }}
                disabled={game.sacrificeUsed || game.playerUnits.filter(u => u.hp > 0).length < 2}
                className={`py-2 rounded-xl font-semibold text-xs transition-all active:scale-[0.97] ${
                  game.sacrificeUsed
                    ? 'bg-muted text-muted-foreground opacity-40 cursor-not-allowed'
                    : 'bg-danger text-danger-foreground hover:opacity-90 shadow-[0_0_8px_hsl(var(--danger)/0.3)]'
                }`}
              >
                {game.sacrificeUsed ? '💀 ✓' : '💀 Opfer'}
              </button>
            </div>

            {/* Ability info line */}
            <div className="flex gap-1 text-[9px] text-muted-foreground justify-center">
              <span>🔥+25%→-15%</span>
              <span>•</span>
              <span>🎯 Schwächstes Ziel</span>
              <span>•</span>
              <span>💀 Opfern=Heilen</span>
            </div>

            <BattleLog logs={game.battleLog} />
          </div>
        )}

        {/* Draw offer dialog */}
        {game.drawOfferPending && (
          <div className="text-center space-y-4 py-4">
            <p className="text-lg font-bold text-foreground">🤝 Unentschieden anbieten?</p>
            <p className="text-sm text-muted-foreground">
              Stand: <span className="text-success font-bold">{game.playerScore}</span> : <span className="text-danger font-bold">{game.enemyScore}</span>
              <br />Verlängerung {game.overtimeCount} — 2 Punkte Vorsprung nötig
            </p>
            <div className="flex gap-3">
              <button
                onClick={game.acceptDraw}
                className="flex-1 py-3 rounded-xl bg-muted text-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all"
              >
                🤝 Unentschieden
              </button>
              <button
                onClick={game.continueOvertime}
                className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all"
              >
                ⚔️ Weiterkämpfen!
              </button>
            </div>
          </div>
        )}

        {/* Game draw */}
        {game.phase === 'game_draw' && (
          <div className="text-center space-y-4 py-4">
            <p className="text-xl font-bold text-foreground">🤝 UNENTSCHIEDEN!</p>
            <p className="text-sm text-muted-foreground">
              Endstand: <span className="text-success font-bold">{game.playerScore}</span> : <span className="text-danger font-bold">{game.enemyScore}</span>
            </p>
            <button
              onClick={() => navigate('/')}
              className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all"
            >
              🏠 Hauptmenü
            </button>
          </div>
        )}

        {(game.phase === 'round_won' || game.phase === 'round_lost' || game.phase === 'round_draw') && (
          <div className="text-center space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Stand: <span className="text-success font-bold">{game.playerScore}</span> : <span className="text-danger font-bold">{game.enemyScore}</span>
              {game.inOvertime && <span className="text-warning text-xs ml-2">(2 Punkte Vorsprung nötig)</span>}
            </p>
            {game.gameOver ? (
              <div className="space-y-3">
                <p className="text-xl font-bold text-foreground">
                  {game.gameWon ? '🎉 SPIEL GEWONNEN!' : '😢 SPIEL VERLOREN!'}
                </p>
                <button
                  onClick={() => navigate('/')}
                  className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all"
                >
                  🏠 Hauptmenü
                </button>
              </div>
            ) : isMultiplayer ? (
              <div className="space-y-2">
                <p className="text-2xl font-black text-foreground">
                  {nextRoundCountdown !== null && nextRoundCountdown > 0 ? `${nextRoundCountdown}` : '⚔️'}
                </p>
                <p className="text-xs text-muted-foreground">Nächste Runde startet automatisch...</p>
              </div>
            ) : (
              <button
                onClick={game.nextRound}
                className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all"
              >
                ➡️ {game.inOvertime ? 'Verlängerung' : 'Nächste Runde'} ({game.roundNumber + 1})
              </button>
            )}
          </div>
        )}
      </div>

      {inspectUnit && (
        <UnitInfoModal unitType={inspectUnit} onClose={() => setInspectUnit(null)} />
      )}
      {/* Opponent disconnect overlay */}
      {game.opponentLeft && (
        <div className="fixed inset-0 z-50 bg-black/70 flex flex-col items-center justify-center gap-4">
          <p className="text-2xl font-black text-foreground">🚪 Gegner hat das Spiel verlassen</p>
          <p className="text-sm text-muted-foreground">Du wirst zum Hauptmenü weitergeleitet...</p>
        </div>
      )}
      <div className="h-6" />
    </div>
  );
}

const Index = () => {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode');
  const roomId = searchParams.get('room');
  const role = searchParams.get('role') as 'player1' | 'player2' | null;

  if (mode === 'multi' && roomId && role) {
    return <MultiplayerGame roomId={roomId} role={role} />;
  }

  return <SinglePlayerGame />;
};

export default Index;
