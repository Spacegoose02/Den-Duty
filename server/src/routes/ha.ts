// Home Assistant (or any automation) with an API token: per-kid sensors, today's chores, events, and actions.
// Read tokens can only look. Control tokens can also mark chores done, approve them, and give or take points.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx, type HomeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, num, requireStr, str } from '../util.ts';
import {
  approveInstance, balance, goalsFor, homeInfo, homeToday, kidWeek, penalize, reviewQueue, submitInstance, todayList, writeLedger,
} from '../chores.ts';
import { levelOf, streaks } from '../progress.ts';
import { eventView } from '../events.ts';
import { listKids } from './homes.ts';
import { homeTimeouts } from './timeouts.ts';

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'kid';

/** Actions need a control token, or a parent trying them out from the browser. */
function control(ctx: HomeCtx): void {
  if (ctx.actor.kind === 'parent') return;
  if (ctx.actor.kind === 'token' && ctx.actor.scope === 'control') return;
  throw new HttpError(403, 'This needs a control token (Settings → Home Assistant). Read tokens can only look.');
}

const by = (ctx: HomeCtx) => ({ userId: ctx.user?.id ?? null, name: ctx.user?.name ?? 'Home Assistant' });

/** Finds a kid by id or by name (any case). */
function findKid(db: DatabaseSync, homeId: string, v: unknown): { id: string; name: string } {
  const key = requireStr(v, 'Kid', 60);
  const r = db.prepare("SELECT id, name FROM members WHERE home_id = ? AND role = 'kid' AND (id = ? OR name = ? COLLATE NOCASE)").get(homeId, key, key) as Row | undefined;
  if (!r) throw new HttpError(404, `No kid called ${key}`);
  return { id: r.id as string, name: r.name as string };
}

/** Today's instance of a chore for a kid, by instance id or chore title. */
function findToday(db: DatabaseSync, homeId: string, b: Row, today: string) {
  if (b.instanceId) {
    const r = db.prepare('SELECT id FROM chore_instances WHERE id = ? AND home_id = ?').get(String(b.instanceId), homeId) as Row | undefined;
    if (!r) throw new HttpError(404, 'No such chore');
    return r.id as string;
  }
  const kid = findKid(db, homeId, b.kid);
  const title = requireStr(b.chore, 'Chore', 80).toLowerCase();
  const item = todayList(db, homeId, kid.id, today).find((i) => i.title.toLowerCase() === title);
  if (!item) throw new HttpError(404, `${kid.name} has no chore called “${b.chore}” today`);
  return item.id!;
}

export function haRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // Everything for sensors in one request. kids_by_name makes templates easy: value_json.kids_by_name.ava.balance
  app.get('/api/homes/:homeId/ha/summary', async (req) => {
    const ctx = homeCtx(db, req);
    const home = homeInfo(db, ctx.homeId);
    const today = homeToday(home);
    const waiting = reviewQueue(db, ctx.homeId);
    const timeouts = homeTimeouts(db, ctx.homeId);
    const kids = listKids(db, ctx.homeId).map((k) => {
      const off = new Set(k.pagesOff);
      const w = kidWeek(db, home, k.id, today);
      const s = streaks(db, k.id, today);
      const level = levelOf(db, k.id);
      const goal = goalsFor(db, k.id).find((g) => !g.reached) ?? goalsFor(db, k.id)[0] ?? null;
      const items = todayList(db, ctx.homeId, k.id, today);
      return {
        id: k.id, name: k.name, slug: slug(k.name),
        balance: w.balance, points_this_week: w.pointsThisWeek, pages_off: k.pagesOff,
        ...(off.has('chores')
          ? { left_today: null, done_today: null, total_today: null, waiting_for_review: null, done_this_week: null, chores_left: [] }
          : {
            left_today: w.leftToday, done_today: items.filter((i) => i.status === 'approved').length, total_today: items.length,
            waiting_for_review: waiting.filter((i) => i.memberId === k.id).length, done_this_week: w.choresDone,
            chores_left: items.filter((i) => i.status === 'pending' || i.status === 'rejected').map((i) => i.title),
          }),
        ...(off.has('stats')
          ? { streak: null, best_streak: null, level: null, level_name: null, level_badge: null }
          : { streak: s.current, best_streak: s.best, level: level.level, level_name: level.name, level_badge: level.badge }),
        ...(off.has('timeout')
          ? { in_timeout: null, timeouts: [] }
          : {
            in_timeout: timeouts.some((t) => t.memberId === k.id && t.state === 'active'),
            timeouts: timeouts.filter((t) => t.memberId === k.id).map((t) => ({
              what: t.what, reason: t.reason, state: t.state, starts_at: t.startsAt, ends_at: t.endsAt, minutes_left: t.minutesLeft,
              buy_back_waiting: !!t.pending,
            })),
          }),
        next_goal: off.has('goals') ? null : goal?.title ?? null, next_goal_percent: off.has('goals') ? null : goal?.percent ?? null,
      };
    });
    return {
      home: home.name, points_name: home.pointsName, points_icon: home.pointsIcon, today,
      active_timeouts: timeouts.filter((t) => t.state === 'active').length,
      timeout_requests_waiting: timeouts.filter((t) => t.pending).length,
      waiting_for_review: waiting.filter((i) => !kids.find((k) => k.id === i.memberId)?.pages_off.includes('chores')).length, kids, kids_by_name: Object.fromEntries(kids.map((k) => [k.slug, k])),
    };
  });

  app.get('/api/homes/:homeId/ha/today', async (req) => {
    const ctx = homeCtx(db, req);
    const today = homeToday(homeInfo(db, ctx.homeId));
    return listKids(db, ctx.homeId).filter((k) => !k.pagesOff.includes('chores')).map((k) => ({
      kid: k.name, kid_id: k.id,
      chores: todayList(db, ctx.homeId, k.id, today).map((i) => ({ id: i.id, title: i.title, icon: i.icon, points: i.points, status: i.status })),
    }));
  });

  // Polling alternative to the webhook: ?after=<last id you saw>.
  app.get('/api/homes/:homeId/ha/events', async (req) => {
    const ctx = homeCtx(db, req);
    const after = Number((req.query as { after?: string }).after) || 0;
    return (db.prepare('SELECT * FROM events WHERE home_id = ? AND id > ? ORDER BY id DESC LIMIT 50').all(ctx.homeId, after) as Row[]).map((r) => eventView(db, r));
  });

  // "Mark done" as if the kid tapped it (it then waits for a parent), e.g. from an NFC tag on the dishwasher.
  app.post('/api/homes/:homeId/ha/complete', async (req) => {
    const ctx = homeCtx(db, req);
    control(ctx);
    const today = homeToday(homeInfo(db, ctx.homeId));
    return { item: submitInstance(db, ctx.homeId, findToday(db, ctx.homeId, (req.body ?? {}) as Row, today), today) };
  });

  app.post('/api/homes/:homeId/ha/approve', async (req) => {
    const ctx = homeCtx(db, req);
    control(ctx);
    const today = homeToday(homeInfo(db, ctx.homeId));
    return approveInstance(db, ctx.homeId, findToday(db, ctx.homeId, (req.body ?? {}) as Row, today), by(ctx));
  });

  app.post('/api/homes/:homeId/ha/quick-reward', async (req) => {
    const ctx = homeCtx(db, req);
    control(ctx);
    const b = (req.body ?? {}) as Row;
    const kid = findKid(db, ctx.homeId, b.kid);
    const key = requireStr(b.reward, 'Reward', 60);
    const r = db.prepare('SELECT * FROM quick_rewards WHERE home_id = ? AND (id = ? OR title = ? COLLATE NOCASE)').get(ctx.homeId, key, key) as Row | undefined;
    if (!r) throw new HttpError(404, `No quick reward called “${key}”`);
    writeLedger(db, { homeId: ctx.homeId, memberId: kid.id, amount: r.amount as number, kind: 'bonus', reason: `${r.icon} ${r.title}`, date: homeToday(homeInfo(db, ctx.homeId)), by: by(ctx) });
    return { awarded: r.amount, balance: balance(db, kid.id) };
  });

  app.post('/api/homes/:homeId/ha/points', async (req) => {
    const ctx = homeCtx(db, req);
    control(ctx);
    const b = (req.body ?? {}) as Row;
    const kid = findKid(db, ctx.homeId, b.kid);
    const amount = num(b.amount);
    if (amount == null || !Number.isInteger(amount) || amount <= 0 || amount > 10000) throw new HttpError(400, 'amount must be a whole number, at least 1');
    writeLedger(db, { homeId: ctx.homeId, memberId: kid.id, amount, kind: 'bonus', reason: str(b.reason, 120) ?? 'Bonus from Home Assistant', date: homeToday(homeInfo(db, ctx.homeId)), by: by(ctx) });
    return { awarded: amount, balance: balance(db, kid.id) };
  });

  app.post('/api/homes/:homeId/ha/penalty', async (req) => {
    const ctx = homeCtx(db, req);
    control(ctx);
    const b = (req.body ?? {}) as Row;
    const kid = findKid(db, ctx.homeId, b.kid);
    const points = num(b.points);
    if (points == null || !Number.isInteger(points) || points < 1) throw new HttpError(400, 'points must be a whole number, at least 1');
    const allowNegative = !!(db.prepare('SELECT allow_negative FROM homes WHERE id = ?').get(ctx.homeId) as Row).allow_negative;
    return penalize(db, { id: ctx.homeId, allowNegative }, kid.id, points, requireStr(b.reason, 'Reason', 120), by(ctx), homeToday(homeInfo(db, ctx.homeId)));
  });
}
