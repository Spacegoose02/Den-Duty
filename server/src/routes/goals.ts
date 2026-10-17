import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, newId, num, requireStr, str } from '../util.ts';
import { balance, goalsFor, homeInfo, homeToday, ledger, penalize, redeemGoal, writeLedger } from '../chores.ts';
import { getKid } from './homes.ts';
import { byOf } from './chores.ts';

function targetPoints(v: unknown): number {
  const n = num(v);
  if (n == null || !Number.isInteger(n) || n < 1 || n > 1_000_000) throw new HttpError(400, 'The goal needs a whole number of points, at least 1');
  return n;
}

export function goalRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/kids/:memberId/goals', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    getKid(db, ctx, memberId);
    return goalsFor(db, memberId, (req.query as { all?: string }).all === '1');
  });

  app.post('/api/homes/:homeId/kids/:memberId/goals', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const b = (req.body ?? {}) as Row;
    const id = newId();
    db.prepare('INSERT INTO goals (id, home_id, member_id, title, target_points, reward, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, ctx.homeId, kid.id as string, requireStr(b.title, 'Goal', 80), targetPoints(b.targetPoints), str(b.reward, 200), ctx.user?.id ?? null);
    return goalsFor(db, kid.id as string).find((g) => g.id === id);
  });

  app.patch('/api/homes/:homeId/goals/:goalId', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const g = db.prepare("SELECT * FROM goals WHERE id = ? AND home_id = ?").get((req.params as { goalId: string }).goalId, ctx.homeId) as Row | undefined;
    if (!g) throw new HttpError(404, 'That goal is gone');
    if (g.status !== 'active') throw new HttpError(400, "Redeemed goals can't be changed");
    const b = (req.body ?? {}) as Row;
    const title = str(b.title, 80);
    if (title) db.prepare('UPDATE goals SET title = ? WHERE id = ?').run(title, g.id as string);
    if ('targetPoints' in b) db.prepare('UPDATE goals SET target_points = ? WHERE id = ?').run(targetPoints(b.targetPoints), g.id as string);
    if ('reward' in b) db.prepare('UPDATE goals SET reward = ? WHERE id = ?').run(str(b.reward, 200), g.id as string);
    return goalsFor(db, g.member_id as string).find((x) => x.id === g.id);
  });

  app.delete('/api/homes/:homeId/goals/:goalId', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM goals WHERE id = ? AND home_id = ?').run((req.params as { goalId: string }).goalId, ctx.homeId);
    return { ok: true };
  });

  // The kid gets the reward: their points are spent.
  app.post('/api/homes/:homeId/goals/:goalId/redeem', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return redeemGoal(db, ctx.homeId, (req.params as { goalId: string }).goalId, byOf(ctx), homeToday(homeInfo(db, ctx.homeId)));
  });

  // ---------- the points ledger ----------
  app.get('/api/homes/:homeId/kids/:memberId/ledger', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    getKid(db, ctx, memberId);
    return { balance: balance(db, memberId), entries: ledger(db, memberId, Math.min(Number((req.query as { limit?: string }).limit) || 100, 500)) };
  });

  // Bonus points, or taking some away. Always a new row; the ledger is never edited.
  app.post('/api/homes/:homeId/kids/:memberId/points', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const b = (req.body ?? {}) as Row;
    const amount = num(b.amount);
    if (amount == null || !Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100_000) throw new HttpError(400, 'Points must be a whole number other than zero');
    const today = homeToday(homeInfo(db, ctx.homeId));
    if (amount < 0) {
      const allowNegative = !!(db.prepare('SELECT allow_negative FROM homes WHERE id = ?').get(ctx.homeId) as Row).allow_negative;
      return penalize(db, { id: ctx.homeId, allowNegative }, kid.id as string, -amount, str(b.reason, 120) ?? 'Points taken away', byOf(ctx), today);
    }
    writeLedger(db, { homeId: ctx.homeId, memberId: kid.id as string, amount, kind: 'bonus', reason: str(b.reason, 120) ?? 'Bonus', date: today, by: byOf(ctx) });
    return { balance: balance(db, kid.id as string) };
  });
}
