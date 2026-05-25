// Formation system: 8-connected groups of same-team units that move together.
import type { Unit, Cell } from '@/lib/battleGame';
import { GRID_SIZE } from '@/lib/battleGame';

const NEIGHBORS_8: Array<[number, number]> = [
  [-1,-1],[-1,0],[-1,1],
  [ 0,-1],       [ 0,1],
  [ 1,-1],[ 1,0],[ 1,1],
];

export function findFormations(units: Unit[], team: 'player' | 'enemy'): Unit[][] {
  const alive = units.filter(u => u.team === team && u.hp > 0 && !u.dead);
  const byKey = new Map<string, Unit>();
  for (const u of alive) byKey.set(`${u.row}-${u.col}`, u);
  const visited = new Set<string>();
  const groups: Unit[][] = [];
  for (const u of alive) {
    const k = `${u.row}-${u.col}`;
    if (visited.has(k)) continue;
    const queue: Unit[] = [u];
    visited.add(k);
    const group: Unit[] = [];
    while (queue.length) {
      const cur = queue.shift()!;
      group.push(cur);
      for (const [dr, dc] of NEIGHBORS_8) {
        const nk = `${cur.row + dr}-${cur.col + dc}`;
        if (visited.has(nk)) continue;
        const n = byKey.get(nk);
        if (!n) continue;
        visited.add(nk);
        queue.push(n);
      }
    }
    groups.push(group);
  }
  return groups;
}

export function findFormationContaining(units: Unit[], unitId: string): Unit[] | null {
  const u = units.find(x => x.id === unitId);
  if (!u) return null;
  for (const g of findFormations(units, u.team)) {
    if (g.some(x => x.id === unitId)) return g;
  }
  return null;
}

/** Check whether a formation can shift by (dr,dc) on the grid (no out-of-bounds, no collision with non-formation units, no water). */
export function canMoveFormation(formation: Unit[], dr: number, dc: number, grid: Cell[][]): boolean {
  if (formation.length === 0) return false;
  const ids = new Set(formation.map(u => u.id));
  for (const u of formation) {
    const r = u.row + dr;
    const c = u.col + dc;
    if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) return false;
    const cell = grid[r]?.[c];
    if (!cell) return false;
    if (cell.terrain === 'water') return false;
    const occ = cell.unit;
    if (occ && !ids.has(occ.id)) return false;
  }
  return true;
}

/** Apply a formation shift to the grid in-place. Caller is responsible for mapping `formation` to
 *  the same unit objects referenced inside `grid`. Returns true on success. */
export function applyFormationMove(formation: Unit[], dr: number, dc: number, grid: Cell[][]): boolean {
  if (!canMoveFormation(formation, dr, dc, grid)) return false;
  // Lift all formation units off the grid first
  for (const u of formation) {
    if (grid[u.row]?.[u.col]?.unit?.id === u.id) {
      grid[u.row][u.col].unit = null;
    }
  }
  // Then place at new positions
  for (const u of formation) {
    u.row += dr;
    u.col += dc;
    grid[u.row][u.col].unit = u;
  }
  return true;
}
