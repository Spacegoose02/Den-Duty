import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, num, requireStr, str } from '../util.ts';
import {
  agenda, approveInstance, getInstance, goalsFor, homeInfo, homeToday, kidWeek, rejectInstance, reviewQueue, submitInstance,
  syncChore, todayList, unapproveInstance, unsubmitInstance, type By,
} from '../chores.ts';
import { cleanIcon, getKid, kidView, listKids } from './homes.ts';
import { addDays, cleanWeekdays, describeSchedule, isIsoDate, startOfWeek, type ScheduleKind } from '../../../shared/schedule.ts';

/** Who to credit in the ledger and review history. */
export function byOf(ctx: HomeCtx): By {
  return ctx.user ? { userId: ctx.user.id, name: ctx.user.name } : { userId: null, name: 'Automation' };
}

function choreView(db: DatabaseSync, r: Row) {
  const weekdays = JSON.parse(r.weekdays as string) as number[];
  const schedule = r.schedule as ScheduleKind;
  return {
    id: r.id as string, title: r.title as string, icon: r.icon as string, points: r.points as number,
    schedule, weekdays, dueDate: r.due_date as string | null, startDate: r.start_date as string,
    describe: describeSchedule({ schedule, weekdays, dueDate: r.due_date as string | null }),
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
  let memberIds: string[] | null = null;
  if ('memberIds' in b || !cur) {
    if (!Array.isArray(b.memberIds)) throw new HttpError(400, 'Pick which kids do this chore');
    const kids = new Set(listKids(db, homeId).map((k) => k.id));
    memberIds = [...new Set(b.memberIds.map(String))];
    if (memberIds.some((m) => !kids.has(m))) throw new HttpError(400, 'Chores can only be assigned to kids in this home');
  }
  return { title, icon, points, schedule, weekdays, dueDate, memberIds };
}

function setAssignments(db: DatabaseSync, choreId: string, memberIds: string[]): void {
  db.prepare('DELETE FROM chore_assignments WHERE chore_id = ?').run(choreId);
  const ins = db.prepare('INSERT INTO chore_assignments (chore_id, member_id) VALUES (?, ?)');
  for (const m of memberIds) ins.run(choreId, m);
}

/** Who the agenda is for: kids only ever see themselves. */
function agendaKids(db: DatabaseSync, ctx: HomeCtx, kid: string | undefined): string[] {
  if (ctx.actor.kind === 'kid') return [ctx.actor.memberId];
  if (kid) return [getKid(db, ctx, kid).id as string];
  return listKids(db, ctx.homeId).map((k) => k.id);
}

function startParam(v: unknown, fallback: string): string {
  if (v == null || v === '') return fallback;
  if (!isIsoDate(v)) throw new HttpError(400, 'Dates look like 2026-10-17');
  return v;
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
      db.prepare(`INSERT INTO chores (id, home_id, title, icon, points, schedule, weekdays, due_date, start_date, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, ctx.homeId, c.title, c.icon, c.points, c.schedule, JSON.stringify(c.weekdays), c.dueDate,
          c.dueDate && c.dueDate < today ? c.dueDate : today, ctx.user?.id ?? null);
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
      db.prepare(`UPDATE chores SET title = ?, icon = ?, points = ?, schedule = ?, weekdays = ?, due_date = ?,
        start_date = MIN(start_date, COALESCE(?, start_date)), updated_at = datetime('now') WHERE id = ?`)
        .run(c.title, c.icon, c.points, c.schedule, JSON.stringify(c.weekdays), c.dueDate, c.dueDate, cur.id as string);
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
    const days = Math.min(Math.max(Number(q.days) || 7, 1), 31);
    return { today, start, days: agenda(db, ctx.homeId, agendaKids(db, ctx, q.kid), start, days, today) };
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
    const start = startParam((req.query as { start?: string }).start, thisWeek);
    return {
      today,
      weekStart: start,
      kid: kidView(db, kid),
      stats: kidWeek(db, home, memberId, today),
      todayItems: todayList(db, ctx.homeId, memberId, today),
      week: agenda(db, ctx.homeId, [memberId], start, 7, today),
      goals: goalsFor(db, memberId),
    };
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
    return reviewQueue(db, ctx.homeId);
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
      kids: listKids(db, ctx.homeId).map((k) => ({ ...k, ...kidWeek(db, home, k.id, today), goals: goalsFor(db, k.id) })),
    };
  });

  // For Home Assistant sensors and other automations (works with an API token).
  app.get('/api/homes/:homeId/ha/summary', async (req) => {
    const ctx = homeCtx(db, req);
    const home = homeInfo(db, ctx.homeId);
    const today = homeToday(home);
    return {
      points_name: home.pointsName,
      waiting_for_review: reviewQueue(db, ctx.homeId).length,
      kids: listKids(db, ctx.homeId).map((k) => {
        const w = kidWeek(db, home, k.id, today);
        return { name: k.name, balance: w.balance, points_this_week: w.pointsThisWeek, left_today: w.leftToday, done_this_week: w.choresDone };
      }),
    };
  });
}
