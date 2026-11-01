// LootDen link: what LootDen (the family's game library) needs to know about each kid, on the public API. LootDen polls
// GET /api/v1/homes/:homeId/gaming with a control token and
//   - locks a kid's games while a time-out says so (all games, or just Roblox),
//   - can keep games closed until today's chores are done,
//   - hands out game time a kid bought in the rewards shop, then claims the order so it's marked given here,
//   - unlocks a family game night when a family goal is reached.
// Kids whose Chores, Time-outs or Goals & rewards pages are off are left out of that part.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { emit } from '../events.ts';
import { HttpError } from '../util.ts';
import { homeInfo, homeToday, kidsWithPageOff, todayList } from '../chores.ts';
import { listKids } from './homes.ts';
import { v1Path } from './v1.ts';

export interface GamingKid {
  id: string;
  name: string;
  /** Today's chores: how many are due, done (waiting for a grown-up counts) and still to do. Null when Chores is off. */
  chores: { due: number; done: number; left: number } | null;
  /** Time-outs on right now that lock LootDen games. */
  locks: Array<{ id: string; what: string; games: 'all' | 'roblox'; endsAt: string }>;
  /** Game time bought in the shop that LootDen hasn't handed out yet. */
  gameTime: Array<{ orderId: string; title: string; icon: string; minutes: number; boughtAt: string }>;
}

export function gamingState(db: DatabaseSync, homeId: string) {
  const h = homeInfo(db, homeId);
  const today = homeToday(h);
  const now = new Date().toISOString();
  const choresOff = kidsWithPageOff(db, homeId, 'chores');
  const timeoutsOff = kidsWithPageOff(db, homeId, 'timeout');
  const goalsOff = kidsWithPageOff(db, homeId, 'goals');
  const kids: GamingKid[] = listKids(db, homeId).map((k) => {
    const id = k.id as string;
    let chores: GamingKid['chores'] = null;
    if (!choresOff.has(id)) {
      const items = todayList(db, homeId, id, today);
      const done = items.filter((i) => i.status === 'submitted' || i.status === 'approved').length;
      chores = { due: items.length, done, left: items.length - done };
    }
    const locks = timeoutsOff.has(id) ? [] : (db.prepare(`SELECT id, what, games, ends_at FROM timeouts
      WHERE member_id = ? AND games IS NOT NULL AND ended_at IS NULL AND starts_at <= ? AND ends_at > ? ORDER BY ends_at`).all(id, now, now) as Row[])
      .map((r) => ({ id: r.id as string, what: r.what as string, games: r.games as 'all' | 'roblox', endsAt: r.ends_at as string }));
    const gameTime = goalsOff.has(id) ? [] : (db.prepare(`SELECT id, title, icon, game_minutes, created_at FROM shop_orders
      WHERE member_id = ? AND status = 'waiting' AND game_minutes IS NOT NULL ORDER BY created_at`).all(id) as Row[])
      .map((r) => ({ orderId: r.id as string, title: r.title as string, icon: r.icon as string, minutes: r.game_minutes as number, boughtAt: r.created_at as string }));
    return { id, name: k.name as string, chores, locks, gameTime };
  });
  const goals = (db.prepare(`SELECT id, title, icon, reward, status, reached_at FROM team_goals WHERE home_id = ? AND reached_at IS NOT NULL
    AND reached_at > datetime('now', '-30 days') ORDER BY reached_at DESC LIMIT 10`).all(homeId) as Row[])
    .map((r) => ({ id: r.id as string, title: r.title as string, icon: r.icon as string, reward: r.reward as string | null, reachedAt: r.reached_at as string, done: r.status === 'done' }));
  return { today, timezone: h.timezone, pointsName: h.pointsName, pointsIcon: h.pointsIcon, kids, familyGoalsReached: goals };
}

export function gamingRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get(v1Path('/homes/:homeId/gaming'), { config: { v1: 'read' } }, async (req) => gamingState(db, homeCtx(db, req, 'parent').homeId));

  // LootDen handed the game time out: the order is marked given, like a parent tapping it.
  app.post(v1Path('/homes/:homeId/gaming/orders/:orderId/claim'), { config: { v1: 'control' } }, async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const { orderId } = req.params as { orderId: string };
    const o = db.prepare('SELECT * FROM shop_orders WHERE id = ? AND home_id = ?').get(orderId, ctx.homeId) as Row | undefined;
    if (!o || o.game_minutes == null) throw new HttpError(404, 'No such game time order');
    if (o.status !== 'waiting') return { ok: true, already: true };
    const by = ctx.tokenName ?? 'LootDen';
    db.prepare("UPDATE shop_orders SET status = 'given', closed_at = datetime('now'), closed_by = ? WHERE id = ?").run(by, orderId);
    emit(db, ctx.homeId, 'reward_given', o.member_id as string, { reward: o.title, icon: o.icon, price: o.price, order_id: orderId, by, game_minutes: o.game_minutes });
    return { ok: true, already: false };
  });
}
