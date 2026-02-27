import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Unit, UnitType, Cell, Phase,
  createEmptyGrid, createUnit, findTarget, moveToward, canAttack, calcDamage,
  generateAIPlacement, getMaxUnits, generateTerrain, setBondsForPlacement, moveTankFormation,
  GRID_SIZE, MAX_UNITS, PLAYER_ROWS, UNIT_DEFS, UNIT_TYPES, POINTS_TO_WIN, BASE_UNITS, ROUND_TIME_LIMIT,
  OVERTIME_THRESHOLD, AUTO_OVERTIMES, MAX_OVERTIMES, PLACE_TIME_LIMIT,
  getActivationTurn,
} from '@/lib/battleGame';
import { BattleEvent } from '@/lib/battleEvents';
import { sfxHit, sfxCriticalHit, sfxKill, sfxFreeze, sfxProjectile } from '@/lib/sfx';

export function useBattleGame(difficulty: number = 2) {
  const [grid, setGrid] = useState<Cell[][]>(() => generateTerrain(createEmptyGrid()));
  const [phase, setPhase] = useState<Phase>('place_player');
  const [selectedUnit, setSelectedUnit] = useState<UnitType | null>('warrior');
  const [playerUnits, setPlayerUnits] = useState<Unit[]>([]);
  const [enemyUnits, setEnemyUnits] = useState<Unit[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [battleLog, setBattleLog] = useState<string[]>([]);
  const [playerScore, setPlayerScore] = useState(0);
  const [enemyScore, setEnemyScore] = useState(0);
  const playerScoreRef = useRef(0);
  const enemyScoreRef = useRef(0);
  const [roundNumber, setRoundNumber] = useState(1);
  const [playerStarts, setPlayerStarts] = useState(true);
  const battleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [battleEvents, setBattleEvents] = useState<BattleEvent[]>([]);
  const [battleTimer, setBattleTimer] = useState(ROUND_TIME_LIMIT);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnCountRef = useRef(0);

  // Placement timer (difficulty 2+)
  const hasPlaceTimer = difficulty >= 2;
  const [placeTimer, setPlaceTimer] = useState(PLACE_TIME_LIMIT);
  const placeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playerUnitsRef = useRef(playerUnits);
  useEffect(() => { playerUnitsRef.current = playerUnits; }, [playerUnits]);

  // Fatigue system: tracks how many consecutive rounds each unit type survived
  const [playerFatigue, setPlayerFatigue] = useState<Record<string, number>>({});
  const [enemyFatigue, setEnemyFatigue] = useState<Record<string, number>>({});
  // Banned units for current round (fatigue >= 1 — units that survived last round are immediately banned)
  const playerBannedUnits: UnitType[] = UNIT_TYPES.filter(t => (playerFatigue[t] || 0) >= 1);
  const enemyBannedUnits: UnitType[] = UNIT_TYPES.filter(t => (enemyFatigue[t] || 0) >= 1);

  // Morale boost state
  const [moraleBoostUsed, setMoraleBoostUsed] = useState(false);
  const [moraleBoostActive, setMoraleBoostActive] = useState<'buff' | 'debuff' | null>(null);
  const moraleTicksLeft = useRef(0);
  const moralePhase = useRef<'none' | 'buff' | 'debuff'>('none');

  // Focus Fire state
  const [focusFireUsed, setFocusFireUsed] = useState(false);
  const [focusFireActive, setFocusFireActive] = useState(false);
  const focusFireTicksLeft = useRef(0);

  // Sacrifice Ritual state
  const [sacrificeUsed, setSacrificeUsed] = useState(false);

  // Shield Wall state
  const [shieldWallUsed, setShieldWallUsed] = useState(false);
  const [shieldWallActive, setShieldWallActive] = useState(false);
  const shieldWallTicksLeft = useRef(0);

  // AI ability state
  const aiMoraleUsed = useRef(false);
  const aiMoralePhase = useRef<'none' | 'buff' | 'debuff'>('none');
  const aiMoraleTicksLeft = useRef(0);
  const [aiMoraleActive, setAiMoraleActive] = useState<'buff' | 'debuff' | null>(null);
  const aiFocusFireUsed = useRef(false);
  const aiFocusFireTicksLeft = useRef(0);
  const aiSacrificeUsed = useRef(false);

  // Overtime state
  const [overtimeCount, setOvertimeCount] = useState(0);
  const [drawOfferPending, setDrawOfferPending] = useState(false);
  const [gameDraw, setGameDraw] = useState(false);

  // Overtime win check: need 2-point lead once both are at OVERTIME_THRESHOLD+
  const checkGameOver = useCallback((pScore: number, eScore: number, otCount: number): { over: boolean; won: boolean; draw: boolean } => {
    const bothAtThreshold = pScore >= OVERTIME_THRESHOLD && eScore >= OVERTIME_THRESHOLD;

    if (bothAtThreshold) {
      // Forced draw after MAX_OVERTIMES
      if (otCount >= MAX_OVERTIMES) {
        return { over: true, won: false, draw: true };
      }
      // Need 2-point lead
      if (Math.abs(pScore - eScore) >= 2) {
        return { over: true, won: pScore > eScore, draw: false };
      }
      return { over: false, won: false, draw: false };
    }

    // Normal win
    if (pScore >= POINTS_TO_WIN) return { over: true, won: true, draw: false };
    if (eScore >= POINTS_TO_WIN) return { over: true, won: false, draw: false };
    return { over: false, won: false, draw: false };
  }, []);

  // Full reset
  const resetGame = useCallback(() => {
    setGrid(generateTerrain(createEmptyGrid()));
    setPlayerUnits([]);
    setEnemyUnits([]);
    setPhase('place_player');
    setTurnCount(0);
    turnCountRef.current = 0;
    setBattleLog([]);
    setSelectedUnit('warrior');
    setPlayerScore(0); playerScoreRef.current = 0;
    setEnemyScore(0); enemyScoreRef.current = 0;
    setRoundNumber(1);
    setPlayerStarts(true);
    setMoraleBoostUsed(false);
    setMoraleBoostActive(null);
    moraleTicksLeft.current = 0;
    moralePhase.current = 'none';
    setFocusFireUsed(false);
    setFocusFireActive(false);
    focusFireTicksLeft.current = 0;
    setSacrificeUsed(false);
    setShieldWallUsed(false);
    setShieldWallActive(false);
    shieldWallTicksLeft.current = 0;
    aiMoraleUsed.current = false;
    aiMoralePhase.current = 'none';
    aiMoraleTicksLeft.current = 0;
    setAiMoraleActive(null);
    aiFocusFireUsed.current = false;
    aiFocusFireTicksLeft.current = 0;
    aiSacrificeUsed.current = false;
    setOvertimeCount(0);
    setDrawOfferPending(false);
    setGameDraw(false);
    setPlayerFatigue({});
    setEnemyFatigue({});
    setPlaceTimer(PLACE_TIME_LIMIT);
  }, []);

  // Placement timer countdown (difficulty 2+)
  useEffect(() => {
    if (phase !== 'place_player' || !hasPlaceTimer) {
      if (placeTimerRef.current) clearInterval(placeTimerRef.current);
      return;
    }
    setPlaceTimer(PLACE_TIME_LIMIT);
    placeTimerRef.current = setInterval(() => {
      setPlaceTimer(prev => {
        if (prev <= 1) {
          if (placeTimerRef.current) clearInterval(placeTimerRef.current);
          // Auto-confirm placement when timer runs out
          setTimeout(() => {
            if (playerUnitsRef.current.length > 0) {
              // Will be handled by confirmPlacement call below
            }
            // Force confirm even with 0 units - skip turn
            confirmPlacementRef.current?.();
          }, 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (placeTimerRef.current) clearInterval(placeTimerRef.current); };
  }, [phase, hasPlaceTimer, roundNumber]);

  const confirmPlacementRef = useRef<(() => void) | null>(null);

  const playerMaxUnits = getMaxUnits(playerScore, enemyScore);
  const enemyMaxUnits = getMaxUnits(enemyScore, playerScore);

  // Place unit
  const placeUnit = useCallback((row: number, col: number) => {
    if (phase !== 'place_player' || !selectedUnit) return;
    if (playerBannedUnits.includes(selectedUnit)) return; // Fatigue ban
    if (!PLAYER_ROWS.includes(row)) return;
    if (playerUnits.length >= playerMaxUnits) return;
    if (grid[row][col].unit) return;
    if (grid[row][col].terrain === 'water') return; // Can't place on water

    const unit = createUnit(selectedUnit, 'player', row, col);
    setPlayerUnits(prev => [...prev, unit]);
    setGrid(prev => {
      const next = prev.map(r => r.map(c => ({ ...c })));
      next[row][col] = { ...next[row][col], unit };
      return next;
    });
  }, [phase, selectedUnit, playerUnits, grid, playerMaxUnits, playerBannedUnits]);

  // Remove placed unit
  const removeUnit = useCallback((unitId: string) => {
    if (phase !== 'place_player') return;
    setPlayerUnits(prev => {
      const unit = prev.find(u => u.id === unitId);
      if (!unit) return prev;
      setGrid(g => {
        const next = g.map(r => r.map(c => ({ ...c })));
        next[unit.row][unit.col].unit = null;
        return next;
      });
      return prev.filter(u => u.id !== unitId);
    });
  }, [phase]);

  // Confirm placement
  const confirmPlacement = useCallback(() => {
    if (placeTimerRef.current) clearInterval(placeTimerRef.current);

    // If no units placed and timer forced it, auto-lose the round
    if (playerUnits.length === 0) {
      const newES = enemyScoreRef.current + 1;
      enemyScoreRef.current = newES;
      setEnemyScore(newES);
      setPhase('round_lost');
      setBattleLog(prev => ['⏰ Keine Einheiten platziert – Runde verloren!', ...prev]);
      return;
    }

    const pUnits = playerUnits.map(u => ({ ...u }));
    
    const aiPlacements = generateAIPlacement(pUnits, enemyMaxUnits, grid, difficulty, enemyBannedUnits);
    const enemies: Unit[] = aiPlacements.map(p => createUnit(p.type, 'enemy', p.row, p.col));

    // Set bonds for all units (player + enemy)
    const allUnits = [...pUnits, ...enemies];
    setBondsForPlacement(allUnits);

    setPlayerUnits(pUnits);
    setEnemyUnits(enemies);

    // Build full grid preserving terrain
    setGrid(prev => {
      const newGrid = prev.map(r => r.map(c => ({ ...c, unit: null as Unit | null })));
      for (const u of pUnits) newGrid[u.row][u.col].unit = u;
      for (const e of enemies) newGrid[e.row][e.col].unit = e;
      return newGrid;
    });

    setPhase('place_enemy');
  }, [playerUnits, enemyBannedUnits]);

  // Keep confirmPlacementRef in sync for auto-confirm timer
  useEffect(() => { confirmPlacementRef.current = confirmPlacement; }, [confirmPlacement]);

  // Start battle
  const startBattle = useCallback(() => {
    setPhase('battle');
    setBattleLog([]);
    setTurnCount(0);
    turnCountRef.current = 0;
    setBattleTimer(ROUND_TIME_LIMIT);
    setMoraleBoostUsed(false);
    setMoraleBoostActive(null);
    moraleTicksLeft.current = 0;
    moralePhase.current = 'none';
    setFocusFireUsed(false);
    setFocusFireActive(false);
    focusFireTicksLeft.current = 0;
    setSacrificeUsed(false);
    setShieldWallUsed(false);
    setShieldWallActive(false);
    shieldWallTicksLeft.current = 0;
    aiMoraleUsed.current = false;
    aiMoralePhase.current = 'none';
    aiMoraleTicksLeft.current = 0;
    setAiMoraleActive(null);
    aiFocusFireUsed.current = false;
    aiFocusFireTicksLeft.current = 0;
    aiSacrificeUsed.current = false;
  }, []);

  // Activate morale boost
  const activateMoraleBoost = useCallback(() => {
    if (moraleBoostUsed || phase !== 'battle') return;
    setMoraleBoostUsed(true);
    moralePhase.current = 'buff';
    moraleTicksLeft.current = 3;
    setMoraleBoostActive('buff');
    setBattleLog(prev => ['🔥 KRIEGSSCHREI! +25% Schaden für 3 Züge!', ...prev]);
  }, [moraleBoostUsed, phase]);

  // Activate focus fire – all units target highest HP enemy for 3 ticks
  const activateFocusFire = useCallback(() => {
    if (focusFireUsed || phase !== 'battle') return;
    setFocusFireUsed(true);
    setFocusFireActive(true);
    focusFireTicksLeft.current = 4;
    setBattleLog(prev => ['🎯 FOKUSFEUER! Alle Einheiten greifen das schwächste Ziel an (4 Züge)!', ...prev]);
  }, [focusFireUsed, phase]);

  // Activate sacrifice ritual – kill weakest own unit, heal others +15%
  const activateSacrifice = useCallback(() => {
    if (sacrificeUsed || phase !== 'battle') return;
    
    // Find weakest player unit
    const pUnits = playerUnits.filter(u => u.hp > 0 && !u.dead);
    if (pUnits.length < 2) return; // need at least 2 units
    
    const weakest = pUnits.reduce((a, b) => a.hp < b.hp ? a : b);
    
    setSacrificeUsed(true);
    
    // Kill weakest and heal others
    setGrid(prevGrid => {
      const newGrid = prevGrid.map(r => r.map(c => ({ ...c, unit: c.unit ? { ...c.unit } : null })));
      
      // Kill the weakest
      if (newGrid[weakest.row][weakest.col].unit) {
        newGrid[weakest.row][weakest.col].unit!.hp = 0;
        (newGrid[weakest.row][weakest.col].unit as any).dead = true;
      }
      
      // Heal all other player units by 15% of maxHp
      for (const row of newGrid) {
        for (const cell of row) {
          if (cell.unit && cell.unit.team === 'player' && cell.unit.hp > 0 && cell.unit.id !== weakest.id) {
            const healAmt = Math.round(cell.unit.maxHp * 0.15);
            cell.unit.hp = Math.min(cell.unit.maxHp, cell.unit.hp + healAmt);
          }
        }
      }
      
      return newGrid;
    });
    
    setBattleLog(prev => [`💀 OPFERRITUAL! ${UNIT_DEFS[weakest.type].emoji} geopfert – alle anderen geheilt!`, ...prev]);
  }, [sacrificeUsed, phase, playerUnits]);

  // Activate shield wall – 3 ticks retreat, 50% damage taken, no damage dealt
  const activateShieldWall = useCallback(() => {
    if (shieldWallUsed || phase !== 'battle') return;
    setShieldWallUsed(true);
    setShieldWallActive(true);
    shieldWallTicksLeft.current = 3;
    setBattleLog(prev => ['🛡️ SCHILDWALL! Rückzug zur Base – 50% Schadensreduktion für 3 Züge!', ...prev]);
  }, [shieldWallUsed, phase]);

  // Run one battle tick
  const battleTick = useCallback(() => {
    setGrid(prevGrid => {
      const newGrid = prevGrid.map(r => r.map(c => ({ ...c, unit: c.unit ? { ...c.unit } : null })));
      const allUnits: Unit[] = [];
      for (const row of newGrid) for (const cell of row) if (cell.unit && cell.unit.hp > 0 && !cell.unit.dead) allUnits.push(cell.unit);

      // Morale boost tick-down
      if (moralePhase.current !== 'none' && moraleTicksLeft.current > 0) {
        moraleTicksLeft.current -= 1;
        if (moraleTicksLeft.current <= 0) {
          if (moralePhase.current === 'buff') {
            // Transition to debuff phase
            moralePhase.current = 'debuff';
            moraleTicksLeft.current = 3;
            setMoraleBoostActive('debuff');
          } else {
            // Debuff expired
            moralePhase.current = 'none';
            setMoraleBoostActive(null);
          }
        }
      }

      // Focus fire tick-down
      if (focusFireTicksLeft.current > 0) {
        focusFireTicksLeft.current -= 1;
        if (focusFireTicksLeft.current <= 0) {
          setFocusFireActive(false);
        }
      }

      // Shield wall tick-down
      if (shieldWallTicksLeft.current > 0) {
        shieldWallTicksLeft.current -= 1;
        if (shieldWallTicksLeft.current <= 0) {
          setShieldWallActive(false);
        }
        // Retreat: move all player units toward their base rows (5,6,7) as fast as possible
        const playerAlive = allUnits.filter(u => u.team === 'player' && u.hp > 0 && !u.dead);
        for (const unit of playerAlive) {
          // Move toward closest base row (maximize row number)
          if (unit.row < 5) {
            // Move as far south as possible (up to 2 steps for speed)
            for (let step = 2; step >= 1; step--) {
              const targetRow = Math.min(7, unit.row + step);
              if (targetRow <= 7 && !newGrid[targetRow][unit.col].unit && newGrid[targetRow][unit.col].terrain !== 'water') {
                newGrid[unit.row][unit.col].unit = null;
                unit.row = targetRow;
                newGrid[unit.row][unit.col].unit = unit;
                break;
              }
            }
          }
        }
      }


      if (aiMoralePhase.current !== 'none' && aiMoraleTicksLeft.current > 0) {
        aiMoraleTicksLeft.current -= 1;
        if (aiMoraleTicksLeft.current <= 0) {
          if (aiMoralePhase.current === 'buff') {
            aiMoralePhase.current = 'debuff';
            aiMoraleTicksLeft.current = 3;
            setAiMoraleActive('debuff');
          } else {
            aiMoralePhase.current = 'none';
            setAiMoraleActive(null);
          }
        }
      }

      // AI focus fire tick-down
      if (aiFocusFireTicksLeft.current > 0) {
        aiFocusFireTicksLeft.current -= 1;
      }

      // --- AI ability decisions (singleplayer, difficulty-aware) ---
      const pAliveNow = allUnits.filter(u => u.team === 'player' && u.hp > 0);
      const eAliveNow = allUnits.filter(u => u.team === 'enemy' && u.hp > 0);
      const currentTurnNum = turnCountRef.current;

      // Difficulty 1-2: AI never uses abilities. Difficulty 3+: uses them with increasing intelligence
      const aiUsesAbilities = difficulty >= 3;

      // AI Kriegsschrei
      if (aiUsesAbilities && !aiMoraleUsed.current && currentTurnNum >= (difficulty >= 5 ? 2 : 3)) {
        const triggerChance = difficulty === 3 ? 0.15 : difficulty === 4 ? 0.3 : 0.5;
        const shouldUse = eAliveNow.length < pAliveNow.length
          || (currentTurnNum >= 5 && Math.random() < triggerChance)
          || (currentTurnNum >= 8 && Math.random() < triggerChance * 2);
        if (shouldUse) {
          aiMoraleUsed.current = true;
          aiMoralePhase.current = 'buff';
          aiMoraleTicksLeft.current = 3;
          setAiMoraleActive('buff');
          setBattleLog(prev => ['🔥 GEGNER: KRIEGSSCHREI! +25% Schaden für 3 Züge!', ...prev]);
          setBattleEvents([{ type: 'hit', attackerId: 'ai', attackerRow: 0, attackerCol: 4, attackerEmoji: '🔥', targetId: '', targetRow: 0, targetCol: 0, damage: 0, isStrong: false, isWeak: false, isRanged: false }]);
        }
      }

      // AI Fokusfeuer
      if (aiUsesAbilities && !aiFocusFireUsed.current && currentTurnNum >= (difficulty >= 5 ? 3 : 4)) {
        const highHpPlayer = pAliveNow.find(u => u.hp > u.maxHp * 0.7);
        const triggerChance = difficulty === 3 ? 0.2 : difficulty === 4 ? 0.4 : 0.6;
        const shouldUse = (highHpPlayer && Math.random() < triggerChance)
          || (currentTurnNum >= 7 && Math.random() < triggerChance * 0.5);
        if (shouldUse) {
          aiFocusFireUsed.current = true;
          aiFocusFireTicksLeft.current = 3;
          setBattleLog(prev => ['🎯 GEGNER: FOKUSFEUER! Alle feindlichen Einheiten greifen ein Ziel an!', ...prev]);
        }
      }

      // AI Opferritual
      if (aiUsesAbilities && !aiSacrificeUsed.current && eAliveNow.length >= 2 && currentTurnNum >= (difficulty >= 5 ? 4 : 5)) {
        const avgEnemyHp = eAliveNow.reduce((s, u) => s + u.hp / u.maxHp, 0) / eAliveNow.length;
        const triggerChance = difficulty === 3 ? 0.25 : difficulty === 4 ? 0.4 : 0.6;
        const shouldUse = (avgEnemyHp < 0.5 && Math.random() < triggerChance)
          || (eAliveNow.length <= 2 && Math.random() < triggerChance * 0.6);
        if (shouldUse) {
          aiSacrificeUsed.current = true;
          const weakest = eAliveNow.reduce((a, b) => a.hp < b.hp ? a : b);
          if (newGrid[weakest.row][weakest.col].unit) {
            newGrid[weakest.row][weakest.col].unit!.hp = 0;
            (newGrid[weakest.row][weakest.col].unit as any).dead = true;
          }
          for (const eu of eAliveNow) {
            if (eu.id !== weakest.id && eu.hp > 0) {
              const healAmt = Math.round(eu.maxHp * 0.15);
              eu.hp = Math.min(eu.maxHp, eu.hp + healAmt);
            }
          }
          setBattleLog(prev => [`💀 GEGNER: OPFERRITUAL! ${UNIT_DEFS[weakest.type].emoji} geopfert – alle anderen geheilt!`, ...prev]);
        }
      }

      // Calculate player damage modifier from morale (+ shield wall: player deals 0 damage)
      const playerDmgMod = shieldWallTicksLeft.current > 0 ? 0 : (moralePhase.current === 'buff' ? 1.25 : moralePhase.current === 'debuff' ? 0.85 : 1.0);
      // Calculate enemy damage modifier from AI morale
      const enemyDmgMod = aiMoralePhase.current === 'buff' ? 1.25 : aiMoralePhase.current === 'debuff' ? 0.85 : 1.0;
      // Shield wall: enemies deal only 50% damage to player units
      const shieldWallDefMod = shieldWallTicksLeft.current > 0 ? 0.5 : 1.0;

      // Focus fire: determine lowest HP enemy target (player ability) – finish off weak units
      const focusTarget = focusFireTicksLeft.current > 0
        ? allUnits.filter(u => u.team === 'enemy' && u.hp > 0).sort((a, b) => a.hp - b.hp)[0] ?? null
        : null;
      // AI focus fire: determine highest HP player target
      const aiFocusTarget = aiFocusFireTicksLeft.current > 0
        ? allUnits.filter(u => u.team === 'player' && u.hp > 0).sort((a, b) => b.hp - a.hp)[0] ?? null
        : null;

      const logs: string[] = [];
      const events: BattleEvent[] = [];
      const currentTurn = turnCountRef.current;
      const acting = allUnits.filter(u => {
        if (u.hp <= 0) return false;
        // Staggered activation: units don't act until their activation turn
        if (u.activationTurn !== undefined && currentTurn < u.activationTurn) return false;
        return true;
      }).sort((a, b) => a.maxCooldown - b.maxCooldown);

      for (const unit of acting) {
        if (unit.hp <= 0) continue;

        // Frozen units can't act, just tick down
        if (unit.frozen && unit.frozen > 0) {
          unit.frozen -= 1;
          continue;
        }

        unit.cooldown = Math.max(0, unit.cooldown - 1);

        // Healer: heal allies first, attack only if no one to heal
        if (unit.type === 'healer') {
          const allies = allUnits.filter(u => u.team === unit.team && u.id !== unit.id && u.hp > 0 && !u.dead);
          const healable = allies.filter(a => a.hp < a.maxHp);

          if (healable.length > 0 && unit.cooldown <= 0) {
            // Try to heal someone in range
            let healed = false;
            for (const ally of healable) {
              if (canAttack(unit, ally)) {
                const healAmt = Math.min(22, ally.maxHp - ally.hp);
                ally.hp += healAmt;
                logs.push(`🌿 ${unit.team === 'player' ? '👤' : '💀'} Schamane → ${UNIT_DEFS[ally.type].emoji} +${healAmt} ❤️`);
                healed = true;
                unit.cooldown = unit.maxCooldown;

                // Emit heal event for animation
                events.push({
                  type: 'heal',
                  attackerId: unit.id,
                  attackerRow: unit.row,
                  attackerCol: unit.col,
                  attackerEmoji: '🌿',
                  targetId: ally.id,
                  targetRow: ally.row,
                  targetCol: ally.col,
                  damage: 0,
                  isStrong: false, isWeak: false,
                  isRanged: Math.abs(unit.row - ally.row) + Math.abs(unit.col - ally.col) > 1,
                  healAmount: healAmt,
                });
                break;
              }
            }
            if (!healed) {
              // Move toward lowest HP ally
              healable.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
              const newPos = moveToward(unit, healable[0], newGrid, allUnits);
              if (newPos.row !== unit.row || newPos.col !== unit.col) {
                newGrid[unit.row][unit.col].unit = null;
                unit.row = newPos.row;
                unit.col = newPos.col;
                newGrid[unit.row][unit.col].unit = unit;
              }
            }
            continue;
          }
          // No allies to heal → fall through to normal attack logic below
        }

        // Focus fire override: player units target lowest HP enemy, AI units target highest HP player
        const target = (focusTarget && unit.team === 'player') ? focusTarget
          : (aiFocusTarget && unit.team === 'enemy') ? aiFocusTarget
          : findTarget(unit, allUnits);
        if (!target) continue;

        if (!canAttack(unit, target)) {
          // Track stuck turns for anti-stalemate
          unit.stuckTurns = (unit.stuckTurns || 0) + 1;
          const newPos = moveToward(unit, target, newGrid, allUnits);
          if (newPos.row !== unit.row || newPos.col !== unit.col) {
            // If tank, move bonded units first
            if (unit.type === 'tank') {
              moveTankFormation(unit, newPos, newGrid, allUnits);
            }
            newGrid[unit.row][unit.col].unit = null;
            unit.row = newPos.row;
            unit.col = newPos.col;
            newGrid[unit.row][unit.col].unit = unit;
          }
        } else {
          // Can attack → reset stuck counter, but ranged kiters still reposition
          unit.stuckTurns = 0;
          const kitePos = moveToward(unit, target, newGrid, allUnits);
          if (kitePos.row !== unit.row || kitePos.col !== unit.col) {
            if (unit.type === 'tank') {
              moveTankFormation(unit, kitePos, newGrid, allUnits);
            }
            newGrid[unit.row][unit.col].unit = null;
            unit.row = kitePos.row;
            unit.col = kitePos.col;
            newGrid[unit.row][unit.col].unit = unit;
          }
        }

        if (canAttack(unit, target) && unit.cooldown <= 0) {
          let dmg = calcDamage(unit, target, newGrid);
          // Apply morale modifier + shield wall
          if (unit.team === 'player') dmg = Math.round(dmg * playerDmgMod);
          else {
            dmg = Math.round(dmg * enemyDmgMod);
            // Shield wall: enemy attacks on player units deal 50% damage
            if (target.team === 'player') dmg = Math.round(dmg * shieldWallDefMod);
          }
          target.hp = Math.max(0, target.hp - dmg);
          unit.cooldown = unit.maxCooldown;
          // Warrior: track last attacked for lock-on behavior
          if (unit.type === 'warrior') unit.lastAttackedId = target.id;
          // Rider: track last attacked for target-switching
          if (unit.type === 'rider') unit.lastAttackedId = target.id;

          // Frost: 50% chance to freeze the target for 1 turn
          let didFreeze = false;
          if (unit.type === 'frost' && target.hp > 0 && Math.random() < 0.5) {
            target.frozen = 1;
            didFreeze = true;
          }

          const def = UNIT_DEFS[unit.type];
          const tDef = UNIT_DEFS[target.type];
          const isStrong = def.strongVs.includes(target.type);
          const isWeak = def.weakVs.includes(target.type);
          const suffix = isStrong ? ' 💪' : isWeak ? ' 😰' : '';
          const dist = Math.abs(unit.row - target.row) + Math.abs(unit.col - target.col);
          logs.push(`${def.emoji} ${unit.team === 'player' ? '👤' : '💀'} ${def.label} → ${tDef.emoji} ${dmg}${suffix}${target.frozen ? ' 🧊' : ''}${target.hp <= 0 ? ' ☠️' : ''}`);

          // Dragon AOE: collect all cells in 3x3 around the dragon for fire effect
          let aoeCells: { row: number; col: number }[] | undefined;
          if (unit.type === 'dragon') {
            aoeCells = [];
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                const ar = unit.row + dr;
                const ac = unit.col + dc;
                if (ar >= 0 && ar < GRID_SIZE && ac >= 0 && ac < GRID_SIZE) {
                  aoeCells.push({ row: ar, col: ac });
                }
              }
            }

            // Splash damage: 30% to other enemies in the 3x3 area
            const splashDmg = Math.round(dmg * 0.3);
            for (const aoePos of aoeCells) {
              const cellUnit = newGrid[aoePos.row][aoePos.col].unit;
              if (cellUnit && cellUnit.hp > 0 && !cellUnit.dead && cellUnit.team !== unit.team && cellUnit.id !== target.id) {
                cellUnit.hp = Math.max(0, cellUnit.hp - splashDmg);
                const splashDef = UNIT_DEFS[cellUnit.type];
                logs.push(`🔥 ${unit.team === 'player' ? '👤' : '💀'} Drache 🔥→ ${splashDef.emoji} ${splashDmg} (Flächenschaden)`);
                events.push({
                  type: cellUnit.hp <= 0 ? 'kill' : 'hit',
                  attackerId: unit.id,
                  attackerRow: unit.row,
                  attackerCol: unit.col,
                  attackerEmoji: '🔥',
                  targetId: cellUnit.id,
                  targetRow: aoePos.row,
                  targetCol: aoePos.col,
                  damage: splashDmg,
                  isStrong: false, isWeak: false,
                  isRanged: false,
                  isAoe: true,
                });
                if (cellUnit.hp <= 0) {
                  (cellUnit as any).dead = true;
                }
              }
            }
          }

          events.push({
            type: target.hp <= 0 ? 'kill' : 'hit',
            attackerId: unit.id,
            attackerRow: unit.row,
            attackerCol: unit.col,
            attackerEmoji: def.emoji,
            targetId: target.id,
            targetRow: target.row,
            targetCol: target.col,
            damage: dmg,
            isStrong, isWeak,
            isRanged: dist > 1,
            isAoe: unit.type === 'dragon',
            aoeCells: aoeCells,
            isFrozen: didFreeze,
          });

          // Emit freeze event for ice animation
          if (didFreeze) {
            events.push({
              type: 'freeze',
              attackerId: unit.id,
              attackerRow: unit.row,
              attackerCol: unit.col,
              attackerEmoji: '🥶',
              targetId: target.id,
              targetRow: target.row,
              targetCol: target.col,
              damage: 0,
              isStrong: false, isWeak: false,
              isRanged: dist > 1,
            });
          }

          if (target.hp <= 0) {
            target.type = target.type;
            (target as any).dead = true;
          }
        }
      }

      if (logs.length > 0) {
        setBattleLog(prev => [...logs, ...prev].slice(0, 40));
      }
      if (events.length > 0) {
        setBattleEvents(events);
        // Play SFX for battle events
        let hasKill = false;
        let hasHit = false;
        let hasCrit = false;
        let hasRanged = false;
        for (const evt of events) {
          if (evt.type === 'kill') hasKill = true;
          else if (evt.isStrong) hasCrit = true;
          else hasHit = true;
          if (evt.isRanged) hasRanged = true;
        }
        // Play most impactful sound (don't stack too many)
        if (hasKill) sfxKill();
        else if (hasCrit) sfxCriticalHit();
        else if (hasHit) sfxHit();
        if (hasRanged) sfxProjectile();
      }

      const alive = allUnits.filter(u => u.hp > 0);
      const pAlive = alive.filter(u => u.team === 'player');
      const eAlive = alive.filter(u => u.team === 'enemy');
      setPlayerUnits(pAlive);
      setEnemyUnits(eAlive);

      if (eAlive.length === 0) {
        const newPS = playerScoreRef.current + 1;
        playerScoreRef.current = newPS;
        setPlayerScore(newPS);
        const result = checkGameOver(newPS, enemyScoreRef.current, overtimeCount);
        if (result.draw) {
          setGameDraw(true);
          setPhase('game_draw');
        } else {
          setPhase('round_won');
        }
      } else if (pAlive.length === 0) {
        const newES = enemyScoreRef.current + 1;
        enemyScoreRef.current = newES;
        setEnemyScore(newES);
        const result = checkGameOver(playerScoreRef.current, newES, overtimeCount);
        if (result.draw) {
          setGameDraw(true);
          setPhase('game_draw');
        } else {
          setPhase('round_lost');
        }
      }

      setTurnCount(prev => { turnCountRef.current = prev + 1; return prev + 1; });
      return newGrid;
    });
  }, []);

  // Battle loop
  useEffect(() => {
    if (phase !== 'battle') {
      if (battleRef.current) clearInterval(battleRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    battleRef.current = setInterval(battleTick, 800);
    timerRef.current = setInterval(() => {
      setBattleTimer(prev => {
        if (prev <= 1) {
          // Time's up - resolve by unit count
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (battleRef.current) clearInterval(battleRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, battleTick]);

  // Handle timer expiry
  useEffect(() => {
    if (phase !== 'battle' || battleTimer > 0) return;
    // Stop the battle
    if (battleRef.current) clearInterval(battleRef.current);
    if (timerRef.current) clearInterval(timerRef.current);

    const pAlive = playerUnits.filter(u => u.hp > 0 && !u.dead);
    const eAlive = enemyUnits.filter(u => u.hp > 0 && !u.dead);

    if (pAlive.length > eAlive.length) {
      const newPS = playerScoreRef.current + 1;
      playerScoreRef.current = newPS;
      setPlayerScore(newPS);
      const result = checkGameOver(newPS, enemyScoreRef.current, overtimeCount);
      if (result.draw) { setGameDraw(true); setPhase('game_draw'); }
      else setPhase('round_won');
      setBattleLog(prev => ['⏰ Zeit abgelaufen! Du hast mehr Einheiten übrig!', ...prev]);
    } else if (eAlive.length > pAlive.length) {
      const newES = enemyScoreRef.current + 1;
      enemyScoreRef.current = newES;
      setEnemyScore(newES);
      const result = checkGameOver(playerScoreRef.current, newES, overtimeCount);
      if (result.draw) { setGameDraw(true); setPhase('game_draw'); }
      else setPhase('round_lost');
      setBattleLog(prev => ['⏰ Zeit abgelaufen! Der Gegner hat mehr Einheiten!', ...prev]);
    } else {
      const newPS = playerScoreRef.current + 1;
      const newES = enemyScoreRef.current + 1;
      playerScoreRef.current = newPS;
      enemyScoreRef.current = newES;
      setPlayerScore(newPS);
      setEnemyScore(newES);
      const result = checkGameOver(newPS, newES, overtimeCount);
      if (result.draw) { setGameDraw(true); setPhase('game_draw'); }
      else setPhase('round_draw');
      setBattleLog(prev => ['⏰ Zeit abgelaufen! Gleichstand – beide erhalten einen Punkt!', ...prev]);
    }
  }, [battleTimer, phase, playerUnits, enemyUnits]);

  const gameOverResult = checkGameOver(playerScore, enemyScore, overtimeCount);
  const gameOver = gameOverResult.over;
  const gameWon = gameOverResult.won;

  // Check if we're in overtime
  const inOvertime = playerScore >= OVERTIME_THRESHOLD && enemyScore >= OVERTIME_THRESHOLD;

  // Accept draw offer (singleplayer: player decides alone)
  const acceptDraw = useCallback(() => {
    setGameDraw(true);
    setPhase('game_draw');
  }, []);

  const nextRound = useCallback(() => {
    // Update fatigue: surviving unit types get +1 fatigue, dead ones reset to 0
    // Also, banned types reset to 0 (they rested this round)
    setPlayerFatigue(prev => {
      const next = { ...prev };
      const survivingTypes = new Set(playerUnits.filter(u => u.hp > 0 && !u.dead).map(u => u.type));
      for (const t of UNIT_TYPES) {
        if (playerBannedUnits.includes(t)) {
          next[t] = 0; // rested this round
        } else if (survivingTypes.has(t)) {
          next[t] = 1; // survived → immediately banned next round
        } else {
          next[t] = 0; // died or wasn't used
        }
      }
      return next;
    });
    setEnemyFatigue(prev => {
      const next = { ...prev };
      const survivingTypes = new Set(enemyUnits.filter(u => u.hp > 0 && !u.dead).map(u => u.type));
      for (const t of UNIT_TYPES) {
        if (enemyBannedUnits.includes(t)) {
          next[t] = 0; // rested this round
        } else if (survivingTypes.has(t)) {
          next[t] = 1; // survived → immediately banned next round
        } else {
          next[t] = 0;
        }
      }
      return next;
    });

    // Track overtime
    if (inOvertime) {
      const newOT = overtimeCount + 1;
      setOvertimeCount(newOT);
      if (newOT >= AUTO_OVERTIMES && !gameOver) {
        setDrawOfferPending(true);
        return;
      }
    }
    setDrawOfferPending(false);
    startNextRound();
  }, [playerStarts, inOvertime, overtimeCount, gameOver, playerUnits, enemyUnits, playerBannedUnits, enemyBannedUnits]);

  const startNextRound = useCallback(() => {
    const newStarts = !playerStarts;
    setRoundNumber(prev => prev + 1);
    setPlayerStarts(newStarts);
    setPlayerUnits([]);
    setTurnCount(0);
    turnCountRef.current = 0;
    setBattleLog([]);
    setSelectedUnit(UNIT_TYPES.find(t => !playerBannedUnits.includes(t)) || 'warrior');
    setPlaceTimer(PLACE_TIME_LIMIT);
    setMoraleBoostUsed(false);
    setMoraleBoostActive(null);
    moraleTicksLeft.current = 0;
    moralePhase.current = 'none';
    setFocusFireUsed(false);
    setFocusFireActive(false);
    focusFireTicksLeft.current = 0;
    setSacrificeUsed(false);
    setShieldWallUsed(false);
    setShieldWallActive(false);
    shieldWallTicksLeft.current = 0;
    aiMoraleUsed.current = false;
    aiMoralePhase.current = 'none';
    aiMoraleTicksLeft.current = 0;
    setAiMoraleActive(null);
    aiFocusFireUsed.current = false;
    aiFocusFireTicksLeft.current = 0;
    aiSacrificeUsed.current = false;

    if (newStarts) {
      setGrid(generateTerrain(createEmptyGrid()));
      setEnemyUnits([]);
      setPhase('place_player');
    } else {
      const terrainGrid = generateTerrain(createEmptyGrid());
      const aiMax = getMaxUnits(enemyScore, playerScore);
      const aiPlacements = generateAIPlacement([], aiMax, terrainGrid, difficulty, enemyBannedUnits);
      const enemies: Unit[] = aiPlacements.map(p => createUnit(p.type, 'enemy', p.row, p.col));
      for (const e of enemies) terrainGrid[e.row][e.col].unit = e;
      setGrid(terrainGrid);
      setEnemyUnits(enemies);
      setPhase('place_player');
    }
  }, [playerStarts]);

  // Continue overtime (decline draw offer)
  const continueOvertime = useCallback(() => {
    setDrawOfferPending(false);
    startNextRound();
  }, [startNextRound]);

  return {
    grid, phase, selectedUnit, setSelectedUnit,
    playerUnits, enemyUnits, turnCount, battleLog, battleEvents, battleTimer,
    playerScore, enemyScore, roundNumber, playerStarts,
    playerMaxUnits, enemyMaxUnits,
    gameOver, gameWon, gameDraw,
    placeUnit, removeUnit, confirmPlacement, startBattle,
    resetGame, nextRound,
    moraleBoostUsed, moraleBoostActive, activateMoraleBoost,
    focusFireUsed, focusFireActive, activateFocusFire,
    sacrificeUsed, activateSacrifice,
    shieldWallUsed, shieldWallActive, activateShieldWall,
    waitingForOpponent: false,
    aiMoraleActive,
    inOvertime, overtimeCount, drawOfferPending,
    acceptDraw, continueOvertime,
    // Fatigue system
    playerBannedUnits,
    playerFatigue,
    // Placement timer
    placeTimer: hasPlaceTimer ? placeTimer : undefined,
  };
}
