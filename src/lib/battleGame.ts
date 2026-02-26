export type UnitType = 'warrior' | 'lancer' | 'archer' | 'assassin' | 'mage' | 'tank';
export type Team = 'player' | 'enemy';
export type Phase = 'place_player' | 'place_enemy' | 'battle' | 'round_won' | 'round_lost';

export interface Position { row: number; col: number }

export interface Unit {
  id: string;
  type: UnitType;
  team: Team;
  hp: number;
  maxHp: number;
  attack: number;
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

// Movement patterns: relative offsets the unit can move to per turn
// Attack patterns: relative offsets where the unit can deal damage
export interface UnitDef {
  label: string;
  emoji: string;
  hp: number;
  attack: number;
  cooldown: number;
  description: string;
  movePattern: Position[];
  attackPattern: Position[];
  strongVs: UnitType[];
  weakVs: UnitType[];
}

const ORTHOGONAL: Position[] = [
  { row: -1, col: 0 }, { row: 1, col: 0 },
  { row: 0, col: -1 }, { row: 0, col: 1 },
];

const DIAGONAL: Position[] = [
  { row: -1, col: -1 }, { row: -1, col: 1 },
  { row: 1, col: -1 }, { row: 1, col: 1 },
];

const ALL_ADJACENT: Position[] = [...ORTHOGONAL, ...DIAGONAL];

export const UNIT_DEFS: Record<UnitType, UnitDef> = {
  warrior: {
    label: 'Krieger',
    emoji: '⚔️',
    hp: 120,
    attack: 28,
    cooldown: 2,
    description: 'Nahkämpfer. Bewegt sich orthogonal (1 Feld). Greift angrenzend an (4 Richtungen).',
    movePattern: ORTHOGONAL,
    attackPattern: ORTHOGONAL,
    strongVs: ['assassin'],
    weakVs: ['lancer'],
  },
  lancer: {
    label: 'Lanzen.',
    emoji: '🔱',
    hp: 100,
    attack: 22,
    cooldown: 2,
    description: 'Bewegt sich orthogonal (1 Feld). Greift 2 Felder geradeaus an.',
    movePattern: ORTHOGONAL,
    attackPattern: [
      { row: -2, col: 0 }, { row: 2, col: 0 },
      { row: 0, col: -2 }, { row: 0, col: 2 },
      ...ORTHOGONAL,
    ],
    strongVs: ['warrior'],
    weakVs: ['archer'],
  },
  archer: {
    label: 'Bogen.',
    emoji: '🏹',
    hp: 70,
    attack: 20,
    cooldown: 2,
    description: 'Bewegt sich in alle Richtungen (1 Feld). Greift orthogonal bis 3 Felder an.',
    movePattern: ALL_ADJACENT,
    attackPattern: [
      ...ORTHOGONAL,
      { row: -2, col: 0 }, { row: 2, col: 0 }, { row: 0, col: -2 }, { row: 0, col: 2 },
      { row: -3, col: 0 }, { row: 3, col: 0 }, { row: 0, col: -3 }, { row: 0, col: 3 },
    ],
    strongVs: ['lancer'],
    weakVs: ['assassin'],
  },
  assassin: {
    label: 'Assass.',
    emoji: '🗡️',
    hp: 65,
    attack: 32,
    cooldown: 2,
    description: 'Bewegt sich diagonal (2 Felder). Greift diagonal angrenzend an.',
    movePattern: [
      ...DIAGONAL,
      { row: -2, col: -2 }, { row: -2, col: 2 },
      { row: 2, col: -2 }, { row: 2, col: 2 },
    ],
    attackPattern: DIAGONAL,
    strongVs: ['archer'],
    weakVs: ['warrior'],
  },
  mage: {
    label: 'Magier',
    emoji: '🔮',
    hp: 55,
    attack: 35,
    cooldown: 3,
    description: 'Bewegt sich in alle Richtungen (1 Feld). Greift diagonal 2-3 Felder an.',
    movePattern: ALL_ADJACENT,
    attackPattern: [
      { row: -2, col: -2 }, { row: -2, col: 2 },
      { row: 2, col: -2 }, { row: 2, col: 2 },
      { row: -3, col: -3 }, { row: -3, col: 3 },
      { row: 3, col: -3 }, { row: 3, col: 3 },
    ],
    strongVs: ['tank'],
    weakVs: ['warrior', 'lancer', 'assassin'],
  },
  tank: {
    label: 'Schild',
    emoji: '🛡️',
    hp: 200,
    attack: 10,
    cooldown: 3,
    description: 'Bewegt sich orthogonal (1 Feld). Greift angrenzend an. Zieht Feinde in der Nähe an.',
    movePattern: ORTHOGONAL,
    attackPattern: ORTHOGONAL,
    strongVs: ['warrior', 'lancer', 'assassin'],
    weakVs: ['mage'],
  },
};

export const UNIT_TYPES: UnitType[] = ['warrior', 'lancer', 'archer', 'assassin', 'mage', 'tank'];
export const MAX_UNITS = 5;
export const GRID_SIZE = 8;
export const PLAYER_ROWS = [5, 6, 7];
export const ENEMY_ROWS = [0, 1, 2];
export const POINTS_TO_WIN = 13;

export const COUNTER_MULTIPLIER = 1.5;
export const WEAKNESS_MULTIPLIER = 0.7;

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
    attack: def.attack,
    cooldown: 0, maxCooldown: def.cooldown,
  };
}

export function distance(a: Position, b: Position): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

// Can unit attack target from current position?
export function canAttack(unit: Unit, target: Unit): boolean {
  const def = UNIT_DEFS[unit.type];
  const dr = target.row - unit.row;
  const dc = target.col - unit.col;
  return def.attackPattern.some(p => p.row === dr && p.col === dc);
}

// Get all cells a unit can attack from its position
export function getAttackCells(unit: Unit): Position[] {
  const def = UNIT_DEFS[unit.type];
  return def.attackPattern
    .map(p => ({ row: unit.row + p.row, col: unit.col + p.col }))
    .filter(p => p.row >= 0 && p.row < GRID_SIZE && p.col >= 0 && p.col < GRID_SIZE);
}

// Get all cells a unit can move to
export function getMoveCells(unit: Unit, grid: Cell[][]): Position[] {
  const def = UNIT_DEFS[unit.type];
  return def.movePattern
    .map(p => ({ row: unit.row + p.row, col: unit.col + p.col }))
    .filter(p =>
      p.row >= 0 && p.row < GRID_SIZE && p.col >= 0 && p.col < GRID_SIZE &&
      (!grid[p.row][p.col].unit || grid[p.row][p.col].unit!.id === unit.id)
    );
}

// Find best target considering tank taunt
export function findTarget(unit: Unit, allUnits: Unit[]): Unit | null {
  const enemies = allUnits.filter(u => u.team !== unit.team && u.hp > 0);
  if (enemies.length === 0) return null;

  // Tanks taunt: if any tank is within distance 3, prioritize it
  const nearbyTanks = enemies.filter(e => e.type === 'tank' && distance(unit, e) <= 3);
  if (nearbyTanks.length > 0) {
    nearbyTanks.sort((a, b) => distance(unit, a) - distance(unit, b));
    return nearbyTanks[0];
  }

  enemies.sort((a, b) => distance(unit, a) - distance(unit, b));
  return enemies[0];
}

// Move toward target using movement pattern
export function moveToward(unit: Unit, target: Unit, grid: Cell[][]): Position {
  const possibleMoves = getMoveCells(unit, grid);
  if (possibleMoves.length === 0) return { row: unit.row, col: unit.col };

  // If can already attack, don't move
  if (canAttack(unit, target)) return { row: unit.row, col: unit.col };

  let best = { row: unit.row, col: unit.col };
  let bestDist = distance(unit, target);

  for (const pos of possibleMoves) {
    const d = distance(pos, target);
    if (d < bestDist) {
      bestDist = d;
      best = pos;
    }
  }
  return best;
}

// Calculate damage with counter system
export function calcDamage(attacker: Unit, defender: Unit): number {
  const aDef = UNIT_DEFS[attacker.type];
  let dmg = attacker.attack * (0.8 + Math.random() * 0.4);

  if (aDef.strongVs.includes(defender.type)) {
    dmg *= COUNTER_MULTIPLIER;
  } else if (aDef.weakVs.includes(defender.type)) {
    dmg *= WEAKNESS_MULTIPLIER;
  }

  return Math.floor(dmg);
}

// Light AI: tries to counter the player's composition
export function generateAIPlacement(playerUnits: Unit[]): { type: UnitType; row: number; col: number }[] {
  const placements: { type: UnitType; row: number; col: number }[] = [];
  const usedCells = new Set<string>();
  const count = Math.min(5, Math.max(3, playerUnits.length));

  // Count player unit types
  const playerTypes: Record<string, number> = {};
  for (const u of playerUnits) {
    playerTypes[u.type] = (playerTypes[u.type] || 0) + 1;
  }

  // Find counters for the most common player types
  const counterPicks: UnitType[] = [];
  const sortedTypes = Object.entries(playerTypes).sort((a, b) => b[1] - a[1]);

  for (const [pType] of sortedTypes) {
    // Find units that are strong against this type
    for (const [uType, def] of Object.entries(UNIT_DEFS)) {
      if (def.strongVs.includes(pType as UnitType)) {
        counterPicks.push(uType as UnitType);
      }
    }
  }

  for (let i = 0; i < count; i++) {
    // 60% chance to pick a counter, 40% random
    let type: UnitType;
    if (counterPicks.length > 0 && Math.random() < 0.6) {
      type = counterPicks[Math.floor(Math.random() * counterPicks.length)];
    } else {
      type = UNIT_TYPES[Math.floor(Math.random() * UNIT_TYPES.length)];
    }

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

// For showing patterns in unit info (relative offsets)
export function getPatternDisplay(pattern: Position[], gridSize: number = 5): boolean[][] {
  const center = Math.floor(gridSize / 2);
  const display = Array.from({ length: gridSize }, () => Array(gridSize).fill(false));
  for (const p of pattern) {
    const r = center + p.row;
    const c = center + p.col;
    if (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
      display[r][c] = true;
    }
  }
  return display;
}
