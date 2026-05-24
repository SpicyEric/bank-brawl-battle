// Battle events emitted during combat for animations
export interface BattleEvent {
  type: 'hit' | 'kill' | 'heal' | 'freeze' | 'web' | 'chain' | 'spawn' | 'impulse' | 'teleport' | 'frostNova' | 'riderHorn' | 'volleyMiss' | 'dragonSpin';
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
  /** Unit ids that were pushed by a mage impulse (used to apply a stronger slide animation). */
  pushedIds?: string[];
  /** Rider-horn: inner 3x3 cells (flash first). */
  innerCells?: { row: number; col: number }[];
  /** Rider-horn: outer ring cells (flash one tick later). */
  outerCells?: { row: number; col: number }[];
}
