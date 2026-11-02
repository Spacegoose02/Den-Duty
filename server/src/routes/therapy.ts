// Therapy section per kid: appointments, development / doctor / speech / feeding goals, and progress notes.
// Parents only. A parent can choose to show a kid their own active goals and upcoming appointments (never notes).
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { emit } from '../events.ts';
import { HttpError, newId, num, parseJson, requireStr, str } from '../util.ts';
import { homeInfo, homeToday, writeLedger } from '../chores.ts';
import { byOf } from './chores.ts';
import { doctorAreasOff, getKid, pageOn } from './homes.ts';
import { appointmentOn, goalAreaOn } from '../../../shared/pages.ts';
import { addDays, cleanWeekdays, dateRange, isIsoDate, REPEAT_UNITS, repeatDate, weekdayOf, type RepeatRule, type RepeatUnit } from '../../../shared/schedule.ts';

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

const appointmentView = (db: DatabaseSync, r: Row) => ({
  id: r.id as string, memberId: r.member_id as string, kind: r.kind as string, title: r.title as string, provider: r.provider as string | null,
  location: r.location as string | null, startsAt: r.starts_at as string, durationMinutes: r.duration_minutes as number | null,
  status: r.status as string, notes: r.notes as string | null,
  questions: cleanQuestions(parseJson(r.questions, [])), summary: (r.summary as string | null) ?? null,
  repeat: appointmentRepeat(db, r),
});

// ---------- repeating appointments ----------

/** How far ahead a series' visits are made. The minute timer (and opening Doctors) tops them up as days pass. */
const HORIZON_DAYS: Record<RepeatUnit, number> = { day: 92, week: 183, month: 366 };

/** A repeat rule from a form: null (doesn't repeat) or every N days / weeks / months, ending never, on a date, or after N visits. */
export function cleanRepeat(v: unknown, startDate: string): RepeatRule | null {
  if (v == null || v === false || v === '') return null;
  if (typeof v !== 'object') throw new HttpError(400, 'Repeat must be a rule or nothing');
  const o = v as Row;
  const every = num(o.every);
  if (every == null || !Number.isInteger(every) || every < 1 || every > 365) throw new HttpError(400, 'Repeat every 1 to 365 days, weeks or months');
  if (!(REPEAT_UNITS as string[]).includes(String(o.unit))) throw new HttpError(400, 'Repeat by day, week or month');
  const endDate = o.endDate == null || o.endDate === '' ? null : o.endDate;
  if (endDate != null && (!isIsoDate(endDate) || endDate < startDate)) throw new HttpError(400, 'The repeat end date has to be on or after the first visit');
  const count = o.count == null || o.count === '' ? null : num(o.count);
  if (count != null && (!Number.isInteger(count) || count < 1 || count > 500)) throw new HttpError(400, 'Repeat 1 to 500 times');
  if (endDate && count) throw new HttpError(400, 'End on a date or after a number of visits, not both');
  return { every, unit: String(o.unit) as RepeatUnit, endDate: endDate as string | null, count };
}

/** The repeat rule a visit belongs to, with which visit it is, or null for a one-off. */
function appointmentRepeat(db: DatabaseSync, r: Row): (RepeatRule & { seriesId: string; index: number }) | null {
  if (!r.series_id) return null;
  const s = db.prepare('SELECT * FROM appointment_series WHERE id = ?').get(r.series_id as string) as Row | undefined;
  if (!s) return null;
  return { seriesId: s.id as string, index: (r.series_index as number) ?? 0, every: s.repeat_every as number, unit: s.repeat_unit as RepeatUnit,
    endDate: (s.end_date as string | null) ?? null, count: (s.end_count as number | null) ?? null };
}

/** Makes a series' visits up to its horizon, and marks it finished once it has no more to make. Returns how many it made. */
export function extendSeries(db: DatabaseSync, s: Row, today: string): number {
  const unit = s.repeat_unit as RepeatUnit;
  const horizon = addDays(today, HORIZON_DAYS[unit]);
  const ins = db.prepare(`INSERT INTO therapy_appointments (id, home_id, member_id, kind, title, provider, location, starts_at, duration_minutes, notes, created_by,
    series_id, series_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let i = s.next_index as number;
  let made = 0;
  let finished = false;
  for (;;) {
    if (s.end_count != null && i >= (s.end_count as number)) { finished = true; break; }
    const d = repeatDate(s.start_date as string, s.repeat_every as number, unit, i);
    if (s.end_date && d > (s.end_date as string)) { finished = true; break; }
    if (d > horizon || made >= 400) break;
    ins.run(newId(), s.home_id as string, s.member_id as string, s.kind as string, s.title as string, s.provider as string | null, s.location as string | null,
      `${d}T${s.time}`, s.duration_minutes as number | null, s.notes as string | null, s.created_by as string | null, s.id as string, i);
    i++;
    made++;
  }
  if (i !== s.next_index || finished) db.prepare('UPDATE appointment_series SET next_index = ?, finished = ? WHERE id = ?').run(i, finished ? 1 : 0, s.id as string);
  return made;
}

/** Tops up every running series (in one home, or all of them), each by its home's today. */
export function topUpSeries(db: DatabaseSync, homeId?: string): void {
  const rows = (homeId ? db.prepare('SELECT * FROM appointment_series WHERE finished = 0 AND home_id = ?').all(homeId)
    : db.prepare('SELECT * FROM appointment_series WHERE finished = 0').all()) as Row[];
  if (!rows.length) return;
  const todays = new Map<string, string>();
  tx(db, () => {
    for (const s of rows) {
      const h = s.home_id as string;
      if (!todays.has(h)) todays.set(h, homeToday(homeInfo(db, h)));
      extendSeries(db, s, todays.get(h)!);
    }
  });
}

/** Turns an appointment into the first visit of a new series with its details, and makes the visits after it. */
function startSeries(db: DatabaseSync, appt: Row, rule: RepeatRule): void {
  const id = newId();
  const [date, time] = (appt.starts_at as string).split('T');
  db.prepare(`INSERT INTO appointment_series (id, home_id, member_id, kind, title, provider, location, notes, duration_minutes, start_date, time,
    repeat_every, repeat_unit, end_date, end_count, next_index, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(
    id, appt.home_id as string, appt.member_id as string, appt.kind as string, appt.title as string, appt.provider as string | null, appt.location as string | null,
    appt.notes as string | null, appt.duration_minutes as number | null, date, time, rule.every, rule.unit, rule.endDate, rule.count, appt.created_by as string | null);
  db.prepare('UPDATE therapy_appointments SET series_id = ?, series_index = 0 WHERE id = ?').run(id, appt.id as string);
  extendSeries(db, db.prepare('SELECT * FROM appointment_series WHERE id = ?').get(id) as Row, homeToday(homeInfo(db, appt.home_id as string)));
}

/**
 * Ends a series just before one of its visits: that visit and later ones leave it. Later visits are deleted unless
 * they were marked done (those keep their follow-up).
 */
function endSeriesAt(db: DatabaseSync, appt: Row): void {
  const idx = appt.series_index as number;
  db.prepare("DELETE FROM therapy_appointments WHERE series_id = ? AND series_index > ? AND status != 'done'").run(appt.series_id as string, idx);
  db.prepare('UPDATE appointment_series SET end_count = ?, end_date = NULL, finished = 1 WHERE id = ?').run(idx, appt.series_id as string);
}

/** A new appointment for a kid, repeating when the body has a repeat rule. Returns the (first) appointment's id. */
export function createAppointment(db: DatabaseSync, ctx: HomeCtx, memberId: string, b: Row, kindFallback: (typeof APPOINTMENT_KINDS)[number] = 'other'): string {
  if (typeof b.startsAt !== 'string' || !LOCAL_DT.test(b.startsAt)) throw new HttpError(400, 'Pick a date and time');
  const repeat = cleanRepeat(b.repeat, b.startsAt.slice(0, 10));
  const id = newId();
  tx(db, () => {
    db.prepare(`INSERT INTO therapy_appointments (id, home_id, member_id, kind, title, provider, location, starts_at, duration_minutes, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.homeId, memberId, oneOf(APPOINTMENT_KINDS, b.kind, 'Kind', kindFallback),
      requireStr(b.title, 'Title', 100), str(b.provider, 100), str(b.location, 200), b.startsAt as string, num(b.durationMinutes), str(b.notes, 2000), ctx.user?.id ?? null);
    if ('questions' in b) db.prepare('UPDATE therapy_appointments SET questions = ? WHERE id = ?').run(JSON.stringify(cleanQuestions(b.questions)), id);
    if (repeat) startSeries(db, db.prepare('SELECT * FROM therapy_appointments WHERE id = ?').get(id) as Row, repeat);
  });
  return id;
}

/** Questions to ask at an appointment, ticked off at the visit. */
export function cleanQuestions(v: unknown): { text: string; done: boolean }[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 30).map((q) => {
    const o = (typeof q === 'string' ? { text: q, done: false } : q ?? {}) as Row;
    return { text: String(o.text ?? '').trim().slice(0, 300), done: o.done === true };
  }).filter((q) => q.text);
}

/** Picture steps for kid practice mode: an emoji and a few words each. */
export function cleanSteps(v: unknown): { icon: string; text: string }[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 12).map((x) => {
    const o = (x ?? {}) as Row;
    return { icon: String(o.icon ?? '⭐').trim().slice(0, 16) || '⭐', text: String(o.text ?? '').trim().slice(0, 160) };
  }).filter((x) => x.text);
}

function goalView(db: DatabaseSync, r: Row) {
  const history = (db.prepare('SELECT date, progress FROM therapy_notes WHERE goal_id = ? AND progress IS NOT NULL ORDER BY date, created_at').all(r.id as string) as Row[])
    .map((h) => ({ date: h.date as string, progress: h.progress as number }));
  return {
    id: r.id as string, memberId: r.member_id as string, area: r.area as string, title: r.title as string, description: r.description as string | null,
    targetDate: r.target_date as string | null, status: r.status as string, progress: r.progress as number,
    createdAt: r.created_at as string, metAt: r.met_at as string | null, history,
    rewardStep: (r.reward_step as number) ?? 0, rewardMet: (r.reward_met as number) ?? 0, rewardMetPaid: !!r.reward_met_paid,
    steps: cleanSteps(parseJson(r.steps, [])), practiceMinutes: (r.practice_minutes as number | null) ?? null, kidPractice: !!r.kid_practice,
    practice: r.practice_schedule ? {
      schedule: r.practice_schedule as 'weekly' | 'once', weekdays: cleanWeekdays(parseJson(r.practice_weekdays, [])),
      date: r.practice_date as string | null, time: r.practice_time as string | null,
    } : null,
  };
}

/** Practice schedule from a goal form: none, some weekdays (optionally at a time), or one date. */
function applyPractice(db: DatabaseSync, id: string, b: Row): void {
  if ('steps' in b) db.prepare('UPDATE therapy_goals SET steps = ? WHERE id = ?').run(JSON.stringify(cleanSteps(b.steps)), id);
  if ('kidPractice' in b) db.prepare('UPDATE therapy_goals SET kid_practice = ? WHERE id = ?').run(b.kidPractice === true ? 1 : 0, id);
  if ('practiceMinutes' in b) {
    const m = b.practiceMinutes == null || b.practiceMinutes === '' ? null : num(b.practiceMinutes);
    if (m != null && (!Number.isInteger(m) || m < 1 || m > 60)) throw new HttpError(400, 'Practice timers run 1 to 60 minutes');
    db.prepare('UPDATE therapy_goals SET practice_minutes = ? WHERE id = ?').run(m, id);
  }
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
    goals: (db.prepare("SELECT id, area, title, progress, reward_step, reward_met, steps, practice_minutes, kid_practice FROM therapy_goals WHERE member_id = ? AND status = 'active' ORDER BY created_at").all(memberId) as Row[])
      .filter((g) => goalAreaOn(g.area as string, off))
      .map((g) => ({
        id: g.id as string, area: g.area as string, title: g.title as string, progress: g.progress as number,
        rewardStep: g.reward_step as number, rewardMet: g.reward_met as number,
        // Practice mode: only when a parent turned it on for this goal.
        practiceMode: g.kid_practice ? {
          steps: cleanSteps(parseJson(g.steps, [])), minutes: (g.practice_minutes as number | null) ?? null,
          waiting: !!db.prepare("SELECT 1 FROM practice_requests WHERE goal_id = ? AND date = ? AND status = 'waiting'").get(g.id as string, today),
          doneToday: (db.prepare("SELECT COUNT(*) AS n FROM practice_requests WHERE goal_id = ? AND date = ? AND status = 'approved'").get(g.id as string, today) as Row).n as number,
        } : null,
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
    topUpSeries(db, ctx.homeId);
    const goalRows = db.prepare("SELECT * FROM therapy_goals WHERE member_id = ? ORDER BY status = 'active' DESC, created_at DESC").all(id) as Row[];
    const hiddenGoals = new Set(goalRows.filter((g) => !goalAreaOn(g.area as string, off)).map((g) => g.id as string));
    return {
      kidVisible: !!kid.therapy_kid_visible,
      areasOff: off,
      appointments: (db.prepare('SELECT * FROM therapy_appointments WHERE member_id = ? ORDER BY starts_at DESC LIMIT 200').all(id) as Row[])
        .filter((a) => appointmentOn(a.kind as string, off)).map((a) => appointmentView(db, a)),
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
    topUpSeries(db, ctx.homeId);
    return (db.prepare(`SELECT a.*, m.name AS kid_name, m.avatar AS kid_avatar FROM therapy_appointments a JOIN members m ON m.id = a.member_id
      WHERE a.home_id = ? AND a.status = 'scheduled' AND a.starts_at >= ? ORDER BY a.starts_at LIMIT 50`).all(ctx.homeId, today) as Row[])
      .filter((r) => pageOn(db, r.member_id as string, 'doctors') && appointmentOn(r.kind as string, doctorAreasOff(db, r.member_id as string)))
      .slice(0, 10)
      .map((r) => ({ ...appointmentView(db, r), kidName: r.kid_name as string, kidAvatar: r.kid_avatar as string }));
  });

  // ----- appointments -----
  app.post('/api/homes/:homeId/kids/:memberId/therapy/appointments', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const id = createAppointment(db, ctx, kid.id as string, (req.body ?? {}) as Row);
    return appointmentView(db, ownRow(db, 'therapy_appointments', ctx, id));
  });

  app.patch('/api/homes/:homeId/therapy/appointments/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const cur = ownRow(db, 'therapy_appointments', ctx, (req.params as { id: string }).id);
    const b = (req.body ?? {}) as Row;
    if ('startsAt' in b && (typeof b.startsAt !== 'string' || !LOCAL_DT.test(b.startsAt))) throw new HttpError(400, 'Pick a date and time');
    // A repeating visit changes on its own ("one", the default), or with every later visit ("following"), which can also
    // change or stop the repeat. A one-off appointment with a repeat rule starts repeating from itself.
    const following = b.scope === 'following' && !!cur.series_id;
    const startsAt = 'startsAt' in b ? b.startsAt as string : cur.starts_at as string;
    let rule: RepeatRule | null | undefined;
    if ('repeat' in b && (following || !cur.series_id)) rule = cleanRepeat(b.repeat, startsAt.slice(0, 10));
    else if (following) {
      const s = db.prepare('SELECT * FROM appointment_series WHERE id = ?').get(cur.series_id as string) as Row;
      const left = s.end_count == null ? null : (s.end_count as number) - (cur.series_index as number);
      rule = { every: s.repeat_every as number, unit: s.repeat_unit as RepeatUnit, endDate: (s.end_date as string | null) ?? null, count: left };
      if (rule.endDate && rule.endDate < startsAt.slice(0, 10)) rule = null;
    }
    tx(db, () => {
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
      if ('questions' in b) db.prepare('UPDATE therapy_appointments SET questions = ? WHERE id = ?').run(JSON.stringify(cleanQuestions(b.questions)), cur.id as string);
      if ('summary' in b) db.prepare('UPDATE therapy_appointments SET summary = ? WHERE id = ?').run(str(b.summary, 4000), cur.id as string);
      if (following) {
        endSeriesAt(db, cur);
        db.prepare('UPDATE therapy_appointments SET series_id = NULL, series_index = NULL WHERE id = ?').run(cur.id as string);
      }
      if ((following || !cur.series_id) && rule && rule.count !== 1) startSeries(db, ownRow(db, 'therapy_appointments', ctx, cur.id as string), rule);
    });
    return appointmentView(db, ownRow(db, 'therapy_appointments', ctx, cur.id as string));
  });

  // ?scope=following deletes a repeating visit and every later one (visits marked done stay), ending the repeat.
  app.delete('/api/homes/:homeId/therapy/appointments/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const cur = db.prepare('SELECT * FROM therapy_appointments WHERE id = ? AND home_id = ?').get((req.params as { id: string }).id, ctx.homeId) as Row | undefined;
    if (!cur) return { ok: true };
    tx(db, () => {
      if ((req.query as { scope?: string }).scope === 'following' && cur.series_id) endSeriesAt(db, cur);
      db.prepare('DELETE FROM therapy_appointments WHERE id = ?').run(cur.id as string);
    });
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
    if (g.status !== 'active' || !practiceSlots(db, g, date, date).some((s) => s.date === date && !s.skipped)) throw new HttpError(400, "There's no practice scheduled that day");
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

  // Just this day: skip one scheduled practice, or move it to another date/time. The schedule itself stays.
  app.post('/api/homes/:homeId/therapy/goals/:id/practice-exception', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const g = ownRow(db, 'therapy_goals', ctx, (req.params as { id: string }).id);
    const b = (req.body ?? {}) as Row;
    if (!isIsoDate(b.date) || !practiceOn(g, b.date)) throw new HttpError(400, "There's no practice scheduled that day");
    if (b.action !== 'skip' && b.action !== 'move') throw new HttpError(400, 'Skip it or move it');
    let newDate: string | null = null;
    let newTime: string | null = null;
    if (b.action === 'move') {
      if (!isIsoDate(b.newDate)) throw new HttpError(400, 'Pick the new day');
      newDate = b.newDate;
      newTime = b.newTime ? String(b.newTime) : null;
      if (newTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(newTime)) throw new HttpError(400, 'Times look like 16:30');
      if (newDate === b.date && newTime === (g.practice_time ?? null)) throw new HttpError(400, "That's the same day and time");
    }
    db.prepare('INSERT OR REPLACE INTO practice_exceptions (goal_id, date, action, new_date, new_time) VALUES (?, ?, ?, ?, ?)').run(g.id as string, b.date, b.action, newDate, newTime);
    return { ok: true };
  });

  // Undo a skip or move: the day goes back to the regular schedule.
  app.delete('/api/homes/:homeId/therapy/goals/:id/practice-exception', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const g = ownRow(db, 'therapy_goals', ctx, (req.params as { id: string }).id);
    db.prepare('DELETE FROM practice_exceptions WHERE goal_id = ? AND date = ?').run(g.id as string, (req.query as { date?: string }).date ?? '');
    return { ok: true };
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

  // ----- kid practice mode -----
  // The kid follows the picture steps (and timer) on their screen and taps "I did it!". It waits for a parent, like a chore.
  app.post('/api/homes/:homeId/therapy/goals/:id/kid-practice', async (req) => {
    const ctx = homeCtx(db, req);
    if (ctx.actor.kind !== 'kid' && ctx.actor.kind !== 'parent') throw new HttpError(403, 'Tap your avatar first');
    const g = ownRow(db, 'therapy_goals', ctx, (req.params as { id: string }).id);
    assertCanActFor(ctx, g.member_id as string);
    if (!pageOn(db, g.member_id as string, 'doctors') || g.status !== 'active' || !g.kid_practice) throw new HttpError(400, "This goal isn't set up for practice on the tablet");
    if (ctx.actor.kind === 'kid' && !kidTherapyView(db, g.member_id as string, '')) throw new HttpError(403, 'Ask a grown-up to share your goals first');
    const today = homeToday(homeInfo(db, ctx.homeId));
    if (db.prepare("SELECT 1 FROM practice_requests WHERE goal_id = ? AND date = ? AND status = 'waiting'").get(g.id as string, today)) {
      throw new HttpError(400, 'Already waiting for a grown-up to check');
    }
    const m = num((req.body as Row | undefined)?.minutes);
    const minutes = m != null && Number.isInteger(m) && m >= 0 && m <= 120 ? m : null;
    const id = newId();
    db.prepare('INSERT INTO practice_requests (id, home_id, member_id, goal_id, date, minutes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, ctx.homeId, g.member_id as string, g.id as string, today, minutes);
    emit(db, ctx.homeId, 'practice_waiting', g.member_id as string, { goal_id: g.id, minutes });
    return { id, status: 'waiting' };
  });

  app.get('/api/homes/:homeId/therapy/practice-requests', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return waitingPractices(db, ctx.homeId);
  });

  app.post('/api/homes/:homeId/therapy/practice-requests/:id/:action', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const { id, action } = req.params as { id: string; action: string };
    if (action !== 'approve' && action !== 'reject') throw new HttpError(404, 'Not found');
    const r = db.prepare("SELECT * FROM practice_requests WHERE id = ? AND home_id = ?").get(id, ctx.homeId) as Row | undefined;
    if (!r) throw new HttpError(404, 'That practice is gone');
    if (r.status !== 'waiting') throw new HttpError(400, 'Already checked');
    if (action === 'reject') {
      db.prepare("UPDATE practice_requests SET status = 'rejected', closed_at = datetime('now') WHERE id = ?").run(id);
      return { ok: true, awarded: 0 };
    }
    const g = ownRow(db, 'therapy_goals', ctx, r.goal_id as string);
    const date = r.date as string;
    // Counts as the day's scheduled practice when there is one that isn't ticked off yet.
    const scheduled = g.status === 'active' && practiceSlots(db, g, date, date).some((s) => s.date === date && !s.skipped)
      && !db.prepare('SELECT 1 FROM therapy_notes WHERE goal_id = ? AND date = ? AND practice = 1').get(g.id as string, date);
    const noteId = newId();
    let awarded = 0;
    tx(db, () => {
      const body = `✅ Practiced on the tablet${r.minutes ? ` (${r.minutes} min)` : ''}`;
      db.prepare(`INSERT INTO therapy_notes (id, home_id, member_id, goal_id, body, date, by_name, created_by, practice) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(noteId, ctx.homeId, g.member_id as string, g.id as string, body, date, ctx.user?.name ?? null, ctx.user?.id ?? null, scheduled ? 1 : 0);
      const pts = g.reward_step as number;
      if (pts > 0 && g.status === 'active') {
        writeLedger(db, {
          homeId: ctx.homeId, memberId: g.member_id as string, amount: pts, kind: 'bonus',
          reason: rewardReason(db, g.member_id as string, g.title as string, false), date: homeToday(homeInfo(db, ctx.homeId)), by: byOf(ctx),
        });
        db.prepare('UPDATE therapy_notes SET awarded = ? WHERE id = ?').run(pts, noteId);
        awarded = pts;
      }
      db.prepare("UPDATE practice_requests SET status = 'approved', note_id = ?, closed_at = datetime('now') WHERE id = ?").run(noteId, id);
    });
    return { ok: true, awarded };
  });

  app.delete('/api/homes/:homeId/therapy/notes/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM therapy_notes WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });
}

/** Kid practices waiting for a parent, for the Doctors page and the parent home. */
export function waitingPractices(db: DatabaseSync, homeId: string) {
  return (db.prepare(`SELECT r.*, g.title AS goal_title, g.area, g.reward_step, m.name AS kid_name, m.avatar AS kid_avatar FROM practice_requests r
    JOIN therapy_goals g ON g.id = r.goal_id JOIN members m ON m.id = r.member_id
    WHERE r.home_id = ? AND r.status = 'waiting' ORDER BY r.created_at`).all(homeId) as Row[])
    .filter((r) => pageOn(db, r.member_id as string, 'doctors'))
    .map((r) => ({
      id: r.id as string, memberId: r.member_id as string, goalId: r.goal_id as string, goalTitle: r.goal_title as string, area: r.area as string,
      date: r.date as string, minutes: r.minutes as number | null, points: r.reward_step as number, kidName: r.kid_name as string, kidAvatar: r.kid_avatar as string,
    }));
}

// ---------- practices and appointments on the calendars ----------

export interface PracticeItem {
  goalId: string; memberId: string; title: string; area: string; time: string | null; done: boolean; points: number;
  /** The day it was scheduled for (differs from the calendar day when it was moved). */
  occurrence: string; moved: boolean;
  /** Skipped days only reach parents (so they can undo the skip). */
  skipped: boolean;
}

export interface PracticeSlot { date: string; time: string | null; occurrence: string; moved: boolean; skipped: boolean }

/** A goal's practices between two dates, with single-day skips and moves applied. */
export function practiceSlots(db: DatabaseSync, g: Row, from: string, to: string): PracticeSlot[] {
  const ex = db.prepare('SELECT * FROM practice_exceptions WHERE goal_id = ?').all(g.id as string) as Row[];
  const byDay = new Map(ex.map((e) => [e.date as string, e]));
  const time = (g.practice_time as string | null) ?? null;
  const out: PracticeSlot[] = [];
  for (const d of dateRange(from, to)) {
    if (!practiceOn(g, d)) continue;
    const e = byDay.get(d);
    if (!e) out.push({ date: d, time, occurrence: d, moved: false, skipped: false });
    else if (e.action === 'skip') out.push({ date: d, time, occurrence: d, moved: false, skipped: true });
  }
  for (const e of ex) {
    if (e.action !== 'move' || !practiceOn(g, e.date as string)) continue;
    const nd = e.new_date as string;
    if (nd >= from && nd <= to) out.push({ date: nd, time: (e.new_time as string | null) ?? time, occurrence: e.date as string, moved: true, skipped: false });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
export interface AppointmentItem {
  id: string; memberId: string; kind: string; title: string; provider: string | null; time: string; status: string;
  /** Parents only (for editing from the calendar). */
  location?: string | null; durationMinutes?: number | null; notes?: string | null;
  repeat?: (RepeatRule & { seriesId: string; index: number }) | null;
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
      for (const g of goals) {
        for (const s of practiceSlots(db, g, from, to)) {
          if (s.skipped && forKid) continue;
          day(s.date).practices.push({
            goalId: g.id as string, memberId: id, title: g.title as string, area: g.area as string, time: s.time,
            done: done.has(`${g.id}|${s.date}`), points: g.reward_step as number, occurrence: s.occurrence, moved: s.moved, skipped: s.skipped,
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
        ...(forKid ? {} : { location: a.location as string | null, durationMinutes: a.duration_minutes as number | null, notes: a.notes as string | null, repeat: appointmentRepeat(db, a) }),
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
