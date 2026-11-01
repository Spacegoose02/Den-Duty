import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, requireStr, str } from '../util.ts';
import { homeInfo, homeToday } from '../chores.ts';
import { cashOut, cleanSplit, deposit, isJar, jars, moneyHistory, moneySettings, moveMoney, runMoney, skipInterestThisMonth, withdraw } from '../money.ts';
import { getKid, listKids } from './homes.ts';
import { byOf } from './chores.ts';

export function moneyRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // Everything the Allowance page needs (parents).
  app.get('/api/homes/:homeId/money', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const today = homeToday(homeInfo(db, ctx.homeId));
    runMoney(db, ctx.homeId, today);
    const settings = moneySettings(db, ctx.homeId);
    const kids = listKids(db, ctx.homeId).map((k) => {
      const r = db.prepare('SELECT allowance_cents, allowance_day FROM members WHERE id = ?').get(k.id) as Row;
      const j = jars(db, k.id);
      return {
        id: k.id, name: k.name, avatar: k.avatar, color: k.color, balance: k.balance, jars: j, total: j.spend + j.save + j.give,
        allowanceCents: r.allowance_cents as number, allowanceDay: r.allowance_day as number, history: moneyHistory(db, k.id, 25),
      };
    });
    return { today, settings, kids };
  });

  app.patch('/api/homes/:homeId/money/settings', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    const today = homeToday(homeInfo(db, ctx.homeId));
    const before = moneySettings(db, ctx.homeId);
    if (typeof b.enabled === 'boolean') db.prepare('UPDATE homes SET money_enabled = ? WHERE id = ?').run(b.enabled ? 1 : 0, ctx.homeId);
    if ('symbol' in b) db.prepare('UPDATE homes SET money_symbol = ? WHERE id = ?').run(requireStr(b.symbol, 'Money symbol', 4), ctx.homeId);
    if ('centsPerPoint' in b) {
      const n = Number(b.centsPerPoint);
      if (!Number.isInteger(n) || n < 0 || n > 10000) throw new HttpError(400, 'A point is worth 0 to 10000 cents');
      db.prepare('UPDATE homes SET cents_per_point = ? WHERE id = ?').run(n, ctx.homeId);
    }
    if ('split' in b) db.prepare('UPDATE homes SET jar_split = ? WHERE id = ?').run(JSON.stringify(cleanSplit(b.split)), ctx.homeId);
    if ('interest' in b) {
      const n = Number(b.interest);
      if (!Number.isInteger(n) || n < 0 || n > 100) throw new HttpError(400, 'Interest is 0% to 10% a month');
      db.prepare('UPDATE homes SET save_interest = ? WHERE id = ?').run(n, ctx.homeId);
      // Interest starts next month: turning it on today doesn't pay a whole month at once.
      if (n > 0 && before.interest === 0) skipInterestThisMonth(db, ctx.homeId, today);
    }
    if (!before.enabled && b.enabled === true) skipInterestThisMonth(db, ctx.homeId, today);
    return moneySettings(db, ctx.homeId);
  });

  // A kid's weekly allowance: an amount in cents and the weekday it pays (0 = Sunday).
  app.patch('/api/homes/:homeId/money/kids/:memberId', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const b = (req.body ?? {}) as Row;
    const today = homeToday(homeInfo(db, ctx.homeId));
    if ('allowanceCents' in b) {
      const n = Number(b.allowanceCents);
      if (!Number.isInteger(n) || n < 0 || n > 100_000) throw new HttpError(400, 'Allowance is 0 to 1000.00 a week');
      // Changing it starts counting from today, so a new allowance never pays for days before it was set.
      db.prepare('UPDATE members SET allowance_cents = ?, allowance_since = ? WHERE id = ?').run(n, today, kid.id as string);
    }
    if ('allowanceDay' in b) {
      const d = Number(b.allowanceDay);
      if (!Number.isInteger(d) || d < 0 || d > 6) throw new HttpError(400, 'Pick a day of the week');
      db.prepare('UPDATE members SET allowance_day = ?, allowance_since = ? WHERE id = ?').run(d, today, kid.id as string);
    }
    runMoney(db, ctx.homeId, today);
    return { ok: true };
  });

  app.post('/api/homes/:homeId/money/kids/:memberId/cashout', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    return cashOut(db, ctx.homeId, kid.id as string, Number((req.body as Row)?.points), byOf(ctx), homeToday(homeInfo(db, ctx.homeId)));
  });

  app.post('/api/homes/:homeId/money/kids/:memberId/deposit', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const b = (req.body ?? {}) as Row;
    if (b.jar != null && !isJar(b.jar)) throw new HttpError(400, 'Unknown jar');
    return { jars: deposit(db, ctx.homeId, kid.id as string, b.cents, str(b.reason, 80) ?? 'Money in', byOf(ctx), homeToday(homeInfo(db, ctx.homeId)), b.jar ?? undefined) };
  });

  app.post('/api/homes/:homeId/money/kids/:memberId/withdraw', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const b = (req.body ?? {}) as Row;
    if (!isJar(b.jar)) throw new HttpError(400, 'Pick a jar');
    return { jars: withdraw(db, ctx.homeId, kid.id as string, b.jar, b.cents, requireStr(b.reason, 'What it was for', 80), byOf(ctx), homeToday(homeInfo(db, ctx.homeId))) };
  });

  app.post('/api/homes/:homeId/money/kids/:memberId/move', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const b = (req.body ?? {}) as Row;
    if (!isJar(b.from) || !isJar(b.to)) throw new HttpError(400, 'Pick two jars');
    return { jars: moveMoney(db, ctx.homeId, kid.id as string, b.from, b.to, b.cents, byOf(ctx), homeToday(homeInfo(db, ctx.homeId))) };
  });
}
