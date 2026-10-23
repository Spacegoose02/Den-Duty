import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, num, requireStr, str } from '../util.ts';
import {
  agenda, approveInstance, bonusOffers, kidsWithPageOff, claimBonus, getInstance, goalsFor, homeInfo, homeToday, kidWeek, ledger, rejectInstance,
  reviewQueue, setStarted, submitInstance, syncChore, todayList, unapproveInstance, unclaimBonus, unsubmitInstance, type By, type HomeInfo,
} from '../chores.ts';
import { achievements, doctorsStats, goalsStats, kidStats, levelOf, streaks } from '../progress.ts';
import { kidTherapyView, withDoctors } from './therapy.ts';
import { dutyDue } from './parentduty.ts';
import { homeTimeouts, kidTimeouts } from './timeouts.ts';
import { waitingRequests } from './helpdesk.ts';
import { listReminders, remindersDue } from './reminders.ts';
import { roomMessage } from '../roommessage.ts';
import { externalBetween, refreshStale } from '../calendar.ts';
import { cleanIcon, doctorAreasOff, getKid, kidView, listKids, pageOn } from './homes.ts';
import type { KidPage } from '../../../shared/pages.ts';
import { addDays, cleanWeekdays, describeSchedule, isIsoDate, startOfWeek, type ScheduleKind } from '../../../shared/schedule.ts';

/** Who to credit in the ledger and review history. */
export function byOf(ctx: HomeCtx): By {
  return ctx.user ? { userId: ctx.user.id, name: ctx.user.name } : { userId: null, name: ctx.tokenName ? `🔑 ${ctx.tokenName}` : 'Automation' };
}

function choreView(db: DatabaseSync, r: Row) {
  const weekdays = JSON.parse(r.weekdays as string) as number[];
  const schedule = r.schedule as ScheduleKind;
  return {
    id: r.id as string, title: r.title as string, icon: r.icon as string, points: r.points as number,
    schedule, weekdays, dueDate: r.due_date as string | null, startDate: r.start_date as string,
    describe: describeSchedule({ schedule, weekdays, dueDate: r.due_date as string | null }),
    bonus: !!r.bonus, claimLimit: r.claim_limit as 'each' | 'one', category: (r.category as string | null) ?? null,
    memberIds: (db.prepare('SELECT member_id FROM chore_assignments WHERE chore_id = ?').all(r.id as string) as Row[]).map((a) => a.member_id as string),
  };
}

function getChore(db: DatabaseSync, homeId: string, id: string): Row {
  const r = db.prepare('SELECT * FROM chores WHERE id = ? AND home_id = ? AND active = 1').get(id, homeId) as Row | undefined;
  if (!r) throw new HttpError(404, 'That chore is gone');
  return r;
}

/** Validates the parts of a chore that were sent, falling back to the current values when editing. */
function choreInput(db: DatabaseSync, homeId: string, b: Row, today: string, cur?: Row) {
  const title = 'title' in b || !cur ? requireStr(b.title, 'Title', 80) : (cur.title as string);
  const icon = 'icon' in b || !cur ? cleanIcon(b.icon, '⭐') : (cur.icon as string);
  let points = cur ? (cur.points as number) : 1;
  if ('points' in b) {
    const p = num(b.points);
    if (p == null || !Number.isInteger(p) || p < 0 || p > 10000) throw new HttpError(400, 'Points must be a whole number from 0 to 10000');
    points = p;
  }
  const schedule = (b.schedule ?? cur?.schedule ?? 'daily') as ScheduleKind;
  if (!['daily', 'weekly', 'once'].includes(schedule)) throw new HttpError(400, 'Schedule must be daily, weekly or once');
  const weekdays = 'weekdays' in b ? cleanWeekdays(b.weekdays) : cur ? (JSON.parse(cur.weekdays as string) as number[]) : [];
  if (schedule === 'weekly' && !weekdays.length) throw new HttpError(400, 'Pick at least one day of the week');
  let dueDate = 'dueDate' in b ? (b.dueDate as string | null) : (cur?.due_date as string | null) ?? null;
  if (schedule === 'once') {
    dueDate ??= today;
    if (!isIsoDate(dueDate)) throw new HttpError(400, 'Pick a date for a one-time chore');
  } else dueDate = null;
  const bonus = 'bonus' in b ? !!b.bonus : !!cur?.bonus;
  const claimLimit = (b.claimLimit ?? cur?.claim_limit ?? 'each') as 'each' | 'one';
  if (claimLimit !== 'each' && claimLimit !== 'one') throw new HttpError(400, 'claimLimit must be each or one');
  let memberIds: string[] | null = null;
  if ('memberIds' in b || !cur) {
    // Bonus chores may leave this empty, meaning any kid can opt in.
    if (!Array.isArray(b.memberIds) && !bonus) throw new HttpError(400, 'Pick which kids do this chore');
    const kids = new Set(listKids(db, homeId).map((k) => k.id));
    memberIds = [...new Set(((b.memberIds as unknown[]) ?? []).map(String))];
    if (memberIds.some((m) => !kids.has(m))) throw new HttpError(400, 'Chores can only be assigned to kids in this home');
    if (!bonus && !memberIds.length) throw new HttpError(400, 'Pick which kids do this chore');
  }
  const category = 'category' in b ? (b.category === 'room' ? 'room' : null) : (cur?.category as string | null) ?? null;
  return { title, icon, points, schedule, weekdays, dueDate, memberIds, bonus, claimLimit, category };
}

/** Only a kid's own things for kids; parents can act for any kid in the home. */
function actingKid(db: DatabaseSync, ctx: HomeCtx, requested: unknown): string {
  if (ctx.actor.kind === 'kid') return ctx.actor.memberId;
  if (ctx.actor.kind !== 'parent') throw new HttpError(403, 'Tap your avatar first');
  return getKid(db, ctx, requireStr(requested, 'Kid', 60)).id as string;
}

function setAssignments(db: DatabaseSync, choreId: string, memberIds: string[]): void {
  db.prepare('DELETE FROM chore_assignments WHERE chore_id = ?').run(choreId);
  const ins = db.prepare('INSERT INTO chore_assignments (chore_id, member_id) VALUES (?, ?)');
  for (const m of memberIds) ins.run(choreId, m);
}

/** Who the agenda is for: kids only ever see themselves. */
function agendaKids(db: DatabaseSync, ctx: HomeCtx, kid: string | undefined): string[] {
  if (ctx.actor.kind === 'kid') return [ctx.actor.memberId];
  const off = kidsWithPageOff(db, ctx.homeId, 'chores');
  if (kid) return [getKid(db, ctx, kid).id as string].filter((id) => !off.has(id));
  return listKids(db, ctx.homeId).map((k) => k.id).filter((id) => !off.has(id));
}

/** Kids whose practices and appointments go on a calendar (Chores being off doesn't hide them). */
function doctorKids(db: DatabaseSync, ctx: HomeCtx, kid: string | undefined): string[] {
  if (ctx.actor.kind === 'kid') return [ctx.actor.memberId];
  if (kid) return [getKid(db, ctx, kid).id as string];
  return listKids(db, ctx.homeId).map((k) => k.id);
}

function startParam(v: unknown, fallback: string): string {
  if (v == null || v === '') return fallback;
  if (!isIsoDate(v)) throw new HttpError(400, 'Dates look like 2026-10-17');
  return v;
}

/** Adds school lunch, meal plan and other subscribed calendar events to each day. */
async function withFeeds<T extends { date: string }>(db: DatabaseSync, ctx: HomeCtx, days: T[], kidId?: string) {
  if (!days.length) return [];
  if (kidId && !pageOn(db, kidId, 'calendar')) return days.map((d) => ({ ...d, external: [] }));
  await refreshStale(db, ctx.homeId);
  const ext = externalBetween(db, ctx.homeId, days[0].date, days[days.length - 1].date, ctx.actor.kind !== 'parent');
  return days.map((d) => ({ ...d, external: ext.get(d.date) ?? [] }));
}

export function choreRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // ---------- managing chores (parents) ----------
  app.get('/api/homes/:homeId/chores', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return (db.prepare('SELECT * FROM chores WHERE home_id = ? AND active = 1 ORDER BY title').all(ctx.homeId) as Row[]).map((r) => choreView(db, r));
  });

  app.post('/api/homes/:homeId/chores', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const today = homeToday(homeInfo(db, ctx.homeId));
    const c = choreInput(db, ctx.homeId, (req.body ?? {}) as Row, today);
    const id = newId();
    tx(db, () => {
      db.prepare(`INSERT INTO chores (id, home_id, title, icon, points, schedule, weekdays, due_date, start_date, created_by, bonus, claim_limit, category)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, ctx.homeId, c.title, c.icon, c.points, c.schedule, JSON.stringify(c.weekdays), c.dueDate,
          c.dueDate && c.dueDate < today ? c.dueDate : today, ctx.user?.id ?? null, c.bonus ? 1 : 0, c.claimLimit, c.category);
      setAssignments(db, id, c.memberIds!);
    });
    syncChore(db, ctx.homeId, id, today);
    return choreView(db, getChore(db, ctx.homeId, id));
  });

  app.patch('/api/homes/:homeId/chores/:choreId', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const today = homeToday(homeInfo(db, ctx.homeId));
    const cur = getChore(db, ctx.homeId, (req.params as { choreId: string }).choreId);
    const c = choreInput(db, ctx.homeId, (req.body ?? {}) as Row, today, cur);
    tx(db, () => {
      db.prepare(`UPDATE chores SET title = ?, icon = ?, points = ?, schedule = ?, weekdays = ?, due_date = ?, bonus = ?, claim_limit = ?, category = ?,
        start_date = MIN(start_date, COALESCE(?, start_date)), updated_at = datetime('now') WHERE id = ?`)
        .run(c.title, c.icon, c.points, c.schedule, JSON.stringify(c.weekdays), c.dueDate, c.bonus ? 1 : 0, c.claimLimit, c.category, c.dueDate, cur.id as string);
      if (c.memberIds) setAssignments(db, cur.id as string, c.memberIds);
    });
    syncChore(db, ctx.homeId, cur.id as string, today);
    return choreView(db, getChore(db, ctx.homeId, cur.id as string));
  });

  // Chores are retired rather than erased, so past days keep showing what was done.
  app.delete('/api/homes/:homeId/chores/:choreId', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const cur = getChore(db, ctx.homeId, (req.params as { choreId: string }).choreId);
    db.prepare("UPDATE chores SET active = 0, updated_at = datetime('now') WHERE id = ?").run(cur.id as string);
    syncChore(db, ctx.homeId, cur.id as string, homeToday(homeInfo(db, ctx.homeId)));
    return { ok: true };
  });

  // ---------- the week ----------
  app.get('/api/homes/:homeId/agenda', async (req) => {
    const ctx = homeCtx(db, req);
    const home = homeInfo(db, ctx.homeId);
    const today = homeToday(home);
    const q = req.query as { start?: string; days?: string; kid?: string };
    const start = startParam(q.start, startOfWeek(today, home.weekStart));
    const days = Math.min(Math.max(Number(q.days) || 7, 1), 42);
    const kidIds = agendaKids(db, ctx, q.kid);
    // Scheduled practices and appointments: parents see them; kids only when Doctors is shared with them.
    const withExt = withDoctors(db, await withFeeds(db, ctx, agenda(db, ctx.homeId, kidIds, start, days, today), ctx.actor.kind === 'kid' ? ctx.actor.memberId : q.kid), doctorKids(db, ctx, q.kid), ctx.actor.kind !== 'parent');
    if (ctx.actor.kind !== 'parent' || q.kid) return { today, start, days: withExt };
    const duty = dutyDue(db, ctx.homeId, start, addDays(start, days - 1));
    const reminders = remindersDue(db, ctx.homeId, start, addDays(start, days - 1));
    return { today, start, days: withExt.map((d) => ({ ...d, duty: duty.filter((x) => x.dueDate === d.date), reminders: reminders.filter((x) => x.dueDate === d.date) })) };
  });

  // Everything a kid's screen needs in one go.
  app.get('/api/homes/:homeId/kids/:memberId/board', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    const kid = getKid(db, ctx, memberId);
    const home = homeInfo(db, ctx.homeId);
    const today = homeToday(home);
    const thisWeek = startOfWeek(today, home.weekStart);
    // Pages a parent switched off for this kid are left out (their data is kept).
    const on = (page: KidPage) => pageOn(db, memberId, page);
    const start = startParam((req.query as { start?: string }).start, thisWeek);
    return {
      today,
      weekStart: start,
      kid: kidView(db, kid),
      stats: kidWeek(db, home, memberId, today),
      todayItems: on('chores') ? todayList(db, ctx.homeId, memberId, today) : [],
      week: withDoctors(db, await withFeeds(db, ctx, on('chores') ? agenda(db, ctx.homeId, [memberId], start, 7, today) : agenda(db, ctx.homeId, [], start, 7, today), memberId), [memberId], ctx.actor.kind !== 'parent'),
      goals: on('goals') ? goalsFor(db, memberId) : [],
      bonus: on('chores') ? bonusOffers(db, ctx.homeId, memberId, today) : [],
      level: levelOf(db, memberId),
      streak: streaks(db, memberId, today),
      achievements: on('stats') ? achievements(db, memberId, today) : [],
      recent: ledger(db, memberId, 8),
      // Only when a parent chose to share it; parents see the full therapy section on its own page.
      therapy: on('doctors') ? kidTherapyView(db, memberId, today) : null,
      timeouts: on('timeout') ? kidTimeouts(db, memberId) : [],
    };
  });

  // The daily den message on the kid's screen (its own request, so the board never waits on the AI). Off with Chores.
  app.get('/api/homes/:homeId/kids/:memberId/room-message', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    const kid = kidView(db, getKid(db, ctx, memberId));
    if (!pageOn(db, memberId, 'chores')) return null;
    return roomMessage(db, ctx.homeId, kid, homeToday(homeInfo(db, ctx.homeId)));
  });

  // ---------- kanban and bonus chores ----------
  app.post('/api/homes/:homeId/instances/:id/start', async (req) => {
    const ctx = homeCtx(db, req);
    const { id } = req.params as { id: string };
    const { memberId } = getInstance(db, ctx.homeId, id);
    actingKid(db, ctx, memberId);
    assertCanActFor(ctx, memberId);
    const started = (req.body as Row)?.started !== false;
    return { item: setStarted(db, ctx.homeId, id, started, homeToday(homeInfo(db, ctx.homeId))) };
  });

  app.post('/api/homes/:homeId/chores/:choreId/claim', async (req) => {
    const ctx = homeCtx(db, req);
    const memberId = actingKid(db, ctx, (req.body as Row)?.memberId);
    return { item: claimBonus(db, ctx.homeId, (req.params as { choreId: string }).choreId, memberId, homeToday(homeInfo(db, ctx.homeId))) };
  });

  app.post('/api/homes/:homeId/instances/:id/unclaim', async (req) => {
    const ctx = homeCtx(db, req);
    const { id } = req.params as { id: string };
    const { memberId } = getInstance(db, ctx.homeId, id);
    actingKid(db, ctx, memberId);
    assertCanActFor(ctx, memberId);
    unclaimBonus(db, ctx.homeId, id);
    return { ok: true };
  });

  // ---------- stats and charts ----------
  // The Doctors panel (parents only, Doctors on) and the Goals panel (Goals on), over the same weeks as the charts.
  const panels = (memberId: string, home: HomeInfo, today: string, weeks: number, parent: boolean) => {
    const from = startOfWeek(addDays(today, -7 * (weeks - 1)), home.weekStart);
    return {
      doctors: parent && pageOn(db, memberId, 'doctors') ? doctorsStats(db, home, memberId, from, today, doctorAreasOff(db, memberId)) : null,
      goalStats: pageOn(db, memberId, 'goals') ? goalsStats(db, home, memberId, from, today) : null,
    };
  };
  app.get('/api/homes/:homeId/stats', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const home = homeInfo(db, ctx.homeId);
    const today = homeToday(home);
    const weeks = Math.min(Math.max(Number((req.query as { weeks?: string }).weeks) || 12, 2), 52);
    const off = kidsWithPageOff(db, ctx.homeId, 'stats');
    return { today, weeks, kids: listKids(db, ctx.homeId).filter((k) => !off.has(k.id)).map((k) => ({ ...k, ...kidStats(db, home, k.id, today, weeks), ...panels(k.id, home, today, weeks, true) })) };
  });

  app.get('/api/homes/:homeId/kids/:memberId/stats', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    const kid = kidView(db, getKid(db, ctx, memberId));
    const home = homeInfo(db, ctx.homeId);
    const today = homeToday(home);
    const weeks = Math.min(Math.max(Number((req.query as { weeks?: string }).weeks) || 12, 2), 52);
    return { today, weeks, kid: { ...kid, ...kidStats(db, home, memberId, today, weeks), ...panels(memberId, home, today, weeks, ctx.actor.kind === 'parent') }, achievements: achievements(db, memberId, today) };
  });

  // ---------- doing chores ----------
  // A kid's "done" waits for a parent; a parent's "done" counts straight away.
  app.post('/api/homes/:homeId/instances/:id/done', async (req) => {
    const ctx = homeCtx(db, req);
    const { id } = req.params as { id: string };
    const inst = getInstance(db, ctx.homeId, id);
    if (ctx.actor.kind === 'parent') return approveInstance(db, ctx.homeId, id, byOf(ctx));
    if (ctx.actor.kind !== 'kid') throw new HttpError(403, 'Tap your avatar first');
    assertCanActFor(ctx, inst.memberId);
    return { item: submitInstance(db, ctx.homeId, id, homeToday(homeInfo(db, ctx.homeId))), awarded: 0 };
  });

  app.post('/api/homes/:homeId/instances/:id/undo', async (req) => {
    const ctx = homeCtx(db, req);
    const { id } = req.params as { id: string };
    const inst = getInstance(db, ctx.homeId, id);
    if (ctx.actor.kind === 'parent') {
      return { item: inst.status === 'approved' ? unapproveInstance(db, ctx.homeId, id, byOf(ctx)) : unsubmitInstance(db, ctx.homeId, id) };
    }
    if (ctx.actor.kind !== 'kid') throw new HttpError(403, 'Tap your avatar first');
    assertCanActFor(ctx, inst.memberId);
    return { item: unsubmitInstance(db, ctx.homeId, id) };
  });

  // ---------- reviewing (parents) ----------
  app.get('/api/homes/:homeId/review', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const off = kidsWithPageOff(db, ctx.homeId, 'chores');
    return reviewQueue(db, ctx.homeId).filter((i) => !off.has(i.memberId));
  });

  app.post('/api/homes/:homeId/instances/:id/approve', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return approveInstance(db, ctx.homeId, (req.params as { id: string }).id, byOf(ctx));
  });

  app.post('/api/homes/:homeId/review/approve', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const ids = (req.body as Row)?.ids;
    if (!Array.isArray(ids)) throw new HttpError(400, 'Send the chores to approve');
    let awarded = 0;
    for (const id of ids.slice(0, 500)) awarded += approveInstance(db, ctx.homeId, String(id), byOf(ctx)).awarded;
    return { approved: ids.length, awarded };
  });

  app.post('/api/homes/:homeId/instances/:id/reject', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return { item: rejectInstance(db, ctx.homeId, (req.params as { id: string }).id, byOf(ctx), str((req.body as Row)?.note, 200)) };
  });

  // ---------- summaries ----------
  app.get('/api/homes/:homeId/summary', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const home = homeInfo(db, ctx.homeId);
    const today = homeToday(home);
    const weekStart = startOfWeek(today, home.weekStart);
    return {
      today,
      weekStart,
      weekEnd: addDays(weekStart, 6),
      waiting: reviewQueue(db, ctx.homeId).length,
      timeouts: homeTimeouts(db, ctx.homeId),
      helpdesk: waitingRequests(db, ctx.homeId),
      // Overdue, due today and the next week (undated ones live on the Reminders page).
      reminders: listReminders(db, ctx.homeId).filter((r) => r.state === 'overdue' || r.state === 'today' || (r.state === 'upcoming' && r.dueDate! <= addDays(today, 7))),
      kids: listKids(db, ctx.homeId).map((k) => ({
        ...k, ...kidWeek(db, home, k.id, today), goals: goalsFor(db, k.id), streak: streaks(db, k.id, today), level: levelOf(db, k.id),
      })),
    };
  });
}
