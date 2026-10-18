// Streaks, raccoon levels, achievements and the numbers behind the charts. All read-only, computed from
// chore_instances and points_ledger, so nothing here can drift out of sync with what actually happened.
import type { DatabaseSync } from 'node:sqlite';
import type { Row } from './db.ts';
import { goalsFor, materialize, type HomeInfo } from './chores.ts';
import { addDays, dateRange, startOfWeek } from '../../shared/schedule.ts';
import { appointmentOn, goalAreaOn } from '../../shared/pages.ts';
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

// ---------- Doctors and Goals panels ----------

const weekStarts = (from: string, today: string, weekStart: number) => [...new Set(dateRange(from, today).map((d) => startOfWeek(d, weekStart)))];

/**
 * The Doctors panel: practices per week by goal area, goal progress, goals reached, appointments kept and coming up,
 * and the practice streak (days in a row with at least one practice). Only sections turned on for the kid count.
 */
export function doctorsStats(db: DatabaseSync, home: HomeInfo, memberId: string, from: string, today: string, off: readonly string[]) {
  const goals = (db.prepare('SELECT * FROM therapy_goals WHERE member_id = ? ORDER BY created_at').all(memberId) as Row[]).filter((g) => goalAreaOn(g.area as string, off));
  const goalArea = new Map(goals.map((g) => [g.id as string, g.area as string]));
  // A practice is a ticked-off scheduled practice or a progress/practice note on a goal.
  const notes = (db.prepare('SELECT goal_id, date FROM therapy_notes WHERE member_id = ? AND goal_id IS NOT NULL AND date <= ?').all(memberId, today) as Row[])
    .filter((n) => goalArea.has(n.goal_id as string));
  const weeks = weekStarts(from, today, home.weekStart);
  const areas = [...new Set(notes.filter((n) => (n.date as string) >= from).map((n) => goalArea.get(n.goal_id as string)!))].sort();
  const perWeek = areas.map((area) => ({
    area, values: weeks.map((w) => notes.filter((n) => goalArea.get(n.goal_id as string) === area && startOfWeek(n.date as string, home.weekStart) === w).length),
  }));
  const days = new Set(notes.map((n) => n.date as string));
  let streak = 0;
  for (let d = days.has(today) ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) streak++;
  const appts = (db.prepare('SELECT kind, status, starts_at FROM therapy_appointments WHERE member_id = ?').all(memberId) as Row[]).filter((a) => appointmentOn(a.kind as string, off));
  return {
    weeks, perWeek, streak, practicesInRange: notes.filter((n) => (n.date as string) >= from).length,
    goals: goals.filter((g) => g.status !== 'met' || (g.met_at as string) >= from).map((g) => ({
      id: g.id as string, title: g.title as string, area: g.area as string, progress: g.progress as number, status: g.status as string,
    })),
    goalsReached: goals.filter((g) => g.status === 'met').length,
    goalsReachedInRange: goals.filter((g) => g.status === 'met' && String(g.met_at ?? '').slice(0, 10) >= from).length,
    appointments: {
      attended: appts.filter((a) => a.status === 'done' && (a.starts_at as string).slice(0, 10) >= from).length,
      missed: appts.filter((a) => a.status === 'missed' && (a.starts_at as string).slice(0, 10) >= from).length,
      upcoming: appts.filter((a) => a.status === 'scheduled' && (a.starts_at as string).slice(0, 10) >= today).length,
    },
  };
}

/** The Goals panel: points goals' progress, goals reached and redeemed per week, and how long goals take to reach. */
export function goalsStats(db: DatabaseSync, home: HomeInfo, memberId: string, from: string, today: string) {
  const rows = db.prepare('SELECT * FROM goals WHERE member_id = ? ORDER BY created_at').all(memberId) as Row[];
  // When each goal was first reached, from the goal_reached events (redeeming counts as reached if that's all we have).
  const reachedAt = new Map<string, string>();
  for (const e of db.prepare("SELECT data, created_at FROM events WHERE member_id = ? AND type = 'goal_reached' ORDER BY id").all(memberId) as Row[]) {
    const id = (JSON.parse(e.data as string) as { goal_id?: string }).goal_id;
    if (id && !reachedAt.has(id)) reachedAt.set(id, (e.created_at as string).slice(0, 10));
  }
  for (const g of rows) if (g.redeemed_at && !reachedAt.has(g.id as string)) reachedAt.set(g.id as string, (g.redeemed_at as string).slice(0, 10));
  const weeks = weekStarts(from, today, home.weekStart);
  const inWeek = (d: string | undefined, w: string) => !!d && d >= from && startOfWeek(d, home.weekStart) === w;
  const took = rows.filter((g) => reachedAt.has(g.id as string)).map((g) => ({
    title: g.title as string, days: Math.max(0, Math.round((Date.parse(reachedAt.get(g.id as string)!) - Date.parse((g.created_at as string).slice(0, 10))) / 86400000)),
  }));
  return {
    active: goalsFor(db, memberId).map((g) => ({ id: g.id, title: g.title, target: g.targetPoints, progress: g.progress, percent: g.percent, reached: g.reached })),
    weeks,
    reachedPerWeek: weeks.map((w) => rows.filter((g) => inWeek(reachedAt.get(g.id as string), w)).length),
    redeemedPerWeek: weeks.map((w) => rows.filter((g) => inWeek((g.redeemed_at as string | null)?.slice(0, 10), w)).length),
    reachedTotal: reachedAt.size,
    redeemedTotal: rows.filter((g) => g.status === 'redeemed').length,
    averageDays: took.length ? Math.round(took.reduce((s, t) => s + t.days, 0) / took.length) : null,
    recent: took.slice(-5).reverse(),
  };
}

/** Badges as they stood at the end of a day (for "earned today": today's minus yesterday's). */
export function achievementsOn(db: DatabaseSync, memberId: string, day: string): Achievement[] {
  const chores = num((db.prepare("SELECT COUNT(*) AS n FROM chore_instances WHERE member_id = ? AND status = 'approved' AND date <= ?").get(memberId, day) as Row).n);
  const bonus = num((db.prepare(`SELECT COUNT(*) AS n FROM chore_instances i JOIN chores c ON c.id = i.chore_id
    WHERE i.member_id = ? AND i.status = 'approved' AND c.bonus = 1 AND i.date <= ?`).get(memberId, day) as Row).n);
  const points = num((db.prepare("SELECT SUM(amount) AS n FROM points_ledger WHERE member_id = ? AND kind IN ('chore', 'bonus', 'reversal') AND date <= ?").get(memberId, day) as Row).n);
  const goals = num((db.prepare("SELECT COUNT(*) AS n FROM goals WHERE member_id = ? AND status = 'redeemed' AND substr(redeemed_at, 1, 10) <= ?").get(memberId, day) as Row).n);
  return achievementsFor({ chores, bonus, points: Math.max(0, points), goals, streak: streaks(db, memberId, day).best });
}

/** Badges earned today. */
export function badgesToday(db: DatabaseSync, memberId: string, today: string): Achievement[] {
  const before = new Set(achievementsOn(db, memberId, addDays(today, -1)).filter((a) => a.earned).map((a) => a.id));
  return achievementsOn(db, memberId, today).filter((a) => a.earned && !before.has(a.id));
}
