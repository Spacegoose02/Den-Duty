// Holiday mode: a seasonal layer for the boards and the family wall (countdown with snow, elf of the day, nice meter,
// sleigh tracker, North Pole cams), after Nordpol Card by DKAnord (MIT). Off until a parent turns it on, either
// straight away or between two dates. The countdown, route and cams are worked out on the tablet from shared/holiday.ts;
// the server keeps the settings, the elf tasks (which pay points through the ledger) and the nice meter.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx, isParent, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, parseJson, str } from '../util.ts';
import { homeInfo, homeToday, ledger, writeLedger, type HomeInfo } from '../chores.ts';
import { dailyStats } from '../progress.ts';
import { getKid, listKids } from './homes.ts';
import { byOf } from './chores.ts';
import { cleanHoliday, elfFor, holidayActive, niceLevel, niceScore, type HolidaySettings } from '../../../shared/holiday.ts';
import { isLang, type Lang } from '../../../shared/languages.ts';
import { addDays } from '../../../shared/schedule.ts';

export function holidaySettings(db: DatabaseSync, homeId: string): HolidaySettings {
  const r = db.prepare('SELECT holiday FROM homes WHERE id = ?').get(homeId) as Row | undefined;
  return cleanHoliday(parseJson(r?.holiday, null));
}

/** What a board or the wall needs, or null when Holiday mode isn't showing today. */
export function holidayView(db: DatabaseSync, homeId: string) {
  const home = homeInfo(db, homeId);
  const today = homeToday(home);
  const s = holidaySettings(db, homeId);
  if (!holidayActive(s, today)) return null;
  return {
    today, timezone: home.timezone,
    settings: {
      day: s.day, time: s.time, title: s.title, snow: s.snow, elf: s.elf, nice: s.nice,
      sleigh: s.sleigh, eta: s.eta, place: s.place, cams: s.cams, camUrl: s.camUrl, camLabels: s.camLabels, camLook: s.camLook,
    },
  };
}
export type HolidayView = ReturnType<typeof holidayView>;

const kidLang = (kid: Row, home: HomeInfo): Lang => {
  const l = (kid.language as string | null) ?? home.language;
  return isLang(l) ? l : 'en';
};

/** The nice meter: the last two weeks of chores (or since Holiday mode started), kind extras and penalties. */
export function niceFor(db: DatabaseSync, home: HomeInfo, s: HolidaySettings, memberId: string, today: string) {
  let since = addDays(today, -13);
  if (s.mode === 'dates' && s.from && s.from > since && s.from <= today) since = s.from;
  const days = dailyStats(db, home, memberId, since, today);
  const done = days.reduce((n, d) => n + d.done, 0);
  const due = days.reduce((n, d) => n + d.due, 0);
  const rows = db.prepare(`SELECT
      SUM(amount > 0 AND kind IN ('bonus', 'adjust')) AS kind_n,
      SUM(amount < 0 AND kind = 'adjust') AS pen_n
    FROM points_ledger WHERE member_id = ? AND date BETWEEN ? AND ?`).get(memberId, since, today) as Row;
  const kind = Number(rows.kind_n ?? 0), penalties = Number(rows.pen_n ?? 0);
  const score = niceScore({ done, due, kind, penalties });
  // The elf log: the latest lines from the points ledger (spending on rewards isn't news for the elves).
  const log = ledger(db, memberId, 30).filter((e) => e.kind !== 'redeem' && e.date >= since).slice(0, 5)
    .map((e) => ({ id: e.id, date: e.date, amount: e.amount, reason: e.reason }));
  return { score, level: niceLevel(score), done, due, kind, penalties, since, log };
}

function elfView(r: Row) {
  return {
    id: r.id as string, memberId: r.member_id as string, date: r.date as string, task: r.task as string, elf: r.elf as string,
    points: r.points as number, status: r.status as 'waiting' | 'done' | 'rejected', paid: !!r.paid, note: (r.note as string | null) ?? null,
  };
}

export function holidayRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const active = (ctx: HomeCtx) => {
    const home = homeInfo(db, ctx.homeId);
    const today = homeToday(home);
    const s = holidaySettings(db, ctx.homeId);
    return { home, today, s, on: holidayActive(s, today) };
  };

  // Parents: the settings, and whether it's showing today.
  app.get('/api/homes/:homeId/holiday-settings', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const a = active(ctx);
    return { settings: a.s, activeToday: a.on, today: a.today };
  });

  app.put('/api/homes/:homeId/holiday-settings', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    if (ctx.access === 'caregiver') throw new HttpError(403, 'Ask a parent to change Holiday mode');
    const b = (req.body ?? {}) as Row;
    const s = cleanHoliday({ ...holidaySettings(db, ctx.homeId), ...b });
    if (s.mode === 'dates' && !s.from && !s.to) throw new HttpError(400, 'Pick a start date, an end date, or both');
    if (s.from && s.to && s.from > s.to) throw new HttpError(400, 'The start date is after the end date');
    db.prepare('UPDATE homes SET holiday = ? WHERE id = ?').run(JSON.stringify(s), ctx.homeId);
    const a = active(ctx);
    return { settings: a.s, activeToday: a.on, today: a.today };
  });

  // Anyone in the home: a parent, a kid, or the family tablet.
  app.get('/api/homes/:homeId/holiday', async (req) => {
    const ctx = homeCtx(db, req);
    return { holiday: holidayView(db, ctx.homeId) };
  });

  // A kid's board: today's elf (and how their task is going) and the nice meter.
  app.get('/api/homes/:homeId/kids/:memberId/holiday', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    const kid = getKid(db, ctx, memberId);
    const a = active(ctx);
    if (!a.on) return { holiday: null };
    const lang = kidLang(kid, a.home);
    const elf = elfFor(a.s, a.today, lang);
    const row = db.prepare('SELECT * FROM elf_tasks WHERE member_id = ? AND date = ?').get(memberId, a.today) as Row | undefined;
    return {
      holiday: {
        elf: a.s.elf ? { ...elf, points: a.s.elfPoints, needsOk: a.s.elfNeedsOk, done: row ? elfView(row) : null } : null,
        nice: a.s.nice ? niceFor(db, a.home, a.s, memberId, a.today) : null,
      },
    };
  });

  const pay = (ctx: HomeCtx, r: Row, today: string, by: { userId: string | null; name: string }) => {
    if (r.paid || !(r.points as number)) return 0;
    writeLedger(db, { homeId: ctx.homeId, memberId: r.member_id as string, amount: r.points as number, kind: 'bonus',
      reason: `🧝 ${r.task as string}`, date: today, by });
    db.prepare('UPDATE elf_tasks SET paid = 1 WHERE id = ?').run(r.id as string);
    return r.points as number;
  };

  // "I did it!" for today's elf task. A kid's waits for a grown-up when it pays points (unless the home trusts it);
  // a parent's counts straight away. Once a day per kid.
  app.post('/api/homes/:homeId/kids/:memberId/holiday/elf', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    if (!isParent(ctx) && ctx.actor.kind !== 'kid') throw new HttpError(403, 'Pick your raccoon first');
    const kid = getKid(db, ctx, memberId);
    const a = active(ctx);
    if (!a.on || !a.s.elf) throw new HttpError(400, "The elves aren't here right now");
    const old = db.prepare('SELECT * FROM elf_tasks WHERE member_id = ? AND date = ?').get(memberId, a.today) as Row | undefined;
    if (old && old.status !== 'rejected') return { task: elfView(old), paid: 0 };
    const elf = elfFor(a.s, a.today, kidLang(kid, a.home));
    const finish = isParent(ctx) || !a.s.elfNeedsOk || !a.s.elfPoints;
    const id = (old?.id as string | undefined) ?? newId();
    let paid = 0;
    tx(db, () => {
      if (old) db.prepare("UPDATE elf_tasks SET status = ?, task = ?, elf = ?, points = ?, note = NULL, reviewed_by = NULL, created_at = datetime('now') WHERE id = ?")
        .run(finish ? 'done' : 'waiting', elf.task, elf.name, a.s.elfPoints, id);
      else db.prepare('INSERT INTO elf_tasks (id, home_id, member_id, date, task, elf, points, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, ctx.homeId, memberId, a.today, elf.task, elf.name, a.s.elfPoints, finish ? 'done' : 'waiting');
      const r = db.prepare('SELECT * FROM elf_tasks WHERE id = ?').get(id) as Row;
      if (finish) paid = pay(ctx, r, a.today, isParent(ctx) ? byOf(ctx) : { userId: null, name: '✨ Auto-approved' });
    });
    return { task: elfView(db.prepare('SELECT * FROM elf_tasks WHERE id = ?').get(id) as Row), paid };
  });

  // A kid can take back a tick that's still waiting.
  app.delete('/api/homes/:homeId/kids/:memberId/holiday/elf', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    const { today } = active(ctx);
    db.prepare("DELETE FROM elf_tasks WHERE member_id = ? AND date = ? AND status = 'waiting'").run(memberId, today);
    return { ok: true };
  });

  // The parent home: elf tasks waiting for a check.
  app.get('/api/homes/:homeId/holiday/waiting', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kids = new Map(listKids(db, ctx.homeId).map((k) => [k.id, k]));
    return (db.prepare("SELECT * FROM elf_tasks WHERE home_id = ? AND status = 'waiting' ORDER BY created_at").all(ctx.homeId) as Row[])
      .map(elfView).filter((e) => kids.has(e.memberId))
      .map((e) => ({ ...e, kid: { name: kids.get(e.memberId)!.name, avatar: kids.get(e.memberId)!.avatar, color: kids.get(e.memberId)!.color } }));
  });

  const waiting = (ctx: HomeCtx, id: string) => {
    const r = db.prepare('SELECT * FROM elf_tasks WHERE id = ? AND home_id = ?').get(id, ctx.homeId) as Row | undefined;
    if (!r) throw new HttpError(404, 'That elf task is gone');
    if (r.status !== 'waiting') throw new HttpError(400, 'Nothing to check');
    return r;
  };

  app.post('/api/homes/:homeId/holiday/elf/:id/approve', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const r = waiting(ctx, (req.params as { id: string }).id);
    const { today } = active(ctx);
    let paid = 0;
    tx(db, () => {
      db.prepare("UPDATE elf_tasks SET status = 'done', reviewed_by = ? WHERE id = ?").run(byOf(ctx).name, r.id as string);
      paid = pay(ctx, r, today, byOf(ctx));
    });
    return { task: elfView(db.prepare('SELECT * FROM elf_tasks WHERE id = ?').get(r.id as string) as Row), paid };
  });

  // "Not yet": the kid sees the note and can try again today.
  app.post('/api/homes/:homeId/holiday/elf/:id/reject', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const r = waiting(ctx, (req.params as { id: string }).id);
    const note = str((req.body as Row | undefined)?.note, 200);
    db.prepare("UPDATE elf_tasks SET status = 'rejected', note = ?, reviewed_by = ? WHERE id = ?").run(note, byOf(ctx).name, r.id as string);
    return { task: elfView(db.prepare('SELECT * FROM elf_tasks WHERE id = ?').get(r.id as string) as Row) };
  });
}
