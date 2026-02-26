// Battle events emitted during combat for animations
export interface BattleEvent {
  type: 'hit' | 'kill';
  attackerId: string;
  attackerRow: number;
  attackerCol: number;
  attackerEmoji: string;
  targetId: string;
  targetRow: number;
  targetCol: number;
  damage: number;
  isStrong: boolean;
  isWeak: boolean;
  isRanged: boolean; // attacker not adjacent to target
}
