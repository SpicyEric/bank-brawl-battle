export type UnitType = 'warrior' | 'rider' | 'archer' | 'assassin' | 'mage' | 'tank' | 'dragon' | 'healer' | 'frost';
export type Team = 'player' | 'enemy';
export type Phase = 'place_player' | 'place_enemy' | 'battle' | 'round_won' | 'round_lost' | 'round_draw' | 'game_draw';

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
  stuckTurns?: number; // turns without attacking – used for anti-stalemate
  activationTurn?: number; // turn number when this unit becomes active (staggered rows)
  startRow?: number; // the row the unit was originally placed on
  lastAttackedId?: string; // last enemy attacked (rider uses this for target-switching)
}

export type TerrainType = 'none' | 'forest' | 'hill' | 'water';

export const TERRAIN_DEFS: Record<TerrainType, { emoji: string; label: string; description: string }> = {
  none: { emoji: '', label: '', description: '' },
  forest: { emoji: '🌲', label: 'Wald', description: '-20% erlittener Schaden' },
  hill: { emoji: '⛰️', label: 'Hügel', description: '+15% verursachter Schaden' },
  water: { emoji: '🌊', label: 'Wasser', description: 'Unpassierbar (Drache kann fliegen)' },
};

export interface Cell {
  row: number;
  col: number;
  unit: Unit | null;
  terrain: TerrainType;
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
    hp: 105,
    attack: 23,
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
    hp: 90,
    attack: 34,
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
    hp: 80,
    attack: 24,
    cooldown: 3,
    description: 'Fliegt über Hindernisse. Flächenangriff (3x3, 30% Splash). Ignoriert Blockaden.',
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
    hp: 70,
    attack: 18,
    cooldown: 2,
    description: 'Springer-Kavallerist. Bewegt sich in L-Form (wie Schach-Springer). Springt über Hindernisse. Wechselt Ziele.',
    movePattern: [
      // L-shaped knight moves (can jump over obstacles)
      { row: -2, col: -1 }, { row: -2, col: 1 },
      { row: 2, col: -1 }, { row: 2, col: 1 },
      { row: -1, col: -2 }, { row: -1, col: 2 },
      { row: 1, col: -2 }, { row: 1, col: 2 },
      // Keep 1-step and 2-step orthogonal
      ...ORTHOGONAL,
      { row: -2, col: 0 }, { row: 2, col: 0 }, { row: 0, col: -2 }, { row: 0, col: 2 },
    ],
    attackPattern: ORTHOGONAL,
    strongVs: ['warrior', 'assassin', 'dragon'],
    weakVs: ['tank', 'mage', 'healer'],
  },
  archer: {
    label: 'Bogenschütze',
    emoji: '🏹',
    hp: 65,
    attack: 18,
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
    attack: 14,
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
    attack: 19,
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
    hp: 85,
    attack: 30,
    cooldown: 1,
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
    hp: 80,
    attack: 5,
    cooldown: 2,
    description: 'Heilt Verbündete im Umkreis (2 Felder). Greift nur an, wenn niemand mehr zu heilen ist.',
    movePattern: ALL_ADJACENT,
    attackPattern: [
      ...ALL_ADJACENT,
      { row: -2, col: 0 }, { row: 2, col: 0 }, { row: 0, col: -2 }, { row: 0, col: 2 },
    ],
    strongVs: ['rider', 'archer', 'frost'],
    weakVs: ['warrior', 'assassin', 'dragon'],
  },
};

export const UNIT_TYPES: UnitType[] = ['warrior', 'assassin', 'dragon', 'tank', 'mage', 'healer', 'rider', 'archer', 'frost'];
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
export const POINTS_TO_WIN = 8;
export const OVERTIME_THRESHOLD = 7; // at this score, 2-point lead required
export const AUTO_OVERTIMES = 3; // first 3 overtimes are automatic
export const MAX_OVERTIMES = 5; // after 5th overtime → forced draw
export const ROUND_TIME_LIMIT = 45; // seconds

export const COUNTER_MULTIPLIER = 1.4;
export const WEAKNESS_MULTIPLIER = 0.6;

export function createEmptyGrid(): Cell[][] {
  return Array.from({ length: GRID_SIZE }, (_, row) =>
    Array.from({ length: GRID_SIZE }, (_, col) => ({ row, col, unit: null, terrain: 'none' as TerrainType }))
  );
}

// Generate random terrain for a new round
export function generateTerrain(grid: Cell[][]): Cell[][] {
  const newGrid = grid.map(r => r.map(c => ({ ...c, terrain: 'none' as TerrainType })));
  const terrainTypes: TerrainType[] = ['forest', 'hill', 'water'];
  // Place 4-7 terrain tiles in the middle area (rows 2-5)
  const middleCount = 4 + Math.floor(Math.random() * 4);
  const used = new Set<string>();

  for (let i = 0; i < middleCount; i++) {
    let row: number, col: number;
    let attempts = 0;
    do {
      row = 2 + Math.floor(Math.random() * 4); // rows 2-5 (middle)
      col = Math.floor(Math.random() * GRID_SIZE);
      attempts++;
    } while (used.has(`${row},${col}`) && attempts < 20);

    if (attempts >= 20) continue;
    used.add(`${row},${col}`);
    // No water on placement rows (row 2 = enemy front, row 5 = player front)
    const isPlacementRow = PLAYER_ROWS.includes(row) || ENEMY_ROWS.includes(row);
    const terrain = isPlacementRow
      ? (Math.random() < 0.5 ? 'forest' : 'hill')
      : (Math.random() < 0.3 ? 'water' : terrainTypes[Math.floor(Math.random() * 2)]);
    newGrid[row][col].terrain = terrain;
  }

  // Occasionally place 1-3 terrain tiles on player-side rows (5-7 and 0-2)
  const sideCount = Math.floor(Math.random() * 4); // 0-3 tiles
  const sideRows = [0, 1, 5, 6, 7]; // row 2 already covered by middle
  for (let i = 0; i < sideCount; i++) {
    let row: number, col: number;
    let attempts = 0;
    do {
      row = sideRows[Math.floor(Math.random() * sideRows.length)];
      col = Math.floor(Math.random() * GRID_SIZE);
      attempts++;
    } while (used.has(`${row},${col}`) && attempts < 20);

    if (attempts >= 20) continue;
    used.add(`${row},${col}`);
    // No water on player rows to avoid blocking too much, only forest/hill
    const terrain = Math.random() < 0.5 ? 'forest' : 'hill';
    newGrid[row][col].terrain = terrain;
  }

  return newGrid;
}

// Calculate activation turn based on row distance from center
// Player rows: 5 (front, turn 0), 6 (mid, turn 2), 7 (back, turn 3)
// Enemy rows: 2 (front, turn 0), 1 (mid, turn 2), 0 (back, turn 3)
export function getActivationTurn(row: number, team: Team): number {
  if (team === 'player') {
    if (row === 5) return 0;
    if (row === 6) return 2;
    return 3; // row 7
  } else {
    if (row === 2) return 0;
    if (row === 1) return 2;
    return 3; // row 0
  }
}

export function createUnit(type: UnitType, team: Team, row: number, col: number): Unit {
  const def = UNIT_DEFS[type];
  return {
    id: crypto.randomUUID(),
    type, team, row, col,
    hp: def.hp, maxHp: def.hp,
    attack: def.attack,
    cooldown: 0, maxCooldown: def.cooldown,
    activationTurn: getActivationTurn(row, team),
    startRow: row,
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
  const canJump = unit.type === 'rider'; // rider jumps over obstacles like a chess knight
  return def.movePattern
    .map(p => ({ row: unit.row + p.row, col: unit.col + p.col }))
    .filter(p =>
      p.row >= 0 && p.row < GRID_SIZE && p.col >= 0 && p.col < GRID_SIZE &&
      (!grid[p.row][p.col].unit || grid[p.row][p.col].unit!.id === unit.id) &&
      (canFly || canJump || grid[p.row][p.col].terrain !== 'water') &&
      (canFly || canJump || !grid[p.row][p.col].unit?.dead)
    );
}

// Find best target: column priority + frontline mechanic + tank taunt + rider target-switching
export function findTarget(unit: Unit, allUnits: Unit[]): Unit | null {
  const enemies = allUnits.filter(u => u.team !== unit.team && u.hp > 0);
  if (enemies.length === 0) return null;

  // Tanks taunt: if any tank is within distance 3, prioritize it
  const nearbyTanks = enemies.filter(e => e.type === 'tank' && distance(unit, e) <= 3);
  if (nearbyTanks.length > 0) {
    nearbyTanks.sort((a, b) => distance(unit, a) - distance(unit, b));
    return nearbyTanks[0];
  }

  // Rider target-switching: prefer enemies it hasn't attacked last
  if (unit.type === 'rider' && unit.lastAttackedId && enemies.length > 1) {
    const otherEnemies = enemies.filter(e => e.id !== unit.lastAttackedId);
    if (otherEnemies.length > 0) {
      otherEnemies.sort((a, b) => distance(unit, a) - distance(unit, b));
      return otherEnemies[0];
    }
  }

  // Column-based targeting: enemies in the same column get priority (~70% of the time)
  const sameColEnemies = enemies.filter(e => e.col === unit.col);
  const nearColEnemies = enemies.filter(e => Math.abs(e.col - unit.col) === 1);
  const columnEnemies = [...sameColEnemies, ...nearColEnemies];

  // 70% chance to pick from same/adjacent column if available
  if (columnEnemies.length > 0 && Math.random() < 0.7) {
    // Among column enemies, prefer same column over adjacent
    columnEnemies.sort((a, b) => {
      const aColDist = Math.abs(a.col - unit.col);
      const bColDist = Math.abs(b.col - unit.col);
      if (aColDist !== bColDist) return aColDist - bColDist;
      return distance(unit, a) - distance(unit, b);
    });
    return columnEnemies[0];
  }

  // Frontline mechanic for melee
  const isMelee = UNIT_DEFS[unit.type].attackPattern.every(p => Math.abs(p.row) <= 1 && Math.abs(p.col) <= 1);

  if (isMelee) {
    const frontlineSorted = [...enemies].sort((a, b) => {
      const aFront = unit.team === 'player' ? a.row : -a.row;
      const bFront = unit.team === 'player' ? b.row : -b.row;
      if (aFront !== bFront) return bFront - aFront;
      return distance(unit, a) - distance(unit, b);
    });
    return frontlineSorted[0];
  }

  // Ranged units: target closest enemy
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

// BFS to find shortest path to any cell from which unit can attack target
function bfsFirstStep(unit: Unit, target: Unit, grid: Cell[][]): Position | null {
  const canFly = unit.type === 'dragon';
  const start = `${unit.row},${unit.col}`;
  const visited = new Set<string>([start]);
  // Queue: [row, col, firstStepRow, firstStepCol]
  const queue: [number, number, number, number][] = [];

  // Seed with immediate move options
  const def = UNIT_DEFS[unit.type];
  for (const m of def.movePattern) {
    const nr = unit.row + m.row;
    const nc = unit.col + m.col;
    if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) continue;
    const cell = grid[nr][nc];
    if (cell.unit && cell.unit.hp > 0 && !cell.unit.dead) continue;
    if (!canFly && cell.terrain === 'water') continue;
    if (!canFly && cell.unit?.dead) continue;
    const key = `${nr},${nc}`;
    if (visited.has(key)) continue;
    visited.add(key);
    queue.push([nr, nc, nr, nc]);
  }

  // BFS up to ~60 nodes to keep it fast
  let idx = 0;
  while (idx < queue.length && idx < 60) {
    const [r, c, fr, fc] = queue[idx++];
    // Check if we can attack from here
    if (couldAttackFrom({ row: r, col: c }, unit.type, target)) {
      return { row: fr, col: fc };
    }
    // Expand using single-step orthogonal+diagonal moves for BFS (regardless of unit type)
    for (const d of [{ row: -1, col: 0 }, { row: 1, col: 0 }, { row: 0, col: -1 }, { row: 0, col: 1 },
                      { row: -1, col: -1 }, { row: -1, col: 1 }, { row: 1, col: -1 }, { row: 1, col: 1 }]) {
      const nr = r + d.row;
      const nc = c + d.col;
      if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) continue;
      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;
      const cell = grid[nr][nc];
      if (cell.unit && cell.unit.hp > 0 && !cell.unit.dead) continue;
      if (!canFly && cell.terrain === 'water') continue;
      if (!canFly && cell.unit?.dead) continue;
      visited.add(key);
      queue.push([nr, nc, fr, fc]);
    }
  }
  return null;
}

// Terrain score for a position: forest = defensive bonus, hill = offensive bonus
function terrainScore(pos: Position, grid: Cell[][]): number {
  const t = grid[pos.row]?.[pos.col]?.terrain;
  if (t === 'forest') return 2; // defensive cover
  if (t === 'hill') return 1.5; // offensive bonus
  return 0;
}

// Move toward target: terrain-aware with anti-stalemate
export function moveToward(unit: Unit, target: Unit, grid: Cell[][]): Position {
  const possibleMoves = getMoveCells(unit, grid);
  if (possibleMoves.length === 0) return { row: unit.row, col: unit.col };

  // If can already attack, consider staying or moving to better terrain nearby
  if (canAttack(unit, target)) {
    // Only consider terrain moves if not stuck (anti-stalemate)
    if ((unit.stuckTurns || 0) < 3) {
      return { row: unit.row, col: unit.col };
    }
    // Stuck too long on terrain → keep attacking from here
    return { row: unit.row, col: unit.col };
  }

  const isStuck = (unit.stuckTurns || 0) >= 3;

  // Priority 1: move to a cell from which we can attack
  const attackMoves = possibleMoves.filter(pos => couldAttackFrom(pos, unit.type, target));
  if (attackMoves.length > 0) {
    // Among attack moves, prefer terrain tiles (but only if not stuck)
    if (!isStuck) {
      attackMoves.sort((a, b) => terrainScore(b, grid) - terrainScore(a, grid) || distance(b, target) - distance(a, target));
    } else {
      attackMoves.sort((a, b) => distance(a, target) - distance(b, target));
    }
    return attackMoves[0];
  }

  // Priority 2: if not stuck, consider moving to a nearby terrain tile that's still closer to target
  if (!isStuck) {
    const currentDist = distance(unit, target);
    const terrainMoves = possibleMoves.filter(pos => {
      const t = grid[pos.row][pos.col].terrain;
      return (t === 'forest' || t === 'hill') && distance(pos, target) <= currentDist;
    });
    if (terrainMoves.length > 0) {
      terrainMoves.sort((a, b) => terrainScore(b, grid) - terrainScore(a, grid));
      return terrainMoves[0];
    }
  }

  // Priority 3: BFS to find a path around obstacles
  const bfsStep = bfsFirstStep(unit, target, grid);
  if (bfsStep) {
    const validStep = possibleMoves.find(p => p.row === bfsStep.row && p.col === bfsStep.col);
    if (validStep) return validStep;
  }

  // Priority 4: fallback - move closer by manhattan distance
  const def = UNIT_DEFS[unit.type];
  let best = { row: unit.row, col: unit.col };
  let bestScore = Infinity;

  for (const pos of possibleMoves) {
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

// Calculate damage with counter system + terrain bonuses
export function calcDamage(attacker: Unit, defender: Unit, grid?: Cell[][]): number {
  const aDef = UNIT_DEFS[attacker.type];
  let dmg = attacker.attack * (0.95 + Math.random() * 0.1);

  if (aDef.strongVs.includes(defender.type)) {
    dmg *= COUNTER_MULTIPLIER;
  } else if (aDef.weakVs.includes(defender.type)) {
    dmg *= WEAKNESS_MULTIPLIER;
  }

  // Hill bonus: attacker on hill deals +15% damage
  if (grid && grid[attacker.row][attacker.col].terrain === 'hill') {
    dmg *= 1.15;
  }

  // Forest bonus: defender in forest takes -20% damage
  if (grid && grid[defender.row][defender.col].terrain === 'forest') {
    dmg *= 0.8;
  }

  return Math.floor(dmg);
}

// Light AI: tries to counter the player's composition
export function generateAIPlacement(playerUnits: Unit[], maxCount: number = BASE_UNITS, currentGrid?: Cell[][]): { type: UnitType; row: number; col: number }[] {
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
    let attempts = 0;
    do {
      row = Math.floor(Math.random() * 3); // rows 0-2
      col = Math.floor(Math.random() * GRID_SIZE);
      attempts++;
    } while ((usedCells.has(`${row},${col}`) || (currentGrid && currentGrid[row] && currentGrid[row][col] && currentGrid[row][col].terrain === 'water')) && attempts < 30);
    if (attempts >= 30) continue;
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
