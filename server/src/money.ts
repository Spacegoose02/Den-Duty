// Allowance and money jars. Parents turn points into money (at a rate they pick), and money lands in three jars:
// Spend, Save and Give, split by the home's percentages. A weekly allowance and monthly interest on the Save jar
// pay in by themselves. Like points, money is an append-only ledger: balances are sums, mistakes get a new row.
import type { DatabaseSync } from 'node:sqlite';
import { tx, type Row } from './db.ts';
import { HttpError } from './util.ts';
import { balance, writeLedger, type By } from './chores.ts';
import { addDays, dateRange, weekdayOf } from '../../shared/schedule.ts';

export const JARS = ['spend', 'save', 'give'] as const;
export type Jar = (typeof JARS)[number];
export type JarSplit = Record<Jar, number>;
export type Jars = Record<Jar, number>;
export const isJar = (v: unknown): v is Jar => JARS.includes(v as Jar);
export type MoneyKind = 'cashout' | 'allowance' | 'interest' | 'withdraw' | 'deposit' | 'move';

export interface MoneySettings {
  enabled: boolean;
  symbol: string;
  /** What one point is worth, in cents. */
  centsPerPoint: number;
  split: JarSplit;
  /** Monthly interest on the Save jar, in tenths of a percent (5 = 0.5% a month). */
  interest: number;
}

export function moneySettings(db: DatabaseSync, homeId: string): MoneySettings {
  const h = db.prepare('SELECT money_enabled, money_symbol, cents_per_point, jar_split, save_interest FROM homes WHERE id = ?').get(homeId) as Row;
  return { enabled: !!h.money_enabled, symbol: h.money_symbol as string, centsPerPoint: h.cents_per_point as number, split: cleanSplit(JSON.parse(h.jar_split as string)), interest: h.save_interest as number };
}

/** Percentages for the three jars: whole numbers that add up to 100. */
export function cleanSplit(v: unknown): JarSplit {
  const o = (v ?? {}) as Record<string, unknown>;
  const s = { spend: Number(o.spend), save: Number(o.save), give: Number(o.give) };
  if (JARS.some((j) => !Number.isInteger(s[j]) || s[j] < 0 || s[j] > 100) || s.spend + s.save + s.give !== 100) {
    throw new HttpError(400, 'Jar percentages are whole numbers that add up to 100');
  }
  return s;
}

/** Splits cents across the jars. Save and Give round down; Spend gets the rest, so nothing is lost. */
export function splitCents(cents: number, split: JarSplit): Jars {
  const save = Math.floor((cents * split.save) / 100);
  const give = Math.floor((cents * split.give) / 100);
  return { spend: cents - save - give, save, give };
}

export function money(cents: number, symbol: string): string {
  const sign = cents < 0 ? '−' : '';
  return `${sign}${symbol}${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function jars(db: DatabaseSync, memberId: string): Jars {
  const out: Jars = { spend: 0, save: 0, give: 0 };
  for (const r of db.prepare('SELECT jar, SUM(cents) AS n FROM money_ledger WHERE member_id = ? GROUP BY jar').all(memberId) as Row[]) out[r.jar as Jar] = Number(r.n);
  return out;
}

export function moneyHistory(db: DatabaseSync, memberId: string, limit = 30) {
  return (db.prepare('SELECT * FROM money_ledger WHERE member_id = ? ORDER BY id DESC LIMIT ?').all(memberId, limit) as Row[]).map((r) => ({
    id: r.id as number, jar: r.jar as Jar, cents: r.cents as number, kind: r.kind as MoneyKind, reason: r.reason as string,
    date: r.date as string, by: (r.by_name as string | null) ?? null, createdAt: r.created_at as string,
  }));
}

function write(db: DatabaseSync, e: { homeId: string; memberId: string; jar: Jar; cents: number; kind: MoneyKind; reason: string; date: string; by: string | null }): void {
  if (!e.cents) return;
  db.prepare('INSERT INTO money_ledger (home_id, member_id, jar, cents, kind, reason, date, by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(e.homeId, e.memberId, e.jar, e.cents, e.kind, e.reason, e.date, e.by);
}

/** Money into the jars: one jar, or split by the home's percentages. */
function payIn(db: DatabaseSync, homeId: string, memberId: string, cents: number, kind: MoneyKind, reason: string, date: string, by: string | null, jar?: Jar): Jars {
  const split = jar ? { spend: 0, save: 0, give: 0, [jar]: cents } as Jars : splitCents(cents, moneySettings(db, homeId).split);
  for (const j of JARS) write(db, { homeId, memberId, jar: j, cents: split[j], kind, reason, date, by });
  return split;
}

function requireOn(db: DatabaseSync, homeId: string): MoneySettings {
  const s = moneySettings(db, homeId);
  if (!s.enabled) throw new HttpError(400, 'Turn on Allowance & jars in Settings first');
  return s;
}

function cleanCents(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 10_000_00) throw new HttpError(400, 'Amounts are whole cents, more than 0');
  return n;
}

/** Points become money: the points are spent (like buying a reward) and the money is split into the jars. */
export function cashOut(db: DatabaseSync, homeId: string, memberId: string, points: number, by: By, today: string): { points: number; cents: number; jars: Jars } {
  const s = requireOn(db, homeId);
  if (!Number.isInteger(points) || points <= 0) throw new HttpError(400, 'Cash out a whole number of points, at least 1');
  return tx(db, () => {
    if (balance(db, memberId) < points) throw new HttpError(400, 'Not enough points for that');
    const cents = points * s.centsPerPoint;
    if (!cents) throw new HttpError(400, 'Points are worth nothing yet: set what a point is worth');
    writeLedger(db, { homeId, memberId, amount: -points, kind: 'redeem', reason: `Cashed out: ${money(cents, s.symbol)}`, date: today, by });
    payIn(db, homeId, memberId, cents, 'cashout', `${points} points cashed out`, today, by.name);
    return { points, cents, jars: jars(db, memberId) };
  });
}

/** Money given straight to a kid (birthday money, a chore paid in cash), into one jar or split. */
export function deposit(db: DatabaseSync, homeId: string, memberId: string, centsIn: unknown, reason: string, by: By, today: string, jar?: Jar): Jars {
  requireOn(db, homeId);
  const cents = cleanCents(centsIn);
  return tx(db, () => { payIn(db, homeId, memberId, cents, 'deposit', reason, today, by.name, jar); return jars(db, memberId); });
}

/** Money taken out of a jar: spent, saved up for something, or given away. Never below zero. */
export function withdraw(db: DatabaseSync, homeId: string, memberId: string, jar: Jar, centsIn: unknown, reason: string, by: By, today: string): Jars {
  const s = requireOn(db, homeId);
  const cents = cleanCents(centsIn);
  return tx(db, () => {
    const have = jars(db, memberId)[jar];
    if (have < cents) throw new HttpError(400, `There's only ${money(have, s.symbol)} in that jar`);
    write(db, { homeId, memberId, jar, cents: -cents, kind: 'withdraw', reason, date: today, by: by.name });
    return jars(db, memberId);
  });
}

export function moveMoney(db: DatabaseSync, homeId: string, memberId: string, from: Jar, to: Jar, centsIn: unknown, by: By, today: string): Jars {
  const s = requireOn(db, homeId);
  const cents = cleanCents(centsIn);
  if (from === to) throw new HttpError(400, 'Pick two different jars');
  return tx(db, () => {
    const have = jars(db, memberId)[from];
    if (have < cents) throw new HttpError(400, `There's only ${money(have, s.symbol)} in that jar`);
    write(db, { homeId, memberId, jar: from, cents: -cents, kind: 'move', reason: `Moved to ${to}`, date: today, by: by.name });
    write(db, { homeId, memberId, jar: to, cents, kind: 'move', reason: `Moved from ${from}`, date: today, by: by.name });
    return jars(db, memberId);
  });
}

/** Marks a period as already handled; true the first time only. */
function claimRun(db: DatabaseSync, memberId: string, kind: string, period: string): boolean {
  return Number(db.prepare('INSERT OR IGNORE INTO money_runs (member_id, kind, period) VALUES (?, ?, ?)').run(memberId, kind, period).changes) > 0;
}

/** Skips interest for this month (so turning interest on mid-month doesn't pay a whole month straight away). */
export function skipInterestThisMonth(db: DatabaseSync, homeId: string, today: string): void {
  for (const k of db.prepare("SELECT id FROM members WHERE home_id = ? AND role = 'kid'").all(homeId) as Row[]) claimRun(db, k.id as string, 'interest', today.slice(0, 7));
}

/**
 * Pays what's due: each kid's weekly allowance on their day (catching up on the last week if the server was off),
 * and once a month, interest on the Save jar. Safe to call as often as you like.
 */
export function runMoney(db: DatabaseSync, homeId: string, today: string): void {
  const s = moneySettings(db, homeId);
  if (!s.enabled) return;
  const kids = db.prepare("SELECT id, allowance_cents, allowance_day, allowance_since FROM members WHERE home_id = ? AND role = 'kid'").all(homeId) as Row[];
  tx(db, () => {
    for (const k of kids) {
      const id = k.id as string;
      const cents = k.allowance_cents as number;
      const since = (k.allowance_since as string | null) ?? today;
      if (cents > 0) {
        const from = addDays(today, -6) > since ? addDays(today, -6) : since;
        for (const d of dateRange(from, today)) {
          if (weekdayOf(d) === k.allowance_day && claimRun(db, id, 'allowance', d)) payIn(db, homeId, id, cents, 'allowance', 'Weekly allowance', d, null);
        }
      }
      if (s.interest > 0 && claimRun(db, id, 'interest', today.slice(0, 7))) {
        const save = jars(db, id).save;
        const earned = Math.round((save * s.interest) / 1000);
        if (earned > 0) write(db, { homeId, memberId: id, jar: 'save', cents: earned, kind: 'interest', reason: `Interest: ${s.interest / 10}% for saving`, date: today, by: null });
      }
    }
  });
}

/** A kid's money for their board: the jars and the last few changes. */
export function kidMoney(db: DatabaseSync, homeId: string, memberId: string) {
  const s = moneySettings(db, homeId);
  if (!s.enabled) return null;
  const j = jars(db, memberId);
  const k = db.prepare('SELECT allowance_cents, allowance_day FROM members WHERE id = ?').get(memberId) as Row;
  return {
    symbol: s.symbol, centsPerPoint: s.centsPerPoint, interest: s.interest, jars: j, total: j.spend + j.save + j.give,
    allowanceCents: k.allowance_cents as number, allowanceDay: k.allowance_day as number, recent: moneyHistory(db, memberId, 6),
  };
}
