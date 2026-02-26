export type UnitType = 'warrior' | 'archer' | 'mage' | 'tank';
export type Team = 'player' | 'enemy';
export type Phase = 'place' | 'battle' | 'won' | 'lost';

export interface Unit {
  id: string;
  type: UnitType;
  team: Team;
  hp: number;
  maxHp: number;
  attack: number;
  range: number;
  row: number;
  col: number;
  cooldown: number;
  maxCooldown: number;
}

export interface Cell {
  row: number;
  col: number;
  unit: Unit | null;
}

export const UNIT_DEFS: Record<UnitType, { label: string; emoji: string; hp: number; attack: number; range: number; cooldown: number; description: string }> = {
  warrior: { label: 'Krieger', emoji: '⚔️', hp: 120, attack: 25, range: 1, cooldown: 2, description: 'Nahkampf, hoher Schaden' },
  archer:  { label: 'Bogenschütze', emoji: '🏹', hp: 70, attack: 20, range: 3, cooldown: 2, description: 'Fernkampf, mittlerer Schaden' },
  mage:    { label: 'Magier', emoji: '🔮', hp: 60, attack: 35, range: 4, cooldown: 3, description: 'Hohe Reichweite & Schaden' },
  tank:    { label: 'Schild', emoji: '🛡️', hp: 200, attack: 10, range: 1, cooldown: 3, description: 'Viel HP, wenig Schaden' },
};

export const UNIT_TYPES: UnitType[] = ['warrior', 'archer', 'mage', 'tank'];
export const MAX_UNITS = 5;
export const GRID_SIZE = 8;
export const PLAYER_ROWS = [5, 6, 7]; // rows where player can place (0-indexed)

export function createEmptyGrid(): Cell[][] {
  return Array.from({ length: GRID_SIZE }, (_, row) =>
    Array.from({ length: GRID_SIZE }, (_, col) => ({ row, col, unit: null }))
  );
}

export function createUnit(type: UnitType, team: Team, row: number, col: number): Unit {
  const def = UNIT_DEFS[type];
  return {
    id: crypto.randomUUID(),
    type, team, row, col,
    hp: def.hp, maxHp: def.hp,
    attack: def.attack, range: def.range,
    cooldown: 0, maxCooldown: def.cooldown,
  };
}

export function distance(a: { row: number; col: number }, b: { row: number; col: number }): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

export function findTarget(unit: Unit, allUnits: Unit[]): Unit | null {
  const enemies = allUnits.filter(u => u.team !== unit.team && u.hp > 0);
  if (enemies.length === 0) return null;
  enemies.sort((a, b) => distance(unit, a) - distance(unit, b));
  return enemies[0];
}

export function moveToward(unit: Unit, target: Unit, grid: Cell[][]): { row: number; col: number } {
  if (distance(unit, target) <= unit.range) return { row: unit.row, col: unit.col };
  
  const directions = [
    { dr: -1, dc: 0 }, { dr: 1, dc: 0 },
    { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
  ];
  
  let best = { row: unit.row, col: unit.col };
  let bestDist = distance(unit, target);
  
  for (const { dr, dc } of directions) {
    const nr = unit.row + dr;
    const nc = unit.col + dc;
    if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) continue;
    if (grid[nr][nc].unit && grid[nr][nc].unit!.id !== unit.id) continue;
    const d = distance({ row: nr, col: nc }, target);
    if (d < bestDist) {
      bestDist = d;
      best = { row: nr, col: nc };
    }
  }
  return best;
}

export function generateEnemyPlacement(): { type: UnitType; row: number; col: number }[] {
  const placements: { type: UnitType; row: number; col: number }[] = [];
  const usedCells = new Set<string>();
  const count = 3 + Math.floor(Math.random() * 3); // 3-5 units
  
  for (let i = 0; i < count; i++) {
    const type = UNIT_TYPES[Math.floor(Math.random() * UNIT_TYPES.length)];
    let row: number, col: number;
    do {
      row = Math.floor(Math.random() * 3); // rows 0-2
      col = Math.floor(Math.random() * GRID_SIZE);
    } while (usedCells.has(`${row},${col}`));
    usedCells.add(`${row},${col}`);
    placements.push({ type, row, col });
  }
  return placements;
}
