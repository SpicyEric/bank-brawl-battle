export type UnitType = 'warrior' | 'rider' | 'archer' | 'assassin' | 'mage' | 'tank' | 'dragon' | 'healer' | 'frost';
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
  dead?: boolean;
  frozen?: number; // turns remaining frozen (can't act)
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

export type ColorGroup = 'red' | 'blue' | 'green';

export const UNIT_COLOR_GROUPS: Record<UnitType, ColorGroup> = {
  warrior: 'red',
  assassin: 'red',
  dragon: 'red',
  rider: 'blue',
  archer: 'blue',
  frost: 'blue',
  tank: 'green',
  mage: 'green',
  healer: 'green',
};

// Red > Green > Blue > Red (rock-paper-scissors)
export const COLOR_BEATS: Record<ColorGroup, ColorGroup> = {
  red: 'green',
  green: 'blue',
  blue: 'red',
};

export const UNIT_DEFS: Record<UnitType, UnitDef> = {
  warrior: {
    label: 'Krieger',
    emoji: '⚔️',
    hp: 120,
    attack: 28,
    cooldown: 2,
    description: 'Nahkämpfer. Bewegt sich orthogonal (1 Feld). Greift angrenzend an.',
    movePattern: ORTHOGONAL,
    attackPattern: ORTHOGONAL,
    strongVs: ['tank', 'mage', 'healer'],
    weakVs: ['rider', 'archer', 'frost'],
  },
  assassin: {
    label: 'Assassine',
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
    strongVs: ['tank', 'mage', 'healer'],
    weakVs: ['rider', 'archer', 'frost'],
  },
  dragon: {
    label: 'Drache',
    emoji: '🐉',
    hp: 90,
    attack: 30,
    cooldown: 3,
    description: 'Fliegt über Hindernisse. Flächenangriff (3x3). Ignoriert Blockaden.',
    movePattern: [
      ...ALL_ADJACENT,
      { row: -2, col: 0 }, { row: 2, col: 0 }, { row: 0, col: -2 }, { row: 0, col: 2 },
    ],
    attackPattern: [
      ...ALL_ADJACENT,
      { row: 0, col: 0 },
    ],
    strongVs: ['tank', 'mage', 'healer'],
    weakVs: ['rider', 'archer', 'frost'],
  },
  rider: {
    label: 'Reiter',
    emoji: '🏇',
    hp: 95,
    attack: 24,
    cooldown: 2,
    description: 'Schneller Kavallerist. Bewegt sich bis 3 Felder orthogonal. Greift angrenzend an.',
    movePattern: [
      ...ORTHOGONAL,
      { row: -2, col: 0 }, { row: 2, col: 0 }, { row: 0, col: -2 }, { row: 0, col: 2 },
      { row: -3, col: 0 }, { row: 3, col: 0 }, { row: 0, col: -3 }, { row: 0, col: 3 },
    ],
    attackPattern: ORTHOGONAL,
    strongVs: ['warrior', 'assassin', 'dragon'],
    weakVs: ['tank', 'mage', 'healer'],
  },
  archer: {
    label: 'Bogenschütze',
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
    strongVs: ['warrior', 'assassin', 'dragon'],
    weakVs: ['tank', 'mage', 'healer'],
  },
  frost: {
    label: 'Frostmagier',
    emoji: '🥶',
    hp: 75,
    attack: 18,
    cooldown: 2,
    description: 'Friert Gegner 1 Runde ein. Greift orthogonal bis 2 Felder an.',
    movePattern: ALL_ADJACENT,
    attackPattern: [
      ...ORTHOGONAL,
      { row: -2, col: 0 }, { row: 2, col: 0 }, { row: 0, col: -2 }, { row: 0, col: 2 },
    ],
    strongVs: ['warrior', 'assassin', 'dragon'],
    weakVs: ['tank', 'mage', 'healer'],
  },
  tank: {
    label: 'Schildträger',
    emoji: '🛡️',
    hp: 200,
    attack: 10,
    cooldown: 3,
    description: 'Bewegt sich orthogonal (1 Feld). Greift angrenzend an. Zieht Feinde an.',
    movePattern: ORTHOGONAL,
    attackPattern: ORTHOGONAL,
    strongVs: ['rider', 'archer', 'frost'],
    weakVs: ['warrior', 'assassin', 'dragon'],
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
    strongVs: ['rider', 'archer', 'frost'],
    weakVs: ['warrior', 'assassin', 'dragon'],
  },
  healer: {
    label: 'Schamane',
    emoji: '🌿',
    hp: 50,
    attack: 0,
    cooldown: 2,
    description: 'Heilt Verbündete im Umkreis statt anzugreifen. Kein eigener Schaden.',
    movePattern: ALL_ADJACENT,
    attackPattern: ALL_ADJACENT,
    strongVs: ['rider', 'archer', 'frost'],
    weakVs: ['warrior', 'assassin', 'dragon'],
  },
};

export const UNIT_TYPES: UnitType[] = ['warrior', 'rider', 'archer', 'assassin', 'mage', 'tank', 'dragon', 'healer', 'frost'];
export const BASE_UNITS = 5;
export const MAX_UNITS = 7; // absolute cap

// Comeback mechanic: behind by 2+ → +1, behind by 4+ → +2
export function getMaxUnits(myScore: number, opponentScore: number): number {
  const deficit = opponentScore - myScore;
  let bonus = 0;
  if (deficit >= 4) bonus = 2;
  else if (deficit >= 2) bonus = 1;
  return Math.min(BASE_UNITS + bonus, MAX_UNITS);
}
export const GRID_SIZE = 8;
export const PLAYER_ROWS = [5, 6, 7];
export const ENEMY_ROWS = [0, 1, 2];
export const POINTS_TO_WIN = 13;

export const COUNTER_MULTIPLIER = 1.3;
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
  const canFly = unit.type === 'dragon';
  return def.movePattern
    .map(p => ({ row: unit.row + p.row, col: unit.col + p.col }))
    .filter(p =>
      p.row >= 0 && p.row < GRID_SIZE && p.col >= 0 && p.col < GRID_SIZE &&
      (!grid[p.row][p.col].unit || grid[p.row][p.col].unit!.id === unit.id) &&
      (canFly || !grid[p.row][p.col].unit?.dead)
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

// Check if a unit at a given position could attack the target
function couldAttackFrom(pos: Position, unitType: UnitType, target: Position): boolean {
  const def = UNIT_DEFS[unitType];
  const dr = target.row - pos.row;
  const dc = target.col - pos.col;
  return def.attackPattern.some(p => p.row === dr && p.col === dc);
}

// Move toward target: prioritize positions from which unit can attack
export function moveToward(unit: Unit, target: Unit, grid: Cell[][]): Position {
  const possibleMoves = getMoveCells(unit, grid);
  if (possibleMoves.length === 0) return { row: unit.row, col: unit.col };

  // If can already attack, don't move
  if (canAttack(unit, target)) return { row: unit.row, col: unit.col };

  // Priority 1: move to a cell from which we can attack
  const attackMoves = possibleMoves.filter(pos => couldAttackFrom(pos, unit.type, target));
  if (attackMoves.length > 0) {
    // Pick the one furthest from the target (stay at range if possible)
    attackMoves.sort((a, b) => distance(b, target) - distance(a, target));
    return attackMoves[0];
  }

  // Priority 2: move closer to the nearest cell from which we could attack
  const def = UNIT_DEFS[unit.type];
  let best = { row: unit.row, col: unit.col };
  let bestScore = Infinity;

  for (const pos of possibleMoves) {
    // Find minimum distance from this pos to any theoretical attack position
    let minAttackDist = Infinity;
    for (const p of def.attackPattern) {
      const attackFromRow = target.row - p.row;
      const attackFromCol = target.col - p.col;
      if (attackFromRow >= 0 && attackFromRow < GRID_SIZE && attackFromCol >= 0 && attackFromCol < GRID_SIZE) {
        const d = distance(pos, { row: attackFromRow, col: attackFromCol });
        if (d < minAttackDist) minAttackDist = d;
      }
    }
    if (minAttackDist < bestScore) {
      bestScore = minAttackDist;
      best = pos;
    }
  }
  return best;
}

// Calculate damage with counter system
export function calcDamage(attacker: Unit, defender: Unit): number {
  const aDef = UNIT_DEFS[attacker.type];
  let dmg = attacker.attack * (0.95 + Math.random() * 0.1);

  if (aDef.strongVs.includes(defender.type)) {
    dmg *= COUNTER_MULTIPLIER;
  } else if (aDef.weakVs.includes(defender.type)) {
    dmg *= WEAKNESS_MULTIPLIER;
  }

  return Math.floor(dmg);
}

// Light AI: tries to counter the player's composition
export function generateAIPlacement(playerUnits: Unit[], maxCount: number = BASE_UNITS): { type: UnitType; row: number; col: number }[] {
  const placements: { type: UnitType; row: number; col: number }[] = [];
  const usedCells = new Set<string>();
  const count = maxCount;

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
