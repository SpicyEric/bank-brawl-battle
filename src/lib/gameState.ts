export interface Transaction {
  id: string;
  type: 'earn' | 'attack' | 'defend' | 'received_attack';
  label: string;
  amount: number; // positive = earn, negative = loss
  timestamp: number;
}

export interface GameAction {
  id: string;
  label: string;
  description: string;
  type: 'earn' | 'attack';
  minAmount: number;
  maxAmount: number;
  cooldownMs: number;
  icon: string;
  successRate: number; // 0-1
}

export const EARN_ACTIONS: GameAction[] = [
  { id: 'freelance', label: 'Freelance Job', description: 'Schneller Gig', type: 'earn', minAmount: 50, maxAmount: 200, cooldownMs: 3000, icon: '💼', successRate: 0.9 },
  { id: 'invest', label: 'Investment', description: 'Riskante Anlage', type: 'earn', minAmount: 100, maxAmount: 500, cooldownMs: 8000, icon: '📈', successRate: 0.55 },
  { id: 'crypto', label: 'Crypto Trade', description: 'Volatil aber lukrativ', type: 'earn', minAmount: 200, maxAmount: 800, cooldownMs: 12000, icon: '🪙', successRate: 0.4 },
  { id: 'salary', label: 'Gehalt', description: 'Sicheres Einkommen', type: 'earn', minAmount: 150, maxAmount: 250, cooldownMs: 15000, icon: '🏦', successRate: 0.95 },
];

export const ATTACK_ACTIONS: GameAction[] = [
  { id: 'fee', label: 'Gebühr senden', description: 'Versteckte Kosten', type: 'attack', minAmount: 30, maxAmount: 150, cooldownMs: 4000, icon: '📄', successRate: 0.8 },
  { id: 'hack', label: 'Konto hacken', description: 'Direkter Zugriff', type: 'attack', minAmount: 200, maxAmount: 600, cooldownMs: 15000, icon: '💻', successRate: 0.35 },
  { id: 'scam', label: 'Phishing Mail', description: 'Social Engineering', type: 'attack', minAmount: 100, maxAmount: 400, cooldownMs: 8000, icon: '🎣', successRate: 0.5 },
  { id: 'tax', label: 'Steuernachzahlung', description: 'Finanzamt kommt', type: 'attack', minAmount: 150, maxAmount: 500, cooldownMs: 20000, icon: '🏛️', successRate: 0.45 },
];

export const WIN_AMOUNT = 10000;
export const START_AMOUNT = 2500;

export function rollAction(action: GameAction): { success: boolean; amount: number } {
  const success = Math.random() < action.successRate;
  const amount = Math.floor(Math.random() * (action.maxAmount - action.minAmount + 1)) + action.minAmount;
  return { success, amount: success ? amount : 0 };
}

export function createTransaction(type: Transaction['type'], label: string, amount: number): Transaction {
  return {
    id: crypto.randomUUID(),
    type,
    label,
    amount,
    timestamp: Date.now(),
  };
}
