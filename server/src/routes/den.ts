// Rocky's den: a kid's own room on their board. They buy furniture with points (fancier things unlock with levels),
// put it out or tuck it away, and the room is tidy or messy depending on how chores went the last three days.
// Buying writes a 'redeem' row to the ledger like the rewards shop, so levels (lifetime earnings) never drop.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx, isParent, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError } from '../util.ts';
import { balance, homeInfo, homeToday, todayList, writeLedger } from '../chores.ts';
import { levelOf } from '../progress.ts';
import { getKid, pageOn } from './homes.ts';
import { byOf } from './chores.ts';
import { addDays } from '../../../shared/schedule.ts';
import { DEN_ITEMS, denItem, tidinessOf } from '../../../shared/den.ts';

/** Share of regular chores done over the last three days (today: waiting for a grown-up counts as done). */
export function denShare(db: DatabaseSync, homeId: string, memberId: string, today: string): number | null {
  todayList(db, homeId, memberId, today);
  const rows = db.prepare(`SELECT i.date, i.status FROM chore_instances i LEFT JOIN chores c ON c.id = i.chore_id
    WHERE i.member_id = ? AND i.date BETWEEN ? AND ? AND COALESCE(c.bonus, 0) = 0`).all(memberId, addDays(today, -2), today) as Row[];
  // Today only counts what's already finished, so the den isn't messy first thing in the morning.
  const done = (r: Row) => r.status === 'approved' || (r.date === today && r.status === 'submitted');
  const counted = rows.filter((r) => r.date !== today || done(r));
  return counted.length ? counted.filter(done).length / counted.length : null;
}

export function denView(db: DatabaseSync, homeId: string, memberId: string) {
  const today = homeToday(homeInfo(db, homeId));
  const owned = db.prepare('SELECT item_id, placed FROM den_items WHERE member_id = ?').all(memberId) as Row[];
  const level = levelOf(db, memberId).level;
  const bal = balance(db, memberId);
  const share = denShare(db, homeId, memberId, today);
  return {
    tidiness: tidinessOf(share), share,
    level, balance: bal,
    items: DEN_ITEMS.map((i) => {
      const o = owned.find((x) => x.item_id === i.id);
      return { ...i, owned: !!o, placed: !!o?.placed, locked: level < i.level, affordable: bal >= i.price };
    }),
  };
}

export function denRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const kid = (ctx: HomeCtx, memberId: string) => {
    assertCanActFor(ctx, memberId);
    getKid(db, ctx, memberId);
    if (ctx.actor.kind !== 'kid' && !isParent(ctx)) throw new HttpError(403, 'Pick your raccoon first');
  };

  app.get('/api/homes/:homeId/kids/:memberId/den', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    kid(ctx, memberId);
    if (!pageOn(db, memberId, 'den')) return null;
    return denView(db, ctx.homeId, memberId);
  });

  app.post('/api/homes/:homeId/kids/:memberId/den/buy', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    kid(ctx, memberId);
    if (!pageOn(db, memberId, 'den')) throw new HttpError(403, "Rocky's den is switched off");
    const item = denItem(String((req.body as Row | undefined)?.itemId ?? ''));
    if (!item) throw new HttpError(404, 'No such thing in the den shop');
    const today = homeToday(homeInfo(db, ctx.homeId));
    tx(db, () => {
      if (db.prepare('SELECT 1 FROM den_items WHERE member_id = ? AND item_id = ?').get(memberId, item.id)) throw new HttpError(400, 'You already have that');
      if (levelOf(db, memberId).level < item.level) throw new HttpError(400, `That unlocks at level ${item.level}`);
      if (balance(db, memberId) < item.price) throw new HttpError(400, `You need ${item.price - balance(db, memberId)} more`);
      db.prepare('INSERT INTO den_items (member_id, item_id) VALUES (?, ?)').run(memberId, item.id);
      writeLedger(db, {
        homeId: ctx.homeId, memberId, amount: -item.price, kind: 'redeem', reason: `Bought: ${item.icon} ${item.name} for my den`, date: today,
        by: isParent(ctx) ? byOf(ctx) : { userId: null, name: 'Den shop' },
      });
    });
    return denView(db, ctx.homeId, memberId);
  });

  // Put something out in the room, or tuck it away.
  app.post('/api/homes/:homeId/kids/:memberId/den/place', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    kid(ctx, memberId);
    const b = (req.body ?? {}) as Row;
    const r = db.prepare('UPDATE den_items SET placed = ? WHERE member_id = ? AND item_id = ?').run(b.placed ? 1 : 0, memberId, String(b.itemId ?? ''));
    if (!Number(r.changes)) throw new HttpError(404, "You don't have that yet");
    return denView(db, ctx.homeId, memberId);
  });
}
