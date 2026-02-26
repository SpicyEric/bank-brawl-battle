// Battle events emitted during combat for animations
export interface BattleEvent {
  type: 'hit' | 'kill';
  targetId: string;
  targetRow: number;
  targetCol: number;
  damage: number;
  isStrong: boolean;
  isWeak: boolean;
}
