// Records every match (singleplayer & multiplayer) for later AI-driven analysis.
// Persists to Supabase when online, falls back to localStorage on mobile/offline.
import { supabase } from '@/integrations/supabase/client';
import type { BattleEvent } from '@/lib/battleEvents';
import type { Unit, UnitType, ColorGroup, Cell } from '@/lib/battleGame';

const LOCAL_PENDING_KEY = 'match_records_pending_v1';
const LOCAL_CLIENT_ID_KEY = 'match_records_client_id_v1';

export type MatchMode = 'singleplayer' | 'multiplayer';
export type MatchWinner = 'player1' | 'player2' | 'draw' | null;

export interface RosterEntry { slot: number; type: UnitType; color: ColorGroup }
export interface Placement { team: 'player1' | 'player2'; type: UnitType; color?: ColorGroup; coord: string; row: number; col: number; hp: number }
export interface RecordedEvent {
  tick: number;
  type: string;
  attackerType?: string;
  attackerTeam?: 'player1' | 'player2';
  attackerCoord?: string;
  targetType?: string;
  targetTeam?: 'player1' | 'player2';
  targetCoord?: string;
  damage?: number;
  heal?: number;
  isStrong?: boolean;
  isWeak?: boolean;
  isRanged?: boolean;
  isAoe?: boolean;
  isFrozen?: boolean;
}
export interface RoundRecord {
  round: number;
  startedAt: string;
  placements: Placement[];
  events: RecordedEvent[];
  result?: { winner?: 'player1' | 'player2' | 'draw'; player1Score: number; player2Score: number };
}
export interface MatchData {
  version: 1;
  mode: MatchMode;
  difficulty?: number;
  player1Label: string;
  player2Label: string;
  player1Roster?: RosterEntry[];
  player2Roster?: RosterEntry[];
  startedAt: string;
  endedAt?: string;
  rounds: RoundRecord[];
  winner: MatchWinner;
  finalScore: { player1: number; player2: number };
}

function getClientId(): string {
  try {
    let id = localStorage.getItem(LOCAL_CLIENT_ID_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem(LOCAL_CLIENT_ID_KEY, id);
    }
    return id;
  } catch { return 'anon'; }
}

export function coord(row: number, col: number): string {
  // Columns A-H left→right, Rows 1-8 top→bottom (chess-like)
  const letters = ['A','B','C','D','E','F','G','H'];
  return `${letters[col] ?? '?'}${row + 1}`;
}

class MatchRecorder {
  private data: MatchData | null = null;
  private tick = 0;
  private currentRound: RoundRecord | null = null;
  private seenEventKeys = new Set<string>();

  start(opts: { mode: MatchMode; difficulty?: number; player1Label: string; player2Label: string }) {
    this.data = {
      version: 1,
      mode: opts.mode,
      difficulty: opts.difficulty,
      player1Label: opts.player1Label,
      player2Label: opts.player2Label,
      startedAt: new Date().toISOString(),
      rounds: [],
      winner: null,
      finalScore: { player1: 0, player2: 0 },
    };
    this.tick = 0;
    this.currentRound = null;
    this.seenEventKeys.clear();
  }

  setRoster(team: 'player1' | 'player2', roster: UnitType[], colorOf: (slot: number) => ColorGroup) {
    if (!this.data) return;
    const entries: RosterEntry[] = roster.map((type, slot) => ({ slot, type, color: colorOf(slot) }));
    if (team === 'player1') this.data.player1Roster = entries;
    else this.data.player2Roster = entries;
  }

  startRound(round: number, units: { team: 'player1' | 'player2'; type: UnitType; color?: ColorGroup; row: number; col: number; hp: number }[]) {
    if (!this.data) return;
    this.tick = 0;
    this.seenEventKeys.clear();
    this.currentRound = {
      round,
      startedAt: new Date().toISOString(),
      placements: units.map(u => ({ ...u, coord: coord(u.row, u.col) })),
      events: [],
    };
    this.data.rounds.push(this.currentRound);
  }

  tickAdvance() { this.tick += 1; }

  addBattleEvents(
    events: BattleEvent[],
    teamOf: (id: string) => 'player1' | 'player2' | undefined,
    typeOf: (id: string) => UnitType | undefined,
  ) {
    if (!this.data || !this.currentRound) return;
    for (const e of events) {
      // Dedupe identical events (same tick can flush multiple times in React strict mode)
      const key = `${this.tick}|${e.type}|${e.attackerId}|${e.targetId}|${e.damage}|${e.targetRow},${e.targetCol}`;
      if (this.seenEventKeys.has(key)) continue;
      this.seenEventKeys.add(key);
      this.currentRound.events.push({
        tick: this.tick,
        type: e.type,
        attackerType: e.attackerType ?? typeOf(e.attackerId),
        attackerTeam: teamOf(e.attackerId),
        attackerCoord: Number.isFinite(e.attackerRow) ? coord(e.attackerRow, e.attackerCol) : undefined,
        targetType: typeOf(e.targetId),
        targetTeam: teamOf(e.targetId),
        targetCoord: Number.isFinite(e.targetRow) ? coord(e.targetRow, e.targetCol) : undefined,
        damage: e.damage || undefined,
        heal: e.healAmount,
        isStrong: e.isStrong || undefined,
        isWeak: e.isWeak || undefined,
        isRanged: e.isRanged || undefined,
        isAoe: e.isAoe || undefined,
        isFrozen: e.isFrozen || undefined,
      });
    }
  }

  endRound(p1Score: number, p2Score: number, winner?: 'player1' | 'player2' | 'draw') {
    if (!this.currentRound) return;
    this.currentRound.result = { winner, player1Score: p1Score, player2Score: p2Score };
    if (this.data) this.data.finalScore = { player1: p1Score, player2: p2Score };
  }

  async endMatch(winner: MatchWinner, finalScore?: { player1: number; player2: number }) {
    if (!this.data) return;
    this.data.endedAt = new Date().toISOString();
    this.data.winner = winner;
    if (finalScore) this.data.finalScore = finalScore;

    const payload = {
      mode: this.data.mode,
      difficulty: this.data.difficulty ?? null,
      winner,
      player1_label: this.data.player1Label,
      player2_label: this.data.player2Label,
      client_id: getClientId(),
      data: this.data as unknown as Record<string, unknown>,
    };

    const snapshot = this.data;
    this.data = null;
    this.currentRound = null;

    // Always store locally first as durability
    this.queueLocal(snapshot, payload);
    // Then try to flush all pending (including this one)
    await this.flushPending();
  }

  cancel() {
    this.data = null;
    this.currentRound = null;
  }

  private queueLocal(_snapshot: MatchData, payload: Record<string, unknown>) {
    try {
      const raw = localStorage.getItem(LOCAL_PENDING_KEY);
      const arr = raw ? (JSON.parse(raw) as Record<string, unknown>[]) : [];
      arr.push({ ...payload, _localId: Date.now() + '-' + Math.random().toString(36).slice(2) });
      localStorage.setItem(LOCAL_PENDING_KEY, JSON.stringify(arr));
    } catch (err) {
      console.warn('[matchRecorder] localStorage queue failed', err);
    }
  }

  async flushPending() {
    let arr: Record<string, unknown>[] = [];
    try {
      const raw = localStorage.getItem(LOCAL_PENDING_KEY);
      arr = raw ? JSON.parse(raw) : [];
    } catch { arr = []; }
    if (arr.length === 0) return;
    const remaining: Record<string, unknown>[] = [];
    for (const item of arr) {
      const { _localId, ...row } = item as { _localId?: string; [k: string]: unknown };
      try {
        const { error } = await supabase.from('match_records').insert(row as never);
        if (error) {
          console.warn('[matchRecorder] upload failed, keeping local', error.message);
          remaining.push(item);
        }
      } catch (err) {
        console.warn('[matchRecorder] network error, keeping local', err);
        remaining.push(item);
      }
    }
    try { localStorage.setItem(LOCAL_PENDING_KEY, JSON.stringify(remaining)); } catch { /* ignore */ }
  }
}

export const matchRecorder = new MatchRecorder();

// Helpers used by hooks
export function snapshotUnitsForRound(
  player1Units: Unit[],
  player2Units: Unit[],
  grid: Cell[][],
): { team: 'player1' | 'player2'; type: UnitType; color?: ColorGroup; row: number; col: number; hp: number }[] {
  void grid;
  const out: { team: 'player1' | 'player2'; type: UnitType; color?: ColorGroup; row: number; col: number; hp: number }[] = [];
  for (const u of player1Units) out.push({ team: 'player1', type: u.type, color: u.colorGroup, row: u.row, col: u.col, hp: u.hp });
  for (const u of player2Units) out.push({ team: 'player2', type: u.type, color: u.colorGroup, row: u.row, col: u.col, hp: u.hp });
  return out;
}

// Fetch all matches (most recent first)
export async function fetchAllMatches(limit = 2000) {
  // Make sure local-only matches are uploaded first
  try { await matchRecorder.flushPending(); } catch { /* ignore */ }
  const { data, error } = await supabase
    .from('match_records')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  // Also include any rows still pending locally (offline)
  let pending: Record<string, unknown>[] = [];
  try {
    const raw = localStorage.getItem(LOCAL_PENDING_KEY);
    pending = raw ? JSON.parse(raw) : [];
  } catch { pending = []; }
  const pendingRows = pending.map(p => ({
    id: 'local-' + Math.random().toString(36).slice(2),
    created_at: ((p.data as { startedAt?: string })?.startedAt) || new Date().toISOString(),
    ...p,
    _local: true,
  }));
  return [...pendingRows, ...(data ?? [])];
}
