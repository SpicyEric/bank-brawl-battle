// Battle events emitted during combat for animations
export interface BattleEvent {
  type: 'hit' | 'kill' | 'heal';
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
  isAoe?: boolean; // splash damage (dragon)
  aoeCells?: { row: number; col: number }[]; // all cells affected by AOE fire
  healAmount?: number; // healing done (shaman)
}
