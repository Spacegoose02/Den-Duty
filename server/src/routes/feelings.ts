// Feelings check-in: a kid taps how they feel today (and, if they like, why). Parents see each kid's check-ins
// on the parent home, and a hard feeling (sad, angry, worried, scared) can buzz their phones. Never on the family
// wall, never shown to other kids, never sent to AI.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx, isParent } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, parseJson, str } from '../util.ts';
import { homeInfo, homeToday } from '../chores.ts';
import { emit } from '../events.ts';
import { getKid, listKids, pageOn } from './homes.ts';
import { addDays } from '../../../shared/schedule.ts';
import { FEELING_IDS, FEELING_REASONS, feelingOf, type FeelingId, type FeelingReason } from '../../../shared/feelings.ts';

const REASON_IDS = FEELING_REASONS.map((r) => r.id) as FeelingReason[];

const view = (r: Row) => ({
  date: r.date as string, feeling: r.feeling as FeelingId, reasons: parseJson<FeelingReason[]>(r.reasons, []), note: r.note as string | null,
});
export type FeelingView = ReturnType<typeof view>;

export function feelingsBetween(db: DatabaseSync, memberId: string, from: string, to: string): FeelingView[] {
  return (db.prepare('SELECT * FROM kid_feelings WHERE member_id = ? AND date BETWEEN ? AND ? ORDER BY date').all(memberId, from, to) as Row[]).map(view);
}

export function feelingRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/kids/:memberId/feelings', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    getKid(db, ctx, memberId);
    if (ctx.actor.kind !== 'kid' && !isParent(ctx)) throw new HttpError(403, 'Pick your raccoon first');
    const today = homeToday(homeInfo(db, ctx.homeId));
    const on = pageOn(db, memberId, 'feelings');
    const days = Math.min(Math.max(Number((req.query as { days?: string }).days) || 7, 1), 90);
    const list = on || isParent(ctx) ? feelingsBetween(db, memberId, addDays(today, -(days - 1)), today) : [];
    return { on, today: list.find((f) => f.date === today) ?? null, days: list };
  });

  app.put('/api/homes/:homeId/kids/:memberId/feelings', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    getKid(db, ctx, memberId);
    if (ctx.actor.kind !== 'kid' && !isParent(ctx)) throw new HttpError(403, 'Pick your raccoon first');
    if (!pageOn(db, memberId, 'feelings')) throw new HttpError(403, 'The feelings check-in is switched off');
    const b = (req.body ?? {}) as Row;
    if (!(FEELING_IDS as unknown[]).includes(b.feeling)) throw new HttpError(400, 'Pick a feeling');
    const reasons = Array.isArray(b.reasons) ? [...new Set(b.reasons.filter((r): r is FeelingReason => (REASON_IDS as unknown[]).includes(r)))] : [];
    const note = str(b.note, 300);
    const home = homeInfo(db, ctx.homeId);
    const today = homeToday(home);
    const before = db.prepare('SELECT feeling FROM kid_feelings WHERE member_id = ? AND date = ?').get(memberId, today) as Row | undefined;
    db.prepare(`INSERT INTO kid_feelings (member_id, home_id, date, feeling, reasons, note) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (member_id, date) DO UPDATE SET feeling = excluded.feeling, reasons = excluded.reasons, note = excluded.note, created_at = datetime('now')`)
      .run(memberId, ctx.homeId, today, b.feeling as string, JSON.stringify(reasons), note);
    const f = feelingOf(b.feeling as string)!;
    const alertOn = !!(db.prepare('SELECT feelings_alert FROM homes WHERE id = ?').get(ctx.homeId) as Row).feelings_alert;
    // Buzz once when a kid moves to a hard feeling (not again for the same feeling the same day).
    const alert = ctx.actor.kind === 'kid' && alertOn && f.alert && before?.feeling !== f.id;
    emit(db, ctx.homeId, 'feeling_shared', memberId, { feeling: f.label.toLowerCase(), icon: f.icon, alert, note: alert ? note : null });
    return view(db.prepare('SELECT * FROM kid_feelings WHERE member_id = ? AND date = ?').get(memberId, today) as Row);
  });

  // Parents: everyone's check-ins for the last week, and the alert switch.
  app.get('/api/homes/:homeId/feelings', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const today = homeToday(homeInfo(db, ctx.homeId));
    const from = addDays(today, -6);
    const alert = !!(db.prepare('SELECT feelings_alert FROM homes WHERE id = ?').get(ctx.homeId) as Row).feelings_alert;
    return {
      today, alert,
      kids: listKids(db, ctx.homeId).filter((k) => !k.pagesOff.includes('feelings')).map((k) => ({
        id: k.id, name: k.name, avatar: k.avatar, color: k.color, days: feelingsBetween(db, k.id, from, today),
      })),
    };
  });

  app.patch('/api/homes/:homeId/feelings', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    if ('alert' in b) db.prepare('UPDATE homes SET feelings_alert = ? WHERE id = ?').run(b.alert ? 1 : 0, ctx.homeId);
    return { alert: !!(db.prepare('SELECT feelings_alert FROM homes WHERE id = ?').get(ctx.homeId) as Row).feelings_alert };
  });
}
