import type { BattleEvent } from './battleEvents';

export type UnitType =
  | 'warrior' | 'rider' | 'archer' | 'assassin' | 'mage' | 'tank' | 'dragon' | 'healer' | 'frost'
  // New units (v2):
  | 'banshee' | 'magnetiker' | 'vulkanit' | 'mirror' | 'doppelganger'
  | 'spiderqueen' | 'judge' | 'waterwalker' | 'chaindancer' | 'shadowblade'
  | 'lamb' | 'vampire' | 'icegolem' | 'stormrunner' | 'ranger'
  | 'arsonist' | 'lightning' | 'mountaineer' | 'sniper' | 'cloner';
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
  color?: 'red' | 'blue' | 'green'; // per-instance color (assigned from roster slot for player units)
  slotIndex?: number; // for player units: index in the chosen roster (0..8)
  dead?: boolean;
  frozen?: number; // turns remaining frozen (can't move, attacks at reduced dmg)
  frozenDmgMul?: number; // damage multiplier while frozen (default 0.5; frost nova sets 0.3)
  webbed?: number; // turns remaining webbed (spiderqueen) – same as frozen, distinct visual
  stuckTurns?: number; // turns without attacking – used for anti-stalemate
  activationTurn?: number; // turn number when this unit becomes active (staggered rows)
  startRow?: number; // the row the unit was originally placed on
  lastAttackedId?: string; // last enemy attacked (rider uses this for target-switching)
  bondedToTankId?: string; // if placed adjacent to a tank, bonded for rigid formation
  bondBroken?: boolean; // once bond breaks (blocked move), unit moves freely
  movedWithTank?: boolean; // set to true when unit already moved this tick via tank formation
  burning?: { dmg: number; turns: number }[]; // active burn DoT stacks (arsonist)
  judgeBonus?: number; // extra ATK accrued by judge from fallen allies
  ghost?: number; // banshee: visual purple glow flag (>0 = glow active)
  reviveIn?: number; // banshee: ticks until revival from first death
  bansheeRevived?: boolean; // banshee: already used its one revival
  firstAttackUsed?: boolean; // shadowblade: first attack bonus consumed
  teleportTimer?: number; // shadowblade: ticks until next teleport-strike
  homeRow?: number; // shadowblade: row to return to after teleport-strike
  homeCol?: number; // shadowblade: col to return to after teleport-strike
  pendingTeleportReturn?: boolean; // shadowblade: must teleport back this tick
  skipNextMove?: boolean; // icegolem: alternate-turn movement
  isClone?: boolean; // spawned by cloner; clones cannot spawn more clones
  cloneTimer?: number; // cloner spawn cooldown countdown
  clonesSpawnedTotal?: number; // lifetime total clones this cloner has spawned (max 3)
  parentClonerId?: string; // for clones: id of the cloner that spawned them
  impulseTimer?: number; // mage shockwave cooldown countdown
  frostNovaTimer?: number; // frost mage 3x3 nova cooldown countdown
  hornTimer?: number; // rider horn ability cooldown countdown (9 ticks)
  hornBuff?: number; // ticks remaining of +50% damage from rider horn
  volleyTimer?: number; // archer 8-direction volley cooldown countdown (4 ticks)
  spinTimer?: number; // dragon fire-spin cooldown countdown (10 ticks)
  spinTicksLeft?: number; // dragon: ticks remaining in active fire spin (8 = just started)
  spinDirIdx?: number; // dragon: current beam direction (0..7)
  spinClockwise?: boolean; // dragon: rotation direction this spin
  phantom?: number; // doppelganger phantom: ticks left of invulnerability; disappears after
  isPhantom?: boolean; // doppelganger phantom flag
  doppelSpawned?: boolean; // original doppelganger has already spawned its phantom
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
  lavaTicks?: number; // vulkanit lava: ticks remaining
  lavaOwnerTeam?: Team; // immune team
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
  // New (v2)
  banshee: 'red', vampire: 'red', vulkanit: 'red', shadowblade: 'red',
  stormrunner: 'red', arsonist: 'red', lightning: 'red',
  mirror: 'green', lamb: 'green', judge: 'green', icegolem: 'green',
  ranger: 'green', mountaineer: 'green', cloner: 'green',
  magnetiker: 'blue', spiderqueen: 'blue', waterwalker: 'blue',
  doppelganger: 'blue', sniper: 'blue', chaindancer: 'blue',
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
    attack: 16,
    cooldown: 1,
    description: 'Schneller Opportunist. Greift jede Runde an und wechselt zum nächsten verwundeten Ziel. Bewegt sich diagonal (2 Felder). Gegner unter 50% HP nehmen 20 Schaden statt 16.',
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
    description: 'Fliegt über Hindernisse. Flächenangriff (3x3, 30% Splash). Alle 10 Ticks: bleibt stehen und dreht sich 8 Ticks lang im Kreis, speit pro Tick einen 3-Felder-Feuerstrahl in eine Richtung. Getroffene Gegner brennen 8 Ticks (5 Dmg/Tick).',
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
    description: 'Extrem mobiler Springer. Springt bis zu 3 Felder in alle Richtungen und über Hindernisse. Wechselt nach jedem Angriff sein Ziel. Bläst alle 9 Ticks ins Horn: Verbündete in 5×5 um sich machen 2 Ticks lang +50% Schaden.',
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
    description: 'Bewegt sich in alle Richtungen (1 Feld). Greift orthogonal bis 3 Felder an. Alle 4 Ticks: 8-Pfeil-Salve in alle Richtungen (orthogonal + diagonal) mit unendlicher Reichweite – jeder Pfeil trifft den ersten Gegner auf seiner Linie.',
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
    description: 'Friert Gegner 3 Ticks ein (50% Schaden, keine Bewegung). Alle 7 Ticks: Frost-Nova im 3×3 friert Feinde 5 Ticks (nur 30% Schaden). Greift orthogonal bis 2 Felder an.',
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
    description: 'Versteckt sich hinter Verbündeten. Greift diagonal 1-3 Felder an. Alle 7 Ticks: Impulswelle stößt alle Feinde im 7×7-Umkreis nach außen.',
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
    description: 'Heilt Verbündete im Umkreis von 2 Feldern (+28 HP). Greift nur an, wenn niemand mehr zu heilen ist.',
    movePattern: ALL_ADJACENT,
    attackPattern: [
      ...ALL_ADJACENT,
      { row: -2, col: 0 }, { row: 2, col: 0 }, { row: 0, col: -2 }, { row: 0, col: 2 },
    ],
    strongVs: ['rider', 'archer', 'frost'],
    weakVs: ['warrior', 'assassin', 'dragon'],
  },
  // ===== NEW UNITS v2 =====
  // Behaviors that fit cleanly into the engine are implemented in calcDamage/battleTick.
  // Mechanics marked "(geplant)" in the description are currently approximated via stats/patterns.
  banshee: {
    label: 'Banshee', emoji: '👻', hp: 70, attack: 16, cooldown: 2,
    description: 'Diagonale Bewegung. Stirbt einmalig nur scheinbar – steht nach 3 Runden mit 40 HP und nur noch 10 ATK wieder auf (zweiter Tod ist endgültig).',
    movePattern: [...DIAGONAL, { row: -2, col: -2 }, { row: -2, col: 2 }, { row: 2, col: -2 }, { row: 2, col: 2 }],
    attackPattern: DIAGONAL,
    strongVs: [], weakVs: [],
  },
  vampire: {
    label: 'Vampir', emoji: '🧛', hp: 80, attack: 19, cooldown: 2,
    description: 'Lifesteal 30%. Bei Overheal explodiert er sofort für 25 Splash an angrenzende Feinde.',
    movePattern: DIAGONAL,
    attackPattern: DIAGONAL,
    strongVs: [], weakVs: [],
  },
  vulkanit: {
    label: 'Vulkanit', emoji: '🌋', hp: 90, attack: 20, cooldown: 3,
    description: 'Hinterlässt nach jedem Angriff ein Lava-Plus (5 Felder) um das Ziel (8 Schaden / Runde, 3 Runden).',
    movePattern: ALL_ADJACENT,
    attackPattern: ALL_ADJACENT,
    strongVs: [], weakVs: [],
  },
  shadowblade: {
    label: 'Schattenklinge', emoji: '🥷', hp: 60, attack: 20, cooldown: 2,
    description: 'Hält max. Abstand. Alle 5 Ticks: teleportiert sich neben einen Gegner, schlägt zu und teleportiert zurück.',
    movePattern: [...DIAGONAL, { row: -2, col: -2 }, { row: -2, col: 2 }, { row: 2, col: -2 }, { row: 2, col: 2 }],
    attackPattern: DIAGONAL,
    strongVs: [], weakVs: [],
  },
  stormrunner: {
    label: 'Sturmläufer', emoji: '⚡', hp: 55, attack: 16, cooldown: 1,
    description: 'Greift jede Runde an. 2 Felder orthogonale Bewegung pro Zug.',
    movePattern: [...ORTHOGONAL, { row: -2, col: 0 }, { row: 2, col: 0 }, { row: 0, col: -2 }, { row: 0, col: 2 }],
    attackPattern: ORTHOGONAL,
    strongVs: [], weakVs: [],
  },
  arsonist: {
    label: 'Brandstifter', emoji: '🔥', hp: 65, attack: 4, cooldown: 2,
    description: 'Geringer Sofortschaden, zündet aber an: 6 Schaden pro Runde für 4 Runden. Stapelbar. Hinterlässt zudem eine Brandspur (3 Ticks), die nur Feinden Schaden zufügt.',
    movePattern: ALL_ADJACENT,
    attackPattern: ALL_ADJACENT,
    strongVs: [], weakVs: [],
  },
  lightning: {
    label: 'Blitzmagier', emoji: '🌩️', hp: 75, attack: 18, cooldown: 2,
    description: 'Kettenblitz: springt vom Ziel zu Feinden im Radius 2 weiter (50/40/30/20/10% Schaden).',
    movePattern: ALL_ADJACENT,
    attackPattern: [
      ...ORTHOGONAL,
      { row: -2, col: 0 }, { row: 2, col: 0 }, { row: 0, col: -2 }, { row: 0, col: 2 },
    ],
    strongVs: [], weakVs: [],
  },
  mirror: {
    label: 'Spiegelkämpfer', emoji: '🪞', hp: 75, attack: 14, cooldown: 2,
    description: 'Reflektiert 30% des erlittenen Schadens. Explodiert beim Tod für 20 Schaden im Umkreis.',
    movePattern: ORTHOGONAL,
    attackPattern: ORTHOGONAL,
    strongVs: [], weakVs: [],
  },
  lamb: {
    label: 'Opferlamm', emoji: '🐑', hp: 120, attack: 5, cooldown: 5,
    description: 'Provoziert! Wird immer als Primärziel anvisiert. Heilt beim Tod alle Verbündeten um 30% HP.',
    movePattern: ORTHOGONAL,
    attackPattern: ORTHOGONAL,
    strongVs: [], weakVs: [],
  },
  judge: {
    label: 'Richter', emoji: '⚖️', hp: 100, attack: 8, cooldown: 2,
    description: 'Pro gefallenem Verbündeten: +8 ATK permanent in dieser Runde.',
    movePattern: ORTHOGONAL,
    attackPattern: ORTHOGONAL,
    strongVs: [], weakVs: [],
  },
  icegolem: {
    label: 'Eisgolem', emoji: '🧊', hp: 200, attack: 25, cooldown: 4,
    description: 'Riesiger Tank. Bewegt sich nur jede zweite Runde. 25% Chance, Angreifer einzufrieren.',
    movePattern: ORTHOGONAL,
    attackPattern: ORTHOGONAL,
    strongVs: [], weakVs: [],
  },
  ranger: {
    label: 'Waldläufer', emoji: '🪵', hp: 70, attack: 14, cooldown: 2,
    description: 'Strebt zwanghaft ins nächste Waldfeld und verteidigt es. Auf Wald: 19 ATK, Cooldown 1. Ohne Waldfeld kämpft er normal.',
    movePattern: ALL_ADJACENT,
    attackPattern: ALL_ADJACENT,
    strongVs: [], weakVs: [],
  },
  mountaineer: {
    label: 'Bergkrieger', emoji: '🪨', hp: 130, attack: 21, cooldown: 3,
    description: 'Strebt zwanghaft auf den nächsten Hügel und belagert ihn. Auf Hügel: Cooldown 2, immun gegen Einfrieren und Feuerschaden. Ohne Hügel kämpft er normal.',
    movePattern: ORTHOGONAL,
    attackPattern: ORTHOGONAL,
    strongVs: [], weakVs: [],
  },
  cloner: {
    label: 'Kloner', emoji: '🧬', hp: 90, attack: 12, cooldown: 2,
    description: 'Hält maximal Abstand zu Feinden, bewegt sich nur jeden 2. Tick. Spawnt alle 6 Ticks einen Klon (max. 3 Klone insgesamt), der auf Feinde zustürmt.',
    movePattern: ORTHOGONAL,
    attackPattern: ORTHOGONAL,
    strongVs: [], weakVs: [],
  },
  magnetiker: {
    label: 'Magnetiker', emoji: '🧲', hp: 80, attack: 12, cooldown: 2,
    description: 'Zieht nach jedem Angriff alle Feinde im Umkreis 2 ein Feld näher.',
    movePattern: ORTHOGONAL,
    attackPattern: ORTHOGONAL,
    strongVs: [], weakVs: [],
  },
  spiderqueen: {
    label: 'Spinnenkönigin', emoji: '🕷️', hp: 70, attack: 15, cooldown: 2,
    description: 'Bewegt sich in alle 8 Richtungen (bis 2 Felder). 35% Chance, Ziel im Netz zu fangen (3 Runden).',
    movePattern: [
      ...ALL_ADJACENT,
      { row: -2, col: 0 }, { row: 2, col: 0 }, { row: 0, col: -2 }, { row: 0, col: 2 },
      { row: -2, col: -2 }, { row: -2, col: 2 }, { row: 2, col: -2 }, { row: 2, col: 2 },
    ],
    attackPattern: ALL_ADJACENT,
    strongVs: [], weakVs: [],
  },
  waterwalker: {
    label: 'Wasserwandler', emoji: '🌊', hp: 85, attack: 19, cooldown: 2,
    description: 'Strebt zwanghaft in den nächsten Tümpel. Auf Wasser: -30% erlittener Schaden, regeneriert +3 HP pro Tick. Ohne Wasserfeld kämpft er normal.',
    movePattern: ALL_ADJACENT,
    attackPattern: ALL_ADJACENT,
    strongVs: [], weakVs: [],
  },
  doppelganger: {
    label: 'Doppelgänger', emoji: '👥', hp: 85, attack: 17, cooldown: 2,
    description: 'Spawnt zu Beginn der Runde ein Phantom-Duplikat (5 Ticks unverwundbar). Gegner unterscheiden Original und Phantom nicht.',
    movePattern: DIAGONAL,
    attackPattern: DIAGONAL,
    strongVs: [], weakVs: [],
  },
  sniper: {
    label: 'Scharfschütze', emoji: '🎯', hp: 50, attack: 35, cooldown: 3,
    description: 'Bewegt sich nie. Greift immer die Einheit mit niedrigstem HP auf dem ganzen Feld an. Hoher Schaden.',
    movePattern: [],
    attackPattern: (() => {
      const p: Position[] = [];
      const N = 8;
      for (let dr = -N; dr <= N; dr++) for (let dc = -N; dc <= N; dc++) {
        if (dr === 0 && dc === 0) continue;
        p.push({ row: dr, col: dc });
      }
      return p;
    })(),
    strongVs: [], weakVs: [],
  },
  chaindancer: {
    label: 'Kettentänzer', emoji: '🪢', hp: 65, attack: 22, cooldown: 3,
    description: 'Kettenangriff: Schaden springt diagonal durch bis zu 3 Feinde (jeweils 70% Schaden). Diagonale Bewegung bis 2 Felder.',
    movePattern: [...DIAGONAL, { row: -2, col: -2 }, { row: -2, col: 2 }, { row: 2, col: -2 }, { row: 2, col: 2 }],
    attackPattern: DIAGONAL,
    strongVs: [], weakVs: [],
  },
};

// Auto-populate strongVs/weakVs for ALL units based on color group (RPS).
{
  const colorMembers: Record<ColorGroup, UnitType[]> = { red: [], green: [], blue: [] };
  (Object.keys(UNIT_COLOR_GROUPS) as UnitType[]).forEach(t => colorMembers[UNIT_COLOR_GROUPS[t]].push(t));
  (Object.keys(UNIT_DEFS) as UnitType[]).forEach(t => {
    const myColor = UNIT_COLOR_GROUPS[t];
    const beats = COLOR_BEATS[myColor];
    const losesTo = (Object.keys(COLOR_BEATS) as ColorGroup[]).find(k => COLOR_BEATS[k] === myColor)!;
    UNIT_DEFS[t].strongVs = colorMembers[beats];
    UNIT_DEFS[t].weakVs = colorMembers[losesTo];
  });
}

export const UNIT_TYPES: UnitType[] = Object.keys(UNIT_DEFS) as UnitType[];
export const BASE_UNITS = 5;
export const MAX_UNITS = 20; // absolute cap (limited by available rows: 3×8=24 cells)

// Comeback mechanic: behind by 2+ → +1, behind by 4+ → +2
// Round escalation: round N allows N units (up to MAX_UNITS), plus comeback bonus.
export function getMaxUnits(myScore: number, opponentScore: number, roundNumber: number = 999): number {
  const deficit = opponentScore - myScore;
  let bonus = 0;
  if (deficit >= 4) bonus = 2;
  else if (deficit >= 2) bonus = 1;
  return Math.min(roundNumber + bonus, MAX_UNITS);
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
export const MULTI_PLACE_TIME_LIMIT = 20; // seconds for multiplayer placement phase

export const COUNTER_MULTIPLIER = 1.3;
export const WEAKNESS_MULTIPLIER = 0.7;

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

export function createUnit(type: UnitType, team: Team, row: number, col: number, color?: 'red' | 'blue' | 'green', slotIndex?: number): Unit {
  const def = UNIT_DEFS[type];
  return {
    id: crypto.randomUUID(),
    type, team, row, col,
    hp: def.hp, maxHp: def.hp,
    attack: def.attack,
    cooldown: 0, maxCooldown: def.cooldown,
    activationTurn: getActivationTurn(row, team),
    startRow: row,
    color: color ?? UNIT_COLOR_GROUPS[type],
    slotIndex,
  };
}

// Effective color for RPS damage (per-instance, falls back to type default for legacy/AI units)
export function getUnitColor(u: Unit): ColorGroup {
  return (u.color as ColorGroup) ?? UNIT_COLOR_GROUPS[u.type];
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
  const canSwim = unit.type === 'waterwalker';
  return def.movePattern
    .map(p => ({ row: unit.row + p.row, col: unit.col + p.col }))
    .filter(p =>
      p.row >= 0 && p.row < GRID_SIZE && p.col >= 0 && p.col < GRID_SIZE &&
      (!grid[p.row][p.col].unit || grid[p.row][p.col].unit!.id === unit.id) &&
      (canFly || canJump || canSwim || grid[p.row][p.col].terrain !== 'water') &&
      (canFly || canJump || !grid[p.row][p.col].unit?.dead)
    );
}

// Find best target: column priority + frontline mechanic + tank taunt + unique behaviors
export function findTarget(unit: Unit, allUnits: Unit[]): Unit | null {
  const enemies = allUnits.filter(u => u.team !== unit.team && u.hp > 0);
  if (enemies.length === 0) return null;

  // === LAMB TAUNT: any enemy lamb is ALWAYS the primary target (provokes everyone). ===
  const enemyLamb = enemies.find(e => e.type === 'lamb');
  if (enemyLamb && unit.type !== 'sniper' && unit.type !== 'healer') {
    return enemyLamb;
  }
  // === SNIPER: always shoots lowest-HP enemy on the entire field ===
  if (unit.type === 'sniper') {
    return [...enemies].sort((a, b) => a.hp - b.hp)[0];
  }
  // === ASSASSIN: ALWAYS hunts the globally lowest-HP enemy. Re-evaluates every tick.
  //     Tiebreaker: nearest. No lock-on, no column bias, no tank-aggro detour. ===
  if (unit.type === 'assassin') {
    return [...enemies].sort((a, b) => a.hp - b.hp || distance(unit, a) - distance(unit, b))[0];
  }
  // === LAMB (own lamb): taunts the strongest enemy ===
  if (unit.type === 'lamb') {
    return [...enemies].sort((a, b) => b.attack * b.hp - a.attack * a.hp)[0];
  }
  // === VAMPIRE: always targets enemy with HIGHEST HP (nearest among ties) ===
  if (unit.type === 'vampire') {
    return [...enemies].sort((a, b) => b.hp - a.hp || distance(unit, a) - distance(unit, b))[0];
  }
  // === BANSHEE: always nearest enemy ===
  if (unit.type === 'banshee') {
    return [...enemies].sort((a, b) => distance(unit, a) - distance(unit, b))[0];
  }
  // === ARSONIST: prefer high-HP non-burning targets ===
  if (unit.type === 'arsonist') {
    const nonBurning = enemies.filter(e => !e.burning || e.burning.length === 0);
    const pool = nonBurning.length > 0 ? nonBurning : enemies;
    const sorted = [...pool].sort((a, b) => b.hp - a.hp);
    if (sorted[0] && distance(unit, sorted[0]) <= 6) return sorted[0];
  }

  // Tank aggro
  const nearbyTanks = enemies.filter(e => e.type === 'tank' && distance(unit, e) <= 3);
  if (nearbyTanks.length > 0 && Math.random() < 0.6) {
    nearbyTanks.sort((a, b) => distance(unit, a) - distance(unit, b));
    return nearbyTanks[0];
  }

  // === WARRIOR / STORMRUNNER: lock-on – keeps attacking same target until it dies ===
  if ((unit.type === 'warrior' || unit.type === 'stormrunner') && unit.lastAttackedId) {
    const locked = enemies.find(e => e.id === unit.lastAttackedId);
    if (locked) return locked;
  }

  // === ARCHER: lock-on while max-distance kiting ===
  if (unit.type === 'archer' && unit.lastAttackedId) {
    const locked = enemies.find(e => e.id === unit.lastAttackedId);
    if (locked) return locked;
  }

  // === FROST / MAGE: switch target after every attack ===
  if ((unit.type === 'frost' || unit.type === 'mage') &&
      unit.lastAttackedId && enemies.length > 1) {
    const others = enemies.filter(e => e.id !== unit.lastAttackedId);
    if (others.length > 0) {
      others.sort((a, b) => distance(unit, a) - distance(unit, b));
      return others[0];
    }
  }

  // Rider target-switching
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
  const canSwim = unit.type === 'waterwalker';
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
    if (!canFly && !canSwim && cell.terrain === 'water') continue;
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
      if (!canFly && !canSwim && cell.terrain === 'water') continue;
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
    // Ranged kiters: always try to maximize distance while still being able to attack.
    if (isRangedKiter) {
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

  // Cloner (original): retreat — pick the move that maximizes min-distance to nearest enemy.
  if (unit.type === 'cloner' && !unit.isClone) {
    const enemies = (allUnits || []).filter(u => u.team !== unit.team && u.hp > 0 && !u.dead);
    if (enemies.length === 0) return { row: unit.row, col: unit.col };
    const candidates: Position[] = [...possibleMoves, { row: unit.row, col: unit.col }];
    const minDistTo = (p: Position) => Math.min(...enemies.map(e => distance(p, e)));
    candidates.sort((a, b) => {
      const diff = minDistTo(b) - minDistTo(a);
      if (diff !== 0) return diff;
      // tie-break: prefer staying still
      return (a.row === unit.row && a.col === unit.col) ? -1 : 1;
    });
    return candidates[0];
  }

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
  
  let baseAtk = attacker.attack + (attacker.judgeBonus || 0);
  // Assassin: +4 damage against enemies below 50% HP
  if (attacker.type === 'assassin' && defender.hp < defender.maxHp * 0.5) {
    baseAtk += 4;
  }
  let dmg = baseAtk * (0.95 + Math.random() * 0.1);

  const aColor = getUnitColor(attacker);
  const dColor = getUnitColor(defender);
  if (COLOR_BEATS[aColor] === dColor) {
    // Warrior: +50% damage when countering (instead of +30%)
    dmg *= attacker.type === 'warrior' ? 1.5 : COUNTER_MULTIPLIER;
  } else if (COLOR_BEATS[dColor] === aColor) {
    // Warrior: only -10% damage when weak (instead of -30%)
    dmg *= attacker.type === 'warrior' ? 0.9 : WEAKNESS_MULTIPLIER;
  }

  const attackerTerrain = grid?.[attacker.row]?.[attacker.col]?.terrain;
  const defenderTerrain = grid?.[defender.row]?.[defender.col]?.terrain;
  const dist = Math.abs(attacker.row - defender.row) + Math.abs(attacker.col - defender.col);
  const isRanged = dist > 1;

  // Hill bonus: attacker on hill deals +15% damage
  if (attackerTerrain === 'hill') dmg *= 1.15;

  // Forest bonus: defender in forest takes -20% damage
  if (defenderTerrain === 'forest') dmg *= 0.8;

  // Ranger: on a forest tile, effective ATK is 19 (base 14) → scale damage accordingly
  if (attacker.type === 'ranger' && attackerTerrain === 'forest') dmg *= (19 / 14);

  // Waterwalker: -30% incoming damage on water
  if (defender.type === 'waterwalker' && defenderTerrain === 'water') dmg *= 0.7;

  // Shield aura: defender adjacent to friendly tank takes -20% damage
  if (grid && hasAdjacentFriendlyTank(defender, grid)) dmg *= 0.8;

  // Rider horn buff: +50% damage while hornBuff active
  if ((attacker.hornBuff || 0) > 0) dmg *= 1.5;

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

  // Count player units by their EFFECTIVE color (slot-assigned), not by type default.
  const playerColorCounts: Record<ColorGroup, number> = { red: 0, green: 0, blue: 0 };
  for (const u of playerUnits) {
    playerColorCounts[getUnitColor(u)]++;
  }

  // Determine player's dominant color → AI should counter it.
  // RPS reminder: red>green, green>blue, blue>red. So counter(red)=blue, counter(green)=red, counter(blue)=green.
  const COUNTER_COLOR: Record<ColorGroup, ColorGroup> = { red: 'blue', green: 'red', blue: 'green' };
  const colorMembers: Record<ColorGroup, UnitType[]> = {
    red: (Object.keys(UNIT_COLOR_GROUPS) as UnitType[]).filter(t => UNIT_COLOR_GROUPS[t] === 'red'),
    green: (Object.keys(UNIT_COLOR_GROUPS) as UnitType[]).filter(t => UNIT_COLOR_GROUPS[t] === 'green'),
    blue: (Object.keys(UNIT_COLOR_GROUPS) as UnitType[]).filter(t => UNIT_COLOR_GROUPS[t] === 'blue'),
  };

  const dominantPlayerColor: ColorGroup =
    playerColorCounts.red >= playerColorCounts.green && playerColorCounts.red >= playerColorCounts.blue ? 'red'
      : playerColorCounts.green >= playerColorCounts.blue ? 'green' : 'blue';
  const targetCounterColor: ColorGroup = COUNTER_COLOR[dominantPlayerColor];

  // Counter pool: all unit types whose default color counters the player's dominant color.
  const counterPicks: UnitType[] = colorMembers[targetCounterColor].filter(t => !bannedUnits.includes(t));

  // Difficulty-based counter chance
  const counterChance = difficulty === 1 ? 0 : difficulty === 2 ? 0.4 : difficulty === 3 ? 0.6 : difficulty === 4 ? 0.8 : 0.95;

  // Tank bond chance: higher difficulty = more likely to use tank formations
  const tankBondChance = difficulty === 1 ? 0 : difficulty === 2 ? 0.1 : difficulty === 3 ? 0.3 : difficulty === 4 ? 0.5 : 0.7;

  // At difficulty 5, build an optimal composition: pure counters with color advantage
  if (difficulty >= 5 && playerUnits.length > 0) {
    const mainPool = colorMembers[targetCounterColor].filter(t => !bannedUnits.includes(t));
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

// ============= UNIT SPECIAL EFFECTS (shared between SP / MP) =============

/** Apply post-attack effects: mirror reflect, magnet pull, spider web, shadowblade bonus,
 *  icegolem freeze-on-hit, vulkanit lava spawn. */
export function applyPostAttackEffects(
  attacker: Unit, target: Unit, dmg: number,
  grid: Cell[][], logs: string[]
): void {
  // Shadowblade: first attack +50% bonus damage
  if (attacker.type === 'shadowblade' && !attacker.firstAttackUsed && target.hp > 0) {
    const bonus = Math.round(dmg * 0.5);
    target.hp = Math.max(0, target.hp - bonus);
    if (target.hp <= 0) (target as any).dead = true;
    attacker.firstAttackUsed = true;
    logs.push(`🥷 Schattenklinge Erstangriff +${bonus}`);
  }

  // Mirror reflect 30% to attacker
  if (target.type === 'mirror' && target.hp > 0 && dmg > 0) {
    const refl = Math.max(1, Math.round(dmg * 0.3));
    attacker.hp = Math.max(0, attacker.hp - refl);
    if (attacker.hp <= 0) (attacker as any).dead = true;
    logs.push(`🪞 Reflektion → ${UNIT_DEFS[attacker.type].emoji} ${refl}`);
  }

  // Icegolem: 25% chance to freeze melee attacker for 1 turn
  if (target.type === 'icegolem' && attacker.hp > 0 && Math.random() < 0.25) {
    const dist = Math.abs(attacker.row - target.row) + Math.abs(attacker.col - target.col);
    if (dist <= 2 && !isImmuneToFreeze(attacker, grid)) {
      attacker.frozen = Math.max(attacker.frozen || 0, 1);
      logs.push(`🧊 Eisgolem friert ${UNIT_DEFS[attacker.type].emoji} ein`);
    }
  }

  // Spiderqueen: 35% chance to web target for 3 turns (separate field, distinct visual)
  if (attacker.type === 'spiderqueen' && target.hp > 0 && Math.random() < 0.35) {
    target.webbed = Math.max(target.webbed || 0, 3);
    logs.push(`🕸️ Netz! ${UNIT_DEFS[target.type].emoji} 3 Runden gefangen`);
  }

  // Magnetiker: pull adjacent enemies one step closer after attack
  if (attacker.type === 'magnetiker') {
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      if (dr === 0 && dc === 0) continue;
      if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) continue; // only pull from >1
      const r = attacker.row + dr, c = attacker.col + dc;
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
      const cu = grid[r][c].unit;
      if (!cu || cu.team === attacker.team || cu.hp <= 0 || cu.dead) continue;
      const sr = Math.sign(attacker.row - r);
      const sc = Math.sign(attacker.col - c);
      const nr = r + sr, nc = c + sc;
      if (nr === attacker.row && nc === attacker.col) continue;
      if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) continue;
      if (grid[nr][nc].unit) continue;
      if (grid[nr][nc].terrain === 'water' && cu.type !== 'waterwalker') continue;
      grid[r][c].unit = null;
      cu.row = nr; cu.col = nc;
      grid[nr][nc].unit = cu;
    }
    logs.push(`🧲 Magnetiker zieht Feinde heran`);
  }

  // Vulkanit: spawn lava in a 5-tile PLUS pattern on the target (center + 4 orthogonal), 3 ticks
  if (attacker.type === 'vulkanit') {
    const plus: [number, number][] = [[0,0],[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dr, dc] of plus) {
      const r = target.row + dr, c = target.col + dc;
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
      grid[r][c].lavaTicks = 3;
      grid[r][c].lavaOwnerTeam = attacker.team;
    }
  }
}

/** Apply death-trigger effects: mirror explosion, lamb heal, banshee ghost.
 *  Returns true if the unit should NOT be marked dead yet (e.g. banshee turned ghost). */
export function applyDeathEffects(deadUnit: Unit, allUnits: Unit[], grid: Cell[][], logs: string[]): boolean {
  // Banshee → fake death: appears dead & blocks the cell for 3 ticks, then revives at full HP.
  // Second death is permanent.
  if (deadUnit.type === 'banshee' && !deadUnit.bansheeRevived && deadUnit.reviveIn === undefined) {
    deadUnit.reviveIn = 3;
    deadUnit.hp = 0;
    (deadUnit as any).dead = true;
    deadUnit.ghost = 0; // no glow while "dead"
    logs.push(`💀 Banshee gefallen – erhebt sich in 3 Runden wieder`);
    return false; // truly dead for now (cell stays blocked); caller leaves dead=true
  }
  // Mirror death explosion: 20 dmg to adjacent enemies
  if (deadUnit.type === 'mirror') {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = deadUnit.row + dr, c = deadUnit.col + dc;
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
      const cu = grid[r][c].unit;
      if (cu && cu.team !== deadUnit.team && cu.hp > 0 && !cu.dead) {
        cu.hp = Math.max(0, cu.hp - 20);
        if (cu.hp <= 0) (cu as any).dead = true;
        logs.push(`🪞 Spiegel-Explosion → ${UNIT_DEFS[cu.type].emoji} 20`);
      }
    }
  }
  // Lamb: heal all allies +30% maxHp
  if (deadUnit.type === 'lamb') {
    const allies = allUnits.filter(u => u.team === deadUnit.team && u.hp > 0 && !u.dead && u.id !== deadUnit.id);
    for (const a of allies) {
      const heal = Math.round(a.maxHp * 0.30);
      a.hp = Math.min(a.maxHp, a.hp + heal);
    }
    if (allies.length > 0) logs.push(`🐑 Opferlamm heilt ${allies.length} Verbündete (+30%)`);
  }
  return false;
}

/** Tick down lava fields and damage enemies standing on them. */
export function processLavaTick(grid: Cell[][], logs: string[]): void {
  for (let r = 0; r < GRID_SIZE; r++) for (let c = 0; c < GRID_SIZE; c++) {
    const cell = grid[r][c];
    if (!cell.lavaTicks) continue;
    const u = cell.unit;
    if (u && u.hp > 0 && !u.dead && u.team !== cell.lavaOwnerTeam && !isImmuneToFire(u, grid)) {
      u.hp = Math.max(0, u.hp - 8);
      logs.push(`🌋 Lava → ${UNIT_DEFS[u.type].emoji} 8${u.hp <= 0 ? ' ☠️' : ''}`);
      if (u.hp <= 0) (u as any).dead = true;
    }
    cell.lavaTicks -= 1;
    if (cell.lavaTicks <= 0) {
      cell.lavaTicks = undefined;
      cell.lavaOwnerTeam = undefined;
    }
  }
}

/** Arsonist: leave a 3-tick burning trail on the cell the unit is leaving.
 *  Damages enemies only (lavaOwnerTeam = arsonist's team). Call BEFORE clearing the cell. */
export function leaveArsonistTrail(grid: Cell[][], unit: Unit): void {
  if (unit.type !== 'arsonist') return;
  const cell = grid[unit.row]?.[unit.col];
  if (!cell || cell.terrain === 'water') return;
  cell.lavaTicks = 3;
  cell.lavaOwnerTeam = unit.team;
}

// ============= TERRAIN SEEKERS (ranger / mountaineer / waterwalker) =============

/** Returns the terrain a unit zealously seeks, or null if none. */
export function getSeekTerrain(type: UnitType): TerrainType | null {
  if (type === 'ranger') return 'forest';
  if (type === 'mountaineer') return 'hill';
  if (type === 'waterwalker') return 'water';
  return null;
}

/** Mountaineer on hill is immune to freezing. */
export function isImmuneToFreeze(unit: Unit, grid: Cell[][]): boolean {
  return unit.type === 'mountaineer' && grid[unit.row]?.[unit.col]?.terrain === 'hill';
}

/** Mountaineer on hill is immune to fire / lava / burning DoT. */
export function isImmuneToFire(unit: Unit, grid: Cell[][]): boolean {
  return unit.type === 'mountaineer' && grid[unit.row]?.[unit.col]?.terrain === 'hill';
}

/** Effective cooldown considering terrain bonuses (ranger forest=1, mountaineer hill=2). */
export function effectiveCooldown(unit: Unit, grid: Cell[][]): number {
  const t = grid[unit.row]?.[unit.col]?.terrain;
  if (unit.type === 'ranger' && t === 'forest') return 1;
  if (unit.type === 'mountaineer' && t === 'hill') return 2;
  return unit.maxCooldown;
}

export type SeekerResult = 'normal' | 'on_terrain' | 'moved' | 'wait';

/** Move a terrain-seeker one step toward the nearest free matching terrain tile.
 *  Returns:
 *   - 'normal'      → no seek behavior (no terrain of that type exists, or unit is not a seeker)
 *   - 'on_terrain'  → already on a matching tile, hand off to normal attack logic (no chasing)
 *   - 'moved'       → moved this tick; do NOT attack (single-minded travel)
 *   - 'wait'        → all matching tiles occupied or no path; hold position, no attack
 */
export function handleTerrainSeeker(unit: Unit, grid: Cell[][], _allUnits: Unit[]): SeekerResult {
  const terrain = getSeekTerrain(unit.type);
  if (!terrain) return 'normal';

  // Collect all matching tiles
  const tiles: { row: number; col: number; occupiedByOther: boolean }[] = [];
  for (let r = 0; r < GRID_SIZE; r++) for (let c = 0; c < GRID_SIZE; c++) {
    if (grid[r][c].terrain !== terrain) continue;
    const occ = grid[r][c].unit;
    tiles.push({ row: r, col: c, occupiedByOther: !!occ && occ.id !== unit.id && !occ.dead });
  }
  if (tiles.length === 0) return 'normal';

  // Already standing on matching terrain → defend in place
  if (grid[unit.row][unit.col].terrain === terrain) return 'on_terrain';

  // Pick nearest free tile
  const free = tiles.filter(t => !t.occupiedByOther);
  if (free.length === 0) return 'wait';
  free.sort((a, b) => distance(unit, a) - distance(unit, b));
  const goal = free[0];

  const possibleMoves = getMoveCells(unit, grid);
  if (possibleMoves.length === 0) return 'wait';

  // Prefer a direct move that lands ON the goal tile
  const direct = possibleMoves.find(p => p.row === goal.row && p.col === goal.col);
  let newPos: Position | null = direct ?? null;

  if (!newPos) {
    // Use BFS toward goal (fake target Unit-shape: only row/col matter)
    const fakeTarget = { row: goal.row, col: goal.col, id: '__seek__', team: unit.team } as Unit;
    const step = bfsFirstStep(unit, fakeTarget, grid);
    if (step) {
      const valid = possibleMoves.find(p => p.row === step.row && p.col === step.col);
      if (valid) newPos = valid;
    }
    if (!newPos) {
      // Fallback greedy: move that minimizes distance to goal
      const sorted = [...possibleMoves].sort((a, b) => distance(a, goal) - distance(b, goal));
      newPos = sorted[0];
    }
  }

  if (!newPos || (newPos.row === unit.row && newPos.col === unit.col)) return 'wait';

  // Commit the move on the grid
  grid[unit.row][unit.col].unit = null;
  unit.row = newPos.row;
  unit.col = newPos.col;
  grid[unit.row][unit.col].unit = unit;
  return 'moved';
}

/** Waterwalker: regenerate +3 HP per tick while standing on water. */
export function tickTerrainHeals(allUnits: Unit[], grid: Cell[][], logs: string[]): void {
  for (const u of allUnits) {
    if (u.hp <= 0 || (u as any).dead) continue;
    if (u.type === 'waterwalker' && grid[u.row]?.[u.col]?.terrain === 'water' && u.hp < u.maxHp) {
      const heal = Math.min(3, u.maxHp - u.hp);
      if (heal > 0) {
        u.hp += heal;
        logs.push(`🌊 Wasserwandler regeneriert +${heal} ❤️`);
      }
    }
  }
}

/** Tick down banshee revival timers; revive at full HP when timer hits 0. */
export function processGhostTick(_units: Unit[], grid: Cell[][], logs: string[]): void {
  // Scan the grid directly: dead banshees aren't in the allUnits list.
  for (let r = 0; r < GRID_SIZE; r++) for (let c = 0; c < GRID_SIZE; c++) {
    const u = grid[r]?.[c]?.unit;
    if (!u || u.type !== 'banshee') continue;
    if (u.reviveIn === undefined || u.reviveIn <= 0) continue;
    u.reviveIn -= 1;
    if (u.reviveIn <= 0) {
      u.reviveIn = undefined;
      u.hp = 40;
      u.attack = 10;
      (u as any).dead = false;
      u.bansheeRevived = true;
      u.ghost = 999; // persistent purple glow
      u.cooldown = 0;
      logs.push(`👻 Banshee erwacht erneut!`);
    }
  }
}

/** Icegolem alternates movement; returns true if this unit should skip its move this tick. */
export function shouldSkipMove(unit: Unit): boolean {
  if (unit.type === 'cloner' && !unit.isClone) {
    // Cloner moves every 2nd tick
    if (unit.skipNextMove) {
      unit.skipNextMove = false;
      return true;
    }
    unit.skipNextMove = true;
    return false;
  }
  if (unit.type !== 'icegolem') return false;
  if (unit.skipNextMove) {
    unit.skipNextMove = false;
    return true;
  }
  unit.skipNextMove = true;
  return false;
}

/** Cloner spawns a clone every 6 ticks in an adjacent empty cell.
 *  Lifetime cap: max 3 clones per cloner ever (not just alive). Clones have 3 HP and 3 attack. */
export function tickClonerSpawns(allUnits: Unit[], grid: Cell[][], logs: string[]): Unit[] {
  const spawned: Unit[] = [];
  const cloners = allUnits.filter(u => u.type === 'cloner' && !u.isClone && u.hp > 0 && !u.dead);
  const offsets = [
    { r: -1, c: 0 }, { r: 1, c: 0 }, { r: 0, c: -1 }, { r: 0, c: 1 },
    { r: -1, c: -1 }, { r: -1, c: 1 }, { r: 1, c: -1 }, { r: 1, c: 1 },
  ];
  for (const c of cloners) {
    if ((c.clonesSpawnedTotal ?? 0) >= 3) continue; // lifetime limit reached
    if (c.cloneTimer === undefined || c.cloneTimer <= 0) c.cloneTimer = 6;
    c.cloneTimer -= 1;
    if (c.cloneTimer > 0) continue;
    let didSpawn = false;
    for (const o of offsets) {
      const r = c.row + o.r, col = c.col + o.c;
      if (r < 0 || r >= GRID_SIZE || col < 0 || col >= GRID_SIZE) continue;
      const cell = grid[r][col];
      if (cell.unit || cell.terrain === 'water') continue;
      const clone: Unit = {
        ...c,
        id: crypto.randomUUID(),
        row: r, col,
        hp: 3,
        maxHp: 3,
        attack: 3,
        isClone: true,
        parentClonerId: c.id,
        cloneTimer: undefined,
        clonesSpawnedTotal: undefined,
        skipNextMove: false,
        cooldown: 0,
        bondedToTankId: undefined,
        movedWithTank: false,
        slotIndex: undefined,
        activationTurn: 0,
        startRow: r,
        stuckTurns: 0,
        lastAttackedId: undefined,
      };
      grid[r][col].unit = clone;
      spawned.push(clone);
      c.clonesSpawnedTotal = (c.clonesSpawnedTotal ?? 0) + 1;
      logs.push(`🧬 Kloner spawnt Klon (${c.clonesSpawnedTotal}/3)`);
      didSpawn = true;
      break;
    }
    c.cloneTimer = 6;
    if (!didSpawn) {
      // couldn't place this tick (no free adjacent cell) — try again next tick without consuming a charge
    }
  }
  allUnits.push(...spawned);
  return spawned;
}

/** Mage impulse: every 7 ticks each mage pushes ALL enemies within 7x7 (Chebyshev ≤3)
 *  outward to land at distance > 3 (or until blocked / edge). Deals no damage. */
export function tickMageImpulse(
  allUnits: Unit[],
  grid: Cell[][],
  events: BattleEvent[],
  logs: string[],
): void {
  const mages = allUnits.filter(u => u.type === 'mage' && u.hp > 0 && !u.dead);
  for (const m of mages) {
    if (m.impulseTimer === undefined || m.impulseTimer <= 0) m.impulseTimer = 7;
    m.impulseTimer -= 1;
    if (m.impulseTimer > 0) continue;
    m.impulseTimer = 7;

    // Collect enemies in 7x7 box (Chebyshev ≤3), sorted by distance descending so outer ones move first.
    const targets: Unit[] = [];
    for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = m.row + dr, c = m.col + dc;
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
      const u = grid[r][c].unit;
      if (!u || u.hp <= 0 || u.dead) continue;
      if (u.team === m.team) continue;
      targets.push(u);
    }
    targets.sort((a, b) => {
      const da = Math.max(Math.abs(a.row - m.row), Math.abs(a.col - m.col));
      const db = Math.max(Math.abs(b.row - m.row), Math.abs(b.col - m.col));
      return db - da;
    });

    const pushedIds: string[] = [];


    for (const t of targets) {
      const sr = Math.sign(t.row - m.row);
      const sc = Math.sign(t.col - m.col);
      // Push outward step-by-step until blocked, water or map edge.
      let cur = { r: t.row, c: t.col };
      while (true) {
        const nr = cur.r + sr;
        const nc = cur.c + sc;
        if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) break;
        const cell = grid[nr][nc];
        if (cell.terrain === 'water') break;
        if (cell.unit) break;
        cur = { r: nr, c: nc };
      }
      if (cur.r !== t.row || cur.c !== t.col) {
        grid[t.row][t.col].unit = null;
        t.row = cur.r; t.col = cur.c;
        grid[cur.r][cur.c].unit = t;
        pushedIds.push(t.id);
      }
    }

    // Build 7x7 ring cells for the visual impulse.
    const ringCells: { row: number; col: number }[] = [];
    for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
      const r = m.row + dr, c = m.col + dc;
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
      ringCells.push({ row: r, col: c });
    }

    events.push({
      type: 'impulse',
      attackerId: m.id,
      attackerRow: m.row,
      attackerCol: m.col,
      attackerEmoji: '🔮',
      attackerType: 'mage',
      targetId: m.id,
      targetRow: m.row,
      targetCol: m.col,
      damage: 0,
      isStrong: false,
      isWeak: false,
      isRanged: false,
      pushedIds,
    });
    logs.push(`🔮 ${m.team === 'player' ? '👤' : '💀'} Magier-Impuls!`);
  }
}

/** Frost Nova: every 7 ticks each frost mage freezes ALL enemies in 3×3 around itself
 *  for 5 ticks at 30% damage. Pure crowd control, no damage. */
export function tickFrostNova(
  allUnits: Unit[],
  grid: Cell[][],
  events: BattleEvent[],
  logs: string[],
): void {
  const frosts = allUnits.filter(u => u.type === 'frost' && u.hp > 0 && !u.dead);
  for (const f of frosts) {
    if (f.frostNovaTimer === undefined || f.frostNovaTimer <= 0) f.frostNovaTimer = 7;
    f.frostNovaTimer -= 1;
    if (f.frostNovaTimer > 0) continue;
    f.frostNovaTimer = 7;

    const aoeCells: { row: number; col: number }[] = [];
    let frozenCount = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const r = f.row + dr, c = f.col + dc;
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
      aoeCells.push({ row: r, col: c });
      if (dr === 0 && dc === 0) continue;
      const u = grid[r][c].unit;
      if (!u || u.hp <= 0 || u.dead) continue;
      if (u.team === f.team) continue;
      if (isImmuneToFreeze(u, grid)) continue;
      u.frozen = 5;
      u.frozenDmgMul = 0.3;
      frozenCount += 1;
    }

    events.push({
      type: 'frostNova',
      attackerId: f.id,
      attackerRow: f.row,
      attackerCol: f.col,
      attackerEmoji: '❄️',
      attackerType: 'frost',
      targetId: f.id,
      targetRow: f.row,
      targetCol: f.col,
      damage: 0,
      isStrong: false,
      isWeak: false,
      isRanged: false,
      aoeCells,
    });
    logs.push(`❄️ ${f.team === 'player' ? '👤' : '💀'} Frost-Nova! (${frozenCount} eingefroren)`);
  }
}

/** Rider horn: every 9 ticks each rider blasts a horn. Allies in inner 3×3
 *  AND outer 5×5 ring around the rider get a 2-tick +50% damage buff.
 *  Visual is a two-step wave: inner cells flash first, then outer ring. */
export function tickRiderHorn(
  allUnits: Unit[],
  grid: Cell[][],
  events: BattleEvent[],
  logs: string[],
): void {
  // Decrement existing horn buffs once per battle tick (applied before new buffs).
  for (const u of allUnits) {
    if ((u.hornBuff || 0) > 0) {
      u.hornBuff = (u.hornBuff || 0) - 1;
      if ((u.hornBuff || 0) <= 0) u.hornBuff = undefined;
    }
  }

  const riders = allUnits.filter(u => u.type === 'rider' && u.hp > 0 && !u.dead);
  for (const r of riders) {
    if (r.hornTimer === undefined || r.hornTimer <= 0) r.hornTimer = 9;
    r.hornTimer -= 1;
    if (r.hornTimer > 0) continue;
    r.hornTimer = 9;

    const innerCells: { row: number; col: number }[] = [];
    const outerCells: { row: number; col: number }[] = [];
    let buffed = 0;

    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const rr = r.row + dr, cc = r.col + dc;
      if (rr < 0 || rr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) continue;
      const isInner = Math.abs(dr) <= 1 && Math.abs(dc) <= 1;
      if (isInner) innerCells.push({ row: rr, col: cc });
      else outerCells.push({ row: rr, col: cc });
      const u = grid[rr][cc].unit;
      if (!u || u.hp <= 0 || u.dead) continue;
      if (u.team !== r.team) continue;
      u.hornBuff = 2;
      buffed += 1;
    }

    events.push({
      type: 'riderHorn',
      attackerId: r.id,
      attackerRow: r.row,
      attackerCol: r.col,
      attackerEmoji: '📯',
      attackerType: 'rider',
      targetId: r.id,
      targetRow: r.row,
      targetCol: r.col,
      damage: 0,
      isStrong: false,
      isWeak: false,
      isRanged: false,
      innerCells,
      outerCells,
    });
    logs.push(`📯 ${r.team === 'player' ? '👤' : '💀'} Reiter-Horn! (+50% Schaden für ${buffed} Verbündete, 2 Ticks)`);
  }
}

/** Archer volley: every 4 ticks each archer fires 8 arrows simultaneously in
 *  every orthogonal + diagonal direction with infinite range. Each arrow
 *  pierces past empty cells and allied units, then hits the first enemy it
 *  encounters for full archer damage (calcDamage). */
export function tickArcherVolley(
  allUnits: Unit[],
  grid: Cell[][],
  events: BattleEvent[],
  logs: string[],
): void {
  const dirs: { dr: number; dc: number }[] = [
    { dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
    { dr: -1, dc: -1 }, { dr: -1, dc: 1 }, { dr: 1, dc: -1 }, { dr: 1, dc: 1 },
  ];
  const archers = allUnits.filter(u => u.type === 'archer' && u.hp > 0 && !u.dead);
  for (const a of archers) {
    if (a.volleyTimer === undefined || a.volleyTimer <= 0) a.volleyTimer = 4;
    a.volleyTimer -= 1;
    if (a.volleyTimer > 0) continue;
    a.volleyTimer = 4;

    let hitCount = 0;
    for (const { dr, dc } of dirs) {
      let r = a.row + dr, c = a.col + dc;
      let target: Unit | null = null;
      let lastR = a.row, lastC = a.col;
      while (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
        lastR = r; lastC = c;
        const u = grid[r][c].unit;
        if (u && u.hp > 0 && !u.dead && u.team !== a.team && !(u.isPhantom && (u.phantom ?? 0) > 0)) {
          target = u;
          break;
        }
        r += dr; c += dc;
      }

      if (!target) {
        // No enemy in this direction: still emit a visual-only arrow flying to map edge.
        events.push({
          type: 'volleyMiss',
          attackerId: a.id,
          attackerRow: a.row,
          attackerCol: a.col,
          attackerEmoji: '🏹',
          attackerType: 'archer',
          targetId: a.id,
          targetRow: lastR,
          targetCol: lastC,
          damage: 0,
          isStrong: false,
          isWeak: false,
          isRanged: true,
        });
        continue;
      }

      const dmg = calcDamage(a, target, grid);
      target.hp = Math.max(0, target.hp - dmg);
      if (target.hp <= 0) target.dead = true;
      hitCount += 1;

      const aColor = a.color || UNIT_COLOR_GROUPS[a.type];
      const tColor = target.color || UNIT_COLOR_GROUPS[target.type];
      const isStrong = (aColor === 'red' && tColor === 'green') || (aColor === 'green' && tColor === 'blue') || (aColor === 'blue' && tColor === 'red');
      const isWeak = (tColor === 'red' && aColor === 'green') || (tColor === 'green' && aColor === 'blue') || (tColor === 'blue' && aColor === 'red');

      events.push({
        type: target.hp <= 0 ? 'kill' : 'hit',
        attackerId: a.id,
        attackerRow: a.row,
        attackerCol: a.col,
        attackerEmoji: '🏹',
        attackerType: 'archer',
        targetId: target.id,
        targetRow: target.row,
        targetCol: target.col,
        damage: dmg,
        isStrong,
        isWeak,
        isRanged: true,
      });
    }
    logs.push(`🏹 ${a.team === 'player' ? '👤' : '💀'} Pfeilsalve! (${hitCount}/8 getroffen)`);
  }
}

/** Dragon fire-spin: every 10 ticks, the dragon freezes in place and performs
 *  an 8-tick rotation, spitting a 3-cell fire beam in one of 8 directions per
 *  tick. Enemies hit are set on fire for 8 ticks (5 dmg/tick). The starting
 *  direction targets the nearest enemy; rotation direction is random per spin. */
const DRAGON_SPIN_DIRS: { dr: number; dc: number }[] = [
  { dr: -1, dc:  0 }, // 0: up
  { dr: -1, dc:  1 }, // 1: up-right
  { dr:  0, dc:  1 }, // 2: right
  { dr:  1, dc:  1 }, // 3: down-right
  { dr:  1, dc:  0 }, // 4: down
  { dr:  1, dc: -1 }, // 5: down-left
  { dr:  0, dc: -1 }, // 6: left
  { dr: -1, dc: -1 }, // 7: up-left
];

function dragonDirIdxToward(dr: number, dc: number): number {
  // pick the DRAGON_SPIN_DIRS entry whose unit vector best matches (dr,dc)
  const len = Math.hypot(dr, dc) || 1;
  const ux = dr / len, uy = dc / len;
  let best = 0, bestDot = -Infinity;
  for (let i = 0; i < 8; i++) {
    const d = DRAGON_SPIN_DIRS[i];
    const dl = Math.hypot(d.dr, d.dc);
    const dot = (d.dr / dl) * ux + (d.dc / dl) * uy;
    if (dot > bestDot) { bestDot = dot; best = i; }
  }
  return best;
}

function fireDragonBeam(
  dragon: Unit,
  dirIdx: number,
  allUnits: Unit[],
  grid: Cell[][],
  events: BattleEvent[],
  logs: string[],
  beamOrder: number = 0,
): void {
  const { dr, dc } = DRAGON_SPIN_DIRS[dirIdx];
  const cells: { row: number; col: number }[] = [];
  for (let step = 1; step <= 3; step++) {
    const r = dragon.row + dr * step;
    const c = dragon.col + dc * step;
    if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) break;
    cells.push({ row: r, col: c });
  }
  if (cells.length === 0) return;

  let hits = 0;
  for (const cell of cells) {
    const u = grid[cell.row][cell.col].unit;
    if (!u || u.hp <= 0 || u.dead) continue;
    if (u.team === dragon.team) continue;
    if (isImmuneToFire(u, grid)) continue;
    u.burning = [...(u.burning || []), { dmg: 5, turns: 8 }];
    hits += 1;
  }

  events.push({
    type: 'dragonSpin',
    attackerId: dragon.id,
    attackerRow: dragon.row,
    attackerCol: dragon.col,
    attackerEmoji: '🔥',
    attackerType: 'dragon',
    targetId: dragon.id,
    targetRow: cells[cells.length - 1].row,
    targetCol: cells[cells.length - 1].col,
    damage: 0,
    isStrong: false,
    isWeak: false,
    isRanged: false,
    spinCells: cells,
    spinDirIdx: dirIdx,
    spinBeamOrder: beamOrder,
  });

  if (hits > 0) {
    logs.push(`🔥 ${dragon.team === 'player' ? '👤' : '💀'} Drachen-Feuerwirbel entzündet ${hits} Gegner!`);
  }
}

export function tickDragonSpin(
  allUnits: Unit[],
  grid: Cell[][],
  events: BattleEvent[],
  logs: string[],
): void {
  const BEAMS_PER_TICK = 4; // 8 directions over 2 ticks = whip swing
  const dragons = allUnits.filter(u => u.type === 'dragon' && u.hp > 0 && !u.dead);
  for (const d of dragons) {
    // Continuing an active spin: fire BEAMS_PER_TICK beams this tick.
    if ((d.spinTicksLeft ?? 0) > 0) {
      for (let i = 0; i < BEAMS_PER_TICK; i++) {
        const idx = d.spinDirIdx ?? 0;
        fireDragonBeam(d, idx, allUnits, grid, events, logs, i);
        d.spinDirIdx = ((idx + (d.spinClockwise ? 1 : -1)) + 8) % 8;
      }
      d.spinTicksLeft = (d.spinTicksLeft ?? 0) - 1;
      if ((d.spinTicksLeft ?? 0) <= 0) {
        d.spinTicksLeft = undefined;
        d.spinClockwise = undefined;
        d.spinDirIdx = undefined;
        d.spinTimer = 10;
      }
      continue;
    }

    // Not spinning: count down cooldown, then trigger.
    if (d.spinTimer === undefined || d.spinTimer <= 0) d.spinTimer = 10;
    d.spinTimer -= 1;
    if (d.spinTimer > 0) continue;

    // Pick start direction toward nearest enemy (fallback: random)
    const enemies = allUnits.filter(u => u.team !== d.team && u.hp > 0 && !u.dead);
    let startIdx = Math.floor(Math.random() * 8);
    if (enemies.length > 0) {
      let nearest = enemies[0];
      let bestDist = Math.abs(nearest.row - d.row) + Math.abs(nearest.col - d.col);
      for (const e of enemies) {
        const dist = Math.abs(e.row - d.row) + Math.abs(e.col - d.col);
        if (dist < bestDist) { bestDist = dist; nearest = e; }
      }
      startIdx = dragonDirIdxToward(nearest.row - d.row, nearest.col - d.col);
    }
    d.spinClockwise = Math.random() < 0.5;
    d.spinDirIdx = startIdx;
    d.spinTicksLeft = 2;
    logs.push(`🐉 ${d.team === 'player' ? '👤' : '💀'} Drache schwingt Feuerpeitsche!`);

    // Fire first batch of BEAMS_PER_TICK beams immediately this tick.
    for (let i = 0; i < BEAMS_PER_TICK; i++) {
      const idx = d.spinDirIdx ?? 0;
      fireDragonBeam(d, idx, allUnits, grid, events, logs, i);
      d.spinDirIdx = ((idx + (d.spinClockwise ? 1 : -1)) + 8) % 8;
    }
    d.spinTicksLeft -= 1;
  }
}




/** Shadowblade per-tick behavior:
 *  - keeps maximum distance from enemies via diagonal jumps,
 *  - every 5 ticks teleports adjacent to chosen enemy and attacks,
 *  - next tick teleports back to its previous home position. */
export function handleShadowbladeTick(
  unit: Unit,
  allUnits: Unit[],
  grid: Cell[][],
  events: BattleEvent[],
  logs: string[],
  dmgMod: (attacker: Unit, target: Unit, dmg: number) => number,
): void {
  if (unit.hp <= 0 || unit.dead) return;
  unit.cooldown = Math.max(0, unit.cooldown - 1);

  const enemies = allUnits.filter(e => e.team !== unit.team && e.hp > 0 && !e.dead && !(e.isPhantom && (e.phantom ?? 0) > 0));
  if (enemies.length === 0) return;

  const teleportFrom = { row: unit.row, col: unit.col };
  const emitTeleport = (from: { row: number; col: number }, to: { row: number; col: number }) => {
    events.push({
      type: 'teleport',
      attackerId: unit.id,
      attackerRow: from.row, attackerCol: from.col,
      attackerEmoji: '🥷', attackerType: 'shadowblade',
      targetId: unit.id, targetRow: to.row, targetCol: to.col,
      damage: 0, isStrong: false, isWeak: false, isRanged: false,
    });
  };

  // --- Return phase ---
  if (unit.pendingTeleportReturn) {
    const hr = unit.homeRow, hc = unit.homeCol;
    let dest: { row: number; col: number } | null = null;
    if (hr !== undefined && hc !== undefined && hr >= 0 && hr < GRID_SIZE && hc >= 0 && hc < GRID_SIZE) {
      const cell = grid[hr][hc];
      if (!cell.unit && cell.terrain !== 'water') dest = { row: hr, col: hc };
    }
    if (!dest) {
      // pick free cell that maximizes distance from enemies (any cell on board)
      let best: { row: number; col: number; score: number } | null = null;
      for (let r = 0; r < GRID_SIZE; r++) for (let c = 0; c < GRID_SIZE; c++) {
        const cell = grid[r][c];
        if (cell.unit || cell.terrain === 'water') continue;
        let minD = Infinity;
        for (const e of enemies) {
          const d = Math.max(Math.abs(r - e.row), Math.abs(c - e.col));
          if (d < minD) minD = d;
        }
        if (!best || minD > best.score) best = { row: r, col: c, score: minD };
      }
      if (best) dest = { row: best.row, col: best.col };
    }
    if (dest) {
      grid[unit.row][unit.col].unit = null;
      unit.row = dest.row; unit.col = dest.col;
      grid[dest.row][dest.col].unit = unit;
      emitTeleport(teleportFrom, dest);
      logs.push(`🥷 Schattenklinge teleportiert zurück`);
    }
    unit.pendingTeleportReturn = false;
    unit.homeRow = undefined;
    unit.homeCol = undefined;
    unit.teleportTimer = 5;
    return;
  }

  // --- Strike phase (teleport in + attack) ---
  if (unit.teleportTimer === undefined) unit.teleportTimer = 5;
  if (unit.teleportTimer <= 0) {
    // Pick target: lowest HP enemy first (finish off), tiebreak by closest
    const ranked = [...enemies].sort((a, b) => {
      if (a.hp !== b.hp) return a.hp - b.hp;
      const da = Math.max(Math.abs(a.row - unit.row), Math.abs(a.col - unit.col));
      const db = Math.max(Math.abs(b.row - unit.row), Math.abs(b.col - unit.col));
      return da - db;
    });
    const offsets = [
      { r: -1, c: -1 }, { r: -1, c: 1 }, { r: 1, c: -1 }, { r: 1, c: 1 },
      { r: -1, c: 0 }, { r: 1, c: 0 }, { r: 0, c: -1 }, { r: 0, c: 1 },
    ];
    for (const t of ranked) {
      let dest: { row: number; col: number } | null = null;
      for (const o of offsets) {
        const r = t.row + o.r, c = t.col + o.c;
        if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
        const cell = grid[r][c];
        if (cell.unit || cell.terrain === 'water') continue;
        dest = { row: r, col: c };
        break;
      }
      if (!dest) continue;
      // Teleport in
      unit.homeRow = teleportFrom.row;
      unit.homeCol = teleportFrom.col;
      grid[unit.row][unit.col].unit = null;
      unit.row = dest.row; unit.col = dest.col;
      grid[dest.row][dest.col].unit = unit;
      emitTeleport(teleportFrom, dest);
      // Strike
      let dmg = calcDamage(unit, t, grid);
      dmg = dmgMod(unit, t, dmg);
      t.hp = Math.max(0, t.hp - dmg);
      unit.lastAttackedId = t.id;
      const tDef = UNIT_DEFS[t.type];
      logs.push(`🥷 ${unit.team === 'player' ? '👤' : '💀'} Schattenklinge → ${tDef.emoji} ${dmg}${t.hp <= 0 ? ' ☠️' : ''}`);
      events.push({
        type: t.hp <= 0 ? 'kill' : 'hit',
        attackerId: unit.id,
        attackerRow: unit.row, attackerCol: unit.col,
        attackerEmoji: '🥷', attackerType: 'shadowblade',
        targetId: t.id, targetRow: t.row, targetCol: t.col,
        damage: dmg, isStrong: false, isWeak: false,
        isRanged: false,
      });
      if (t.hp <= 0) (t as any).dead = true;
      unit.pendingTeleportReturn = true;
      unit.teleportTimer = 0; // stays 0 so next tick triggers return
      return;
    }
    // No target reachable; try again next tick
  } else {
    unit.teleportTimer -= 1;
  }

  // --- Kiting movement: maximize distance from nearest enemy ---
  const moveOffsets = [...DIAGONAL, { row: -2, col: -2 }, { row: -2, col: 2 }, { row: 2, col: -2 }, { row: 2, col: 2 }];
  const currentMinDist = enemies.reduce((m, e) => {
    const d = Math.max(Math.abs(unit.row - e.row), Math.abs(unit.col - e.col));
    return Math.min(m, d);
  }, Infinity);
  let bestMove: { row: number; col: number; score: number } | null = null;
  for (const o of moveOffsets) {
    const r = unit.row + o.row, c = unit.col + o.col;
    if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
    const cell = grid[r][c];
    if (cell.unit || cell.terrain === 'water') continue;
    let minD = Infinity;
    for (const e of enemies) {
      const d = Math.max(Math.abs(r - e.row), Math.abs(c - e.col));
      if (d < minD) minD = d;
    }
    if (!bestMove || minD > bestMove.score) bestMove = { row: r, col: c, score: minD };
  }
  if (bestMove && bestMove.score > currentMinDist) {
    grid[unit.row][unit.col].unit = null;
    unit.row = bestMove.row; unit.col = bestMove.col;
    grid[bestMove.row][bestMove.col].unit = unit;
  }
}




/** Spawn a phantom duplicate next to each unspawned doppelganger.
 *  Phantom is invulnerable for 5 ticks, then disappears. */
export function spawnDoppelgangerPhantoms(allUnits: Unit[], grid: Cell[][], logs: string[]): Unit[] {
  const spawned: Unit[] = [];
  const originals = allUnits.filter(u =>
    u.type === 'doppelganger' && !u.isPhantom && !u.doppelSpawned && u.hp > 0 && !u.dead
  );
  for (const orig of originals) {
    const offsets = [
      { r: -1, c: 0 }, { r: 1, c: 0 }, { r: 0, c: -1 }, { r: 0, c: 1 },
      { r: -1, c: -1 }, { r: -1, c: 1 }, { r: 1, c: -1 }, { r: 1, c: 1 },
    ];
    for (const o of offsets) {
      const r = orig.row + o.r, c = orig.col + o.c;
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
      const cell = grid[r][c];
      if (cell.unit || cell.terrain === 'water') continue;
      const phantom: Unit = {
        ...orig,
        id: crypto.randomUUID(),
        row: r, col: c,
        isPhantom: true,
        phantom: 5,
        doppelSpawned: true,
        cooldown: 0,
        bondedToTankId: undefined,
        movedWithTank: false,
        slotIndex: undefined,
      };
      grid[r][c].unit = phantom;
      spawned.push(phantom);
      orig.doppelSpawned = true;
      logs.push(`👥 Doppelgänger spawnt Phantom (5 Ticks unverwundbar)`);
      break;
    }
    orig.doppelSpawned = true;
  }
  allUnits.push(...spawned);
  return spawned;
}

/** Tick down phantom invulnerability timers. Phantom vanishes when timer hits 0. */
export function tickPhantomTimers(allUnits: Unit[], grid: Cell[][], logs: string[]): void {
  for (const u of allUnits) {
    if (!u.isPhantom || u.phantom === undefined || u.dead) continue;
    u.phantom -= 1;
    if (u.phantom <= 0) {
      u.hp = 0;
      (u as any).dead = true;
      if (grid[u.row]?.[u.col]?.unit?.id === u.id) {
        grid[u.row][u.col].unit = null;
      }
      logs.push(`👥 Phantom verblasst`);
    }
  }
}

/** Chaindancer chain attack: jumps DIAGONALLY through up to 2 additional enemies
 *  (3 enemies total counting the primary). Each chain hop deals 70% of original damage. */
export function applyChainAttack(
  attacker: Unit, primaryTarget: Unit, primaryDmg: number,
  grid: Cell[][], logs: string[]
): { row: number; col: number }[] {
  const chainCells: { row: number; col: number }[] = [
    { row: primaryTarget.row, col: primaryTarget.col }
  ];
  const visited = new Set<string>([primaryTarget.id]);
  let current = primaryTarget;
  const hopDmg = Math.round(primaryDmg * 0.7);
  const diag = [
    { r: -1, c: -1 }, { r: -1, c: 1 }, { r: 1, c: -1 }, { r: 1, c: 1 },
    { r: -2, c: -2 }, { r: -2, c: 2 }, { r: 2, c: -2 }, { r: 2, c: 2 },
  ];
  for (let hop = 0; hop < 2; hop++) {
    let next: Unit | null = null;
    let bestDist = Infinity;
    for (const o of diag) {
      const r = current.row + o.r, c = current.col + o.c;
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
      const cu = grid[r][c].unit;
      if (!cu || cu.team === attacker.team || cu.hp <= 0 || cu.dead) continue;
      if (visited.has(cu.id)) continue;
      if (cu.isPhantom && (cu.phantom ?? 0) > 0) continue;
      const d = Math.abs(o.r) + Math.abs(o.c);
      if (d < bestDist) { bestDist = d; next = cu; }
    }
    if (!next) break;
    next.hp = Math.max(0, next.hp - hopDmg);
    if (next.hp <= 0) (next as any).dead = true;
    visited.add(next.id);
    chainCells.push({ row: next.row, col: next.col });
    logs.push(`🪢 Kettentänzer → ${UNIT_DEFS[next.type].emoji} ${hopDmg} (Kette)`);
    current = next;
  }
  return chainCells;
}


