import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useBattleGame } from '@/hooks/useBattleGame';
import { useMultiplayerGame } from '@/hooks/useMultiplayerGame';
import { BattleGrid } from '@/components/battle/BattleGrid';
import { UnitPicker } from '@/components/battle/UnitPicker';
import { BattleLog } from '@/components/battle/BattleLog';
import { UnitInfoModal } from '@/components/battle/UnitInfoModal';
import { useMusic } from '@/hooks/useMusic';
import { ROUNDS_TO_WIN, UnitType, ROUND_TIME_LIMIT, ColorGroup } from '@/lib/battleGame';
import { Settings, RotateCcw, Home, VolumeX, Volume2 } from 'lucide-react';
import { sfxPlace, sfxRemove, sfxConfirm, sfxBattleStart, sfxVictory, sfxDefeat, sfxWarCry, sfxFocusFire, sfxSacrifice, sfxShieldWall, setSfxMuted } from '@/lib/sfx';
import { computeAuraOverlay } from '@/lib/auraData';
import { findFormationContaining } from '@/lib/formations';
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
  const [roster, setRoster] = useState<UnitType[] | null>(null);
  const [opponentRoster, setOpponentRoster] = useState<UnitType[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getRoomById } = await import('@/lib/multiplayer');
        const room: any = await getRoomById(roomId);
        const field = role === 'player1' ? 'player1_roster' : 'player2_roster';
        const oppField = role === 'player1' ? 'player2_roster' : 'player1_roster';
        const list = (room?.[field] as UnitType[] | null) || null;
        const oppList = (room?.[oppField] as UnitType[] | null) || undefined;
        if (cancelled) return;
        if (list && list.length === 9) setRoster(list);
        else setLoadError('Roster nicht gefunden');
        if (oppList && oppList.length === 9) setOpponentRoster(oppList);
      } catch (e: any) {
        if (!cancelled) setLoadError(e.message || 'Roster konnte nicht geladen werden');
      }
    })();
    return () => { cancelled = true; };
  }, [roomId, role]);

  if (loadError) {
    return <div className="min-h-[100dvh] flex items-center justify-center text-danger text-sm p-6 text-center">{loadError}</div>;
  }
  if (!roster) {
    return <div className="min-h-[100dvh] flex items-center justify-center text-muted-foreground text-sm">Lade Roster…</div>;
  }
  return <MultiplayerGameInner roomId={roomId} role={role} roster={roster} opponentRoster={opponentRoster} />;
}

function MultiplayerGameInner({ roomId, role, roster, opponentRoster }: { roomId: string; role: 'player1' | 'player2'; roster: UnitType[]; opponentRoster?: UnitType[] }) {
  const game = useMultiplayerGame({ roomId, role, roster, opponentRoster });
  return <GameUI game={game} isMultiplayer flipped={role === 'player2'} roster={roster} />;
}

function SinglePlayerGame() {
  const [searchParams] = useSearchParams();
  const difficulty = parseInt(searchParams.get('difficulty') || '3', 10);
  const rosterParam = searchParams.get('roster');
  const roster = rosterParam ? (rosterParam.split(',').filter(Boolean) as UnitType[]) : undefined;
  const validRoster = roster && roster.length === 9 ? roster : undefined;
  const game = useBattleGame(difficulty, validRoster);
  return <GameUI game={game} isMultiplayer={false} roster={validRoster} />;
}

function GameUI({ game, isMultiplayer, flipped, roster }: { game: Omit<ReturnType<typeof useBattleGame>, 'moveFormation' | 'revealAIPlacement' | 'surrenderRound'> & { moveFormation?: ReturnType<typeof useBattleGame>['moveFormation']; revealAIPlacement?: ReturnType<typeof useBattleGame>['revealAIPlacement']; surrenderRound?: ReturnType<typeof useBattleGame>['surrenderRound']; waitingForOpponent?: boolean; myRows?: number[]; placeTimer?: number; isMyTurnToPlace?: boolean; placingPhase?: string; opponentMoraleActive?: 'buff' | 'debuff' | null; aiMoraleActive?: 'buff' | 'debuff' | null; isHost?: boolean; opponentLeft?: boolean }; isMultiplayer: boolean; flipped?: boolean; roster?: UnitType[] }) {
  const navigate = useNavigate();
  const { muted, toggleMute } = useMusic('battle');
  const [inspectUnit, setInspectUnit] = useState<{ type: UnitType; color?: ColorGroup } | null>(null);
  const [lastPlaced, setLastPlaced] = useState<{ row: number; col: number; type: UnitType } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ row: number; col: number; type: UnitType } | null>(null);
  const [phaseOverlay, setPhaseOverlay] = useState<string | null>(null);
  const [overlaySubtext, setOverlaySubtext] = useState<string | null>(null);
  const [nextRoundCountdown, setNextRoundCountdown] = useState<number | null>(null);
  const prevPhase = useRef(game.phase);
  const nextRoundTriggered = useRef(false);
  const [matchId, setMatchId] = useState(0);
  const prevGameOver = useRef(game.gameOver);

  // === Spy: single tap during placement reveals the AI's fully built formation
  // for 3 seconds. While revealing, your own units are hidden — only the enemy
  // 8×8 board is visible. After 3s, view reverts to your own placement.
  const [spyUsed, setSpyUsed] = useState(false);
  const [surrenderConfirm, setSurrenderConfirm] = useState(false);
  const [spying, setSpying] = useState(false);
  const spyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerSpy = () => {
    if (spyUsed) return;
    if (game.phase !== 'place_player') return;
    // Flush all pending AI placements so player sees the final formation immediately.
    game.revealAIPlacement?.();
    setSpying(true);
    setSpyUsed(true);
    if (spyTimerRef.current) clearTimeout(spyTimerRef.current);
    spyTimerRef.current = setTimeout(() => {
      setSpying(false);
      spyTimerRef.current = null;
    }, 3000);
  };
  // Reset spy state on every new placement phase (and on new match).
  useEffect(() => {
    if (game.phase === 'place_player') {
      setSpyUsed(false);
      setSpying(false);
    } else {
      setSpying(false);
    }
    if (spyTimerRef.current) { clearTimeout(spyTimerRef.current); spyTimerRef.current = null; }
  }, [game.phase, matchId]);
  // Hide enemies during placement unless the spy was used this phase.
  const hideEnemyUnits = game.phase === 'place_player' && !spying;
  // During the 3-second spy reveal, hide our own units so the enemy board is solo.
  const hidePlayerUnits = game.phase === 'place_player' && spying;

  // Aura zones (loaded once from DB), recomputed overlay each render based on placed units
  const [auraZones, setAuraZones] = useState<import('@/lib/auraData').AuraZoneMap>({});
  useEffect(() => {
    let cancelled = false;
    import('@/lib/auraData').then(m => m.loadAuraData()).then(({ zones }) => {
      if (!cancelled) setAuraZones(zones);
    });
    return () => { cancelled = true; };
  }, []);
  const auraOverlay = useMemo(() => {
    if (game.phase !== 'place_player') return undefined;
    // While spying the enemy board, hide our own aura overlays so only the enemy field is visible.
    if (spying) return undefined;
    return computeAuraOverlay(game.playerUnits ?? [], auraZones);
  }, [game.playerUnits, game.phase, auraZones, spying]);

  // Formation selection (combat-phase: tap own unit → select formation → tap adjacent cell → move)
  const [selectedFormationId, setSelectedFormationId] = useState<string | null>(null);
  const selectedFormationCells = useMemo(() => {
    if (!selectedFormationId || game.phase !== 'battle') return undefined;
    const all = [...(game.playerUnits ?? []), ...(game.enemyUnits ?? [])];
    const grp = findFormationContaining(all, selectedFormationId);
    if (!grp) return undefined;
    return new Set(grp.map(u => `${u.row}-${u.col}`));
  }, [selectedFormationId, game.playerUnits, game.enemyUnits, game.phase]);
  useEffect(() => { if (game.phase !== 'battle') setSelectedFormationId(null); }, [game.phase]);


  // New match = transition out of gameOver back into placement (resetGame), or mount of multiplayer
  useEffect(() => {
    if (prevGameOver.current && !game.gameOver) {
      setMatchId(m => m + 1);
    }
    prevGameOver.current = game.gameOver;
  }, [game.gameOver]);

  // Sync SFX mute with music mute
  useEffect(() => { setSfxMuted(muted); }, [muted]);

  // Clear any in-flight drag preview when leaving placement phase (prevents stuck glow if user holds while round starts)
  useEffect(() => {
    if (game.phase !== 'place_player') setDragPreview(null);
  }, [game.phase]);

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
          <ScoreDots score={game.playerScore} max={ROUNDS_TO_WIN} color="success" />
        </div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
          {game.roundNumber > 1 && !game.gameOver ? (
            <span className="text-foreground font-bold">Runde {game.roundNumber}</span>
          ) : (
            <span>Runden</span>
          )}
          {isMultiplayer && <span className="ml-1 text-primary">⚡</span>}
        </p>
        <div className="flex items-center gap-2">
          <ScoreDots score={game.enemyScore} max={ROUNDS_TO_WIN} color="danger" />
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
          grid={(() => {
            // MP spy: overlay opponent snapshot onto an empty board for 3s.
            if (isMultiplayer && spying && (game as any).opponentSnapshot) {
              const snap = (game as any).opponentSnapshot as Array<{ row: number; col: number; team?: string }>;
              const g = game.grid.map(r => r.map(c => ({ ...c, unit: null as any })));
              for (const u of snap) {
                if (g[u.row]?.[u.col]) g[u.row][u.col].unit = u as any;
              }
              return g;
            }
            return game.grid;
          })()}
          phase={game.phase}
          flipped={flipped}
          matchId={matchId}
          onCellClick={(row, col) => {
            if (game.phase === 'place_player') {
              const unit = game.grid[row][col].unit;
              if (unit && unit.team === (isMultiplayer ? (game as any).myRows?.includes(unit.row) ? unit.team : null : 'player')) {
                game.removeUnit(unit.id);
                sfxRemove();
                setLastPlaced(null);
                return;
              }
              const canPlace = roster
                ? (game.selectedSlot !== null && !game.placedSlots?.includes(game.selectedSlot) && !game.playerBannedSlots?.includes(game.selectedSlot))
                : !!game.selectedUnit;
              const existing = game.grid[row][col].unit;
              const cellBlocked = (existing && existing.team === 'player') || game.grid[row][col].terrain === 'water';
              if (canPlace && !cellBlocked) {
                const type = roster && game.selectedSlot !== null ? roster[game.selectedSlot] : game.selectedUnit;
                game.placeUnit(row, col);
                sfxPlace();
                if (type) setLastPlaced({ row, col, type });
              }
              return;
            }
            // === Combat phase: formation drag (SP only) ===
            if (game.phase === 'battle' && !isMultiplayer && game.moveFormation) {
              const unit = game.grid[row][col].unit;
              if (selectedFormationId) {
                const sel = game.playerUnits.find(u => u.id === selectedFormationId);
                if (sel) {
                  const dr = Math.sign(row - sel.row);
                  const dc = Math.sign(col - sel.col);
                  if ((dr !== 0 || dc !== 0) && Math.abs(row - sel.row) <= 1 && Math.abs(col - sel.col) <= 1) {
                    const ok = game.moveFormation(selectedFormationId, dr, dc);
                    if (ok) { setSelectedFormationId(null); return; }
                  }
                }
                // Tap elsewhere → re-select or deselect
                if (unit && unit.team === 'player') { setSelectedFormationId(unit.id); return; }
                setSelectedFormationId(null);
                if (unit) setInspectUnit({ type: unit.type, color: unit.color as ColorGroup | undefined });
                return;
              }
              if (unit && unit.team === 'player') { setSelectedFormationId(unit.id); return; }
            }
            const unit = game.grid[row][col].unit;
            if (unit) setInspectUnit({ type: unit.type, color: unit.color as ColorGroup | undefined });
          }}
          lastPlaced={lastPlaced}
          battleEvents={game.battleEvents}
          moraleBoostActive={game.moraleBoostActive}
          opponentMoraleActive={game.opponentMoraleActive || game.aiMoraleActive}
          focusFireActive={game.focusFireActive}
          sacrificeFlash={game.sacrificeUsed}
          dragPreview={dragPreview}
          auraOverlay={auraOverlay}
          auraZones={auraZones}
          selectedFormationCells={selectedFormationCells}
          hideEnemyUnits={hideEnemyUnits}
          hidePlayerUnits={hidePlayerUnits}
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
            <div className="flex gap-2">
              <button
                onClick={triggerSpy}
                disabled={spyUsed}
                className={`flex-1 py-2.5 rounded-xl font-semibold text-xs transition-all select-none active:scale-[0.98] ${
                  spyUsed
                    ? 'bg-muted text-muted-foreground opacity-40 cursor-not-allowed'
                    : 'bg-card border border-primary/50 text-primary hover:bg-primary/10'
                }`}
              >
                {spying ? '👁️ Gegner sichtbar…' : spyUsed ? '👁️ Spioniert' : '👁️ Spionieren'}
              </button>
              <button
                onClick={() => { game.confirmPlacement(); sfxConfirm(); }}
                disabled={game.playerUnits.length === 0}
                className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-xs hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ✅ Bereit ({game.playerUnits.length})
              </button>
            </div>
            <UnitPicker
              selected={game.selectedUnit}
              onSelect={game.setSelectedUnit}
              placedCount={game.playerUnits.length}
              maxUnits={game.playerMaxUnits}
              bannedUnits={game.playerBannedUnits}
              fatigue={game.playerFatigue}
              roster={roster}
              selectedSlot={game.selectedSlot}
              onSelectSlot={game.setSelectedSlot}
              bannedSlots={game.playerBannedSlots}
              placedSlots={game.placedSlots}
              onDragHover={(row, col, type) => {
                if (row === null || col === null || !type) { setDragPreview(null); return; }
                // SP: full grid is buildable. MP: keep the 4-row half restriction.
                const isPlayerRow = isMultiplayer
                  ? (roster ? (flipped ? row < 4 : [4, 5, 6, 7].includes(row)) : [4, 5, 6, 7].includes(row))
                  : true;
                const targetCell = game.grid[row]?.[col];
                const blocked = !targetCell || targetCell.terrain === 'water' || (targetCell.unit && targetCell.unit.team === 'player');
                if (!isPlayerRow || blocked) {
                  setDragPreview(null);
                  return;
                }
                setDragPreview({ row, col, type });
              }}
              onDragDrop={(row, col, slotIdx) => {
                setDragPreview(null);
                if (!roster) return;
                const cell = game.grid[row]?.[col];
                if (!cell || cell.terrain === 'water' || (cell.unit && cell.unit.team === 'player')) return;
                if (isMultiplayer) {
                  const playerRows = flipped ? [0, 1, 2, 3] : [4, 5, 6, 7];
                  if (!playerRows.includes(row)) return;
                }
                const type = roster[slotIdx];
                game.setSelectedSlot(slotIdx);
                game.placeUnit(row, col, slotIdx);
                sfxPlace();
                setLastPlaced({ row, col, type });
              }}
            />
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

            {/* Ability Buttons: Kampfschrei | Flanke← | Flanke→ | Opfer */}
            <div className="grid grid-cols-4 gap-1.5">
              {/* Kriegsschrei */}
              <button
                onClick={() => { game.activateMoraleBoost(); sfxWarCry(); }}
                disabled={game.moraleBoostUsed}
                className={`py-2 rounded-xl font-semibold text-[10px] transition-all active:scale-[0.97] ${
                  game.moraleBoostActive === 'buff'
                    ? 'bg-warning/20 border-2 border-warning text-warning animate-pulse cursor-default'
                    : game.moraleBoostActive === 'debuff'
                    ? 'bg-danger/10 border-2 border-danger/40 text-danger/60 cursor-default'
                    : game.moraleBoostUsed
                    ? 'bg-muted text-muted-foreground opacity-40 cursor-not-allowed'
                    : 'bg-warning text-warning-foreground hover:opacity-90 shadow-[0_0_8px_hsl(var(--warning)/0.3)]'
                }`}
              >
                {game.moraleBoostActive === 'buff' ? '🔥 AKTIV!'
                  : game.moraleBoostActive === 'debuff' ? '😮‍💨 Müde'
                  : game.moraleBoostUsed ? '🔥 ✓' : '🔥 Schrei'}
              </button>

              {/* Flanke links */}
              <button
                onClick={() => { game.activateFlank?.(-1); }}
                disabled={game.flankLeftUsed || !!game.flankActive}
                className={`py-2 rounded-xl font-semibold text-[10px] transition-all active:scale-[0.97] ${
                  game.flankActive === 'left'
                    ? 'bg-primary/20 border-2 border-primary text-primary animate-pulse cursor-default'
                    : game.flankLeftUsed
                    ? 'bg-muted text-muted-foreground opacity-40 cursor-not-allowed'
                    : 'bg-primary text-primary-foreground hover:opacity-90 shadow-[0_0_8px_hsl(var(--primary)/0.3)]'
                }`}
              >
                {game.flankActive === 'left' ? '⬅️ FLANKE!'
                  : game.flankLeftUsed ? '⬅️ ✓' : '⬅️ Flanke'}
              </button>

              {/* Flanke rechts */}
              <button
                onClick={() => { game.activateFlank?.(1); }}
                disabled={game.flankRightUsed || !!game.flankActive}
                className={`py-2 rounded-xl font-semibold text-[10px] transition-all active:scale-[0.97] ${
                  game.flankActive === 'right'
                    ? 'bg-primary/20 border-2 border-primary text-primary animate-pulse cursor-default'
                    : game.flankRightUsed
                    ? 'bg-muted text-muted-foreground opacity-40 cursor-not-allowed'
                    : 'bg-primary text-primary-foreground hover:opacity-90 shadow-[0_0_8px_hsl(var(--primary)/0.3)]'
                }`}
              >
                {game.flankActive === 'right' ? 'FLANKE! ➡️'
                  : game.flankRightUsed ? '➡️ ✓' : 'Flanke ➡️'}
              </button>

              {/* Opferritual */}
              <button
                onClick={() => { game.activateSacrifice(); sfxSacrifice(); }}
                disabled={game.sacrificeUsed || game.playerUnits.filter(u => u.hp > 0).length < 2}
                className={`py-2 rounded-xl font-semibold text-[10px] transition-all active:scale-[0.97] ${
                  game.sacrificeUsed
                    ? 'bg-muted text-muted-foreground opacity-40 cursor-not-allowed'
                    : 'bg-danger text-danger-foreground hover:opacity-90 shadow-[0_0_8px_hsl(var(--danger)/0.3)]'
                }`}
              >
                {game.sacrificeUsed ? '💀 ✓' : '💀 Opfer'}
              </button>
            </div>

            {/* Ability info line */}
            <div className="flex gap-1 text-[8px] text-muted-foreground justify-center flex-wrap">
              <span>🔥+25%→-15%</span>
              <span>•</span>
              <span>⬅️➡️ 2 zurück → 5 seitwärts → 5 vor</span>
              <span>•</span>
              <span>💀 Opfern=Heilen</span>
            </div>

            {/* Aufgeben Button (mit Ja/Nein-Bestätigung) */}
            {!isMultiplayer && game.surrenderRound && (
              surrenderConfirm ? (
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => { setSurrenderConfirm(false); game.surrenderRound?.(); }}
                    className="py-2 rounded-xl font-semibold text-[11px] bg-danger text-danger-foreground hover:opacity-90 active:scale-[0.97] transition-all"
                  >
                    ✅ Ja, aufgeben
                  </button>
                  <button
                    onClick={() => setSurrenderConfirm(false)}
                    className="py-2 rounded-xl font-semibold text-[11px] bg-muted text-muted-foreground hover:opacity-90 active:scale-[0.97] transition-all"
                  >
                    ❌ Nein
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setSurrenderConfirm(true)}
                  className="w-full py-2 rounded-xl font-semibold text-[11px] bg-muted/40 text-muted-foreground border border-border hover:bg-muted/60 active:scale-[0.97] transition-all"
                >
                  🏳️ Aufgeben
                </button>
              )
            )}


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
              Runden: <span className="text-success font-bold">{game.playerScore}</span> : <span className="text-danger font-bold">{game.enemyScore}</span>
            </p>
            {game.gameOver ? (
              <div className="space-y-3">
                <p className="text-xl font-bold text-foreground">
                  {game.gameWon ? '🎉 MATCH GEWONNEN!' : '😢 MATCH VERLOREN!'}
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
              <div className="space-y-2">
                <button
                  onClick={game.nextRound}
                  className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.97] transition-all"
                >
                  ⚔️ Nächste Runde
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {inspectUnit && (
        <UnitInfoModal unitType={inspectUnit.type} colorOverride={inspectUnit.color} onClose={() => setInspectUnit(null)} />
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
