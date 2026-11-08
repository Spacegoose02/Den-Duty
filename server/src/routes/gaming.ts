// LootDen link: what LootDen (the family's game library) needs to know about each kid, on the public API. LootDen polls
// GET /api/v1/homes/:homeId/gaming with a control token and
//   - locks a kid's games while a time-out says so (all games, or just Roblox),
//   - can keep games closed until today's chores are done,
//   - hands out game time a kid bought in the rewards shop, then claims the order so it's marked given here,
//   - unlocks a family game night when a family goal is reached.
// Dendrop, the family chat app, polls the same endpoint for each kid's chores line and for time-outs that pause chat
// (the whole time, or until today's chores are done).
// LootDen also reports back (POST .../gaming/report): what each kid played today, and the games a shop reward can
// unlock. A reward that unlocks a game shows in gameUnlocks until LootDen claims it.
// Kids whose Chores, Time-outs or Goals & rewards pages are off are left out of that part.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { emit } from '../events.ts';
import { HttpError, parseJson } from '../util.ts';
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
  /** Time-outs on right now that pause the kid's chat in Dendrop: 'all' the whole time, 'chores' until today's chores are done. */
  chatLocks: Array<{ id: string; what: string; chat: 'all' | 'chores'; endsAt: string }>;
  /** Game time bought in the shop that LootDen hasn't handed out yet. */
  gameTime: Array<{ orderId: string; title: string; icon: string; minutes: number; boughtAt: string }>;
  /** Rewards bought that unlock one LootDen game for a while, not handed out yet. */
  gameUnlocks: Array<{ orderId: string; title: string; icon: string; gameId: string; gameTitle: string; hours: number; boughtAt: string }>;
}

/** A game LootDen says a reward can unlock. */
export interface LootdenGame { id: string; title: string }

/** What LootDen last reported: games a reward can unlock, and each kid's play today. */
export function lootdenReport(db: DatabaseSync, homeId: string) {
  const r = db.prepare('SELECT games, updated_at FROM gaming_reports WHERE home_id = ?').get(homeId) as Row | undefined;
  const today = homeToday(homeInfo(db, homeId));
  const play = (db.prepare(`SELECT p.*, m.name FROM gaming_play p JOIN members m ON m.id = p.member_id WHERE m.home_id = ? AND p.day = ?`)
    .all(homeId, today) as Row[]).map((p) => ({
    memberId: p.member_id as string, name: p.name as string, minutes: p.minutes as number,
    playing: (p.playing ?? null) as string | null, remaining: (p.remaining ?? null) as number | null, updatedAt: p.updated_at as string,
  }));
  return { linked: !!r, updatedAt: (r?.updated_at ?? null) as string | null, games: parseJson<LootdenGame[]>(r?.games, []), play };
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
    const chatLocks = timeoutsOff.has(id) ? [] : (db.prepare(`SELECT id, what, chat, ends_at FROM timeouts
      WHERE member_id = ? AND chat IS NOT NULL AND ended_at IS NULL AND starts_at <= ? AND ends_at > ? ORDER BY ends_at`).all(id, now, now) as Row[])
      .map((r) => ({ id: r.id as string, what: r.what as string, chat: r.chat as 'all' | 'chores', endsAt: r.ends_at as string }));
    const gameTime = goalsOff.has(id) ? [] : (db.prepare(`SELECT id, title, icon, game_minutes, created_at FROM shop_orders
      WHERE member_id = ? AND status = 'waiting' AND game_minutes IS NOT NULL ORDER BY created_at`).all(id) as Row[])
      .map((r) => ({ orderId: r.id as string, title: r.title as string, icon: r.icon as string, minutes: r.game_minutes as number, boughtAt: r.created_at as string }));
    const gameUnlocks = goalsOff.has(id) ? [] : (db.prepare(`SELECT id, title, icon, unlock_game, unlock_hours, created_at FROM shop_orders
      WHERE member_id = ? AND status = 'waiting' AND unlock_game IS NOT NULL ORDER BY created_at`).all(id) as Row[])
      .map((r) => {
        const g = parseJson<LootdenGame>(r.unlock_game, { id: '', title: '' });
        return { orderId: r.id as string, title: r.title as string, icon: r.icon as string, gameId: g.id, gameTitle: g.title, hours: (r.unlock_hours ?? 24) as number, boughtAt: r.created_at as string };
      });
    return { id, name: k.name as string, chores, locks, chatLocks, gameTime, gameUnlocks };
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
    if (!o || (o.game_minutes == null && o.unlock_game == null)) throw new HttpError(404, 'No such game time order');
    if (o.status !== 'waiting') return { ok: true, already: true };
    const by = ctx.tokenName ?? 'LootDen';
    db.prepare("UPDATE shop_orders SET status = 'given', closed_at = datetime('now'), closed_by = ? WHERE id = ?").run(by, orderId);
    emit(db, ctx.homeId, 'reward_given', o.member_id as string, { reward: o.title, icon: o.icon, price: o.price, order_id: orderId, by, game_minutes: o.game_minutes });
    return { ok: true, already: false };
  });

  // LootDen reports back every minute or so: each linked kid's play today, and the games a reward may unlock.
  app.post(v1Path('/homes/:homeId/gaming/report'), { config: { v1: 'control' } }, async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as { kids?: unknown; games?: unknown };
    const kids = new Set(listKids(db, ctx.homeId).map((k) => k.id as string));
    const today = homeToday(homeInfo(db, ctx.homeId));
    const games = (Array.isArray(b.games) ? b.games : []).slice(0, 500).flatMap((g) => {
      const id = String((g as LootdenGame)?.id ?? '').slice(0, 200);
      const title = String((g as LootdenGame)?.title ?? '').trim().slice(0, 120);
      return id && title ? [{ id, title }] : [];
    });
    db.prepare(`INSERT INTO gaming_reports (home_id, games, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(home_id) DO UPDATE SET games = excluded.games, updated_at = excluded.updated_at`).run(ctx.homeId, JSON.stringify(games));
    let saved = 0;
    for (const k of Array.isArray(b.kids) ? b.kids.slice(0, 50) : []) {
      const r = k as { kidId?: unknown; minutes?: unknown; playing?: unknown; remaining?: unknown };
      const id = String(r.kidId ?? '');
      if (!kids.has(id)) continue;
      const minutes = Math.max(0, Math.min(24 * 60, Math.round(Number(r.minutes) || 0)));
      const playing = typeof r.playing === 'string' && r.playing.trim() ? r.playing.trim().slice(0, 120) : null;
      const remaining = r.remaining == null || !Number.isFinite(Number(r.remaining)) ? null : Math.max(0, Math.round(Number(r.remaining)));
      db.prepare(`INSERT INTO gaming_play (member_id, day, minutes, playing, remaining, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(member_id) DO UPDATE SET day = excluded.day, minutes = excluded.minutes, playing = excluded.playing,
        remaining = excluded.remaining, updated_at = excluded.updated_at`).run(id, today, minutes, playing, remaining);
      saved++;
    }
    return { ok: true, kids: saved, games: games.length };
  });

  // For Den Duty's own pages: what LootDen reported (parents see everyone; a kid sees their own play).
  app.get('/api/homes/:homeId/gaming/lootden', async (req) => {
    const ctx = homeCtx(db, req);
    const r = lootdenReport(db, ctx.homeId);
    if (ctx.actor.kind === 'parent') return r;
    const own = ctx.actor.kind === 'kid' ? ctx.actor.memberId : null;
    return { ...r, games: [], play: r.play.filter((p) => p.memberId === own) };
  });
}
