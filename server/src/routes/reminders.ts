// Parents' reminders: "call to book Ava's dentist", "renew library books". Optional due date and time, kid tag and
// repeat (every 6 months for checkups). Parents only: never on a kid's screen or the family wall. Ticking a repeating
// reminder moves it to its next date. A "make an appointment" reminder can turn straight into a Doctors appointment.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, num, requireStr, str } from '../util.ts';
import { homeInfo, homeToday } from '../chores.ts';
import { emit } from '../events.ts';
import { getKid } from './homes.ts';
import { APPOINTMENT_KINDS } from './therapy.ts';
import { addDays, addMonths, isIsoDate, timeIn } from '../../../shared/schedule.ts';

const UNITS = ['day', 'week', 'month', 'year'] as const;
type Unit = (typeof UNITS)[number];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function nextDate(from: string, every: number, unit: Unit): string {
  if (unit === 'day') return addDays(from, every);
  if (unit === 'week') return addDays(from, 7 * every);
  return addMonths(from, unit === 'month' ? every : 12 * every);
}

export function reminderView(r: Row, today: string, now: string) {
  const due = r.due_date as string | null;
  const time = r.due_time as string | null;
  const state = r.done_at ? 'done' : !due ? 'someday' : due < today || (due === today && time != null && time <= now) ? 'overdue' : due === today ? 'today' : 'upcoming';
  return {
    id: r.id as string, title: r.title as string, notes: r.notes as string | null, kidId: r.kid_id as string | null, kidName: (r.kid_name as string | null) ?? null,
    dueDate: due, dueTime: time, repeat: r.repeat_unit ? { every: r.repeat_every as number, unit: r.repeat_unit as Unit } : null,
    apptKind: r.appt_kind as string | null, doneAt: r.done_at as string | null, lastDoneAt: r.last_done_at as string | null,
    timesDone: r.times_done as number, state: state as 'done' | 'someday' | 'overdue' | 'today' | 'upcoming',
  };
}
export type ReminderView = ReturnType<typeof reminderView>;

const SELECT = 'SELECT r.*, m.name AS kid_name FROM reminders r LEFT JOIN members m ON m.id = r.kid_id';

function clock(db: DatabaseSync, homeId: string) {
  const home = homeInfo(db, homeId);
  return { today: homeToday(home), now: timeIn(home.timezone) };
}

/** Open reminders (plus ones finished in the last two weeks), soonest first; undated ones last. */
export function listReminders(db: DatabaseSync, homeId: string) {
  const { today, now } = clock(db, homeId);
  return (db.prepare(`${SELECT} WHERE r.home_id = ? AND (r.done_at IS NULL OR r.done_at > datetime('now', '-14 days'))
    ORDER BY r.done_at IS NOT NULL, r.due_date IS NULL, r.due_date, r.due_time IS NULL, r.due_time, r.created_at`).all(homeId) as Row[])
    .map((r) => reminderView(r, today, now));
}

/** Open reminders due in a date range, for the parents' calendar and feed. */
export function remindersDue(db: DatabaseSync, homeId: string, from: string, to: string) {
  const { today, now } = clock(db, homeId);
  return (db.prepare(`${SELECT} WHERE r.home_id = ? AND r.done_at IS NULL AND r.due_date BETWEEN ? AND ? ORDER BY r.due_date, r.due_time`)
    .all(homeId, from, to) as Row[]).map((r) => reminderView(r, today, now));
}

/** Emits reminder_due once per due date for reminders that have come due (for Home Assistant). Run on a timer. */
export function checkDueReminders(db: DatabaseSync): number {
  let sent = 0;
  for (const h of db.prepare('SELECT DISTINCT home_id FROM reminders WHERE done_at IS NULL AND due_date IS NOT NULL').all() as Row[]) {
    const homeId = h.home_id as string;
    const { today, now } = clock(db, homeId);
    const due = (db.prepare(`${SELECT} WHERE r.home_id = ? AND r.done_at IS NULL AND r.due_date <= ? AND (r.notified_for IS NULL OR r.notified_for != r.due_date)`)
      .all(homeId, today) as Row[]).filter((r) => r.due_date !== today || !r.due_time || (r.due_time as string) <= now);
    for (const r of due) {
      db.prepare('UPDATE reminders SET notified_for = due_date WHERE id = ?').run(r.id as string);
      emit(db, homeId, 'reminder_due', (r.kid_id as string | null) ?? null, { reminder: r.title, due_date: r.due_date, due_time: r.due_time, reminder_id: r.id });
      sent++;
    }
  }
  return sent;
}

function fields(db: DatabaseSync, ctx: HomeCtx, b: Row, cur?: Row) {
  const has = (k: string) => k in b || !cur;
  const kidId = has('kidId') ? (b.kidId ? getKid(db, ctx, String(b.kidId)).id as string : null) : cur!.kid_id as string | null;
  const dueDate = has('dueDate') ? (b.dueDate == null || b.dueDate === '' ? null : b.dueDate) : cur!.due_date;
  if (dueDate != null && !isIsoDate(dueDate)) throw new HttpError(400, 'Due dates look like 2026-10-20');
  const dueTime = has('dueTime') ? (b.dueTime == null || b.dueTime === '' ? null : String(b.dueTime)) : cur!.due_time as string | null;
  if (dueTime && !TIME.test(dueTime)) throw new HttpError(400, 'Times look like 09:30');
  let every: number | null = cur ? cur.repeat_every as number | null : null;
  let unit: Unit | null = cur ? cur.repeat_unit as Unit | null : null;
  if ('repeat' in b) {
    if (b.repeat == null || b.repeat === '') { every = null; unit = null; } else {
      const rp = b.repeat as Row;
      every = num(rp.every);
      if (every == null || !Number.isInteger(every) || every < 1 || every > 100) throw new HttpError(400, 'Repeat every 1 to 100');
      if (!(UNITS as readonly unknown[]).includes(rp.unit)) throw new HttpError(400, 'Repeat by day, week, month or year');
      unit = rp.unit as Unit;
    }
  }
  if (unit && !dueDate) throw new HttpError(400, 'A repeating reminder needs a first date');
  const apptKind = has('apptKind') ? (b.apptKind ? String(b.apptKind) : null) : cur!.appt_kind as string | null;
  if (apptKind && !(APPOINTMENT_KINDS as readonly string[]).includes(apptKind)) throw new HttpError(400, 'Unknown appointment type');
  return {
    title: has('title') ? requireStr(b.title, 'Reminder', 120) : cur!.title as string,
    notes: has('notes') ? str(b.notes, 1000) : cur!.notes as string | null,
    kidId, dueDate: dueDate as string | null, dueTime: dueDate ? dueTime : null, every, unit, apptKind,
  };
}

export function reminderRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const one = (ctx: HomeCtx, id: string) => {
    const r = db.prepare(`${SELECT} WHERE r.id = ? AND r.home_id = ?`).get(id, ctx.homeId) as Row | undefined;
    if (!r) throw new HttpError(404, 'That reminder is gone');
    return r;
  };
  const view = (ctx: HomeCtx, id: string) => { const { today, now } = clock(db, ctx.homeId); return reminderView(one(ctx, id), today, now); };

  /** Ticks a reminder off: a repeating one moves to its next date (from its due date, or today if long overdue). */
  const complete = (ctx: HomeCtx, r: Row) => {
    const { today } = clock(db, ctx.homeId);
    if (r.repeat_unit && r.due_date) {
      let next = nextDate(r.due_date as string, r.repeat_every as number, r.repeat_unit as Unit);
      while (next <= today) next = nextDate(next, r.repeat_every as number, r.repeat_unit as Unit);
      db.prepare("UPDATE reminders SET due_date = ?, last_done_at = datetime('now'), times_done = times_done + 1, notified_for = NULL WHERE id = ?").run(next, r.id as string);
    } else {
      db.prepare("UPDATE reminders SET done_at = datetime('now'), last_done_at = datetime('now'), times_done = times_done + 1 WHERE id = ?").run(r.id as string);
    }
    emit(db, ctx.homeId, 'reminder_done', (r.kid_id as string | null) ?? null, { reminder: r.title, reminder_id: r.id });
  };

  app.get('/api/homes/:homeId/reminders', async (req) => listReminders(db, homeCtx(db, req, 'parent').homeId));

  app.post('/api/homes/:homeId/reminders', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const f = fields(db, ctx, (req.body ?? {}) as Row);
    const id = newId();
    db.prepare(`INSERT INTO reminders (id, home_id, title, notes, kid_id, due_date, due_time, repeat_every, repeat_unit, appt_kind, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.homeId, f.title, f.notes, f.kidId, f.dueDate, f.dueTime, f.every, f.unit, f.apptKind, ctx.user?.id ?? null);
    return view(ctx, id);
  });

  app.patch('/api/homes/:homeId/reminders/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const cur = one(ctx, (req.params as { id: string }).id);
    const f = fields(db, ctx, (req.body ?? {}) as Row, cur);
    db.prepare(`UPDATE reminders SET title = ?, notes = ?, kid_id = ?, due_date = ?, due_time = ?, repeat_every = ?, repeat_unit = ?, appt_kind = ?,
      notified_for = CASE WHEN due_date IS ? THEN notified_for ELSE NULL END WHERE id = ?`)
      .run(f.title, f.notes, f.kidId, f.dueDate, f.dueTime, f.every, f.unit, f.apptKind, f.dueDate, cur.id as string);
    return view(ctx, cur.id as string);
  });

  app.delete('/api/homes/:homeId/reminders/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM reminders WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  app.post('/api/homes/:homeId/reminders/:id/done', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const r = one(ctx, (req.params as { id: string }).id);
    if (r.done_at) throw new HttpError(400, 'Already done');
    complete(ctx, r);
    return view(ctx, r.id as string);
  });

  // Undo a finished one-off reminder.
  app.post('/api/homes/:homeId/reminders/:id/reopen', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const r = one(ctx, (req.params as { id: string }).id);
    db.prepare('UPDATE reminders SET done_at = NULL, times_done = MAX(times_done - 1, 0) WHERE id = ?').run(r.id as string);
    return view(ctx, r.id as string);
  });

  // "Make an appointment" → book it: creates the Doctors appointment for the tagged kid and ticks the reminder off.
  app.post('/api/homes/:homeId/reminders/:id/appointment', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const r = one(ctx, (req.params as { id: string }).id);
    const b = (req.body ?? {}) as Row;
    const kid = getKid(db, ctx, String(b.kidId ?? r.kid_id ?? ''));
    if (typeof b.startsAt !== 'string' || !LOCAL_DT.test(b.startsAt)) throw new HttpError(400, 'Pick a date and time');
    const kind = (APPOINTMENT_KINDS as readonly string[]).includes(String(b.kind)) ? String(b.kind) : (r.appt_kind as string | null) ?? 'doctor';
    const apptId = newId();
    tx(db, () => {
      db.prepare(`INSERT INTO therapy_appointments (id, home_id, member_id, kind, title, provider, location, starts_at, duration_minutes, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(apptId, ctx.homeId, kid.id as string, kind, requireStr(b.title, 'Title', 100), str(b.provider, 100),
        str(b.location, 200), b.startsAt as string, num(b.durationMinutes), str(b.notes, 2000), ctx.user?.id ?? null);
      if (!r.done_at) complete(ctx, r);
    });
    return { reminder: view(ctx, r.id as string), appointmentId: apptId };
  });
}
