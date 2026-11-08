// Two homes (see shared/away.ts): which kids are away on which days, for materializing chores and the boards.
import type { DatabaseSync } from 'node:sqlite';
import { parseJson } from './util.ts';
import type { Row } from './db.ts';
import { awayOn, backOn, type AwayPlan, type AwayRange } from '../../shared/away.ts';

export function awayOf(db: DatabaseSync, memberId: string): { plan: AwayPlan | null; ranges: AwayRange[] } {
  const m = db.prepare('SELECT away_plan FROM members WHERE id = ?').get(memberId) as Row | undefined;
  const ranges = (db.prepare('SELECT id, start_date, end_date, label FROM kid_away WHERE member_id = ? ORDER BY start_date').all(memberId) as Row[])
    .map((r) => ({ id: r.id as string, start: r.start_date as string, end: r.end_date as string, label: r.label as string | null }));
  return { plan: parseJson<AwayPlan | null>(m?.away_plan, null), ranges };
}

/** A lookup for every kid in a home: (memberId, date) → where they are, or null when they're here. */
export function awayLookup(db: DatabaseSync, homeId: string): (memberId: string, date: string) => string | null {
  const kids = db.prepare(`SELECT id FROM members m WHERE home_id = ? AND role = 'kid'
    AND (away_plan IS NOT NULL OR EXISTS (SELECT 1 FROM kid_away a WHERE a.member_id = m.id))`).all(homeId) as Row[];
  if (!kids.length) return () => null;
  const by = new Map(kids.map((k) => [k.id as string, awayOf(db, k.id as string)]));
  return (memberId, date) => {
    const a = by.get(memberId);
    return a ? awayOn(a.plan, a.ranges, date) : null;
  };
}

/** For a board: where they are today and when they're back. */
export function awayToday(db: DatabaseSync, memberId: string, today: string): { label: string; back: string | null } | null {
  const { plan, ranges } = awayOf(db, memberId);
  const label = awayOn(plan, ranges, today);
  return label ? { label, back: backOn(plan, ranges, today) } : null;
}
