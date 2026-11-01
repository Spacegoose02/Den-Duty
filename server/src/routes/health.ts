// Doctors, the health side: a kid's health card (allergies, conditions, insurance, care team, vaccines, growth),
// medicines with dose check-offs and refill reminders, a symptom / mood / behavior log, a visit summary to print,
// read-only links for a therapist, and an export of everything in Doctors. Parents only, except:
// - a kid can tick off their own doses of a medicine a parent marked "kid can mark";
// - anyone holding a share link sees what that link covers (never insurance, contacts or private notes).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { emit } from '../events.ts';
import { HttpError, newId, num, parseJson, randomToken, requireStr, sha256, str } from '../util.ts';
import { rateLimit } from '../security.ts';
import { homeInfo, homeToday } from '../chores.ts';
import { doctorAreasOff, getKid, pageOn } from './homes.ts';
import { APPOINTMENT_SECTION, appointmentOn, GOAL_AREA_SECTION, goalAreaOn } from '../../../shared/pages.ts';
import { ageOn } from '../../../shared/ages.ts';
import { addDays, isIsoDate, timeIn } from '../../../shared/schedule.ts';
import { cleanQuestions, practiceSlots } from './therapy.ts';

export const LOG_KINDS = ['mood', 'symptom', 'behavior', 'sleep', 'other'] as const;
type LogKind = (typeof LOG_KINDS)[number];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const clock = (db: DatabaseSync, homeId: string) => {
  const home = homeInfo(db, homeId);
  return { today: homeToday(home), now: timeIn(home.timezone) };
};

/** A kid with Doctors turned on, for a parent. */
function doctorsKid(db: DatabaseSync, ctx: HomeCtx, memberId: string): Row {
  const kid = getKid(db, ctx, memberId);
  if (!pageOn(db, kid.id as string, 'doctors')) throw new HttpError(403, `Doctors is turned off for ${kid.name}. Turn it on in Kids → Edit.`);
  return kid;
}

type Owned = 'care_team' | 'vaccines' | 'growth' | 'medications' | 'health_log' | 'share_links';
function own(db: DatabaseSync, table: Owned, ctx: HomeCtx, id: string): Row {
  const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND home_id = ?`).get(id, ctx.homeId) as Row | undefined;
  if (!r) throw new HttpError(404, 'That is gone');
  return r;
}

function optDate(v: unknown, field: string): string | null {
  if (v == null || v === '') return null;
  if (!isIsoDate(v)) throw new HttpError(400, `${field} looks like 2026-11-01`);
  return v;
}

function optInt(v: unknown, field: string, min: number, max: number): number | null {
  if (v == null || v === '') return null;
  const n = num(v);
  if (n == null || !Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} is a whole number from ${min} to ${max}`);
  return n;
}

// ---------- medicines ----------

export function cleanTimes(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = [...new Set(v.map((t) => String(t).trim()).filter((t) => TIME.test(t)))].sort();
  if (out.length > 8) throw new HttpError(400, 'Eight dose times a day at most');
  return out;
}

const medOn = (m: Row, date: string) => !!m.active && (!m.start_date || (m.start_date as string) <= date) && (!m.end_date || date <= (m.end_date as string));

interface DoseRow { slot: string; status: 'given' | 'skipped'; at: string; by: string | null; byKid: boolean; note: string | null }
const doseView = (d: Row): DoseRow => ({
  slot: d.slot as string, status: d.status as 'given' | 'skipped', at: d.at as string, by: d.by_name as string | null, byKid: !!d.by_kid, note: d.note as string | null,
});

/** A medicine with its dose slots for one day. A scheduled slot is due, given, skipped or late (past its time, not marked). */
function medDay(db: DatabaseSync, m: Row, date: string, today: string, now: string) {
  const doses = (db.prepare('SELECT * FROM med_doses WHERE med_id = ? AND date = ? ORDER BY at').all(m.id as string, date) as Row[]).map(doseView);
  const times = cleanTimes(parseJson(m.times, []));
  const slots = medOn(m, date) ? times.map((t) => {
    const d = doses.find((x) => x.slot === t);
    const late = !d && (date < today || (date === today && t < now));
    return { slot: t, time: t, status: d ? d.status : late ? 'late' : 'due', by: d?.by ?? null, byKid: d?.byKid ?? false, at: d?.at ?? null };
  }) : [];
  return { slots, extra: doses.filter((d) => d.slot.startsWith('prn-')) };
}

function medView(m: Row) {
  return {
    id: m.id as string, memberId: m.member_id as string, name: m.name as string, dose: m.dose as string | null, instructions: m.instructions as string | null,
    times: cleanTimes(parseJson(m.times, [])), asNeeded: !!m.as_needed, startDate: m.start_date as string | null, endDate: m.end_date as string | null,
    supply: m.supply as number | null, refillAt: m.refill_at as number | null,
    low: m.supply != null && m.refill_at != null && (m.supply as number) <= (m.refill_at as number),
    kidCanMark: !!m.kid_can_mark, active: !!m.active,
  };
}

/** Given / skipped / missed scheduled doses between two dates (missed = a past slot nobody marked). */
export function adherence(db: DatabaseSync, m: Row, from: string, to: string, today: string, now: string) {
  let given = 0, skipped = 0, missed = 0, extra = 0;
  const created = String(m.created_at ?? '').slice(0, 10);
  for (let d = from > created ? from : created; d <= to && d <= today; d = addDays(d, 1)) {
    const day = medDay(db, m, d, today, now);
    for (const s of day.slots) {
      if (s.status === 'given') given++;
      else if (s.status === 'skipped') skipped++;
      else if (s.status === 'late') missed++;
    }
    extra += day.extra.filter((x) => x.status === 'given').length;
  }
  const due = given + skipped + missed;
  return { given, skipped, missed, asNeeded: extra, percent: due ? Math.round((given / due) * 100) : null };
}

/**
 * Records a dose. A given dose counts the supply down; at the refill point a parent reminder is made once
 * (and Home Assistant hears med_refill_due). Throws if the slot is already marked.
 */
function recordDose(db: DatabaseSync, homeId: string, m: Row, date: string, slot: string, status: 'given' | 'skipped', by: string | null, byKid: boolean, note: string | null) {
  tx(db, () => {
    try {
      db.prepare('INSERT INTO med_doses (id, home_id, med_id, member_id, date, slot, status, by_name, by_kid, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(newId(), homeId, m.id as string, m.member_id as string, date, slot, status, by, byKid ? 1 : 0, note);
    } catch {
      throw new HttpError(400, 'That dose is already marked');
    }
    if (status !== 'given' || m.supply == null) return;
    const supply = Math.max(0, (m.supply as number) - 1);
    db.prepare('UPDATE medications SET supply = ? WHERE id = ?').run(supply, m.id as string);
    if (m.refill_at != null && supply <= (m.refill_at as number) && !m.refill_reminded) {
      const kid = db.prepare('SELECT name FROM members WHERE id = ?').get(m.member_id as string) as Row;
      db.prepare('INSERT INTO reminders (id, home_id, title, notes, kid_id, due_date) VALUES (?, ?, ?, ?, ?, ?)').run(
        newId(), homeId, `Refill ${m.name} for ${kid.name}`.slice(0, 120), `${supply} dose${supply === 1 ? '' : 's'} left.`, m.member_id as string, homeToday(homeInfo(db, homeId)));
      db.prepare('UPDATE medications SET refill_reminded = 1 WHERE id = ?').run(m.id as string);
      emit(db, homeId, 'med_refill_due', m.member_id as string, { doses_left: supply });
    }
  });
}

/** Medicines a kid may tick off themselves today, for their board. */
export function kidMeds(db: DatabaseSync, memberId: string, today: string, now: string) {
  if (!pageOn(db, memberId, 'doctors')) return [];
  return (db.prepare('SELECT * FROM medications WHERE member_id = ? AND active = 1 AND kid_can_mark = 1 ORDER BY name').all(memberId) as Row[])
    .filter((m) => medOn(m, today))
    .map((m) => ({ id: m.id as string, name: m.name as string, dose: m.dose as string | null, slots: medDay(db, m, today, today, now).slots.map((s) => ({ slot: s.slot, status: s.status })) }))
    .filter((m) => m.slots.length);
}

function medFields(b: Row, cur?: Row) {
  const has = (k: string) => k in b || !cur;
  const times = has('times') ? cleanTimes(b.times) : cleanTimes(parseJson(cur!.times, []));
  const asNeeded = has('asNeeded') ? b.asNeeded === true : !!cur!.as_needed;
  if (!times.length && !asNeeded) throw new HttpError(400, 'Add a dose time, or mark it as only when needed');
  const startDate = has('startDate') ? optDate(b.startDate, 'Start date') : cur!.start_date as string | null;
  const endDate = has('endDate') ? optDate(b.endDate, 'End date') : cur!.end_date as string | null;
  if (startDate && endDate && endDate < startDate) throw new HttpError(400, 'The end date is before the start date');
  return {
    name: has('name') ? requireStr(b.name, 'Medicine', 100) : cur!.name as string,
    dose: has('dose') ? str(b.dose, 100) : cur!.dose as string | null,
    instructions: has('instructions') ? str(b.instructions, 1000) : cur!.instructions as string | null,
    times, asNeeded, startDate, endDate,
    supply: has('supply') ? optInt(b.supply, 'Doses left', 0, 10000) : cur!.supply as number | null,
    refillAt: has('refillAt') ? optInt(b.refillAt, 'Refill reminder', 0, 1000) : cur!.refill_at as number | null,
    kidCanMark: has('kidCanMark') ? b.kidCanMark === true : !!cur!.kid_can_mark,
    active: has('active') ? b.active !== false : !!cur!.active,
  };
}

// ---------- the visit summary (also what a share link shows) ----------

export interface SummaryOpts { goalIds: string[] | null; profile: boolean; meds: boolean; log: boolean; notes: boolean; appointments: boolean }
const ALL: SummaryOpts = { goalIds: null, profile: true, meds: true, log: true, notes: true, appointments: true };

export function buildSummary(db: DatabaseSync, homeId: string, memberId: string, from: string, to: string, opts: SummaryOpts = ALL) {
  const { today, now } = clock(db, homeId);
  const kid = db.prepare('SELECT name, birthdate FROM members WHERE id = ?').get(memberId) as Row;
  const off = doctorAreasOff(db, memberId);
  const goals = (db.prepare("SELECT * FROM therapy_goals WHERE member_id = ? AND (status != 'met' OR met_at >= ?) ORDER BY status = 'active' DESC, created_at").all(memberId, from) as Row[])
    .filter((g) => goalAreaOn(g.area as string, off) && (!opts.goalIds || opts.goalIds.includes(g.id as string)))
    .map((g) => {
      const history = (db.prepare('SELECT date, progress FROM therapy_notes WHERE goal_id = ? AND progress IS NOT NULL ORDER BY date, created_at').all(g.id as string) as Row[])
        .map((h) => ({ date: h.date as string, progress: h.progress as number }));
      const before = history.filter((h) => h.date < from).pop();
      const inRange = history.filter((h) => h.date >= from && h.date <= to);
      const practiced = (db.prepare("SELECT COUNT(*) AS n FROM therapy_notes WHERE goal_id = ? AND date BETWEEN ? AND ? AND (practice = 1 OR body LIKE '✅%')").get(g.id as string, from, to) as Row).n as number;
      const scheduled = g.practice_schedule ? practiceSlots(db, g, from, to < today ? to : today).filter((s) => !s.skipped).length : null;
      return {
        id: g.id as string, area: g.area as string, title: g.title as string, description: g.description as string | null, status: g.status as string,
        progress: g.progress as number, startProgress: before?.progress ?? inRange[0]?.progress ?? null, targetDate: g.target_date as string | null,
        metAt: g.met_at as string | null, history: inRange, practiced, scheduled,
      };
    });
  const goalIds = new Set(goals.map((g) => g.id));
  // A link for some goals only shows visits of the same kind (a speech link: speech visits).
  const sections = new Set<string>(goals.map((g) => GOAL_AREA_SECTION[g.area] ?? '').filter(Boolean));
  const apptShown = (kind: string) => !opts.goalIds || sections.has(APPOINTMENT_SECTION[kind] ?? '');
  const notes = opts.notes ? (db.prepare(`SELECT n.*, g.title AS goal_title FROM therapy_notes n LEFT JOIN therapy_goals g ON g.id = n.goal_id
      WHERE n.member_id = ? AND n.date BETWEEN ? AND ? AND n.practice = 0 AND n.body NOT LIKE '✅%' ORDER BY n.date DESC, n.created_at DESC LIMIT 60`).all(memberId, from, to) as Row[])
    .filter((n) => opts.goalIds ? n.goal_id && goalIds.has(n.goal_id as string) : !n.goal_id || goalIds.has(n.goal_id as string))
    .map((n) => ({ date: n.date as string, body: n.body as string, goalTitle: n.goal_title as string | null, progress: n.progress as number | null, by: n.by_name as string | null })) : [];
  const appts = opts.appointments ? (db.prepare('SELECT * FROM therapy_appointments WHERE member_id = ? AND substr(starts_at, 1, 10) BETWEEN ? AND ? ORDER BY starts_at').all(memberId, from, addDays(to, 60)) as Row[])
    .filter((a) => appointmentOn(a.kind as string, off) && apptShown(a.kind as string)) : [];
  const meds = opts.meds ? (db.prepare('SELECT * FROM medications WHERE member_id = ? AND (active = 1 OR end_date >= ?) ORDER BY active DESC, name').all(memberId, from) as Row[])
    .map((m) => ({ ...medView(m), adherence: adherence(db, m, from, to, today, now) })) : [];
  const logRows = opts.log ? db.prepare('SELECT * FROM health_log WHERE member_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC, time DESC').all(memberId, from, to) as Row[] : [];
  const byLabel = new Map<string, { kind: string; label: string; count: number; severity: number[]; minutes: number[] }>();
  for (const r of logRows) {
    const key = `${r.kind}:${String(r.label).toLowerCase()}`;
    const e = byLabel.get(key) ?? { kind: r.kind as string, label: r.label as string, count: 0, severity: [], minutes: [] };
    e.count++;
    if (r.severity != null) e.severity.push(r.severity as number);
    if (r.minutes != null) e.minutes.push(r.minutes as number);
    byLabel.set(key, e);
  }
  const avg = (xs: number[]) => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
  const profile = opts.profile ? db.prepare('SELECT * FROM health_profiles WHERE member_id = ?').get(memberId) as Row | undefined : undefined;
  const growth = opts.profile ? (db.prepare('SELECT date, height_cm, weight_kg FROM growth WHERE member_id = ? ORDER BY date DESC LIMIT 2').all(memberId) as Row[])
    .map((g) => ({ date: g.date as string, heightCm: g.height_cm as number | null, weightKg: g.weight_kg as number | null })) : [];
  return {
    kid: { name: kid.name as string, age: kid.birthdate ? ageOn(kid.birthdate as string, today) : null, birthdate: opts.profile ? kid.birthdate as string | null : null },
    from, to, today,
    profile: opts.profile ? {
      allergies: (profile?.allergies as string | null) ?? null, conditions: (profile?.conditions as string | null) ?? null, bloodType: (profile?.blood_type as string | null) ?? null,
    } : null,
    growth,
    goals,
    notes,
    appointments: appts.filter((a) => (a.starts_at as string).slice(0, 10) <= to).map((a) => ({
      date: (a.starts_at as string).slice(0, 10), kind: a.kind as string, title: a.title as string, provider: a.provider as string | null, status: a.status as string, summary: a.summary as string | null,
    })),
    next: (() => {
      const a = appts.find((x) => x.status === 'scheduled' && (x.starts_at as string) >= today);
      return a ? { startsAt: a.starts_at as string, kind: a.kind as string, title: a.title as string, provider: a.provider as string | null, questions: cleanQuestions(parseJson(a.questions, [])) } : null;
    })(),
    meds,
    log: opts.log ? {
      total: logRows.length,
      groups: [...byLabel.values()].sort((a, b) => b.count - a.count).map((e) => ({ kind: e.kind, label: e.label, count: e.count, avgSeverity: avg(e.severity), avgMinutes: avg(e.minutes) })),
      recent: logRows.slice(0, 25).map(logView),
    } : null,
  };
}

const logView = (r: Row) => ({
  id: r.id as string, kind: r.kind as LogKind, label: r.label as string, date: r.date as string, time: r.time as string | null,
  severity: r.severity as number | null, minutes: r.minutes as number | null, trigger: r.trigger as string | null, note: r.note as string | null, by: r.by_name as string | null,
});

function rangeParams(q: { from?: string; to?: string; days?: string }, today: string) {
  const to = isIsoDate(q.to) ? q.to : today;
  const days = Math.min(Math.max(Number(q.days) || 30, 1), 366);
  const from = isIsoDate(q.from) ? q.from : addDays(to, -(days - 1));
  if (from > to) throw new HttpError(400, 'The start is after the end');
  return { from, to };
}

// ---------- share links ----------

function linkView(r: Row) {
  return {
    id: r.id as string, label: r.label as string, goalIds: parseJson<string[] | null>(r.goal_ids, null), showLog: !!r.show_log, showMeds: !!r.show_meds,
    allowNotes: !!r.allow_notes, expiresAt: r.expires_at as string, lastSeenAt: r.last_seen_at as string | null, createdAt: r.created_at as string,
  };
}

function sharedLink(db: DatabaseSync, req: FastifyRequest): Row {
  rateLimit(`share:${req.ip}`, 120, 15 * 60e3);
  const token = (req.params as { token: string }).token;
  const r = token.length >= 20 ? db.prepare('SELECT * FROM share_links WHERE token_hash = ?').get(sha256(token)) as Row | undefined : undefined;
  if (!r || (r.expires_at as string) < new Date().toISOString().slice(0, 10) || !pageOn(db, r.member_id as string, 'doctors')) {
    throw new HttpError(404, 'This link has expired or was turned off. Ask the family for a new one.');
  }
  return r;
}

// ---------- export ----------

function exportKid(db: DatabaseSync, memberId: string) {
  const rows = (sql: string) => db.prepare(sql).all(memberId) as Row[];
  const strip = (r: Row) => { const { home_id: _h, created_by: _c, token_hash: _t, ...rest } = r; return rest; };
  const kid = db.prepare('SELECT id, name, birthdate FROM members WHERE id = ?').get(memberId) as Row;
  return {
    kid,
    healthProfile: (db.prepare('SELECT * FROM health_profiles WHERE member_id = ?').get(memberId) as Row | undefined) ?? null,
    careTeam: rows('SELECT * FROM care_team WHERE member_id = ? ORDER BY created_at').map(strip),
    vaccines: rows('SELECT * FROM vaccines WHERE member_id = ? ORDER BY date').map(strip),
    growth: rows('SELECT * FROM growth WHERE member_id = ? ORDER BY date').map(strip),
    medications: rows('SELECT * FROM medications WHERE member_id = ? ORDER BY created_at').map(strip),
    medDoses: rows('SELECT * FROM med_doses WHERE member_id = ? ORDER BY date, at').map(strip),
    healthLog: rows('SELECT * FROM health_log WHERE member_id = ? ORDER BY date, time').map(strip),
    appointments: rows('SELECT * FROM therapy_appointments WHERE member_id = ? ORDER BY starts_at').map(strip),
    goals: rows('SELECT * FROM therapy_goals WHERE member_id = ? ORDER BY created_at').map(strip),
    notes: rows('SELECT * FROM therapy_notes WHERE member_id = ? ORDER BY date, created_at').map(strip),
    practiceRequests: rows('SELECT * FROM practice_requests WHERE member_id = ? ORDER BY created_at').map(strip),
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  // Quote everything, and keep spreadsheet apps from treating a cell as a formula.
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};
export const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function healthRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const kidParam = (req: FastifyRequest) => (req.params as { memberId: string }).memberId;

  // ----- the health card: profile, care team, vaccines, growth, medicines -----
  app.get('/api/homes/:homeId/kids/:memberId/health', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = doctorsKid(db, ctx, kidParam(req));
    const id = kid.id as string;
    const { today, now } = clock(db, ctx.homeId);
    const p = db.prepare('SELECT * FROM health_profiles WHERE member_id = ?').get(id) as Row | undefined;
    return {
      today,
      profile: {
        allergies: (p?.allergies as string | null) ?? null, conditions: (p?.conditions as string | null) ?? null, bloodType: (p?.blood_type as string | null) ?? null,
        insurance: (p?.insurance as string | null) ?? null, insuranceMember: (p?.insurance_member as string | null) ?? null, insuranceGroup: (p?.insurance_group as string | null) ?? null,
        emergency: (p?.emergency as string | null) ?? null, updatedAt: (p?.updated_at as string | null) ?? null,
      },
      careTeam: (db.prepare('SELECT * FROM care_team WHERE member_id = ? ORDER BY name').all(id) as Row[]).map((c) => ({
        id: c.id as string, name: c.name as string, role: c.role as string | null, phone: c.phone as string | null, email: c.email as string | null,
        address: c.address as string | null, notes: c.notes as string | null,
      })),
      vaccines: (db.prepare('SELECT * FROM vaccines WHERE member_id = ? ORDER BY date DESC').all(id) as Row[]).map((v) => ({
        id: v.id as string, name: v.name as string, date: v.date as string, dose: v.dose as string | null, notes: v.notes as string | null,
      })),
      growth: (db.prepare('SELECT * FROM growth WHERE member_id = ? ORDER BY date').all(id) as Row[]).map((g) => ({
        id: g.id as string, date: g.date as string, heightCm: g.height_cm as number | null, weightKg: g.weight_kg as number | null,
      })),
      meds: (db.prepare('SELECT * FROM medications WHERE member_id = ? ORDER BY active DESC, name').all(id) as Row[]).map((m) => ({
        ...medView(m), today: medDay(db, m, today, today, now), onToday: medOn(m, today), last30: adherence(db, m, addDays(today, -29), today, today, now),
      })),
    };
  });

  app.put('/api/homes/:homeId/kids/:memberId/health/profile', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = doctorsKid(db, ctx, kidParam(req));
    const b = (req.body ?? {}) as Row;
    db.prepare(`INSERT INTO health_profiles (member_id, home_id, allergies, conditions, blood_type, insurance, insurance_member, insurance_group, emergency, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT (member_id) DO UPDATE SET allergies = excluded.allergies, conditions = excluded.conditions, blood_type = excluded.blood_type,
        insurance = excluded.insurance, insurance_member = excluded.insurance_member, insurance_group = excluded.insurance_group,
        emergency = excluded.emergency, updated_at = excluded.updated_at`).run(
      kid.id as string, ctx.homeId, str(b.allergies, 1000), str(b.conditions, 2000), str(b.bloodType, 10),
      str(b.insurance, 120), str(b.insuranceMember, 80), str(b.insuranceGroup, 80), str(b.emergency, 2000));
    return { ok: true };
  });

  const contactFields = (b: Row) => ({
    name: requireStr(b.name, 'Name', 100), role: str(b.role, 100), phone: str(b.phone, 40), email: str(b.email, 200), address: str(b.address, 300), notes: str(b.notes, 1000),
  });
  app.post('/api/homes/:homeId/kids/:memberId/health/care-team', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = doctorsKid(db, ctx, kidParam(req));
    const c = contactFields((req.body ?? {}) as Row);
    const id = newId();
    db.prepare('INSERT INTO care_team (id, home_id, member_id, name, role, phone, email, address, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, ctx.homeId, kid.id as string, c.name, c.role, c.phone, c.email, c.address, c.notes);
    return { id };
  });
  app.patch('/api/homes/:homeId/health/care-team/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const cur = own(db, 'care_team', ctx, (req.params as { id: string }).id);
    const c = contactFields({ ...cur, ...((req.body ?? {}) as Row) });
    db.prepare('UPDATE care_team SET name = ?, role = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?').run(c.name, c.role, c.phone, c.email, c.address, c.notes, cur.id as string);
    return { ok: true };
  });

  app.post('/api/homes/:homeId/kids/:memberId/health/vaccines', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = doctorsKid(db, ctx, kidParam(req));
    const b = (req.body ?? {}) as Row;
    const date = optDate(b.date, 'Date');
    if (!date) throw new HttpError(400, 'When was it given?');
    const id = newId();
    db.prepare('INSERT INTO vaccines (id, home_id, member_id, name, date, dose, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, ctx.homeId, kid.id as string, requireStr(b.name, 'Vaccine', 100), date, str(b.dose, 40), str(b.notes, 500));
    return { id };
  });

  app.post('/api/homes/:homeId/kids/:memberId/health/growth', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = doctorsKid(db, ctx, kidParam(req));
    const b = (req.body ?? {}) as Row;
    const date = optDate(b.date, 'Date') ?? clock(db, ctx.homeId).today;
    const measure = (v: unknown, field: string, max: number) => {
      if (v == null || v === '') return null;
      const n = num(v);
      if (n == null || n <= 0 || n > max) throw new HttpError(400, `${field} doesn't look right`);
      return Math.round(n * 10) / 10;
    };
    const h = measure(b.heightCm, 'Height', 250);
    const w = measure(b.weightKg, 'Weight', 250);
    if (h == null && w == null) throw new HttpError(400, 'Add a height or a weight');
    const id = newId();
    db.prepare('INSERT INTO growth (id, home_id, member_id, date, height_cm, weight_kg) VALUES (?, ?, ?, ?, ?, ?)').run(id, ctx.homeId, kid.id as string, date, h, w);
    return { id };
  });

  for (const table of ['care_team', 'vaccines', 'growth', 'health_log'] as const) {
    const path = { care_team: 'care-team', vaccines: 'vaccines', growth: 'growth', health_log: 'log' }[table];
    app.delete(`/api/homes/:homeId/health/${path}/:id`, async (req) => {
      const ctx = homeCtx(db, req, 'parent');
      db.prepare(`DELETE FROM ${table} WHERE id = ? AND home_id = ?`).run((req.params as { id: string }).id, ctx.homeId);
      return { ok: true };
    });
  }

  // ----- medicines -----
  app.post('/api/homes/:homeId/kids/:memberId/meds', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = doctorsKid(db, ctx, kidParam(req));
    const f = medFields((req.body ?? {}) as Row);
    const id = newId();
    db.prepare(`INSERT INTO medications (id, home_id, member_id, name, dose, instructions, times, as_needed, start_date, end_date, supply, refill_at, kid_can_mark, active, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.homeId, kid.id as string, f.name, f.dose, f.instructions, JSON.stringify(f.times), f.asNeeded ? 1 : 0,
      f.startDate, f.endDate, f.supply, f.refillAt, f.kidCanMark ? 1 : 0, f.active ? 1 : 0, ctx.user?.id ?? null);
    return medView(own(db, 'medications', ctx, id));
  });

  app.patch('/api/homes/:homeId/meds/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const cur = own(db, 'medications', ctx, (req.params as { id: string }).id);
    const f = medFields((req.body ?? {}) as Row, cur);
    // Topping the supply back up above the refill point re-arms the refill reminder.
    const rearm = f.supply == null || f.refillAt == null || f.supply > f.refillAt;
    db.prepare(`UPDATE medications SET name = ?, dose = ?, instructions = ?, times = ?, as_needed = ?, start_date = ?, end_date = ?, supply = ?, refill_at = ?,
      kid_can_mark = ?, active = ?, refill_reminded = CASE WHEN ? THEN 0 ELSE refill_reminded END WHERE id = ?`).run(
      f.name, f.dose, f.instructions, JSON.stringify(f.times), f.asNeeded ? 1 : 0, f.startDate, f.endDate, f.supply, f.refillAt, f.kidCanMark ? 1 : 0, f.active ? 1 : 0,
      rearm ? 1 : 0, cur.id as string);
    return medView(own(db, 'medications', ctx, cur.id as string));
  });

  app.delete('/api/homes/:homeId/meds/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM medications WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  // Mark a dose given or skipped: a scheduled slot ('08:00'), or slot 'prn' for an extra as-needed dose.
  app.post('/api/homes/:homeId/meds/:id/doses', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const m = own(db, 'medications', ctx, (req.params as { id: string }).id);
    const b = (req.body ?? {}) as Row;
    const { today } = clock(db, ctx.homeId);
    const date = optDate(b.date, 'Date') ?? today;
    if (date > today) throw new HttpError(400, "That day hasn't happened yet");
    const status = b.status === 'skipped' ? 'skipped' : 'given';
    let slot = String(b.slot ?? '');
    if (slot === 'prn') {
      if (!m.as_needed) throw new HttpError(400, 'This medicine has set dose times');
      const n = (db.prepare("SELECT COUNT(*) AS n FROM med_doses WHERE med_id = ? AND date = ? AND slot LIKE 'prn-%'").get(m.id as string, date) as Row).n as number;
      slot = `prn-${n + 1}`;
    } else if (!cleanTimes(parseJson(m.times, [])).includes(slot) || !medOn(m, date)) {
      throw new HttpError(400, 'No dose is scheduled then');
    }
    recordDose(db, ctx.homeId, m, date, slot, status, ctx.user?.name ?? null, false, str(b.note, 300));
    return { ok: true, slot };
  });

  app.delete('/api/homes/:homeId/meds/:id/doses', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const m = own(db, 'medications', ctx, (req.params as { id: string }).id);
    const q = req.query as { date?: string; slot?: string };
    const d = db.prepare('SELECT * FROM med_doses WHERE med_id = ? AND date = ? AND slot = ?').get(m.id as string, q.date ?? '', q.slot ?? '') as Row | undefined;
    if (!d) throw new HttpError(404, "That dose wasn't marked");
    tx(db, () => {
      db.prepare('DELETE FROM med_doses WHERE id = ?').run(d.id as string);
      if (d.status === 'given' && m.supply != null) db.prepare('UPDATE medications SET supply = supply + 1 WHERE id = ?').run(m.id as string);
    });
    return { ok: true };
  });

  // A kid ticks off their own dose (only for medicines a parent set "kid can mark", only today's scheduled ones).
  app.post('/api/homes/:homeId/meds/:id/kid-dose', async (req) => {
    const ctx = homeCtx(db, req);
    if (ctx.actor.kind !== 'kid') throw new HttpError(403, 'Tap your avatar first');
    const m = db.prepare('SELECT * FROM medications WHERE id = ? AND home_id = ? AND member_id = ?').get((req.params as { id: string }).id, ctx.homeId, ctx.actor.memberId) as Row | undefined;
    if (!m || !m.kid_can_mark || !pageOn(db, m.member_id as string, 'doctors')) throw new HttpError(404, 'That medicine is gone');
    const { today } = clock(db, ctx.homeId);
    const slot = String((req.body as Row | undefined)?.slot ?? '');
    if (!cleanTimes(parseJson(m.times, [])).includes(slot) || !medOn(m, today)) throw new HttpError(400, 'No dose is scheduled then');
    const kid = db.prepare('SELECT name FROM members WHERE id = ?').get(m.member_id as string) as Row;
    recordDose(db, ctx.homeId, m, today, slot, 'given', kid.name as string, true, null);
    return { ok: true };
  });

  // Everyone's medicines for today, for the parents' home screen.
  app.get('/api/homes/:homeId/meds/today', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const { today, now } = clock(db, ctx.homeId);
    const meds = (db.prepare(`SELECT md.*, m.name AS kid_name, m.avatar AS kid_avatar FROM medications md JOIN members m ON m.id = md.member_id
      WHERE md.home_id = ? AND md.active = 1 ORDER BY m.position, m.created_at, md.name`).all(ctx.homeId) as Row[])
      .filter((m) => pageOn(db, m.member_id as string, 'doctors') && medOn(m, today))
      .map((m) => ({ ...medView(m), kidName: m.kid_name as string, kidAvatar: m.kid_avatar as string, today: medDay(db, m, today, today, now) }))
      .filter((m) => m.today.slots.length || m.asNeeded || m.low);
    return { today, meds };
  });

  // ----- symptom, mood and behavior log -----
  app.get('/api/homes/:homeId/kids/:memberId/health/log', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = doctorsKid(db, ctx, kidParam(req));
    const { today } = clock(db, ctx.homeId);
    const { from, to } = rangeParams(req.query as Record<string, string>, today);
    return {
      from, to,
      entries: (db.prepare('SELECT * FROM health_log WHERE member_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC, time DESC, created_at DESC LIMIT 1000')
        .all(kid.id as string, from, to) as Row[]).map(logView),
    };
  });

  app.post('/api/homes/:homeId/kids/:memberId/health/log', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = doctorsKid(db, ctx, kidParam(req));
    const b = (req.body ?? {}) as Row;
    const { today } = clock(db, ctx.homeId);
    if (!(LOG_KINDS as readonly unknown[]).includes(b.kind)) throw new HttpError(400, `Kind is one of: ${LOG_KINDS.join(', ')}`);
    const date = optDate(b.date, 'Date') ?? today;
    if (date > today) throw new HttpError(400, "That day hasn't happened yet");
    const time = b.time ? String(b.time) : null;
    if (time && !TIME.test(time)) throw new HttpError(400, 'Times look like 16:30');
    const id = newId();
    db.prepare(`INSERT INTO health_log (id, home_id, member_id, kind, label, date, time, severity, minutes, trigger, note, by_name, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.homeId, kid.id as string, b.kind as string, requireStr(b.label, 'What happened', 60), date, time,
      optInt(b.severity, 'How strong', 1, 5), optInt(b.minutes, 'Minutes', 0, 1440), str(b.trigger, 200), str(b.note, 2000), ctx.user?.name ?? null, ctx.user?.id ?? null);
    return logView(own(db, 'health_log', ctx, id));
  });

  // ----- visit summary -----
  app.get('/api/homes/:homeId/kids/:memberId/health/summary', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = doctorsKid(db, ctx, kidParam(req));
    const { from, to } = rangeParams(req.query as Record<string, string>, clock(db, ctx.homeId).today);
    return buildSummary(db, ctx.homeId, kid.id as string, from, to);
  });

  // ----- share links for a therapist or doctor -----
  app.get('/api/homes/:homeId/kids/:memberId/share-links', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = doctorsKid(db, ctx, kidParam(req));
    return (db.prepare('SELECT * FROM share_links WHERE member_id = ? ORDER BY created_at DESC').all(kid.id as string) as Row[]).map(linkView);
  });

  app.post('/api/homes/:homeId/kids/:memberId/share-links', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = doctorsKid(db, ctx, kidParam(req));
    const b = (req.body ?? {}) as Row;
    let goalIds: string[] | null = null;
    if (Array.isArray(b.goalIds)) {
      goalIds = [...new Set(b.goalIds.map(String))];
      for (const g of goalIds) {
        if (!db.prepare('SELECT 1 FROM therapy_goals WHERE id = ? AND member_id = ?').get(g, kid.id as string)) throw new HttpError(400, "One of those goals isn't this kid's");
      }
      if (!goalIds.length) throw new HttpError(400, 'Pick at least one goal, or share all of them');
    }
    const days = optInt(b.days, 'Days', 1, 365) ?? 90;
    const count = (db.prepare('SELECT COUNT(*) AS n FROM share_links WHERE member_id = ?').get(kid.id as string) as Row).n as number;
    if (count >= 20) throw new HttpError(400, '20 links per kid is the limit. Turn some off first.');
    const token = randomToken(24);
    const id = newId();
    db.prepare(`INSERT INTO share_links (id, home_id, member_id, token_hash, label, goal_ids, show_log, show_meds, allow_notes, expires_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.homeId, kid.id as string, sha256(token), requireStr(b.label, 'Who is it for', 80),
      goalIds ? JSON.stringify(goalIds) : null, b.showLog === true ? 1 : 0, b.showMeds === true ? 1 : 0, b.allowNotes === true ? 1 : 0,
      addDays(clock(db, ctx.homeId).today, days), ctx.user?.id ?? null);
    // The token is only ever shown here; the server keeps its hash.
    return { ...linkView(own(db, 'share_links', ctx, id)), url: `/share/${token}` };
  });

  app.delete('/api/homes/:homeId/share-links/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM share_links WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  // What the link holder sees: the chosen goals with progress and practice, the provider-facing notes and visits,
  // and the log and medicines only if the family turned those on. Never insurance, contacts, vaccines or the health card.
  app.get('/api/share/:token', async (req, reply) => {
    const link = sharedLink(db, req);
    db.prepare("UPDATE share_links SET last_seen_at = datetime('now') WHERE id = ?").run(link.id as string);
    const homeId = link.home_id as string;
    const { from, to } = rangeParams(req.query as Record<string, string>, clock(db, homeId).today);
    const s = buildSummary(db, homeId, link.member_id as string, from, to, {
      goalIds: parseJson<string[] | null>(link.goal_ids, null), profile: false, meds: !!link.show_meds, log: !!link.show_log, notes: true, appointments: true,
    });
    reply.header('cache-control', 'no-store');
    return {
      ...s, kid: { name: String(s.kid.name).split(' ')[0], age: s.kid.age, birthdate: null }, next: s.next ? { ...s.next, questions: [] } : null,
      link: { label: link.label as string, expiresAt: link.expires_at as string, allowNotes: !!link.allow_notes },
    };
  });

  app.post('/api/share/:token/notes', async (req) => {
    const link = sharedLink(db, req);
    if (!link.allow_notes) throw new HttpError(403, "This link doesn't take notes");
    rateLimit(`share-note:${link.id}`, 30, 60 * 60e3);
    const b = (req.body ?? {}) as Row;
    const name = requireStr(b.name, 'Your name', 60);
    const goalId = str(b.goalId, 60);
    const scope = parseJson<string[] | null>(link.goal_ids, null);
    if (goalId) {
      const g = db.prepare('SELECT status FROM therapy_goals WHERE id = ? AND member_id = ?').get(goalId, link.member_id as string) as Row | undefined;
      if (!g || (scope && !scope.includes(goalId))) throw new HttpError(400, "That goal isn't on this link");
    } else if (scope) throw new HttpError(400, 'Pick a goal');
    const progress = b.progress == null || b.progress === '' ? null : optInt(b.progress, 'Progress', 0, 100);
    if (progress != null && !goalId) throw new HttpError(400, 'Progress goes with a goal');
    const homeId = link.home_id as string;
    tx(db, () => {
      db.prepare('INSERT INTO therapy_notes (id, home_id, member_id, goal_id, body, progress, date, by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(newId(), homeId, link.member_id as string, goalId, requireStr(b.body, 'Note', 2000), progress, clock(db, homeId).today, `${name} (${link.label})`.slice(0, 120));
      if (goalId && progress != null) db.prepare("UPDATE therapy_goals SET progress = ?, updated_at = datetime('now') WHERE id = ?").run(progress, goalId);
    });
    return { ok: true };
  });

  // ----- export: everything in Doctors for one kid (JSON), or the log / doses as CSV -----
  app.get('/api/homes/:homeId/kids/:memberId/doctors/export', async (req, reply) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, kidParam(req));
    const q = req.query as { format?: string; what?: string };
    const today = clock(db, ctx.homeId).today;
    const slug = String(kid.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kid';
    reply.header('cache-control', 'no-store');
    if (q.format === 'csv') {
      if (q.what === 'doses') {
        const rows = db.prepare(`SELECT d.date, d.slot, md.name, md.dose, d.status, d.by_name, d.note, d.at FROM med_doses d JOIN medications md ON md.id = d.med_id
          WHERE d.member_id = ? ORDER BY d.date, d.slot`).all(kid.id as string) as Row[];
        reply.header('content-disposition', `attachment; filename="${slug}-medicine-doses-${today}.csv"`).type('text/csv; charset=utf-8');
        return toCsv(['date', 'time', 'medicine', 'dose', 'status', 'by', 'note', 'recorded_at'], rows.map((r) => [r.date, r.slot, r.name, r.dose, r.status, r.by_name, r.note, r.at]));
      }
      if (q.what === 'log') {
        const rows = db.prepare('SELECT * FROM health_log WHERE member_id = ? ORDER BY date, time').all(kid.id as string) as Row[];
        reply.header('content-disposition', `attachment; filename="${slug}-health-log-${today}.csv"`).type('text/csv; charset=utf-8');
        return toCsv(['date', 'time', 'kind', 'what', 'strength_1_5', 'minutes', 'trigger', 'note', 'by'], rows.map((r) => [r.date, r.time, r.kind, r.label, r.severity, r.minutes, r.trigger, r.note, r.by_name]));
      }
      if (q.what === 'progress') {
        const rows = db.prepare(`SELECT n.date, g.title, g.area, n.progress, n.body, n.by_name FROM therapy_notes n LEFT JOIN therapy_goals g ON g.id = n.goal_id
          WHERE n.member_id = ? ORDER BY n.date, n.created_at`).all(kid.id as string) as Row[];
        reply.header('content-disposition', `attachment; filename="${slug}-goal-notes-${today}.csv"`).type('text/csv; charset=utf-8');
        return toCsv(['date', 'goal', 'area', 'progress', 'note', 'by'], rows.map((r) => [r.date, r.title, r.area, r.progress, r.body, r.by_name]));
      }
      throw new HttpError(400, 'Export doses, log or progress as CSV');
    }
    reply.header('content-disposition', `attachment; filename="${slug}-doctors-${today}.json"`);
    return { app: 'Den Duty', kind: 'doctors-export', version: 1, exportedAt: new Date().toISOString(), ...exportKid(db, kid.id as string) };
  });
}
