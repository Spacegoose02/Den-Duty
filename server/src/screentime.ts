// Screen-time bank: minutes in, minutes out. Kids earn minutes when chores are approved (if the home turns that on),
// swap points for minutes, or get them from a parent; they spend them in timed sessions. Its own append-only ledger in
// minutes (screen_ledger), so the points ledger and levels are untouched by spending.
// Sessions emit screen_time_started / screen_time_ended for Home Assistant (turn the TV or console on and off).
import type { DatabaseSync } from 'node:sqlite';
import type { Row } from './db.ts';
import { parseJson } from './util.ts';
import { emit } from './events.ts';
import { notify } from './push.ts';

export interface ScreenSettings {
  on: boolean;
  /** Minutes earned per point of an approved chore (0 = chores don't earn minutes). */
  perChorePoint: number;
  /** Minutes a kid gets for each point they swap (0 = no swapping). */
  perPoint: number;
  /** Most minutes a kid can use in a day (0 = no limit). */
  dailyMax: number;
  /** Most minutes a kid can keep in the bank (0 = no limit). */
  bankMax: number;
}
export const SCREEN_DEFAULTS: ScreenSettings = { on: false, perChorePoint: 5, perPoint: 3, dailyMax: 120, bankMax: 300 };

export function screenSettings(db: DatabaseSync, homeId: string): ScreenSettings {
  const r = db.prepare('SELECT screen_time FROM homes WHERE id = ?').get(homeId) as Row | undefined;
  return { ...SCREEN_DEFAULTS, ...parseJson<Partial<ScreenSettings>>(r?.screen_time, {}) };
}

export function screenBalance(db: DatabaseSync, memberId: string): number {
  return (db.prepare('SELECT COALESCE(SUM(minutes), 0) AS n FROM screen_ledger WHERE member_id = ?').get(memberId) as Row).n as number;
}

export function usedOn(db: DatabaseSync, memberId: string, date: string): number {
  return -((db.prepare("SELECT COALESCE(SUM(minutes), 0) AS n FROM screen_ledger WHERE member_id = ? AND date = ? AND kind IN ('use', 'refund')").get(memberId, date) as Row).n as number);
}

export interface ScreenRow { homeId: string; memberId: string; minutes: number; kind: string; reason: string; date: string; instanceId?: string | null; sessionId?: string | null; by?: string | null }
export function writeScreen(db: DatabaseSync, r: ScreenRow): void {
  if (!r.minutes) return;
  db.prepare('INSERT INTO screen_ledger (home_id, member_id, minutes, kind, reason, date, instance_id, session_id, by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(r.homeId, r.memberId, r.minutes, r.kind, r.reason, r.date, r.instanceId ?? null, r.sessionId ?? null, r.by ?? null);
}

/** Room left in the bank (bankMax). */
export function bankRoom(db: DatabaseSync, homeId: string, memberId: string): number {
  const s = screenSettings(db, homeId);
  return s.bankMax ? Math.max(s.bankMax - screenBalance(db, memberId), 0) : Infinity;
}

/** Called when a chore is approved: points × perChorePoint minutes, up to the bank's limit. */
export function earnScreenTime(db: DatabaseSync, homeId: string, memberId: string, points: number, title: string, date: string, instanceId: string): void {
  const s = screenSettings(db, homeId);
  if (!s.on || !s.perChorePoint || points <= 0) return;
  const minutes = Math.min(points * s.perChorePoint, bankRoom(db, homeId, memberId));
  writeScreen(db, { homeId, memberId, minutes, kind: 'earn', reason: title, date, instanceId });
}

/** Called when an approval is undone: takes back what that chore earned (not below zero). */
export function reverseScreenTime(db: DatabaseSync, homeId: string, instanceId: string, date: string): void {
  const rows = db.prepare('SELECT member_id, SUM(minutes) AS n FROM screen_ledger WHERE instance_id = ? GROUP BY member_id').all(instanceId) as Row[];
  for (const r of rows) {
    const back = Math.min(r.n as number, Math.max(screenBalance(db, r.member_id as string), 0));
    if (back > 0) writeScreen(db, { homeId, memberId: r.member_id as string, minutes: -back, kind: 'reversal', reason: 'Approval undone', date, instanceId });
  }
}

export function activeSession(db: DatabaseSync, memberId: string): Row | undefined {
  return db.prepare('SELECT * FROM screen_sessions WHERE member_id = ? AND ended_at IS NULL').get(memberId) as Row | undefined;
}

/** Ends a session: refunds whole minutes not used, and tells Home Assistant. */
export function endSession(db: DatabaseSync, s: Row, reason: 'time_up' | 'stopped' | 'parent', date: string): void {
  const now = Date.now();
  const ends = Date.parse(`${s.ends_at}Z`);
  const left = reason === 'time_up' ? 0 : Math.max(Math.floor((ends - now) / 60e3), 0);
  db.prepare("UPDATE screen_sessions SET ended_at = datetime('now'), end_reason = ? WHERE id = ?").run(reason, s.id as string);
  if (left > 0) writeScreen(db, { homeId: s.home_id as string, memberId: s.member_id as string, minutes: left, kind: 'refund', reason: 'Stopped early', date, sessionId: s.id as string });
  emit(db, s.home_id as string, 'screen_time_ended', s.member_id as string, {
    session_id: s.id, minutes: s.minutes, used: (s.minutes as number) - left, reason, balance: screenBalance(db, s.member_id as string),
  });
}

/** The minute timer: ends sessions whose time is up. Returns how many ended. */
export function endFinishedSessions(db: DatabaseSync, today: (homeId: string) => string): number {
  const due = db.prepare("SELECT s.*, m.name FROM screen_sessions s JOIN members m ON m.id = s.member_id WHERE s.ended_at IS NULL AND s.ends_at <= datetime('now')").all() as Row[];
  for (const s of due) {
    endSession(db, s, 'time_up', today(s.home_id as string));
    notify(db, s.home_id as string, 'all', { title: `📺 ${s.name}'s screen time is up`, body: `${s.minutes} minutes done`, url: '/', tag: `screen-${s.member_id}` });
  }
  return due.length;
}
