// The core loop: chores become daily instances per kid, kids submit them, parents approve, approvals write points.
// Everything here takes "today" as an argument so it's easy to test and always uses the home's own calendar.
import type { DatabaseSync } from 'node:sqlite';
import { tx, type Row } from './db.ts';
import { HttpError, newId } from './util.ts';
import { emit } from './events.ts';
import { addDays, dateRange, isScheduledOn, startOfWeek, todayIn, type Schedule, type ScheduleKind } from '../../shared/schedule.ts';

export type InstanceStatus = 'pending' | 'submitted' | 'approved' | 'rejected';
export type LedgerKind = 'chore' | 'bonus' | 'adjust' | 'redeem' | 'reversal';

/** Who did something, for the ledger and review history. */
export interface By { userId: string | null; name: string }

export interface HomeInfo { id: string; name: string; timezone: string; weekStart: number; pointsName: string; pointsIcon: string; theme: string }

export function homeInfo(db: DatabaseSync, homeId: string): HomeInfo {
  const h = db.prepare('SELECT id, name, timezone, week_start, points_name, points_icon, theme FROM homes WHERE id = ?').get(homeId) as Row | undefined;
  if (!h) throw new HttpError(404, 'Home not found');
  return {
    id: h.id as string, name: h.name as string, timezone: h.timezone as string, weekStart: h.week_start as number,
    pointsName: h.points_name as string, pointsIcon: h.points_icon as string, theme: h.theme as string,
  };
}

export const homeToday = (home: Pick<HomeInfo, 'timezone'>, now = new Date()): string => todayIn(home.timezone, now);

interface ChoreRow {
  id: string; title: string; icon: string; points: number; schedule: ScheduleKind; weekdays: string; due_date: string | null; start_date: string;
  /** Bonus chores are opt-in: nothing is created until a kid claims one. */
  bonus: number;
  claim_limit: 'each' | 'one';
}

const scheduleOf = (c: ChoreRow): Schedule => ({
  schedule: c.schedule, weekdays: JSON.parse(c.weekdays) as number[], dueDate: c.due_date, startDate: c.start_date,
});

function activeChores(db: DatabaseSync, homeId: string, choreId?: string): (ChoreRow & { memberIds: string[] })[] {
  const rows = db.prepare(`SELECT id, title, icon, points, schedule, weekdays, due_date, start_date, bonus, claim_limit FROM chores
    WHERE home_id = ? AND active = 1 ${choreId ? 'AND id = ?' : ''}`).all(...(choreId ? [homeId, choreId] : [homeId])) as unknown as ChoreRow[];
  const assigned = db.prepare('SELECT member_id FROM chore_assignments WHERE chore_id = ?');
  return rows.map((c) => ({ ...c, memberIds: (assigned.all(c.id) as Row[]).map((r) => r.member_id as string) }));
}

/**
 * Makes sure instances exist for every chore due between `from` and `to`, but never past today: future days are
 * shown as "planned" without storing anything, so editing a chore changes them for free. Filling in past days
 * means a day nobody opened the app still shows what was due.
 */
export function materialize(db: DatabaseSync, homeId: string, from: string, to: string, today: string): void {
  const last = to < today ? to : today;
  if (from > last) return;
  const ins = db.prepare(`INSERT OR IGNORE INTO chore_instances (id, home_id, chore_id, member_id, date, title, icon, points)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  tx(db, () => {
    for (const c of activeChores(db, homeId)) {
      if (!c.memberIds.length || c.bonus) continue;
      const s = scheduleOf(c);
      const start = from > c.start_date ? from : c.start_date;
      for (const date of dateRange(start, last)) {
        if (!isScheduledOn(s, date)) continue;
        for (const m of c.memberIds) ins.run(newId(), homeId, c.id, m, date, c.title, c.icon, c.points);
      }
    }
  });
}

/**
 * After a chore is edited or deleted: today's and later unfinished instances follow the new version (or go away),
 * while anything already submitted or approved keeps what the kid actually did.
 */
export function syncChore(db: DatabaseSync, homeId: string, choreId: string, today: string): void {
  const [chore] = activeChores(db, homeId, choreId);
  const open = db.prepare("SELECT id, member_id, date FROM chore_instances WHERE chore_id = ? AND date >= ? AND status IN ('pending', 'rejected')")
    .all(choreId, today) as Row[];
  tx(db, () => {
    for (const i of open) {
      const keep = chore && bonusEligible(chore, i.member_id as string) && isScheduledOn(scheduleOf(chore), i.date as string);
      if (!keep) db.prepare('DELETE FROM chore_instances WHERE id = ?').run(i.id as string);
      else db.prepare('UPDATE chore_instances SET title = ?, icon = ?, points = ? WHERE id = ?').run(chore.title, chore.icon, chore.points, i.id as string);
    }
  });
  materialize(db, homeId, today, today, today);
}

/** Regular chores go to their assigned kids. A bonus chore with nobody picked is open to every kid. */
function bonusEligible(c: ChoreRow & { memberIds: string[] }, memberId: string): boolean {
  return c.memberIds.includes(memberId) || (!!c.bonus && !c.memberIds.length);
}

// ---------- bonus chores ----------

export interface BonusOffer {
  choreId: string; title: string; icon: string; points: number; claimLimit: 'each' | 'one';
  /** This kid's instance, once claimed. */
  instanceId: string | null;
  /** Someone else got the only spot today. */
  takenBy: string | null;
}

/** Bonus chores a kid could do today. */
export function bonusOffers(db: DatabaseSync, homeId: string, memberId: string, today: string): BonusOffer[] {
  const claims = db.prepare(`SELECT i.id, i.member_id, m.name FROM chore_instances i JOIN members m ON m.id = i.member_id
    WHERE i.chore_id = ? AND i.date = ?`);
  return activeChores(db, homeId)
    .filter((c) => c.bonus && bonusEligible(c, memberId) && isScheduledOn(scheduleOf(c), today))
    .map((c) => {
      const rows = claims.all(c.id, today) as Row[];
      const mine = rows.find((r) => r.member_id === memberId);
      const other = c.claim_limit === 'one' && !mine ? rows[0] : undefined;
      return {
        choreId: c.id, title: c.title, icon: c.icon, points: c.points, claimLimit: c.claim_limit,
        instanceId: (mine?.id as string) ?? null, takenBy: (other?.name as string) ?? null,
      };
    });
}

/** A kid signs up for a bonus chore today. It then works like any other chore: done, review, points. */
export function claimBonus(db: DatabaseSync, homeId: string, choreId: string, memberId: string, today: string): AgendaItem {
  return tx(db, () => {
    const offer = bonusOffers(db, homeId, memberId, today).find((o) => o.choreId === choreId);
    if (!offer) throw new HttpError(404, "That bonus chore isn't available today");
    if (offer.instanceId) return getInstance(db, homeId, offer.instanceId);
    if (offer.takenBy) throw new HttpError(409, `${offer.takenBy} already took that one today`);
    const id = newId();
    db.prepare(`INSERT INTO chore_instances (id, home_id, chore_id, member_id, date, title, icon, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, homeId, choreId, memberId, today, offer.title, offer.icon, offer.points);
    return getInstance(db, homeId, id);
  });
}

/** Changed your mind? Only before it's been marked done. */
export function unclaimBonus(db: DatabaseSync, homeId: string, instanceId: string): void {
  const r = db.prepare(`SELECT i.status, c.bonus FROM chore_instances i JOIN chores c ON c.id = i.chore_id WHERE i.id = ? AND i.home_id = ?`)
    .get(instanceId, homeId) as Row | undefined;
  if (!r || !r.bonus) throw new HttpError(404, "That isn't a bonus chore");
  if (r.status !== 'pending' && r.status !== 'rejected') throw new HttpError(400, "It's already marked done");
  db.prepare('DELETE FROM chore_instances WHERE id = ?').run(instanceId);
}

// ---------- agenda ----------

export interface AgendaItem {
  /** null for planned (future) items, which aren't stored yet. */
  id: string | null;
  choreId: string | null;
  memberId: string;
  date: string;
  title: string;
  icon: string;
  points: number;
  status: InstanceStatus | 'planned';
  note: string | null;
  /** Kanban "Doing": the kid has started but not finished. */
  started: boolean;
}

const instanceItem = (r: Row): AgendaItem => ({
  id: r.id as string, choreId: r.chore_id as string | null, memberId: r.member_id as string, date: r.date as string,
  title: r.title as string, icon: r.icon as string, points: r.points as number, status: r.status as InstanceStatus,
  note: (r.note as string | null) ?? null, started: !!r.started_at,
});

/** Every chore for these kids from `from` for `days` days, with stored instances up to today and planned ones after. */
export function agenda(db: DatabaseSync, homeId: string, memberIds: string[], from: string, days: number, today: string): { date: string; items: AgendaItem[] }[] {
  const to = addDays(from, days - 1);
  materialize(db, homeId, from, to, today);
  const wanted = new Set(memberIds);
  const stored = (db.prepare(`SELECT * FROM chore_instances WHERE home_id = ? AND date BETWEEN ? AND ? ORDER BY date, title`)
    .all(homeId, from, to) as Row[]).filter((r) => wanted.has(r.member_id as string)).map(instanceItem);
  const out = dateRange(from, to).map((date) => ({ date, items: stored.filter((i) => i.date === date) }));
  if (to > today) {
    const chores = activeChores(db, homeId);
    for (const day of out) {
      if (day.date <= today) continue;
      for (const c of chores) {
        if (c.bonus || !isScheduledOn(scheduleOf(c), day.date)) continue;
        for (const m of c.memberIds) {
          if (!wanted.has(m)) continue;
          day.items.push({ id: null, choreId: c.id, memberId: m, date: day.date, title: c.title, icon: c.icon, points: c.points, status: 'planned', note: null, started: false });
        }
      }
    }
  }
  return out;
}

/** Today's chores for a kid, plus one-off chores from earlier days that still aren't done. */
export function todayList(db: DatabaseSync, homeId: string, memberId: string, today: string): AgendaItem[] {
  materialize(db, homeId, addDays(today, -6), today, today);
  const rows = db.prepare(`
    SELECT i.* FROM chore_instances i LEFT JOIN chores c ON c.id = i.chore_id
    WHERE i.member_id = ? AND (i.date = ? OR (i.date < ? AND i.status IN ('pending', 'rejected') AND c.schedule = 'once' AND c.active = 1))
    ORDER BY i.date, i.title`).all(memberId, today, today) as Row[];
  return rows.map(instanceItem);
}

// ---------- doing and reviewing chores ----------

export function getInstance(db: DatabaseSync, homeId: string, id: string): AgendaItem & { homeId: string } {
  const r = db.prepare('SELECT * FROM chore_instances WHERE id = ? AND home_id = ?').get(id, homeId) as Row | undefined;
  if (!r) throw new HttpError(404, 'That chore is gone');
  return { ...instanceItem(r), homeId };
}

/** A kid says "done!": it waits for a parent. Rejected chores can be tried again. */
export function submitInstance(db: DatabaseSync, homeId: string, id: string, today: string): AgendaItem {
  const inst = getInstance(db, homeId, id);
  if (inst.date > today) throw new HttpError(400, "That chore isn't due yet");
  if (inst.status === 'submitted' || inst.status === 'approved') return inst;
  db.prepare("UPDATE chore_instances SET status = 'submitted', submitted_at = datetime('now'), note = NULL WHERE id = ?").run(id);
  emit(db, homeId, 'chore_submitted', inst.memberId, { chore: inst.title, icon: inst.icon, points: inst.points, instance_id: id });
  return getInstance(db, homeId, id);
}

/** Kanban: move a chore to "Doing" (or back to "To do" with started = false). */
export function setStarted(db: DatabaseSync, homeId: string, id: string, started: boolean, today: string): AgendaItem {
  const inst = getInstance(db, homeId, id);
  if (inst.date > today) throw new HttpError(400, "That chore isn't due yet");
  if (inst.status !== 'pending' && inst.status !== 'rejected') throw new HttpError(400, 'That chore is already marked done');
  db.prepare(`UPDATE chore_instances SET started_at = ${started ? "datetime('now')" : 'NULL'} WHERE id = ?`).run(id);
  return getInstance(db, homeId, id);
}

/** A kid tapped "done" by mistake. Only works until a parent has looked at it. */
export function unsubmitInstance(db: DatabaseSync, homeId: string, id: string): AgendaItem {
  const inst = getInstance(db, homeId, id);
  if (inst.status !== 'submitted') throw new HttpError(400, inst.status === 'approved' ? 'A parent already approved that one' : "That chore wasn't marked done");
  db.prepare("UPDATE chore_instances SET status = 'pending', submitted_at = NULL WHERE id = ?").run(id);
  return getInstance(db, homeId, id);
}

/**
 * A parent approves (from any state, so a parent can also tick a chore off directly). Writes exactly one ledger row:
 * approving twice never pays twice.
 */
export function approveInstance(db: DatabaseSync, homeId: string, id: string, by: By): { item: AgendaItem; awarded: number } {
  return tx(db, () => {
    const inst = getInstance(db, homeId, id);
    if (inst.status === 'approved') return { item: inst, awarded: 0 };
    db.prepare(`UPDATE chore_instances SET status = 'approved', reviewed_at = datetime('now'), reviewed_by = ?, note = NULL,
      submitted_at = COALESCE(submitted_at, datetime('now')) WHERE id = ?`).run(by.userId, id);
    writeLedger(db, { homeId, memberId: inst.memberId, amount: inst.points, kind: 'chore', reason: inst.title, date: inst.date, instanceId: id, by });
    emit(db, homeId, 'chore_approved', inst.memberId, {
      chore: inst.title, icon: inst.icon, points: inst.points, instance_id: id, balance: balance(db, inst.memberId), by: by.name,
    });
    return { item: getInstance(db, homeId, id), awarded: inst.points };
  });
}

export function rejectInstance(db: DatabaseSync, homeId: string, id: string, by: By, note: string | null): AgendaItem {
  const inst = getInstance(db, homeId, id);
  if (inst.status === 'approved') throw new HttpError(400, 'Undo the approval first');
  db.prepare("UPDATE chore_instances SET status = 'rejected', reviewed_at = datetime('now'), reviewed_by = ?, note = ? WHERE id = ?").run(by.userId, note, id);
  return getInstance(db, homeId, id);
}

/** Takes back an approval with a reversing ledger row (the ledger is never edited). The chore goes back to review. */
export function unapproveInstance(db: DatabaseSync, homeId: string, id: string, by: By): AgendaItem {
  return tx(db, () => {
    const inst = getInstance(db, homeId, id);
    if (inst.status !== 'approved') throw new HttpError(400, "That chore isn't approved");
    const paid = (db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM points_ledger WHERE instance_id = ?").get(id) as Row).n as number;
    if (paid) writeLedger(db, { homeId, memberId: inst.memberId, amount: -paid, kind: 'reversal', reason: `Approval undone: ${inst.title}`, date: inst.date, instanceId: id, by });
    db.prepare("UPDATE chore_instances SET status = 'submitted', reviewed_at = NULL, reviewed_by = NULL WHERE id = ?").run(id);
    return getInstance(db, homeId, id);
  });
}

/** Chores waiting for a parent, oldest first. */
export function reviewQueue(db: DatabaseSync, homeId: string) {
  return (db.prepare(`
    SELECT i.*, m.name AS kid_name, m.avatar AS kid_avatar, m.color AS kid_color FROM chore_instances i JOIN members m ON m.id = i.member_id
    WHERE i.home_id = ? AND i.status = 'submitted' ORDER BY i.submitted_at, i.date`).all(homeId) as Row[])
    .map((r) => ({ ...instanceItem(r), submittedAt: r.submitted_at as string, kid: { name: r.kid_name, avatar: r.kid_avatar, color: r.kid_color } }));
}

// ---------- points ----------

export function writeLedger(db: DatabaseSync, e: {
  homeId: string; memberId: string; amount: number; kind: LedgerKind; reason: string; date: string;
  instanceId?: string | null; goalId?: string | null; by: By;
}): void {
  if (!Number.isInteger(e.amount) || e.amount === 0) throw new HttpError(400, 'Points must be a whole number other than zero');
  db.prepare(`INSERT INTO points_ledger (home_id, member_id, amount, kind, reason, date, instance_id, goal_id, by_user_id, by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(e.homeId, e.memberId, e.amount, e.kind, e.reason, e.date, e.instanceId ?? null, e.goalId ?? null, e.by.userId, e.by.name);
  // Goals this entry just pushed over the line.
  const after = balance(db, e.memberId);
  const before = after - e.amount;
  // Chore approvals and redemptions have their own, richer events.
  if (e.kind !== 'chore' && e.kind !== 'redeem') emit(db, e.homeId, 'points_changed', e.memberId, { amount: e.amount, kind: e.kind, reason: e.reason, balance: after, by: e.by.name });
  if (e.amount > 0) {
    const hit = db.prepare("SELECT id, title, target_points, reward FROM goals WHERE member_id = ? AND status = 'active' AND target_points > ? AND target_points <= ?")
      .all(e.memberId, before, after) as Row[];
    for (const g of hit) emit(db, e.homeId, 'goal_reached', e.memberId, { goal: g.title, goal_id: g.id, target: g.target_points, reward: g.reward, balance: after });
  }
}

/**
 * Takes points away with a reason the kid will see. Unless the home allows it, a penalty stops at zero:
 * it takes what's there and says so, and refuses when there's nothing to take.
 */
export function penalize(db: DatabaseSync, home: Pick<HomeInfo, 'id'> & { allowNegative: boolean }, memberId: string, points: number, reason: string, by: By, today: string): { taken: number; balance: number } {
  if (!Number.isInteger(points) || points <= 0) throw new HttpError(400, 'Take away a whole number of points, at least 1');
  return tx(db, () => {
    const bal = balance(db, memberId);
    const taken = home.allowNegative ? points : Math.min(points, Math.max(bal, 0));
    if (!taken) throw new HttpError(400, "There are no points to take away (balances don't go below zero)");
    writeLedger(db, { homeId: home.id, memberId, amount: -taken, kind: 'adjust', reason, date: today, by });
    return { taken, balance: bal - taken };
  });
}

export function balance(db: DatabaseSync, memberId: string): number {
  return (db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM points_ledger WHERE member_id = ?').get(memberId) as Row).n as number;
}

/** Points earned in a date range. Spending on rewards doesn't count against what you earned. */
export function earnedBetween(db: DatabaseSync, memberId: string, from: string, to: string): number {
  return (db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM points_ledger WHERE member_id = ? AND kind != 'redeem' AND date BETWEEN ? AND ?")
    .get(memberId, from, to) as Row).n as number;
}

export function ledger(db: DatabaseSync, memberId: string, limit = 100) {
  return (db.prepare('SELECT * FROM points_ledger WHERE member_id = ? ORDER BY id DESC LIMIT ?').all(memberId, limit) as Row[]).map((r) => ({
    id: r.id as number, amount: r.amount as number, kind: r.kind as LedgerKind, reason: r.reason as string, date: r.date as string,
    by: r.by_name as string | null, createdAt: r.created_at as string,
  }));
}

// ---------- goals ----------

export interface GoalView {
  id: string; memberId: string; title: string; targetPoints: number; reward: string | null; status: 'active' | 'redeemed';
  redeemedAt: string | null; createdAt: string;
  /** Points toward this goal: the kid's balance, capped at the target. */
  progress: number;
  percent: number;
  reached: boolean;
}

/** Goals are measured against the kid's balance, so every goal fills up as points come in and redeeming one spends them. */
export function goalsFor(db: DatabaseSync, memberId: string, includeRedeemed = false): GoalView[] {
  const bal = balance(db, memberId);
  const rows = db.prepare(`SELECT * FROM goals WHERE member_id = ? ${includeRedeemed ? '' : "AND status = 'active'"}
    ORDER BY status, target_points, created_at`).all(memberId) as Row[];
  return rows.map((g) => {
    const target = g.target_points as number;
    const active = g.status === 'active';
    const progress = active ? Math.max(0, Math.min(bal, target)) : target;
    return {
      id: g.id as string, memberId, title: g.title as string, targetPoints: target, reward: g.reward as string | null,
      status: g.status as GoalView['status'], redeemedAt: g.redeemed_at as string | null, createdAt: g.created_at as string,
      progress, percent: Math.round((progress / target) * 100), reached: progress >= target,
    };
  });
}

/** A parent hands over the reward: spends the goal's points from the kid's balance. */
export function redeemGoal(db: DatabaseSync, homeId: string, goalId: string, by: By, today: string): GoalView {
  return tx(db, () => {
    const g = db.prepare("SELECT * FROM goals WHERE id = ? AND home_id = ?").get(goalId, homeId) as Row | undefined;
    if (!g) throw new HttpError(404, 'That goal is gone');
    if (g.status !== 'active') throw new HttpError(400, 'That goal was already redeemed');
    const memberId = g.member_id as string;
    const target = g.target_points as number;
    if (balance(db, memberId) < target) throw new HttpError(400, 'Not enough points for this goal yet');
    writeLedger(db, { homeId, memberId, amount: -target, kind: 'redeem', reason: `Redeemed: ${g.title}`, date: today, goalId, by });
    db.prepare("UPDATE goals SET status = 'redeemed', redeemed_at = datetime('now') WHERE id = ?").run(goalId);
    emit(db, homeId, 'goal_redeemed', memberId, { goal: g.title, goal_id: goalId, target, reward: g.reward, by: by.name });
    return goalsFor(db, memberId, true).find((x) => x.id === goalId)!;
  });
}

// ---------- summaries ----------

export interface KidWeek {
  balance: number;
  pointsThisWeek: number;
  /** Approved this week. */
  choresDone: number;
  /** Waiting for a parent. */
  choresWaiting: number;
  /** Due this week so far (including today). */
  choresDue: number;
  /** Still to do today. */
  leftToday: number;
}

export function kidWeek(db: DatabaseSync, home: HomeInfo, memberId: string, today: string): KidWeek {
  const from = startOfWeek(today, home.weekStart);
  materialize(db, home.id, from, today, today);
  const c = db.prepare(`SELECT
      COUNT(*) AS due,
      SUM(status = 'approved') AS done,
      SUM(status = 'submitted') AS waiting,
      SUM(date = ? AND status IN ('pending', 'rejected')) AS left_today
    FROM chore_instances WHERE member_id = ? AND date BETWEEN ? AND ?`).get(today, memberId, from, today) as Row;
  return {
    balance: balance(db, memberId),
    pointsThisWeek: earnedBetween(db, memberId, from, addDays(from, 6)),
    choresDone: Number(c.done ?? 0),
    choresWaiting: Number(c.waiting ?? 0),
    choresDue: Number(c.due ?? 0),
    leftToday: Number(c.left_today ?? 0),
  };
}
