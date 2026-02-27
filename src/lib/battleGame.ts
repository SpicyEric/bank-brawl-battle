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
  bondedToTankId?: string; // if placed adjacent to a tank, bonded for rigid formation
  bondBroken?: boolean; // once bond breaks (blocked move), unit moves freely
  movedWithTank?: boolean; // set to true when unit already moved this tick via tank formation
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
    description: 'Nahkämpfer. Beißt sich an einem Ziel fest bis es besiegt ist. Bewegt sich orthogonal (1 Feld).',
    movePattern: ORTHOGONAL,
    attackPattern: ORTHOGONAL,
    strongVs: ['tank', 'mage', 'healer'],
    weakVs: ['rider', 'archer', 'frost'],
  },
  assassin: {
    label: 'Assassine',
    emoji: '🗡️',
    hp: 90,
    attack: 18,
    cooldown: 1,
    description: 'Schneller Opportunist. Greift jede Runde an und wechselt zum nächsten verwundeten Ziel. Bewegt sich diagonal (2 Felder).',
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
    hp: 95,
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
    description: 'Extrem mobiler Springer. Kann bis zu 3 Felder in alle Richtungen springen und über Hindernisse setzen. Wechselt Ziele.',
    movePattern: [
      // Large star pattern: 3 squares in all 8 directions (jumps over obstacles)
      // Cardinal: 2 and 3 steps
      { row: -2, col: 0 }, { row: -3, col: 0 },
      { row: 2, col: 0 }, { row: 3, col: 0 },
      { row: 0, col: -2 }, { row: 0, col: -3 },
      { row: 0, col: 2 }, { row: 0, col: 3 },
      // Diagonal: 2 and 3 steps
      { row: -2, col: -2 }, { row: -3, col: -3 },
      { row: -2, col: 2 }, { row: -3, col: 3 },
      { row: 2, col: -2 }, { row: 3, col: -3 },
      { row: 2, col: 2 }, { row: 3, col: 3 },
      // L-shape knight jumps for extra flexibility
      { row: -2, col: -1 }, { row: -2, col: 1 },
      { row: 2, col: -1 }, { row: 2, col: 1 },
      { row: -1, col: -2 }, { row: -1, col: 2 },
      { row: 1, col: -2 }, { row: 1, col: 2 },
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
    hp: 160,
    attack: 19,
    cooldown: 3,
    description: 'Bewegt sich orthogonal (1 Feld). Schützt angrenzende Verbündete (-20% Schaden). Zieht Feinde an. Verbündete können sich an ihn binden.',
    movePattern: ORTHOGONAL,
    attackPattern: ORTHOGONAL,
    strongVs: ['rider', 'archer', 'frost'],
    weakVs: ['warrior', 'assassin', 'dragon'],
  },
  mage: {
    label: 'Magier',
    emoji: '🔮',
    hp: 85,
    attack: 25,
    cooldown: 2,
    description: 'Versteckt sich hinter Verbündeten. Greift diagonal 1-3 Felder an.',
    movePattern: ALL_ADJACENT,
    attackPattern: [
      ...DIAGONAL,
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
    hp: 75,
    attack: 10,
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
export const PLACE_TIME_LIMIT = 15; // seconds for placement phase (difficulty 2+)

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

// Find best target: column priority + frontline mechanic + tank taunt + unique behaviors
export function findTarget(unit: Unit, allUnits: Unit[]): Unit | null {
  const enemies = allUnits.filter(u => u.team !== unit.team && u.hp > 0);
  if (enemies.length === 0) return null;

  // Tank aggro: if any enemy tank is within distance 3, 60% chance to target it
  const nearbyTanks = enemies.filter(e => e.type === 'tank' && distance(unit, e) <= 3);
  if (nearbyTanks.length > 0 && Math.random() < 0.6) {
    nearbyTanks.sort((a, b) => distance(unit, a) - distance(unit, b));
    return nearbyTanks[0];
  }

  // === WARRIOR: Lock-on – keeps attacking the same target until it's dead ===
  if (unit.type === 'warrior' && unit.lastAttackedId) {
    const lockedTarget = enemies.find(e => e.id === unit.lastAttackedId);
    if (lockedTarget) return lockedTarget;
  }

  // === ASSASSIN: Opportunist – prefers wounded enemies, then nearest ===
  if (unit.type === 'assassin') {
    const wounded = enemies.filter(e => e.hp < e.maxHp * 0.7);
    if (wounded.length > 0) {
      wounded.sort((a, b) => a.hp - b.hp);
      return wounded[0];
    }
    enemies.sort((a, b) => distance(unit, a) - distance(unit, b));
    return enemies[0];
  }

  // Rider target-switching: prefer enemies it hasn't attacked last
  if (unit.type === 'rider' && unit.lastAttackedId && enemies.length > 1) {
    const otherEnemies = enemies.filter(e => e.id !== unit.lastAttackedId);
    if (otherEnemies.length > 0) {
      otherEnemies.sort((a, b) => distance(unit, a) - distance(unit, b));
      return otherEnemies[0];
    }
  }

  // Column-based targeting
  const sameColEnemies = enemies.filter(e => e.col === unit.col);
  const nearColEnemies = enemies.filter(e => Math.abs(e.col - unit.col) === 1);
  const columnEnemies = [...sameColEnemies, ...nearColEnemies];

  if (columnEnemies.length > 0 && Math.random() < 0.7) {
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

// Internal: select best move from a list of candidate positions
function _selectBestMove(unit: Unit, target: Unit, possibleMoves: Position[], grid: Cell[][], allUnits: Unit[] | undefined, isRangedKiter: boolean): Position {
  // If can already attack, consider kiting or staying
  if (canAttack(unit, target)) {
    if (isRangedKiter && (unit.stuckTurns || 0) < 3) {
      const kiteMoves = possibleMoves.filter(pos => couldAttackFrom(pos, unit.type, target));
      if (kiteMoves.length > 0) {
        kiteMoves.sort((a, b) => {
          const distA = distance(a, target);
          const distB = distance(b, target);
          if (unit.type === 'mage' && allUnits) {
            const behindA = isBehindAllies(a, unit, allUnits) ? 2 : 0;
            const behindB = isBehindAllies(b, unit, allUnits) ? 2 : 0;
            if (behindA !== behindB) return behindB - behindA;
          }
          return distB - distA;
        });
        const bestKite = kiteMoves[0];
        if (distance(bestKite, target) >= distance(unit, target)) {
          return bestKite;
        }
      }
      return { row: unit.row, col: unit.col };
    }
    return { row: unit.row, col: unit.col };
  }

  const isStuck = (unit.stuckTurns || 0) >= 3;

  const attackMoves = possibleMoves.filter(pos => couldAttackFrom(pos, unit.type, target));
  if (attackMoves.length > 0) {
    if (!isStuck) {
      attackMoves.sort((a, b) => terrainScore(b, grid) - terrainScore(a, grid) || distance(b, target) - distance(a, target));
    } else {
      attackMoves.sort((a, b) => distance(a, target) - distance(b, target));
    }
    return attackMoves[0];
  }

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

  const bfsStep = bfsFirstStep(unit, target, grid);
  if (bfsStep) {
    const validStep = possibleMoves.find(p => p.row === bfsStep.row && p.col === bfsStep.col);
    if (validStep) return validStep;
  }

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

// Magnetic bond: no-op, bonds are handled in moveToward
export function moveTankFormation(_tank: Unit, _newPos: Position, _grid: Cell[][], _allUnits: Unit[]): void {
  // Magnetic bonds don't move units with the tank — they pull units back in moveToward
}


const RANGED_KITERS: UnitType[] = ['archer', 'frost', 'mage'];

// Check if a position is "behind" allies (further from enemies)
function isBehindAllies(pos: Position, unit: Unit, allUnits: Unit[]): boolean {
  const allies = allUnits.filter(u => u.team === unit.team && u.id !== unit.id && u.hp > 0 && !u.dead);
  if (allies.length === 0) return false;
  const enemies = allUnits.filter(u => u.team !== unit.team && u.hp > 0 && !u.dead);
  if (enemies.length === 0) return false;
  const avgEnemyRow = enemies.reduce((s, e) => s + e.row, 0) / enemies.length;
  const avgAllyRow = allies.reduce((s, a) => s + a.row, 0) / allies.length;
  // "Behind" means further from enemies than the average ally
  if (unit.team === 'player') {
    return pos.row > avgAllyRow; // player units: higher row = further back
  } else {
    return pos.row < avgAllyRow; // enemy units: lower row = further back
  }
}

// Find nearest friendly tank position
function findFriendlyTank(unit: Unit, allUnits: Unit[]): Unit | null {
  const tanks = allUnits.filter(u => u.team === unit.team && u.type === 'tank' && u.hp > 0 && !u.dead && u.id !== unit.id);
  if (tanks.length === 0) return null;
  tanks.sort((a, b) => distance(unit, a) - distance(unit, b));
  return tanks[0];
}

// Check if position is orthogonally adjacent to a unit
function isAdjacentTo(pos: Position, target: Unit): boolean {
  return ALL_ADJACENT.some(o => pos.row === target.row + o.row && pos.col === target.col + o.col);
}

// Move toward target: terrain-aware with anti-stalemate + kiting for ranged + magnetic tank bond
export function moveToward(unit: Unit, target: Unit, grid: Cell[][], allUnits?: Unit[]): Position {
  const possibleMoves = getMoveCells(unit, grid);
  if (possibleMoves.length === 0) return { row: unit.row, col: unit.col };

  const isRangedKiter = RANGED_KITERS.includes(unit.type);

  // --- Magnetic bond: bonded units get pulled back toward tank ---
  if (unit.type !== 'tank' && unit.type !== 'healer' && allUnits) {
    const friendlyTank = findFriendlyTank(unit, allUnits);
    if (friendlyTank) {
      const isBonded = unit.bondedToTankId === friendlyTank.id && !unit.bondBroken;
      const dist2tank = distance(unit, friendlyTank);

      if (isBonded) {
        // Bonded unit >2 fields away: 60% chance to move back toward tank
        if (dist2tank > 2 && Math.random() < 0.6) {
          const pullMoves = possibleMoves.filter(pos =>
            distance(pos, friendlyTank) < dist2tank
          );
          // Prefer moves that also let us attack
          const pullAttackMoves = pullMoves.filter(pos => couldAttackFrom(pos, unit.type, target));
          if (pullAttackMoves.length > 0) {
            pullAttackMoves.sort((a, b) => distance(a, friendlyTank) - distance(b, friendlyTank));
            return pullAttackMoves[0];
          }
          if (pullMoves.length > 0) {
            pullMoves.sort((a, b) => distance(a, friendlyTank) - distance(b, friendlyTank));
            return pullMoves[0];
          }
        }
        // Bonded unit adjacent (≤1): try to stay adjacent while attacking
        if (dist2tank <= 1) {
          const adjacentAttackMoves = possibleMoves.filter(pos =>
            isAdjacentTo(pos, friendlyTank) && couldAttackFrom(pos, unit.type, target)
          );
          if (adjacentAttackMoves.length > 0) return adjacentAttackMoves[0];
          // Can attack from here? Stay
          if (canAttack(unit, target)) return { row: unit.row, col: unit.col };
        }
      } else if (!isBonded && dist2tank <= 3 && Math.random() < 0.30) {
        // Soft pull for non-bonded units within 3 fields
        const movesNearTank = possibleMoves.filter(pos =>
          distance(pos, friendlyTank) < dist2tank &&
          couldAttackFrom(pos, unit.type, target)
        );
        if (movesNearTank.length > 0) {
          movesNearTank.sort((a, b) => distance(a, friendlyTank) - distance(b, friendlyTank));
          return movesNearTank[0];
        }
      }
    }
  }

  return _selectBestMove(unit, target, possibleMoves, grid, allUnits, isRangedKiter);
}

// Helper to set bonds on units placed adjacent to tanks
export function setBondsForPlacement(units: Unit[]): void {
  const tanks = units.filter(u => u.type === 'tank');
  for (const unit of units) {
    for (const tank of tanks) {
      if (unit.id === tank.id) continue; // skip self
      if (unit.team === tank.team && ALL_ADJACENT.some(o => unit.row === tank.row + o.row && unit.col === tank.col + o.col)) {
        unit.bondedToTankId = tank.id;
        unit.bondBroken = false;
        break;
      }
    }
  }
}

// Check if defender has a friendly tank adjacent (shield aura)
function hasAdjacentFriendlyTank(defender: Unit, grid: Cell[][]): boolean {
  for (const offset of ALL_ADJACENT) {
    const r = defender.row + offset.row;
    const c = defender.col + offset.col;
    if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
      const cell = grid[r][c];
      if (cell.unit && cell.unit.type === 'tank' && cell.unit.team === defender.team && cell.unit.hp > 0 && !cell.unit.dead && cell.unit.id !== defender.id) {
        return true;
      }
    }
  }
  return false;
}

// Calculate damage with counter system + terrain bonuses + shield aura
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

// Shield aura: defender adjacent to friendly tank takes -20% damage (tanks also protect each other)
  if (grid && hasAdjacentFriendlyTank(defender, grid)) {
    dmg *= 0.8;
  }

  return Math.floor(dmg);
}

// Difficulty levels:
// 1 = Einfach: pure random picks
// 2 = Normal: 40% counter
// 3 = Herausfordernd: 60% counter + some terrain awareness
// 4 = Schwer: 80% counter + terrain + smart positioning
// 5 = Unmöglich: 95% counter + optimal composition + terrain + positioning
export function generateAIPlacement(playerUnits: Unit[], maxCount: number = BASE_UNITS, currentGrid?: Cell[][], difficulty: number = 2, bannedUnits: UnitType[] = []): { type: UnitType; row: number; col: number }[] {
  const placements: { type: UnitType; row: number; col: number }[] = [];
  const usedCells = new Set<string>();
  const count = maxCount;
  const availableTypes = UNIT_TYPES.filter(t => !bannedUnits.includes(t));

  // Count player unit types
  const playerTypes: Record<string, number> = {};
  for (const u of playerUnits) {
    playerTypes[u.type] = (playerTypes[u.type] || 0) + 1;
  }

  // Find counters for the most common player types
  const counterPicks: UnitType[] = [];
  const sortedTypes = Object.entries(playerTypes).sort((a, b) => b[1] - a[1]);

  for (const [pType] of sortedTypes) {
    for (const [uType, def] of Object.entries(UNIT_DEFS)) {
      if (def.strongVs.includes(pType as UnitType) && !bannedUnits.includes(uType as UnitType)) {
        counterPicks.push(uType as UnitType);
      }
    }
  }

  // Difficulty-based counter chance
  const counterChance = difficulty === 1 ? 0 : difficulty === 2 ? 0.4 : difficulty === 3 ? 0.6 : difficulty === 4 ? 0.8 : 0.95;

  // Tank bond chance: higher difficulty = more likely to use tank formations
  const tankBondChance = difficulty === 1 ? 0 : difficulty === 2 ? 0.1 : difficulty === 3 ? 0.3 : difficulty === 4 ? 0.5 : 0.7;

  // At difficulty 5, build an optimal composition: pure counters with color advantage
  if (difficulty >= 5 && playerUnits.length > 0) {
    const redCount = playerUnits.filter(u => ['warrior', 'assassin', 'dragon'].includes(u.type)).length;
    const greenCount = playerUnits.filter(u => ['tank', 'mage', 'healer'].includes(u.type)).length;
    const blueCount = playerUnits.filter(u => ['rider', 'archer', 'frost'].includes(u.type)).length;

    const counterColor = redCount >= greenCount && redCount >= blueCount ? 'blue'
      : greenCount >= blueCount ? 'red' : 'green';

    const colorUnits: Record<string, UnitType[]> = {
      red: ['warrior', 'assassin', 'dragon'],
      green: ['tank', 'mage', 'healer'],
      blue: ['rider', 'archer', 'frost'],
    };

    const mainPool = colorUnits[counterColor].filter(t => !bannedUnits.includes(t));
    if (mainPool.length === 0) return generateAIPlacement(playerUnits, maxCount, currentGrid, difficulty, []); // fallback
    // Difficulty 5: Force at least 1 tank for shield formation
    const hasTankInPool = mainPool.includes('tank');
    let forceTank = !hasTankInPool && !bannedUnits.includes('tank') && Math.random() < 0.5;
    
    for (let i = 0; i < count; i++) {
      let type: UnitType;
      if (forceTank && i === 0) {
        type = 'tank';
        forceTank = false;
      } else if (Math.random() < 0.95) {
        const pool = mainPool.filter(t => t !== 'healer' || placements.filter(p => p.type === 'healer').length < 1);
        type = pool[Math.floor(Math.random() * pool.length)];
      } else {
        type = availableTypes[Math.floor(Math.random() * availableTypes.length)];
      }

      let row: number, col: number;
      let attempts = 0;
      const isRanged = type === 'archer' || type === 'frost' || type === 'mage';
      const isTank = type === 'tank';
      const preferredRow = isTank ? 2 : isRanged ? 0 : 1;
      do {
        row = Math.random() < 0.7 ? preferredRow : Math.floor(Math.random() * 3);
        col = Math.floor(Math.random() * GRID_SIZE);
        attempts++;
      } while ((usedCells.has(`${row},${col}`) || (currentGrid && currentGrid[row]?.[col]?.terrain === 'water')) && attempts < 30);
      if (attempts >= 30) continue;
      usedCells.add(`${row},${col}`);
      placements.push({ type, row, col });
    }
    
    // Difficulty 5: Rearrange to create tank bonds
    _applyTankBondFormation(placements, usedCells, currentGrid, 0.7);
    return placements;
  }

  // Difficulty 3+: chance to include a tank for shield formation
  const shouldUseTankFormation = difficulty >= 3 && Math.random() < tankBondChance;
  let tankInserted = false;

  for (let i = 0; i < count; i++) {
    let type: UnitType;
    
    // Force first unit as tank if using tank formation and no tank picked yet
    if (shouldUseTankFormation && !tankInserted && i === 0 && !bannedUnits.includes('tank')) {
      type = 'tank';
      tankInserted = true;
    } else if (counterPicks.length > 0 && Math.random() < counterChance) {
      type = counterPicks[Math.floor(Math.random() * counterPicks.length)];
    } else {
      type = availableTypes[Math.floor(Math.random() * availableTypes.length)];
    }
    
    // Track if we got a tank naturally
    if (type === 'tank') tankInserted = true;

    let row: number, col: number;
    let attempts = 0;

    if (difficulty >= 4) {
      const isRanged = type === 'archer' || type === 'frost' || type === 'mage';
      const isTank = type === 'tank';
      const preferredRow = isTank ? 2 : isRanged ? 0 : 1;
      do {
        row = Math.random() < 0.6 ? preferredRow : Math.floor(Math.random() * 3);
        col = Math.floor(Math.random() * GRID_SIZE);
        attempts++;
      } while ((usedCells.has(`${row},${col}`) || (currentGrid && currentGrid[row]?.[col]?.terrain === 'water')) && attempts < 30);
    } else if (difficulty >= 3 && currentGrid) {
      do {
        row = Math.floor(Math.random() * 3);
        col = Math.floor(Math.random() * GRID_SIZE);
        attempts++;
        if (attempts < 15 && Math.random() < 0.3 && currentGrid[row]?.[col]?.terrain === 'none') {
          continue;
        }
      } while ((usedCells.has(`${row},${col}`) || (currentGrid && currentGrid[row]?.[col]?.terrain === 'water')) && attempts < 30);
    } else {
      do {
        row = Math.floor(Math.random() * 3);
        col = Math.floor(Math.random() * GRID_SIZE);
        attempts++;
      } while ((usedCells.has(`${row},${col}`) || (currentGrid && currentGrid[row]?.[col]?.terrain === 'water')) && attempts < 30);
    }

    if (attempts >= 30) continue;
    usedCells.add(`${row},${col}`);
    placements.push({ type, row, col });
  }

  // Apply tank bond formation rearrangement if we have a tank and difficulty warrants it
  if (shouldUseTankFormation && tankInserted) {
    _applyTankBondFormation(placements, usedCells, currentGrid, tankBondChance);
  }

  return placements;
}

// Rearrange non-tank units to be adjacent to tanks for bond formation
function _applyTankBondFormation(
  placements: { type: UnitType; row: number; col: number }[],
  usedCells: Set<string>,
  currentGrid?: Cell[][],
  intensity: number = 0.5,
): void {
  const tanks = placements.filter(p => p.type === 'tank');
  if (tanks.length === 0) return;

  const nonTanks = placements.filter(p => p.type !== 'tank');
  const adjacentOffsets = [
    { row: -1, col: 0 }, { row: 1, col: 0 }, { row: 0, col: -1 }, { row: 0, col: 1 },
    { row: -1, col: -1 }, { row: -1, col: 1 }, { row: 1, col: -1 }, { row: 1, col: 1 },
  ];

  for (const unit of nonTanks) {
    if (Math.random() > intensity) continue; // skip some units based on intensity
    
    // Find best adjacent cell to any tank
    const candidates: { row: number; col: number }[] = [];
    for (const tank of tanks) {
      for (const offset of adjacentOffsets) {
        const r = tank.row + offset.row;
        const c = tank.col + offset.col;
        if (r < 0 || r > 2 || c < 0 || c >= GRID_SIZE) continue; // enemy rows 0-2
        const key = `${r},${c}`;
        if (usedCells.has(key) && !(r === unit.row && c === unit.col)) continue;
        if (currentGrid && currentGrid[r]?.[c]?.terrain === 'water') continue;
        candidates.push({ row: r, col: c });
      }
    }

    if (candidates.length > 0) {
      const oldKey = `${unit.row},${unit.col}`;
      const newPos = candidates[Math.floor(Math.random() * candidates.length)];
      usedCells.delete(oldKey);
      unit.row = newPos.row;
      unit.col = newPos.col;
      usedCells.add(`${newPos.row},${newPos.col}`);
    }
  }
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
