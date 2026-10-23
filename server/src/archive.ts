// The weekly chore archive: when a week is over, each kid's week is written down once (points, chores done vs due,
// every chore's result, each day) so parents can look back and compare weeks. Rows are rebuilt for 7 days after a
// week ends (late approvals and take-backs still land), then they're final and never change again.
import type { DatabaseSync } from 'node:sqlite';
import type { Row } from './db.ts';
import { homeToday, kidsWithPageOff, materialize, type HomeInfo } from './chores.ts';
import { dailyStats, streaks } from './progress.ts';
import { addDays, startOfWeek } from '../../shared/schedule.ts';

/** How long a finished week stays open to late changes before it's frozen. */
export const GRACE_DAYS = 7;
/** How far back the first archive run looks for history (two years). */
const MAX_WEEKS_BACK = 104;

const num = (v: unknown): number => Number(v ?? 0);

export interface ArchivedChore { title: string; icon: string; due: number; done: number; points: number }
export interface ArchivedDay { date: string; points: number; done: number; due: number }
export interface ArchivedWeek {
  memberId: string; weekStart: string; weekEnd: string;
  /** Earned this week (spending on rewards doesn't count against it), penalties and take-backs included. */
  points: number; done: number; due: number; bonusDone: number;
  /** Days where every regular chore due got done. */
  perfectDays: number;
  /** The streak as the week ended. */
  streak: number;
  /** Points taken away as penalties (a positive number). */
  penalties: number;
  /** Points spent on rewards (a positive number), and how many rewards. */
  spent: number; rewards: number;
  /** Balance at the end of the week. */
  balance: number;
  chores: ArchivedChore[]; days: ArchivedDay[];
  /** False while the week is still open to late approvals. */
  final: boolean;
}

export const archiveView = (r: Row): ArchivedWeek => ({
  memberId: r.member_id as string, weekStart: r.week_start as string, weekEnd: r.week_end as string,
  points: num(r.points), done: num(r.done), due: num(r.due), bonusDone: num(r.bonus_done), perfectDays: num(r.perfect_days),
  streak: num(r.streak), penalties: num(r.penalties), spent: num(r.spent), rewards: num(r.rewards), balance: num(r.balance),
  chores: JSON.parse(r.chores as string) as ArchivedChore[], days: JSON.parse(r.days as string) as ArchivedDay[], final: !!r.final,
});

/** Works out one kid's week from the instances and the ledger. */
export function computeWeek(db: DatabaseSync, home: HomeInfo, memberId: string, weekStart: string, today: string): Omit<ArchivedWeek, 'final'> {
  const weekEnd = addDays(weekStart, 6);
  const days = dailyStats(db, home, memberId, weekStart, weekEnd < today ? weekEnd : today);
  const regular = db.prepare(`SELECT i.date, COUNT(*) AS due, SUM(i.status = 'approved') AS done
    FROM chore_instances i LEFT JOIN chores c ON c.id = i.chore_id
    WHERE i.member_id = ? AND i.date BETWEEN ? AND ? AND COALESCE(c.bonus, 0) = 0 GROUP BY i.date`).all(memberId, weekStart, weekEnd) as Row[];
  const bonusDone = num((db.prepare(`SELECT COUNT(*) AS n FROM chore_instances i JOIN chores c ON c.id = i.chore_id
    WHERE i.member_id = ? AND i.date BETWEEN ? AND ? AND c.bonus = 1 AND i.status = 'approved'`).get(memberId, weekStart, weekEnd) as Row).n);
  const chores = (db.prepare(`SELECT title, icon, COUNT(*) AS due, SUM(status = 'approved') AS done,
      SUM(CASE WHEN status = 'approved' THEN points ELSE 0 END) AS points
    FROM chore_instances WHERE member_id = ? AND date BETWEEN ? AND ?
    GROUP BY title, icon ORDER BY done DESC, due DESC, title`).all(memberId, weekStart, weekEnd) as Row[])
    .map((r) => ({ title: r.title as string, icon: r.icon as string, due: num(r.due), done: num(r.done), points: num(r.points) }));
  const money = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN kind = 'adjust' AND amount < 0 THEN -amount END), 0) AS penalties,
      COALESCE(SUM(CASE WHEN kind = 'redeem' THEN -amount END), 0) AS spent,
      COALESCE(SUM(kind = 'redeem' AND amount < 0), 0) AS rewards
    FROM points_ledger WHERE member_id = ? AND date BETWEEN ? AND ?`).get(memberId, weekStart, weekEnd) as Row;
  const bal = num((db.prepare('SELECT SUM(amount) AS n FROM points_ledger WHERE member_id = ? AND date <= ?').get(memberId, weekEnd) as Row).n);
  return {
    memberId, weekStart, weekEnd,
    points: days.reduce((s, d) => s + d.points, 0), done: days.reduce((s, d) => s + d.done, 0), due: days.reduce((s, d) => s + d.due, 0),
    bonusDone, perfectDays: regular.filter((d) => num(d.done) >= num(d.due)).length,
    streak: streaks(db, memberId, weekEnd < today ? weekEnd : today).current,
    penalties: num(money.penalties), spent: num(money.spent), rewards: num(money.rewards), balance: bal,
    chores, days,
  };
}

/**
 * Writes every finished week that isn't final yet, for every kid in the home. Cheap when there's nothing to do:
 * it only looks at weeks after the newest final one. Kids added later get rows from the week they show up.
 */
export function archiveWeeks(db: DatabaseSync, home: HomeInfo, today = homeToday(home)): void {
  const thisWeek = startOfWeek(today, home.weekStart);
  const lastDone = addDays(thisWeek, -7);
  const floor = addDays(thisWeek, -7 * MAX_WEEKS_BACK);
  // The first day anything could count for a kid: their first chore instance, ledger row or assigned chore's start.
  const first = db.prepare(`SELECT MIN(d) AS d FROM (
      SELECT MIN(date) AS d FROM chore_instances WHERE member_id = ?
      UNION ALL SELECT MIN(date) FROM points_ledger WHERE member_id = ?
      UNION ALL SELECT MIN(c.start_date) FROM chores c JOIN chore_assignments a ON a.chore_id = c.id WHERE a.member_id = ?)`);
  const newestFinal = db.prepare('SELECT MAX(week_end) AS d FROM week_archive WHERE member_id = ? AND final = 1');
  const write = db.prepare(`INSERT INTO week_archive (member_id, home_id, week_start, week_end, points, done, due, bonus_done, perfect_days,
      streak, penalties, spent, rewards, balance, chores, days, final, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (member_id, week_start) DO UPDATE SET week_end = excluded.week_end, points = excluded.points, done = excluded.done,
      due = excluded.due, bonus_done = excluded.bonus_done, perfect_days = excluded.perfect_days, streak = excluded.streak,
      penalties = excluded.penalties, spent = excluded.spent, rewards = excluded.rewards, balance = excluded.balance,
      chores = excluded.chores, days = excluded.days, final = excluded.final, updated_at = excluded.updated_at
    WHERE week_archive.final = 0`);

  const todo: { id: string; from: string }[] = [];
  for (const k of db.prepare("SELECT id FROM members WHERE home_id = ? AND role = 'kid'").all(home.id) as Row[]) {
    const id = k.id as string;
    const since = (newestFinal.get(id) as Row).d as string | null;
    const firstDay = (first.get(id, id, id) as Row).d as string | null;
    if (!firstDay) continue;
    let week = since ? addDays(since, 1) : startOfWeek(firstDay, home.weekStart);
    // After the week start changes in Settings, the next archived week lines up with the new one.
    if (startOfWeek(week, home.weekStart) !== week) week = addDays(startOfWeek(week, home.weekStart), 7);
    if (week < floor) week = floor;
    if (week <= lastDone) todo.push({ id, from: week });
  }
  if (!todo.length) return;
  // Days nobody opened the app need their instances stored before they can be counted.
  materialize(db, home.id, todo.map((t) => t.from).sort()[0], addDays(lastDone, 6), today);
  for (const { id, from } of todo) {
    for (let week = from; week <= lastDone; week = addDays(week, 7)) {
      const w = computeWeek(db, home, id, week, today);
      const final = addDays(w.weekEnd, GRACE_DAYS) < today ? 1 : 0;
      write.run(id, home.id, w.weekStart, w.weekEnd, w.points, w.done, w.due, w.bonusDone, w.perfectDays, w.streak, w.penalties,
        w.spent, w.rewards, w.balance, JSON.stringify(w.chores), JSON.stringify(w.days), final);
    }
  }
}

/** The archive for a home: newest week first, one entry per week with every kid's row (kids with Stats off left out). */
export function archiveFor(db: DatabaseSync, home: HomeInfo, opts: { memberId?: string; limit?: number } = {}) {
  archiveWeeks(db, home);
  const off = kidsWithPageOff(db, home.id, 'stats');
  const rows = (db.prepare(`SELECT a.* FROM week_archive a JOIN members m ON m.id = a.member_id
    WHERE a.home_id = ? ${opts.memberId ? 'AND a.member_id = ?' : ''} ORDER BY a.week_start DESC, m.position, m.created_at`)
    .all(...(opts.memberId ? [home.id, opts.memberId] : [home.id])) as Row[]).filter((r) => !off.has(r.member_id as string));
  const weeks = new Map<string, { weekStart: string; weekEnd: string; final: boolean; kids: ArchivedWeek[] }>();
  for (const r of rows) {
    const a = archiveView(r);
    const w = weeks.get(a.weekStart) ?? { weekStart: a.weekStart, weekEnd: a.weekEnd, final: true, kids: [] };
    w.kids.push(a);
    w.final &&= a.final;
    weeks.set(a.weekStart, w);
  }
  return [...weeks.values()].slice(0, opts.limit ?? 104);
}
