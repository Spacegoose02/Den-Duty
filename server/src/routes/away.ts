// Two homes: a kid's repeating "at the other home" pattern and one-off away dates (see shared/away.ts).
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, newId, str } from '../util.ts';
import { homeInfo, homeToday } from '../chores.ts';
import { getKid } from './homes.ts';
import { awayLookup, awayOf, awayToday } from '../away.ts';
import { AWAY_PRESETS } from '../../../shared/away.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Chores not started yet that now fall on days away (today on) go away; anything a kid already did stays. */
export function dropAwayChores(db: DatabaseSync, homeId: string, memberId: string, today: string): void {
  const away = awayLookup(db, homeId);
  const open = db.prepare(`SELECT id, date FROM chore_instances WHERE member_id = ? AND date >= ? AND status = 'pending'
    AND started_at IS NULL AND traded = 0`).all(memberId, today) as Row[];
  for (const i of open) if (away(memberId, i.date as string)) db.prepare('DELETE FROM chore_instances WHERE id = ?').run(i.id as string);
}

export function awayRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const view = (homeId: string, memberId: string) => {
    const today = homeToday(homeInfo(db, homeId));
    return { ...awayOf(db, memberId), today: awayToday(db, memberId, today), presets: AWAY_PRESETS };
  };

  app.get('/api/homes/:homeId/kids/:memberId/away', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const { memberId } = req.params as { memberId: string };
    getKid(db, ctx, memberId);
    return view(ctx.homeId, memberId);
  });

  // The repeating pattern, or null to stop it.
  app.put('/api/homes/:homeId/kids/:memberId/away/plan', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const { memberId } = req.params as { memberId: string };
    getKid(db, ctx, memberId);
    const b = req.body as Row | null;
    let plan: string | null = null;
    if (b && b.days) {
      const days = Array.isArray(b.days) ? b.days.map(Boolean) : [];
      if (days.length < 2 || days.length > 28) throw new HttpError(400, 'A pattern is 2 to 28 days long');
      if (!DATE.test(String(b.anchor))) throw new HttpError(400, 'Pick the day the pattern starts');
      plan = JSON.stringify({ label: str(b.label, 40) ?? 'At the other home', anchor: String(b.anchor), days });
    }
    db.prepare('UPDATE members SET away_plan = ? WHERE id = ?').run(plan, memberId);
    dropAwayChores(db, ctx.homeId, memberId, homeToday(homeInfo(db, ctx.homeId)));
    return view(ctx.homeId, memberId);
  });

  app.post('/api/homes/:homeId/kids/:memberId/away/dates', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const { memberId } = req.params as { memberId: string };
    getKid(db, ctx, memberId);
    const b = (req.body ?? {}) as Row;
    const start = String(b.start ?? ''), end = String(b.end ?? b.start ?? '');
    if (!DATE.test(start) || !DATE.test(end) || end < start) throw new HttpError(400, 'Pick the first and last day away');
    db.prepare('INSERT INTO kid_away (id, member_id, start_date, end_date, label) VALUES (?, ?, ?, ?, ?)').run(newId(), memberId, start, end, str(b.label, 40));
    dropAwayChores(db, ctx.homeId, memberId, homeToday(homeInfo(db, ctx.homeId)));
    return view(ctx.homeId, memberId);
  });

  app.delete('/api/homes/:homeId/kids/:memberId/away/dates/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const { memberId, id } = req.params as { memberId: string; id: string };
    getKid(db, ctx, memberId);
    db.prepare('DELETE FROM kid_away WHERE id = ? AND member_id = ?').run(id, memberId);
    return view(ctx.homeId, memberId);
  });
}
