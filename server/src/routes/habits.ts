// Practice and habits: "Reading, 20 minutes, 5 days a week". A kid starts the timer on their board and taps
// "I did it!". The practice waits for a grown-up (unless the habit is trusted); approving it pays the habit's points
// once per day. The board shows this week's days, so a kid can see "4 of 5 days" fill up.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx, isParent, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, num, requireStr, str } from '../util.ts';
import { homeInfo, homeToday, writeLedger, type By } from '../chores.ts';
import { emit } from '../events.ts';
import { cleanIcon, getKid, pageOn } from './homes.ts';
import { byOf } from './chores.ts';
import { addDays, startOfWeek } from '../../../shared/schedule.ts';
import { HABIT_MAX_MINUTES } from '../../../shared/habits.ts';

export function habitView(db: DatabaseSync, h: Row, today: string, weekStart: number) {
  const from = startOfWeek(today, weekStart);
  const logs = db.prepare('SELECT date, minutes, status FROM habit_logs WHERE habit_id = ? AND date BETWEEN ? AND ? ORDER BY date').all(h.id as string, from, addDays(from, 6)) as Row[];
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(from, i);
    const l = logs.find((x) => x.date === date);
    return { date, status: (l?.status as 'waiting' | 'approved' | 'rejected' | undefined) ?? null, minutes: (l?.minutes as number | undefined) ?? 0 };
  });
  const counted = days.filter((d) => d.status === 'approved' || d.status === 'waiting');
  const todayLog = days.find((d) => d.date === today);
  return {
    id: h.id as string, memberId: h.member_id as string, title: h.title as string, icon: h.icon as string, minutes: h.minutes as number | null,
    targetDays: h.target_days as number, points: h.points as number, needsOk: !!h.needs_ok, position: h.position as number,
    week: { days, doneDays: counted.length, minutes: counted.reduce((n, d) => n + d.minutes, 0), reached: counted.length >= (h.target_days as number) },
    today: todayLog?.status ?? null, todayMinutes: todayLog?.minutes ?? 0,
  };
}
export type HabitView = ReturnType<typeof habitView>;

export function kidHabits(db: DatabaseSync, homeId: string, memberId: string) {
  const home = homeInfo(db, homeId);
  const today = homeToday(home);
  return (db.prepare('SELECT * FROM habits WHERE member_id = ? AND active = 1 ORDER BY position, created_at').all(memberId) as Row[])
    .map((h) => habitView(db, h, today, home.weekStart));
}

/** Practices waiting for a grown-up, for the parent home. */
export function habitsWaiting(db: DatabaseSync, homeId: string) {
  return (db.prepare(`SELECT l.*, h.title, h.icon, h.points, m.name AS kid_name, m.avatar AS kid_avatar FROM habit_logs l
    JOIN habits h ON h.id = l.habit_id JOIN members m ON m.id = l.member_id
    WHERE l.home_id = ? AND l.status = 'waiting' ORDER BY l.date, l.created_at`).all(homeId) as Row[]).map((r) => ({
    id: r.id as string, habitId: r.habit_id as string, memberId: r.member_id as string, date: r.date as string, minutes: r.minutes as number,
    title: r.title as string, icon: r.icon as string, points: r.paid ? 0 : r.points as number,
    kid: { name: r.kid_name as string, avatar: r.kid_avatar as string },
  }));
}

/** Approves a practice: points once per habit per day (a second practice that day only adds minutes). */
function approveLog(db: DatabaseSync, homeId: string, log: Row, by: By): number {
  const h = db.prepare('SELECT * FROM habits WHERE id = ?').get(log.habit_id as string) as Row;
  const pay = !log.paid && (h.points as number) > 0 ? h.points as number : 0;
  db.prepare("UPDATE habit_logs SET status = 'approved', paid = paid + ?, reviewed_at = datetime('now'), reviewed_by = ?, note = NULL WHERE id = ?")
    .run(pay ? 1 : 0, by.name, log.id as string);
  if (pay) {
    writeLedger(db, { homeId, memberId: log.member_id as string, amount: pay, kind: 'bonus', reason: `${h.icon} ${h.title} practice`, date: log.date as string, by });
  }
  return pay;
}

function fields(b: Row, cur?: Row) {
  const has = (k: string) => k in b || !cur;
  const minutes = has('minutes') ? num(b.minutes) : cur!.minutes as number | null;
  if (minutes != null && (!Number.isInteger(minutes) || minutes < 1 || minutes > HABIT_MAX_MINUTES)) throw new HttpError(400, `Minutes are 1 to ${HABIT_MAX_MINUTES}, or empty for no timer`);
  const targetDays = has('targetDays') ? num(b.targetDays) ?? 5 : cur!.target_days as number;
  if (!Number.isInteger(targetDays) || targetDays < 1 || targetDays > 7) throw new HttpError(400, 'Days a week are 1 to 7');
  const points = has('points') ? num(b.points) ?? 0 : cur!.points as number;
  if (!Number.isInteger(points) || points < 0 || points > 1000) throw new HttpError(400, 'Points are 0 to 1000');
  return {
    title: has('title') ? requireStr(b.title, 'Name', 60) : cur!.title as string,
    icon: has('icon') ? cleanIcon(b.icon, '🎯') : cur!.icon as string,
    minutes, targetDays, points,
    needsOk: has('needsOk') ? (b.needsOk === undefined ? 1 : b.needsOk ? 1 : 0) : cur!.needs_ok as number,
  };
}

export function habitRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const habit = (ctx: HomeCtx, id: string) => {
    const h = db.prepare('SELECT * FROM habits WHERE id = ? AND home_id = ? AND active = 1').get(id, ctx.homeId) as Row | undefined;
    if (!h) throw new HttpError(404, 'That practice is gone');
    return h;
  };
  const view = (ctx: HomeCtx, h: Row) => { const home = homeInfo(db, ctx.homeId); return habitView(db, h, homeToday(home), home.weekStart); };

  app.get('/api/homes/:homeId/kids/:memberId/habits', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    getKid(db, ctx, memberId);
    if (!isParent(ctx) && !pageOn(db, memberId, 'habits')) return [];
    return kidHabits(db, ctx.homeId, memberId);
  });

  app.post('/api/homes/:homeId/kids/:memberId/habits', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const f = fields((req.body ?? {}) as Row);
    const id = newId();
    const pos = Number((db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM habits WHERE member_id = ?').get(kid.id as string) as Row).n);
    db.prepare('INSERT INTO habits (id, home_id, member_id, title, icon, minutes, target_days, points, needs_ok, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, ctx.homeId, kid.id as string, f.title, f.icon, f.minutes, f.targetDays, f.points, f.needsOk, pos);
    return view(ctx, habit(ctx, id));
  });

  app.patch('/api/homes/:homeId/habits/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const cur = habit(ctx, (req.params as { id: string }).id);
    const f = fields((req.body ?? {}) as Row, cur);
    db.prepare('UPDATE habits SET title = ?, icon = ?, minutes = ?, target_days = ?, points = ?, needs_ok = ? WHERE id = ?')
      .run(f.title, f.icon, f.minutes, f.targetDays, f.points, f.needsOk, cur.id as string);
    return view(ctx, habit(ctx, cur.id as string));
  });

  // Removing keeps the history (approved practices and their points stay in the ledger).
  app.delete('/api/homes/:homeId/habits/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('UPDATE habits SET active = 0 WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  // "I did it!": a kid logs a practice (waits for a grown-up unless trusted); a parent logging it counts straight away.
  app.post('/api/homes/:homeId/habits/:id/log', async (req) => {
    const ctx = homeCtx(db, req);
    const h = habit(ctx, (req.params as { id: string }).id);
    assertCanActFor(ctx, h.member_id as string);
    if (ctx.actor.kind !== 'kid' && !isParent(ctx)) throw new HttpError(403, 'Pick your raccoon first');
    if (!isParent(ctx) && !pageOn(db, h.member_id as string, 'habits')) throw new HttpError(403, 'Practice is switched off');
    const b = (req.body ?? {}) as Row;
    const minutes = num(b.minutes) ?? h.minutes as number | null ?? 0;
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > HABIT_MAX_MINUTES) throw new HttpError(400, `Minutes are 0 to ${HABIT_MAX_MINUTES}`);
    const today = homeToday(homeInfo(db, ctx.homeId));
    const trusted = isParent(ctx) || !h.needs_ok;
    let paid = 0;
    tx(db, () => {
      const cur = db.prepare('SELECT * FROM habit_logs WHERE habit_id = ? AND date = ?').get(h.id as string, today) as Row | undefined;
      let id = cur?.id as string | undefined;
      if (cur) {
        // Practicing again today adds minutes. A "try again" goes back to waiting.
        const status = cur.status === 'approved' ? 'approved' : trusted ? 'approved' : 'waiting';
        db.prepare('UPDATE habit_logs SET minutes = minutes + ?, status = ? WHERE id = ?').run(minutes, status, id!);
      } else {
        id = newId();
        db.prepare("INSERT INTO habit_logs (id, home_id, habit_id, member_id, date, minutes, status) VALUES (?, ?, ?, ?, ?, ?, 'waiting')")
          .run(id, ctx.homeId, h.id as string, h.member_id as string, today, minutes);
      }
      const log = db.prepare('SELECT * FROM habit_logs WHERE id = ?').get(id!) as Row;
      if (trusted && (log.status !== 'approved' || !log.paid)) paid = approveLog(db, ctx.homeId, log, isParent(ctx) ? byOf(ctx) : { userId: null, name: '✨ Auto-approved' });
      const waiting = (db.prepare('SELECT status FROM habit_logs WHERE id = ?').get(id!) as Row).status === 'waiting';
      emit(db, ctx.homeId, 'habit_logged', h.member_id as string, { habit: h.title, icon: h.icon, minutes, waiting, habit_id: h.id });
    });
    return { habit: view(ctx, h), paid };
  });

  app.get('/api/homes/:homeId/habit-logs', async (req) => habitsWaiting(db, homeCtx(db, req, 'parent').homeId));

  app.post('/api/homes/:homeId/habit-logs/:id/approve', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const log = db.prepare("SELECT * FROM habit_logs WHERE id = ? AND home_id = ?").get((req.params as { id: string }).id, ctx.homeId) as Row | undefined;
    if (!log) throw new HttpError(404, 'That practice is gone');
    if (log.status === 'approved') throw new HttpError(400, 'Already approved');
    return { paid: tx(db, () => approveLog(db, ctx.homeId, log, byOf(ctx))) };
  });

  app.post('/api/homes/:homeId/habit-logs/:id/reject', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const log = db.prepare("SELECT * FROM habit_logs WHERE id = ? AND home_id = ? AND status = 'waiting'").get((req.params as { id: string }).id, ctx.homeId) as Row | undefined;
    if (!log) throw new HttpError(404, 'That practice is gone');
    db.prepare("UPDATE habit_logs SET status = 'rejected', note = ?, reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?")
      .run(str((req.body as Row | undefined)?.note, 200), byOf(ctx).name, log.id as string);
    return { ok: true };
  });
}
