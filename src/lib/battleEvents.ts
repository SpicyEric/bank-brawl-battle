// Battle events emitted during combat for animations
export interface BattleEvent {
  type: 'hit' | 'kill' | 'heal' | 'freeze' | 'web' | 'chain' | 'spawn';
  attackerId: string;
  attackerRow: number;
  attackerCol: number;
  attackerEmoji: string;
  /** Unit type of the attacker (used to look up custom attack icons). */
  attackerType?: string;
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
  isFrozen?: boolean; // target got frozen by this attack
  /** Cells that get a lightning-chain flash (Blitzmagier). */
  chainCells?: { row: number; col: number }[];
}
