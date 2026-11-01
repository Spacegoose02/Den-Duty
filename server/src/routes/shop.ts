// The rewards shop: parents stock it with rewards and prices, kids spend their points on them. Points come off right
// away (so a kid can't spend them twice) and the order waits for a grown-up to hand the reward over, or refund it.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { emit } from '../events.ts';
import { HttpError, newId, num, requireStr } from '../util.ts';
import { balance, homeInfo, homeToday, writeLedger } from '../chores.ts';
import { cleanIcon, getKid, pageOn } from './homes.ts';
import { byOf } from './chores.ts';

export const SHOP_MAX_ITEMS = 40;

function price(v: unknown): number {
  const n = num(v);
  if (n == null || !Number.isInteger(n) || n < 1 || n > 100_000) throw new HttpError(400, 'The price must be a whole number of points, at least 1');
  return n;
}

/** Blank or missing means unlimited. */
function stock(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = num(v);
  if (n == null || !Number.isInteger(n) || n < 0 || n > 10_000) throw new HttpError(400, 'How many must be a whole number, or blank for unlimited');
  return n;
}

/** Game time LootDen hands out by itself when it's bought: blank for an ordinary reward. */
function gameMinutes(v: unknown): number | null {
  if (v == null || v === '' || v === 0) return null;
  const n = num(v);
  if (n == null || !Number.isInteger(n) || n < 5 || n > 600) throw new HttpError(400, 'Game time is 5 to 600 minutes, or blank');
  return n;
}

const itemView = (r: Row) => ({
  id: r.id as string, title: r.title as string, icon: r.icon as string, price: r.price as number, stock: r.stock as number | null,
  gameMinutes: (r.game_minutes ?? null) as number | null,
});

const orderView = (r: Row) => ({
  id: r.id as string, memberId: r.member_id as string, kidName: r.kid_name as string, itemId: r.item_id as string | null,
  title: r.title as string, icon: r.icon as string, price: r.price as number, status: r.status as 'waiting' | 'given' | 'refunded',
  gameMinutes: (r.game_minutes ?? null) as number | null,
  createdAt: r.created_at as string, closedAt: r.closed_at as string | null, closedBy: r.closed_by as string | null,
});

const ORDER_SELECT = 'SELECT o.*, m.name AS kid_name FROM shop_orders o JOIN members m ON m.id = o.member_id';

function getItem(db: DatabaseSync, ctx: HomeCtx, id: string): Row {
  const r = db.prepare('SELECT * FROM shop_items WHERE id = ? AND home_id = ?').get(id, ctx.homeId) as Row | undefined;
  if (!r) throw new HttpError(404, 'That reward is gone from the shop');
  return r;
}

function getOrder(db: DatabaseSync, ctx: HomeCtx, id: string): Row {
  const r = db.prepare(`${ORDER_SELECT} WHERE o.id = ? AND o.home_id = ?`).get(id, ctx.homeId) as Row | undefined;
  if (!r) throw new HttpError(404, 'That order is gone');
  if (r.status !== 'waiting') throw new HttpError(400, 'That order was already sorted out');
  return r;
}

export function shopRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/shop', async (req) => {
    const ctx = homeCtx(db, req);
    return (db.prepare('SELECT * FROM shop_items WHERE home_id = ? ORDER BY position, created_at').all(ctx.homeId) as Row[]).map(itemView);
  });

  app.post('/api/homes/:homeId/shop', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    const count = (db.prepare('SELECT COUNT(*) AS n FROM shop_items WHERE home_id = ?').get(ctx.homeId) as Row).n as number;
    if (count >= SHOP_MAX_ITEMS) throw new HttpError(400, `The shop is full (${SHOP_MAX_ITEMS} rewards max)`);
    const id = newId();
    db.prepare('INSERT INTO shop_items (id, home_id, title, icon, price, stock, position, game_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, ctx.homeId, requireStr(b.title, 'Reward', 60), cleanIcon(b.icon, '🎁'), price(b.price), stock(b.stock), count, gameMinutes(b.gameMinutes));
    return itemView(getItem(db, ctx, id));
  });

  app.patch('/api/homes/:homeId/shop/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const item = getItem(db, ctx, (req.params as { id: string }).id);
    const b = (req.body ?? {}) as Row;
    if ('title' in b) db.prepare('UPDATE shop_items SET title = ? WHERE id = ?').run(requireStr(b.title, 'Reward', 60), item.id as string);
    if ('icon' in b) db.prepare('UPDATE shop_items SET icon = ? WHERE id = ?').run(cleanIcon(b.icon, item.icon as string), item.id as string);
    if ('price' in b) db.prepare('UPDATE shop_items SET price = ? WHERE id = ?').run(price(b.price), item.id as string);
    if ('stock' in b) db.prepare('UPDATE shop_items SET stock = ? WHERE id = ?').run(stock(b.stock), item.id as string);
    if ('gameMinutes' in b) db.prepare('UPDATE shop_items SET game_minutes = ? WHERE id = ?').run(gameMinutes(b.gameMinutes), item.id as string);
    return itemView(getItem(db, ctx, item.id as string));
  });

  app.delete('/api/homes/:homeId/shop/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM shop_items WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  // A kid buys for themselves; a parent can buy on a kid's behalf.
  app.post('/api/homes/:homeId/kids/:memberId/shop/:id/buy', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId, id } = req.params as { memberId: string; id: string };
    assertCanActFor(ctx, memberId);
    if (ctx.actor.kind !== 'kid' && ctx.actor.kind !== 'parent') throw new HttpError(403, 'Tap your avatar first');
    const kid = getKid(db, ctx, memberId);
    if (!pageOn(db, memberId, 'goals')) throw new HttpError(403, `Rewards are turned off for ${kid.name}`);
    const by = ctx.actor.kind === 'kid' ? { userId: null, name: kid.name as string } : byOf(ctx);
    return tx(db, () => {
      const item = getItem(db, ctx, id);
      const cost = item.price as number;
      if (item.stock === 0) throw new HttpError(400, 'Sold out! Ask a grown-up to restock it.');
      const have = balance(db, memberId);
      if (have < cost) throw new HttpError(400, `You need ${cost - have} more to get that. Keep going!`);
      const orderId = newId();
      writeLedger(db, {
        homeId: ctx.homeId, memberId, amount: -cost, kind: 'redeem', reason: `Bought: ${item.icon} ${item.title}`,
        date: homeToday(homeInfo(db, ctx.homeId)), by,
      });
      db.prepare('INSERT INTO shop_orders (id, home_id, member_id, item_id, title, icon, price, game_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(orderId, ctx.homeId, memberId, item.id as string, item.title as string, item.icon as string, cost, (item.game_minutes ?? null) as number | null);
      if (item.stock != null) db.prepare('UPDATE shop_items SET stock = stock - 1 WHERE id = ?').run(item.id as string);
      emit(db, ctx.homeId, 'reward_bought', memberId, { reward: item.title, icon: item.icon, price: cost, order_id: orderId, balance: have - cost });
      return { order: orderView(db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(orderId) as Row), balance: have - cost };
    });
  });

  // Parents see every kid's orders; a kid sees their own. Waiting ones first, then the last month.
  app.get('/api/homes/:homeId/shop/orders', async (req) => {
    const ctx = homeCtx(db, req);
    const own = ctx.actor.kind === 'kid' ? ctx.actor.memberId : null;
    if (!own && ctx.actor.kind !== 'parent') throw new HttpError(403, 'Tap your avatar first');
    const rows = db.prepare(`${ORDER_SELECT} WHERE o.home_id = ? AND (? IS NULL OR o.member_id = ?)
      AND (o.status = 'waiting' OR o.closed_at > datetime('now', '-30 days'))
      ORDER BY o.status = 'waiting' DESC, o.created_at DESC LIMIT 100`).all(ctx.homeId, own, own) as Row[];
    return rows.map(orderView);
  });

  app.post('/api/homes/:homeId/shop/orders/:id/given', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const o = getOrder(db, ctx, (req.params as { id: string }).id);
    db.prepare("UPDATE shop_orders SET status = 'given', closed_at = datetime('now'), closed_by = ? WHERE id = ?").run(byOf(ctx).name, o.id as string);
    emit(db, ctx.homeId, 'reward_given', o.member_id as string, { reward: o.title, icon: o.icon, price: o.price, order_id: o.id, by: byOf(ctx).name });
    return orderView(db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(o.id as string) as Row);
  });

  // Gives the points back and puts the item back on the shelf.
  app.post('/api/homes/:homeId/shop/orders/:id/refund', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return tx(db, () => {
      const o = getOrder(db, ctx, (req.params as { id: string }).id);
      // Kind 'redeem' so the refund cancels the purchase in spending totals instead of counting as points earned.
      writeLedger(db, {
        homeId: ctx.homeId, memberId: o.member_id as string, amount: o.price as number, kind: 'redeem', reason: `Refund: ${o.icon} ${o.title}`,
        date: homeToday(homeInfo(db, ctx.homeId)), by: byOf(ctx),
      });
      db.prepare("UPDATE shop_orders SET status = 'refunded', closed_at = datetime('now'), closed_by = ? WHERE id = ?").run(byOf(ctx).name, o.id as string);
      if (o.item_id) db.prepare('UPDATE shop_items SET stock = stock + 1 WHERE id = ? AND stock IS NOT NULL').run(o.item_id as string);
      emit(db, ctx.homeId, 'reward_refunded', o.member_id as string, { reward: o.title, icon: o.icon, price: o.price, order_id: o.id, by: byOf(ctx).name });
      return orderView(db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(o.id as string) as Row);
    });
  });
}
