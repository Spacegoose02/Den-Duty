// Streaks, raccoon levels, achievements and the numbers behind the charts. All read-only, computed from
// chore_instances and points_ledger, so nothing here can drift out of sync with what actually happened.
import type { DatabaseSync } from 'node:sqlite';
import type { Row } from './db.ts';
import { materialize, type HomeInfo } from './chores.ts';
import { addDays, dateRange, startOfWeek } from '../../shared/schedule.ts';
import { achievementsFor, GOAL_LEVEL_BONUS, levelFor, type Achievement, type LevelInfo } from '../../shared/progress.ts';

const num = (v: unknown): number => Number(v ?? 0);

/** Everything ever earned from chores and bonuses (take-backs of approvals included, rewards and penalties not). */
export function lifetimeEarned(db: DatabaseSync, memberId: string): number {
  return num((db.prepare("SELECT SUM(amount) AS n FROM points_ledger WHERE member_id = ? AND kind IN ('chore', 'bonus', 'reversal')").get(memberId) as Row).n);
}

export function goalsRedeemed(db: DatabaseSync, memberId: string): number {
  return num((db.prepare("SELECT COUNT(*) AS n FROM goals WHERE member_id = ? AND status = 'redeemed'").get(memberId) as Row).n);
}

export function levelOf(db: DatabaseSync, memberId: string): LevelInfo {
  return levelFor(Math.max(0, lifetimeEarned(db, memberId)) + GOAL_LEVEL_BONUS * goalsRedeemed(db, memberId));
}

/**
 * A day counts toward a streak when every regular chore due that day was approved (today, waiting for a parent
 * counts too, so kids aren't punished for slow parents). Days with nothing due neither count nor break it,
 * and an unfinished today doesn't break it yet. Bonus chores never affect streaks.
 */
export function streaks(db: DatabaseSync, memberId: string, today: string): { current: number; best: number } {
  const days = db.prepare(`
    SELECT i.date, COUNT(*) AS due,
      SUM(i.status = 'approved' OR (i.date = ? AND i.status = 'submitted')) AS done
    FROM chore_instances i LEFT JOIN chores c ON c.id = i.chore_id
    WHERE i.member_id = ? AND i.date <= ? AND i.date > ? AND COALESCE(c.bonus, 0) = 0
    GROUP BY i.date ORDER BY i.date`).all(today, memberId, today, addDays(today, -400)) as Row[];
  let best = 0;
  let run = 0;
  for (const d of days) {
    if (num(d.done) >= num(d.due)) best = Math.max(best, ++run);
    else if (d.date !== today) run = 0;
  }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const complete = num(days[i].done) >= num(days[i].due);
    if (complete) current++;
    else if (days[i].date === today) continue;
    else break;
  }
  return { current, best };
}

export function achievements(db: DatabaseSync, memberId: string, today: string): Achievement[] {
  const chores = num((db.prepare("SELECT COUNT(*) AS n FROM chore_instances WHERE member_id = ? AND status = 'approved'").get(memberId) as Row).n);
  const bonus = num((db.prepare(`SELECT COUNT(*) AS n FROM chore_instances i JOIN chores c ON c.id = i.chore_id
    WHERE i.member_id = ? AND i.status = 'approved' AND c.bonus = 1`).get(memberId) as Row).n);
  return achievementsFor({
    chores, bonus, points: Math.max(0, lifetimeEarned(db, memberId)), goals: goalsRedeemed(db, memberId), streak: streaks(db, memberId, today).best,
  });
}

// ---------- chart data ----------

export interface DayStat { date: string; points: number; done: number; due: number }
export interface WeekStat { weekStart: string; points: number; done: number; due: number }

/** Points earned (not spent), chores done and chores due per day, for the charts. */
export function dailyStats(db: DatabaseSync, home: HomeInfo, memberId: string, from: string, today: string): DayStat[] {
  materialize(db, home.id, from, today, today);
  const pts = new Map((db.prepare(`SELECT date, SUM(amount) AS n FROM points_ledger WHERE member_id = ? AND kind != 'redeem' AND date BETWEEN ? AND ? GROUP BY date`)
    .all(memberId, from, today) as Row[]).map((r) => [r.date as string, num(r.n)]));
  const inst = new Map((db.prepare(`SELECT date, COUNT(*) AS due, SUM(status = 'approved') AS done FROM chore_instances
    WHERE member_id = ? AND date BETWEEN ? AND ? GROUP BY date`).all(memberId, from, today) as Row[]).map((r) => [r.date as string, r]));
  return dateRange(from, today).map((date) => ({ date, points: pts.get(date) ?? 0, done: num(inst.get(date)?.done), due: num(inst.get(date)?.due) }));
}

export function weeklyStats(days: DayStat[], weekStart: number): WeekStat[] {
  const weeks = new Map<string, WeekStat>();
  for (const d of days) {
    const w = startOfWeek(d.date, weekStart);
    const cur = weeks.get(w) ?? { weekStart: w, points: 0, done: 0, due: 0 };
    cur.points += d.points; cur.done += d.done; cur.due += d.due;
    weeks.set(w, cur);
  }
  return [...weeks.values()];
}

export function choreBreakdown(db: DatabaseSync, memberId: string, from: string, today: string) {
  return (db.prepare(`SELECT title, icon, COUNT(*) AS due, SUM(status = 'approved') AS done,
      SUM(CASE WHEN status = 'approved' THEN points ELSE 0 END) AS points
    FROM chore_instances WHERE member_id = ? AND date BETWEEN ? AND ?
    GROUP BY title, icon ORDER BY done DESC, due DESC LIMIT 12`).all(memberId, from, today) as Row[])
    .map((r) => ({ title: r.title as string, icon: r.icon as string, due: num(r.due), done: num(r.done), points: num(r.points) }));
}

/** Everything the Stats page shows for one kid, over the last `weeks` weeks. */
export function kidStats(db: DatabaseSync, home: HomeInfo, memberId: string, today: string, weeks: number) {
  const from = startOfWeek(addDays(today, -7 * (weeks - 1)), home.weekStart);
  const daily = dailyStats(db, home, memberId, from, today);
  return {
    from,
    daily: daily.slice(-30),
    weekly: weeklyStats(daily, home.weekStart),
    byChore: choreBreakdown(db, memberId, from, today),
    streak: streaks(db, memberId, today),
    level: levelOf(db, memberId),
    lifetime: lifetimeEarned(db, memberId),
  };
}
