// School work: homework, tests and projects with due dates, per kid. Parents add them (or turn a "Math Test" on the
// family calendar into one); kids see a due list on their board, tick steps of a project, mark the days they studied for
// a test and tick work off when it's turned in. Work that pays points waits for a grown-up, like a chore.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx, isParent, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, num, parseJson, requireStr, str } from '../util.ts';
import { homeInfo, homeToday, writeLedger } from '../chores.ts';
import { getKid, listKids, pageOn } from './homes.ts';
import { byOf } from './chores.ts';
import { eventsBetween, getEvent } from '../familyevents.ts';
import { addDays, isIsoDate } from '../../../shared/schedule.ts';
import { SCHOOL_KIND_IDS, daysBetween, dueState, schoolIcon, schoolKindOf, subjectOf, type SchoolKind } from '../../../shared/school.ts';

interface Step { text: string; done: boolean }

export function schoolView(r: Row, today: string) {
  const kind = r.kind as SchoolKind;
  const dueDate = r.due_date as string;
  // A test is over once its day has passed, even if nobody ticked it.
  const done = r.status === 'done' || (kind === 'test' && dueDate < today);
  const steps = parseJson<Step[]>(r.steps, []);
  return {
    id: r.id as string, memberId: r.member_id as string, kind, icon: schoolIcon(kind), title: r.title as string, subject: (r.subject as string | null) ?? null,
    dueDate, notes: (r.notes as string | null) ?? null, steps, studied: parseJson<string[]>(r.studied, []), studiedToday: parseJson<string[]>(r.studied, []).includes(today),
    status: r.status as 'todo' | 'waiting' | 'done', done, state: r.status === 'waiting' ? 'waiting' as const : dueState(dueDate, today, done),
    daysLeft: daysBetween(today, dueDate), points: r.points as number, paid: !!r.paid, score: (r.score as string | null) ?? null,
    eventId: (r.event_id as string | null) ?? null, doneAt: (r.done_at as string | null) ?? null,
    stepsDone: steps.filter((s) => s.done).length,
  };
}
export type SchoolView = ReturnType<typeof schoolView>;

/** A kid's school work: everything still open, plus what finished in the last two weeks. */
export function kidSchool(db: DatabaseSync, homeId: string, memberId: string): SchoolView[] {
  const today = homeToday(homeInfo(db, homeId));
  return (db.prepare(`SELECT * FROM school_work WHERE member_id = ? AND (status != 'done' OR due_date >= ?)
    ORDER BY due_date, created_at`).all(memberId, addDays(today, -14)) as Row[])
    .map((r) => schoolView(r, today))
    .filter((s) => !s.done || s.dueDate >= addDays(today, -14));
}

/** School work due between two dates, for the calendar (kids with School switched off are left out for kids). */
export function schoolBetween(db: DatabaseSync, homeId: string, kidIds: string[], from: string, to: string, forKid: boolean): SchoolView[] {
  if (!kidIds.length) return [];
  const today = homeToday(homeInfo(db, homeId));
  const ids = forKid ? kidIds.filter((id) => pageOn(db, id, 'school')) : kidIds;
  if (!ids.length) return [];
  return (db.prepare(`SELECT * FROM school_work WHERE home_id = ? AND due_date BETWEEN ? AND ? AND member_id IN (${ids.map(() => '?').join(',')})
    ORDER BY due_date, kind, title`).all(homeId, from, to, ...ids) as Row[]).map((r) => schoolView(r, today));
}

/** Family events turned into school work, so the calendar shows them once (as school work). */
export function linkedEventIds(db: DatabaseSync, homeId: string): Set<string> {
  return new Set((db.prepare('SELECT event_id FROM school_work WHERE home_id = ? AND event_id IS NOT NULL').all(homeId) as Row[]).map((r) => r.event_id as string));
}

/** Calendar events in the next month that look like a kid's school work and aren't tracked yet ("Science SOL"). */
export function schoolSuggestions(db: DatabaseSync, homeId: string, memberId: string) {
  const today = homeToday(homeInfo(db, homeId));
  const linked = linkedEventIds(db, homeId);
  return eventsBetween(db, homeId, today, addDays(today, 45), memberId)
    .filter((e) => !linked.has(e.id) && e.memberIds.includes(memberId) && schoolKindOf(e.title))
    .map((e) => ({ eventId: e.id, title: e.title, date: e.date, kind: schoolKindOf(e.title)!, subject: subjectOf(e.title) }));
}

function fields(b: Row, cur?: Row) {
  const has = (k: string) => k in b || !cur;
  const kind = has('kind') ? String(b.kind ?? 'homework') : cur!.kind as string;
  if (!SCHOOL_KIND_IDS.includes(kind as SchoolKind)) throw new HttpError(400, 'Pick homework, a test or a project');
  const dueDate = has('dueDate') ? b.dueDate : cur!.due_date;
  if (!isIsoDate(dueDate)) throw new HttpError(400, 'Pick a due date');
  const points = has('points') ? num(b.points) ?? 0 : cur!.points as number;
  if (!Number.isInteger(points) || points < 0 || points > 1000) throw new HttpError(400, 'Points are 0 to 1000');
  let steps = cur ? parseJson<Step[]>(cur.steps, []) : [];
  if ('steps' in b) {
    if (!Array.isArray(b.steps)) throw new HttpError(400, 'Steps are a list');
    steps = (b.steps as unknown[]).slice(0, 20).map((s) => (typeof s === 'string' ? { text: s, done: false } : { text: String((s as Row)?.text ?? ''), done: !!(s as Row)?.done }))
      .map((s) => ({ text: s.text.trim().slice(0, 120), done: s.done })).filter((s) => s.text);
  }
  return {
    kind, title: has('title') ? requireStr(b.title, 'Name', 120) : cur!.title as string,
    subject: has('subject') ? str(b.subject, 40) : cur!.subject as string | null,
    dueDate, notes: has('notes') ? str(b.notes, 1000) : cur!.notes as string | null, steps, points,
    score: 'score' in b ? str(b.score, 20) : (cur?.score as string | null) ?? null,
  };
}

export function schoolRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const item = (ctx: HomeCtx, id: string) => {
    const r = db.prepare('SELECT * FROM school_work WHERE id = ? AND home_id = ?').get(id, ctx.homeId) as Row | undefined;
    if (!r) throw new HttpError(404, 'That school work is gone');
    assertCanActFor(ctx, r.member_id as string);
    if (!isParent(ctx)) {
      if (ctx.actor.kind !== 'kid') throw new HttpError(403, 'Pick your raccoon first');
      if (!pageOn(db, r.member_id as string, 'school')) throw new HttpError(403, 'School work is switched off');
    }
    return r;
  };
  const today = (ctx: HomeCtx) => homeToday(homeInfo(db, ctx.homeId));
  const view = (ctx: HomeCtx, id: string) => schoolView(db.prepare('SELECT * FROM school_work WHERE id = ?').get(id) as Row, today(ctx));

  app.get('/api/homes/:homeId/kids/:memberId/school', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    getKid(db, ctx, memberId);
    if (!isParent(ctx) && !pageOn(db, memberId, 'school')) return { items: [], suggestions: [] };
    return { items: kidSchool(db, ctx.homeId, memberId), suggestions: isParent(ctx) ? schoolSuggestions(db, ctx.homeId, memberId) : [] };
  });

  // The parent home: what's overdue, due this week, or waiting for a check, across every kid.
  app.get('/api/homes/:homeId/school', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const t = today(ctx);
    const kids = new Map(listKids(db, ctx.homeId).map((k) => [k.id, k]));
    return (db.prepare(`SELECT * FROM school_work WHERE home_id = ? AND (status = 'waiting' OR (status = 'todo' AND due_date <= ?))
      ORDER BY due_date, created_at`).all(ctx.homeId, addDays(t, 7)) as Row[])
      .map((r) => schoolView(r, t))
      .filter((s) => kids.has(s.memberId) && (s.status === 'waiting' || !s.done || s.dueDate >= t))
      .map((s) => ({ ...s, kid: { name: kids.get(s.memberId)!.name, avatar: kids.get(s.memberId)!.avatar, color: kids.get(s.memberId)!.color } }));
  });

  app.post('/api/homes/:homeId/kids/:memberId/school', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const b = (req.body ?? {}) as Row;
    // Made from a family calendar event: its name and date fill in what wasn't given.
    let eventId: string | null = null;
    if (b.eventId) {
      const e = getEvent(db, ctx.homeId, String(b.eventId));
      eventId = e.id;
      b.title ??= e.title;
      b.dueDate ??= e.date;
      b.kind ??= schoolKindOf(e.title) ?? 'homework';
      if (!('subject' in b)) b.subject = subjectOf(e.title);
      if (!('notes' in b) && e.notes) b.notes = e.notes;
    }
    const f = fields(b);
    const id = newId();
    db.prepare(`INSERT INTO school_work (id, home_id, member_id, kind, title, subject, due_date, notes, steps, points, score, event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, ctx.homeId, kid.id as string, f.kind, f.title, f.subject, f.dueDate, f.notes, JSON.stringify(f.steps), f.points, f.score, eventId);
    return view(ctx, id);
  });

  app.patch('/api/homes/:homeId/school/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const cur = item(ctx, (req.params as { id: string }).id);
    const f = fields((req.body ?? {}) as Row, cur);
    db.prepare(`UPDATE school_work SET kind = ?, title = ?, subject = ?, due_date = ?, notes = ?, steps = ?, points = ?, score = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(f.kind, f.title, f.subject, f.dueDate, f.notes, JSON.stringify(f.steps), f.points, f.score, cur.id as string);
    return view(ctx, cur.id as string);
  });

  // Deleting school work made from a calendar event puts the event back on the calendar. Points paid stay paid.
  app.delete('/api/homes/:homeId/school/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const cur = item(ctx, (req.params as { id: string }).id);
    db.prepare('DELETE FROM school_work WHERE id = ?').run(cur.id as string);
    return { ok: true };
  });

  const pay = (ctx: HomeCtx, r: Row) => {
    if (r.paid || !(r.points as number)) return 0;
    writeLedger(db, { homeId: ctx.homeId, memberId: r.member_id as string, amount: r.points as number, kind: 'bonus',
      reason: `${schoolIcon(r.kind as string)} ${r.title as string}`, date: today(ctx), by: isParent(ctx) ? byOf(ctx) : { userId: null, name: '✨ Auto-approved' } });
    db.prepare('UPDATE school_work SET paid = 1 WHERE id = ?').run(r.id as string);
    return r.points as number;
  };

  // "Turned in!": a kid's waits for a grown-up when it pays points; a parent's (or one with no points) is done.
  app.post('/api/homes/:homeId/school/:id/done', async (req) => {
    const ctx = homeCtx(db, req);
    const r = item(ctx, (req.params as { id: string }).id);
    if (r.status === 'done') return { item: view(ctx, r.id as string), paid: 0 };
    const by = isParent(ctx) ? byOf(ctx).name : 'kid';
    let paid = 0;
    tx(db, () => {
      const finish = isParent(ctx) || !(r.points as number);
      db.prepare("UPDATE school_work SET status = ?, done_at = datetime('now'), done_by = ?, updated_at = datetime('now') WHERE id = ?")
        .run(finish ? 'done' : 'waiting', by, r.id as string);
      if (finish) paid = pay(ctx, r);
    });
    return { item: view(ctx, r.id as string), paid };
  });

  // "Not yet": a kid can take back a tick that's still waiting; a parent can reopen anything (paid points come back off).
  app.post('/api/homes/:homeId/school/:id/undo', async (req) => {
    const ctx = homeCtx(db, req);
    const r = item(ctx, (req.params as { id: string }).id);
    if (!isParent(ctx) && r.status !== 'waiting') throw new HttpError(403, 'Ask a grown-up to change that');
    tx(db, () => {
      if (r.paid && isParent(ctx)) {
        writeLedger(db, { homeId: ctx.homeId, memberId: r.member_id as string, amount: -(r.points as number), kind: 'reversal',
          reason: `Undo: ${r.title as string}`, date: today(ctx), by: byOf(ctx) });
      }
      db.prepare("UPDATE school_work SET status = 'todo', paid = 0, done_at = NULL, done_by = NULL, updated_at = datetime('now') WHERE id = ?").run(r.id as string);
    });
    return view(ctx, r.id as string);
  });

  app.post('/api/homes/:homeId/school/:id/approve', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const r = item(ctx, (req.params as { id: string }).id);
    if (r.status !== 'waiting') throw new HttpError(400, 'Nothing to check');
    let paid = 0;
    tx(db, () => {
      db.prepare("UPDATE school_work SET status = 'done', done_by = ?, updated_at = datetime('now') WHERE id = ?").run(byOf(ctx).name, r.id as string);
      paid = pay(ctx, r);
    });
    return { item: view(ctx, r.id as string), paid };
  });

  // Ticking a project's step (kid or parent).
  app.post('/api/homes/:homeId/school/:id/steps/:n', async (req) => {
    const ctx = homeCtx(db, req);
    const r = item(ctx, (req.params as { id: string }).id);
    const steps = parseJson<Step[]>(r.steps, []);
    const n = Number((req.params as { n: string }).n);
    if (!steps[n]) throw new HttpError(404, 'No such step');
    steps[n].done = (req.body as Row | undefined)?.done !== false;
    db.prepare("UPDATE school_work SET steps = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(steps), r.id as string);
    return view(ctx, r.id as string);
  });

  // "I studied today" for a test (tap again to take it back).
  app.post('/api/homes/:homeId/school/:id/studied', async (req) => {
    const ctx = homeCtx(db, req);
    const r = item(ctx, (req.params as { id: string }).id);
    const t = today(ctx);
    const days = new Set(parseJson<string[]>(r.studied, []));
    if ((req.body as Row | undefined)?.studied === false) days.delete(t); else days.add(t);
    db.prepare("UPDATE school_work SET studied = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify([...days].sort()), r.id as string);
    return view(ctx, r.id as string);
  });
}
