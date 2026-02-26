import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Transaction, GameAction, rollAction, createTransaction,
  EARN_ACTIONS, ATTACK_ACTIONS, WIN_AMOUNT, START_AMOUNT
} from '@/lib/gameState';

export type GameStatus = 'menu' | 'playing' | 'won' | 'lost';

export function useGame() {
  const [playerBalance, setPlayerBalance] = useState(START_AMOUNT);
  const [enemyBalance, setEnemyBalance] = useState(START_AMOUNT);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [gameStatus, setGameStatus] = useState<GameStatus>('menu');
  const [lastAttack, setLastAttack] = useState<string | null>(null);
  const enemyTimerRef = useRef<NodeJS.Timeout | null>(null);

  const addTransaction = useCallback((tx: Transaction) => {
    setTransactions(prev => [tx, ...prev].slice(0, 50));
  }, []);

  const performAction = useCallback((action: GameAction) => {
    if (cooldowns[action.id] && cooldowns[action.id] > Date.now()) return;
    
    const result = rollAction(action);
    
    setCooldowns(prev => ({ ...prev, [action.id]: Date.now() + action.cooldownMs }));

    if (action.type === 'earn') {
      if (result.success) {
        setPlayerBalance(prev => prev + result.amount);
        addTransaction(createTransaction('earn', action.label, result.amount));
      } else {
        addTransaction(createTransaction('earn', `${action.label} (fehlgeschlagen)`, 0));
      }
    } else {
      if (result.success) {
        setEnemyBalance(prev => Math.max(0, prev - result.amount));
        addTransaction(createTransaction('attack', action.label, -result.amount));
      } else {
        addTransaction(createTransaction('attack', `${action.label} (geblockt)`, 0));
      }
    }
  }, [cooldowns, addTransaction]);

  // Enemy AI
  useEffect(() => {
    if (gameStatus !== 'playing') {
      if (enemyTimerRef.current) clearInterval(enemyTimerRef.current);
      return;
    }

    const enemyTick = () => {
      const allActions = [...EARN_ACTIONS, ...ATTACK_ACTIONS];
      const action = allActions[Math.floor(Math.random() * allActions.length)];
      const result = rollAction(action);

      if (result.success) {
        if (action.type === 'earn') {
          setEnemyBalance(prev => prev + result.amount);
        } else {
          setPlayerBalance(prev => {
            const newBal = Math.max(0, prev - result.amount);
            return newBal;
          });
          setLastAttack(action.label);
          addTransaction(createTransaction('received_attack', `Gegner: ${action.label}`, -result.amount));
          setTimeout(() => setLastAttack(null), 2000);
        }
      }
    };

    enemyTimerRef.current = setInterval(enemyTick, 3000 + Math.random() * 4000);
    return () => { if (enemyTimerRef.current) clearInterval(enemyTimerRef.current); };
  }, [gameStatus, addTransaction]);

  // Check win/lose
  useEffect(() => {
    if (gameStatus !== 'playing') return;
    if (playerBalance <= 0) setGameStatus('lost');
    else if (enemyBalance <= 0) setGameStatus('won');
    else if (playerBalance >= WIN_AMOUNT) setGameStatus('won');
    else if (enemyBalance >= WIN_AMOUNT) setGameStatus('lost');
  }, [playerBalance, enemyBalance, gameStatus]);

  // Cooldown ticker
  useEffect(() => {
    if (gameStatus !== 'playing') return;
    const interval = setInterval(() => setCooldowns(prev => ({ ...prev })), 250);
    return () => clearInterval(interval);
  }, [gameStatus]);

  const startGame = useCallback(() => {
    setPlayerBalance(START_AMOUNT);
    setEnemyBalance(START_AMOUNT);
    setTransactions([]);
    setCooldowns({});
    setLastAttack(null);
    setGameStatus('playing');
  }, []);

  return {
    playerBalance, enemyBalance, transactions, cooldowns,
    gameStatus, lastAttack, performAction, startGame,
  };
}
