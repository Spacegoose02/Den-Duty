// Therapy section per kid: appointments, development / doctor / speech / feeding goals, and progress notes.
// Parents only. A parent can choose to show a kid their own active goals and upcoming appointments (never notes).
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, num, parseJson, requireStr, str } from '../util.ts';
import { homeInfo, homeToday, writeLedger } from '../chores.ts';
import { byOf } from './chores.ts';
import { doctorAreasOff, getKid, pageOn } from './homes.ts';
import { appointmentOn, goalAreaOn } from '../../../shared/pages.ts';
import { cleanWeekdays, dateRange, isIsoDate, weekdayOf } from '../../../shared/schedule.ts';

export const APPOINTMENT_KINDS = ['doctor', 'speech', 'feeding', 'occupational', 'physical', 'behavioral', 'dental', 'other'] as const;
export const GOAL_AREAS = ['development', 'speech', 'feeding', 'doctor', 'motor', 'sensory', 'selfcare', 'physical', 'behavioral', 'dental', 'social', 'other'] as const;
/** Goal areas the occupational therapy helper looks at. */
export const OT_AREAS = ['motor', 'sensory', 'selfcare'];

function rewardPoints(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = num(v);
  if (n == null || !Number.isInteger(n) || n < 0 || n > 1000) throw new HttpError(400, 'Reward points are a whole number from 0 to 1000');
  return n;
}

/**
 * What the kid sees in their points history. Only a kid whose therapy is shared with them sees the goal's name;
 * otherwise it's a kind, private "great practice".
 */
function rewardReason(db: DatabaseSync, memberId: string, title: string, met: boolean): string {
  const shared = !!(db.prepare('SELECT therapy_kid_visible FROM members WHERE id = ?').get(memberId) as Row).therapy_kid_visible;
  if (met) return shared ? `🏆 You reached a big goal: ${title}!` : '🏆 You reached a big goal!';
  return shared ? `🌈 Great practice: ${title}` : '🌈 Great practice!';
}
const STATUSES = ['scheduled', 'done', 'cancelled', 'missed'] as const;
const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const oneOf = <T extends string>(list: readonly T[], v: unknown, field: string, fallback?: T): T => {
  if (v == null && fallback) return fallback;
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new HttpError(400, `${field} must be one of: ${list.join(', ')}`);
  return v as T;
};

function progressValue(v: unknown): number {
  const n = num(v);
  if (n == null || !Number.isInteger(n) || n < 0 || n > 100) throw new HttpError(400, 'Progress is a whole number from 0 to 100');
  return n;
}

const appointmentView = (r: Row) => ({
  id: r.id as string, memberId: r.member_id as string, kind: r.kind as string, title: r.title as string, provider: r.provider as string | null,
  location: r.location as string | null, startsAt: r.starts_at as string, durationMinutes: r.duration_minutes as number | null,
  status: r.status as string, notes: r.notes as string | null,
});

function goalView(db: DatabaseSync, r: Row) {
  const history = (db.prepare('SELECT date, progress FROM therapy_notes WHERE goal_id = ? AND progress IS NOT NULL ORDER BY date, created_at').all(r.id as string) as Row[])
    .map((h) => ({ date: h.date as string, progress: h.progress as number }));
  return {
    id: r.id as string, memberId: r.member_id as string, area: r.area as string, title: r.title as string, description: r.description as string | null,
    targetDate: r.target_date as string | null, status: r.status as string, progress: r.progress as number,
    createdAt: r.created_at as string, metAt: r.met_at as string | null, history,
    rewardStep: (r.reward_step as number) ?? 0, rewardMet: (r.reward_met as number) ?? 0, rewardMetPaid: !!r.reward_met_paid,
    practice: r.practice_schedule ? {
      schedule: r.practice_schedule as 'weekly' | 'once', weekdays: cleanWeekdays(parseJson(r.practice_weekdays, [])),
      date: r.practice_date as string | null, time: r.practice_time as string | null,
    } : null,
  };
}

/** Practice schedule from a goal form: none, some weekdays (optionally at a time), or one date. */
function applyPractice(db: DatabaseSync, id: string, b: Row): void {
  if (!('practiceSchedule' in b)) return;
  const kind = b.practiceSchedule == null || b.practiceSchedule === 'none' || b.practiceSchedule === '' ? null : String(b.practiceSchedule);
  if (kind && kind !== 'weekly' && kind !== 'once') throw new HttpError(400, 'Practice schedule is none, weekly or once');
  const weekdays = kind === 'weekly' ? cleanWeekdays(b.practiceWeekdays) : [];
  if (kind === 'weekly' && !weekdays.length) throw new HttpError(400, 'Pick at least one practice day');
  const date = kind === 'once' ? b.practiceDate : null;
  if (kind === 'once' && !isIsoDate(date)) throw new HttpError(400, 'Pick a practice date');
  const time = kind && b.practiceTime ? String(b.practiceTime) : null;
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'Practice times look like 16:30');
  db.prepare('UPDATE therapy_goals SET practice_schedule = ?, practice_weekdays = ?, practice_date = ?, practice_time = ? WHERE id = ?')
    .run(kind, JSON.stringify(weekdays), date as string | null, time, id);
}

function ownRow(db: DatabaseSync, table: 'therapy_appointments' | 'therapy_goals' | 'therapy_notes', ctx: HomeCtx, id: string): Row {
  const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND home_id = ?`).get(id, ctx.homeId) as Row | undefined;
  if (!r) throw new HttpError(404, 'That is gone');
  return r;
}

/** What a kid may see about their own therapy, when a parent has turned it on. */
export function kidTherapyView(db: DatabaseSync, memberId: string, today: string) {
  const m = db.prepare('SELECT therapy_kid_visible FROM members WHERE id = ?').get(memberId) as Row | undefined;
  if (!m?.therapy_kid_visible) return null;
  const off = doctorAreasOff(db, memberId);
  return {
    goals: (db.prepare("SELECT id, area, title, progress, reward_step, reward_met FROM therapy_goals WHERE member_id = ? AND status = 'active' ORDER BY created_at").all(memberId) as Row[])
      .filter((g) => goalAreaOn(g.area as string, off))
      .map((g) => ({
        id: g.id as string, area: g.area as string, title: g.title as string, progress: g.progress as number,
        rewardStep: g.reward_step as number, rewardMet: g.reward_met as number,
      })),
    upcoming: (db.prepare(`SELECT id, kind, title, provider, starts_at FROM therapy_appointments
      WHERE member_id = ? AND status = 'scheduled' AND starts_at >= ? ORDER BY starts_at LIMIT 20`).all(memberId, today) as Row[])
      .filter((a) => appointmentOn(a.kind as string, off)).slice(0, 3)
      .map((a) => ({ id: a.id as string, kind: a.kind as string, title: a.title as string, provider: a.provider as string | null, startsAt: a.starts_at as string })),
  };
}

export function therapyRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/kids/:memberId/therapy', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const id = kid.id as string;
    if (!pageOn(db, id, 'doctors')) throw new HttpError(403, `Doctors is turned off for ${kid.name}. Turn it on in Kids → Edit.`);
    // Only the sections turned on for this kid; the rest is kept, just hidden.
    const off = doctorAreasOff(db, id);
    const goalRows = db.prepare("SELECT * FROM therapy_goals WHERE member_id = ? ORDER BY status = 'active' DESC, created_at DESC").all(id) as Row[];
    const hiddenGoals = new Set(goalRows.filter((g) => !goalAreaOn(g.area as string, off)).map((g) => g.id as string));
    return {
      kidVisible: !!kid.therapy_kid_visible,
      areasOff: off,
      appointments: (db.prepare('SELECT * FROM therapy_appointments WHERE member_id = ? ORDER BY starts_at DESC LIMIT 200').all(id) as Row[])
        .filter((a) => appointmentOn(a.kind as string, off)).map(appointmentView),
      goals: goalRows.filter((g) => !hiddenGoals.has(g.id as string)).map((g) => goalView(db, g)),
      notes: (db.prepare(`SELECT n.*, g.title AS goal_title FROM therapy_notes n LEFT JOIN therapy_goals g ON g.id = n.goal_id
        WHERE n.member_id = ? ORDER BY n.date DESC, n.created_at DESC LIMIT 100`).all(id) as Row[])
        .filter((n) => !n.goal_id || !hiddenGoals.has(n.goal_id as string)).map((n) => ({
        id: n.id as string, goalId: n.goal_id as string | null, goalTitle: n.goal_title as string | null, appointmentId: n.appointment_id as string | null,
        body: n.body as string, progress: n.progress as number | null, date: n.date as string, by: n.by_name as string | null,
      })),
    };
  });

  app.patch('/api/homes/:homeId/kids/:memberId/therapy', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    if (typeof (req.body as Row)?.kidVisible !== 'boolean') throw new HttpError(400, 'kidVisible must be true or false');
    db.prepare('UPDATE members SET therapy_kid_visible = ? WHERE id = ?').run((req.body as Row).kidVisible ? 1 : 0, kid.id as string);
    return { ok: true };
  });

  // Everyone's next appointments, for the parents' home screen.
  app.get('/api/homes/:homeId/therapy/upcoming', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const today = homeToday(homeInfo(db, ctx.homeId));
    return (db.prepare(`SELECT a.*, m.name AS kid_name, m.avatar AS kid_avatar FROM therapy_appointments a JOIN members m ON m.id = a.member_id
      WHERE a.home_id = ? AND a.status = 'scheduled' AND a.starts_at >= ? ORDER BY a.starts_at LIMIT 50`).all(ctx.homeId, today) as Row[])
      .filter((r) => pageOn(db, r.member_id as string, 'doctors') && appointmentOn(r.kind as string, doctorAreasOff(db, r.member_id as string)))
      .slice(0, 10)
      .map((r) => ({ ...appointmentView(r), kidName: r.kid_name as string, kidAvatar: r.kid_avatar as string }));
  });

  // ----- appointments -----
  app.post('/api/homes/:homeId/kids/:memberId/therapy/appointments', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const b = (req.body ?? {}) as Row;
    if (typeof b.startsAt !== 'string' || !LOCAL_DT.test(b.startsAt)) throw new HttpError(400, 'Pick a date and time');
    const id = newId();
    db.prepare(`INSERT INTO therapy_appointments (id, home_id, member_id, kind, title, provider, location, starts_at, duration_minutes, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.homeId, kid.id as string, oneOf(APPOINTMENT_KINDS, b.kind, 'Kind', 'other'),
      requireStr(b.title, 'Title', 100), str(b.provider, 100), str(b.location, 200), b.startsAt, num(b.durationMinutes), str(b.notes, 2000), ctx.user?.id ?? null);
    return appointmentView(ownRow(db, 'therapy_appointments', ctx, id));
  });

  app.patch('/api/homes/:homeId/therapy/appointments/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const cur = ownRow(db, 'therapy_appointments', ctx, (req.params as { id: string }).id);
    const b = (req.body ?? {}) as Row;
    if ('startsAt' in b && (typeof b.startsAt !== 'string' || !LOCAL_DT.test(b.startsAt))) throw new HttpError(400, 'Pick a date and time');
    db.prepare(`UPDATE therapy_appointments SET kind = ?, title = ?, provider = ?, location = ?, starts_at = ?, duration_minutes = ?, status = ?, notes = ? WHERE id = ?`).run(
      'kind' in b ? oneOf(APPOINTMENT_KINDS, b.kind, 'Kind') : cur.kind as string,
      'title' in b ? requireStr(b.title, 'Title', 100) : cur.title as string,
      'provider' in b ? str(b.provider, 100) : cur.provider as string | null,
      'location' in b ? str(b.location, 200) : cur.location as string | null,
      'startsAt' in b ? b.startsAt as string : cur.starts_at as string,
      'durationMinutes' in b ? num(b.durationMinutes) : cur.duration_minutes as number | null,
      'status' in b ? oneOf(STATUSES, b.status, 'Status') : cur.status as string,
      'notes' in b ? str(b.notes, 2000) : cur.notes as string | null,
      cur.id as string);
    return appointmentView(ownRow(db, 'therapy_appointments', ctx, cur.id as string));
  });

  app.delete('/api/homes/:homeId/therapy/appointments/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM therapy_appointments WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  // ----- goals -----
  app.post('/api/homes/:homeId/kids/:memberId/therapy/goals', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const b = (req.body ?? {}) as Row;
    if (b.targetDate != null && b.targetDate !== '' && !isIsoDate(b.targetDate)) throw new HttpError(400, 'Target dates look like 2026-12-01');
    const id = newId();
    db.prepare(`INSERT INTO therapy_goals (id, home_id, member_id, area, title, description, target_date, progress, created_by, reward_step, reward_met)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, ctx.homeId, kid.id as string, oneOf(GOAL_AREAS, b.area, 'Area', 'development'), requireStr(b.title, 'Goal', 120), str(b.description, 2000),
        (b.targetDate as string) || null, b.progress == null ? 0 : progressValue(b.progress), ctx.user?.id ?? null,
        rewardPoints(b.rewardStep), rewardPoints(b.rewardMet));
    applyPractice(db, id, b);
    return goalView(db, ownRow(db, 'therapy_goals', ctx, id));
  });

  app.get('/api/homes/:homeId/therapy/goals/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return goalView(db, ownRow(db, 'therapy_goals', ctx, (req.params as { id: string }).id));
  });

  app.patch('/api/homes/:homeId/therapy/goals/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const cur = ownRow(db, 'therapy_goals', ctx, (req.params as { id: string }).id);
    const b = (req.body ?? {}) as Row;
    const status = 'status' in b ? oneOf(['active', 'met', 'paused'] as const, b.status, 'Status') : cur.status as string;
    if ('targetDate' in b && b.targetDate != null && b.targetDate !== '' && !isIsoDate(b.targetDate)) throw new HttpError(400, 'Target dates look like 2026-12-01');
    db.prepare(`UPDATE therapy_goals SET area = ?, title = ?, description = ?, target_date = ?, status = ?, progress = ?, updated_at = datetime('now'),
      met_at = CASE WHEN ? = 'met' THEN COALESCE(met_at, datetime('now')) ELSE NULL END WHERE id = ?`).run(
      'area' in b ? oneOf(GOAL_AREAS, b.area, 'Area') : cur.area as string,
      'title' in b ? requireStr(b.title, 'Goal', 120) : cur.title as string,
      'description' in b ? str(b.description, 2000) : cur.description as string | null,
      'targetDate' in b ? (b.targetDate as string) || null : cur.target_date as string | null,
      status,
      'progress' in b ? progressValue(b.progress) : status === 'met' ? 100 : cur.progress as number,
      status, cur.id as string);
    if ('rewardStep' in b) db.prepare('UPDATE therapy_goals SET reward_step = ? WHERE id = ?').run(rewardPoints(b.rewardStep), cur.id as string);
    if ('rewardMet' in b) db.prepare('UPDATE therapy_goals SET reward_met = ? WHERE id = ?').run(rewardPoints(b.rewardMet), cur.id as string);
    applyPractice(db, cur.id as string, b);
    // Reaching the goal pays its bonus once, even if it's later reopened and met again.
    const after = ownRow(db, 'therapy_goals', ctx, cur.id as string);
    if (after.status === 'met' && !after.reward_met_paid && (after.reward_met as number) > 0) {
      tx(db, () => {
        writeLedger(db, {
          homeId: ctx.homeId, memberId: after.member_id as string, amount: after.reward_met as number, kind: 'bonus',
          reason: rewardReason(db, after.member_id as string, after.title as string, true), date: homeToday(homeInfo(db, ctx.homeId)), by: byOf(ctx),
        });
        db.prepare('UPDATE therapy_goals SET reward_met_paid = 1 WHERE id = ?').run(cur.id as string);
      });
    }
    return goalView(db, ownRow(db, 'therapy_goals', ctx, cur.id as string));
  });

  app.delete('/api/homes/:homeId/therapy/goals/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM therapy_goals WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  // ----- notes -----
  // A note can belong to a goal and/or an appointment. A progress value on a goal note moves the goal and adds a chart point.
  app.post('/api/homes/:homeId/kids/:memberId/therapy/notes', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const b = (req.body ?? {}) as Row;
    const goalId = str(b.goalId, 60);
    const appointmentId = str(b.appointmentId, 60);
    if (goalId && ownRow(db, 'therapy_goals', ctx, goalId).member_id !== kid.id) throw new HttpError(400, "That goal is someone else's");
    if (appointmentId && ownRow(db, 'therapy_appointments', ctx, appointmentId).member_id !== kid.id) throw new HttpError(400, "That appointment is someone else's");
    const progress = b.progress == null || b.progress === '' ? null : progressValue(b.progress);
    if (progress != null && !goalId) throw new HttpError(400, 'Progress goes with a goal');
    const date = isIsoDate(b.date) ? b.date : homeToday(homeInfo(db, ctx.homeId));
    const id = newId();
    let awarded = 0;
    tx(db, () => {
      db.prepare(`INSERT INTO therapy_notes (id, home_id, member_id, goal_id, appointment_id, body, progress, date, by_name, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.homeId, kid.id as string, goalId, appointmentId, requireStr(b.body, 'Note', 4000), progress, date,
        ctx.user?.name ?? null, ctx.user?.id ?? null);
      if (goalId && progress != null) db.prepare("UPDATE therapy_goals SET progress = ?, updated_at = datetime('now') WHERE id = ?").run(progress, goalId);
      // A practice note on an active goal with step points pays them (a planned step saved from a tip doesn't).
      if (goalId && b.noReward !== true) {
        const g = ownRow(db, 'therapy_goals', ctx, goalId);
        const pts = g.reward_step as number;
        if (pts > 0 && g.status === 'active') {
          writeLedger(db, {
            homeId: ctx.homeId, memberId: kid.id as string, amount: pts, kind: 'bonus',
            reason: rewardReason(db, kid.id as string, g.title as string, false), date: homeToday(homeInfo(db, ctx.homeId)), by: byOf(ctx),
          });
          db.prepare('UPDATE therapy_notes SET awarded = ? WHERE id = ?').run(pts, id);
          awarded = pts;
        }
      }
    });
    return { id, awarded };
  });

  // Tick a scheduled practice off on the calendar (today or earlier): writes a practice note for that day, with the goal's
  // step points if it pays them. Unticking removes the note and takes those points back with a reversal.
  app.post('/api/homes/:homeId/therapy/goals/:id/practice', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const g = ownRow(db, 'therapy_goals', ctx, (req.params as { id: string }).id);
    const today = homeToday(homeInfo(db, ctx.homeId));
    const date = (req.body as Row | undefined)?.date;
    if (!isIsoDate(date)) throw new HttpError(400, 'Which day?');
    if (date > today) throw new HttpError(400, "That day hasn't happened yet");
    if (g.status !== 'active' || !practiceOn(g, date)) throw new HttpError(400, "There's no practice scheduled that day");
    if (db.prepare('SELECT 1 FROM therapy_notes WHERE goal_id = ? AND date = ? AND practice = 1').get(g.id as string, date)) throw new HttpError(400, 'Already ticked off');
    const id = newId();
    let awarded = 0;
    tx(db, () => {
      db.prepare(`INSERT INTO therapy_notes (id, home_id, member_id, goal_id, body, date, by_name, created_by, practice) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
        .run(id, ctx.homeId, g.member_id as string, g.id as string, '✅ Practiced', date, ctx.user?.name ?? null, ctx.user?.id ?? null);
      const pts = g.reward_step as number;
      if (pts > 0) {
        writeLedger(db, {
          homeId: ctx.homeId, memberId: g.member_id as string, amount: pts, kind: 'bonus',
          reason: rewardReason(db, g.member_id as string, g.title as string, false), date: today, by: byOf(ctx),
        });
        db.prepare('UPDATE therapy_notes SET awarded = ? WHERE id = ?').run(pts, id);
        awarded = pts;
      }
    });
    return { id, awarded };
  });

  app.delete('/api/homes/:homeId/therapy/goals/:id/practice', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const g = ownRow(db, 'therapy_goals', ctx, (req.params as { id: string }).id);
    const date = (req.query as { date?: string }).date;
    const n = db.prepare('SELECT * FROM therapy_notes WHERE goal_id = ? AND date = ? AND practice = 1').get(g.id as string, date ?? '') as Row | undefined;
    if (!n) throw new HttpError(404, "That practice wasn't ticked off");
    tx(db, () => {
      db.prepare('DELETE FROM therapy_notes WHERE id = ?').run(n.id as string);
      if ((n.awarded as number) > 0) {
        writeLedger(db, {
          homeId: ctx.homeId, memberId: g.member_id as string, amount: -(n.awarded as number), kind: 'reversal',
          reason: 'Practice unticked', date: homeToday(homeInfo(db, ctx.homeId)), by: byOf(ctx),
        });
      }
    });
    return { ok: true, reversed: n.awarded as number };
  });

  app.delete('/api/homes/:homeId/therapy/notes/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM therapy_notes WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });
}

// ---------- practices and appointments on the calendars ----------

export interface PracticeItem { goalId: string; memberId: string; title: string; area: string; time: string | null; done: boolean; points: number }
export interface AppointmentItem {
  id: string; memberId: string; kind: string; title: string; provider: string | null; time: string; status: string;
  /** Parents only (for editing from the calendar). */
  location?: string | null; durationMinutes?: number | null; notes?: string | null;
}
export interface DoctorsDay { practices: PracticeItem[]; appointments: AppointmentItem[] }

/** Is a goal's practice scheduled on this date? */
export function practiceOn(g: Row, date: string): boolean {
  if (g.practice_schedule === 'once') return g.practice_date === date;
  if (g.practice_schedule !== 'weekly') return false;
  if (date < String(g.created_at).slice(0, 10)) return false;
  return cleanWeekdays(parseJson(g.practice_weekdays, [])).includes(weekdayOf(date));
}

/**
 * Scheduled practices and appointments per date for some kids. Parents see them whenever Doctors (and the section)
 * is on; kids only when a parent shares Doctors with them.
 */
export function doctorsCalendar(db: DatabaseSync, memberIds: string[], from: string, to: string, forKid: boolean): Map<string, DoctorsDay> {
  const out = new Map<string, DoctorsDay>();
  const day = (d: string) => { let v = out.get(d); if (!v) { v = { practices: [], appointments: [] }; out.set(d, v); } return v; };
  for (const id of memberIds) {
    if (!pageOn(db, id, 'doctors')) continue;
    if (forKid && !(db.prepare('SELECT therapy_kid_visible FROM members WHERE id = ?').get(id) as Row | undefined)?.therapy_kid_visible) continue;
    const off = doctorAreasOff(db, id);
    const goals = (db.prepare("SELECT * FROM therapy_goals WHERE member_id = ? AND status = 'active' AND practice_schedule IS NOT NULL").all(id) as Row[])
      .filter((g) => goalAreaOn(g.area as string, off));
    if (goals.length) {
      const done = new Set((db.prepare(`SELECT goal_id, date FROM therapy_notes WHERE member_id = ? AND practice = 1 AND date BETWEEN ? AND ?`).all(id, from, to) as Row[])
        .map((n) => `${n.goal_id}|${n.date}`));
      for (const d of dateRange(from, to)) {
        for (const g of goals) {
          if (!practiceOn(g, d)) continue;
          day(d).practices.push({
            goalId: g.id as string, memberId: id, title: g.title as string, area: g.area as string, time: (g.practice_time as string | null) ?? null,
            done: done.has(`${g.id}|${d}`), points: g.reward_step as number,
          });
        }
      }
    }
    for (const a of db.prepare(`SELECT * FROM therapy_appointments WHERE member_id = ? AND status != 'cancelled' AND substr(starts_at, 1, 10) BETWEEN ? AND ?
      ORDER BY starts_at`).all(id, from, to) as Row[]) {
      if (!appointmentOn(a.kind as string, off)) continue;
      const [d, time] = (a.starts_at as string).split('T');
      day(d).appointments.push({
        id: a.id as string, memberId: id, kind: a.kind as string, title: a.title as string, provider: a.provider as string | null, time, status: a.status as string,
        ...(forKid ? {} : { location: a.location as string | null, durationMinutes: a.duration_minutes as number | null, notes: a.notes as string | null }),
      });
    }
  }
  for (const v of out.values()) {
    v.practices.sort((x, y) => (x.time ?? '99').localeCompare(y.time ?? '99'));
    v.appointments.sort((x, y) => x.time.localeCompare(y.time));
  }
  return out;
}

/** Adds each day's practices and appointments to agenda days. */
export function withDoctors<D extends { date: string }>(db: DatabaseSync, days: D[], memberIds: string[], forKid: boolean): (D & DoctorsDay)[] {
  if (!days.length) return [];
  const cal = doctorsCalendar(db, memberIds, days[0].date, days[days.length - 1].date, forKid);
  return days.map((d) => ({ ...d, practices: cal.get(d.date)?.practices ?? [], appointments: cal.get(d.date)?.appointments ?? [] }));
}
