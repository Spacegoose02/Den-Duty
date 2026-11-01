// Time-outs: a parent pauses something ("No Roblox") for a while, with a reason. Kids see a kind countdown. A parent can
// let the kid buy time back with points (a price per hour or per day, up to a cap); the kid asks on the tablet and
// the points only move, through the ledger, once a parent says yes. Parents can end a time-out early or add time.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, num, requireStr, str } from '../util.ts';
import { balance, homeInfo, homeToday, kidsWithPageOff, writeLedger } from '../chores.ts';
import { emit } from '../events.ts';
import { getKid, pageOn } from './homes.ts';
import { byOf } from './chores.ts';

const UNIT_MINUTES = { hours: 60, days: 1440, weeks: 10080 } as const;
type LengthUnit = keyof typeof UNIT_MINUTES;
const BUY_MINUTES = { hour: 60, day: 1440 } as const;
type BuyUnit = keyof typeof BUY_MINUTES;

const iso = (ms: number) => new Date(ms).toISOString();

export type GamesLock = 'all' | 'roblox' | null;
/** Blank or missing: the time-out doesn't touch LootDen. */
export function gamesLock(v: unknown): GamesLock {
  if (v == null || v === '' || v === 'none') return null;
  if (v === 'all' || v === 'roblox') return v;
  throw new HttpError(400, 'Games are locked all, roblox or not at all');
}

export function requestView(r: Row) {
  return {
    id: r.id as string, timeoutId: r.timeout_id as string, units: r.units as number, minutes: r.minutes as number,
    points: r.points as number, status: r.status as 'pending' | 'approved' | 'denied' | 'cancelled', createdAt: r.created_at as string,
  };
}

export function timeoutView(db: DatabaseSync, r: Row, now = Date.now()) {
  const start = Date.parse(r.starts_at as string);
  const end = Date.parse(r.ends_at as string);
  const ended = !!r.ended_at || end <= now;
  const state = ended ? 'over' : start > now ? 'upcoming' : 'active';
  const unit = r.buy_unit as BuyUnit | null;
  const left = Math.max(0, Math.ceil((end - Math.max(now, start)) / 60000));
  const buyLeft = unit ? Math.max(0, Math.min((r.buy_max_minutes as number) - (r.bought_minutes as number), left)) : 0;
  const pending = db.prepare("SELECT * FROM timeout_requests WHERE timeout_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").get(r.id as string) as Row | undefined;
  return {
    id: r.id as string, memberId: r.member_id as string, what: r.what as string, reason: r.reason as string | null,
    startsAt: r.starts_at as string, endsAt: r.ends_at as string, endedAt: r.ended_at as string | null,
    state: state as 'upcoming' | 'active' | 'over', minutesLeft: state === 'over' ? 0 : left,
    /** Locks the kid's games in LootDen too: all of them, or just Roblox. */
    games: (r.games ?? null) as GamesLock,
    buy: unit ? {
      unit, price: r.buy_price as number, maxMinutes: r.buy_max_minutes as number, boughtMinutes: r.bought_minutes as number,
      // How many whole hours/days the kid could still ask for.
      unitsLeft: Math.ceil(buyLeft / BUY_MINUTES[unit]),
    } : null,
    pending: pending ? requestView(pending) : null,
  };
}
export type TimeoutView = ReturnType<typeof timeoutView>;

/** A kid's time-outs that are on now or coming up (and, for parents, ones that ended in the last week). */
export function kidTimeouts(db: DatabaseSync, memberId: string, withRecent = false): TimeoutView[] {
  const now = Date.now();
  const since = withRecent ? iso(now - 7 * 86400000) : iso(now);
  return (db.prepare('SELECT * FROM timeouts WHERE member_id = ? AND (ended_at IS NULL OR ended_at > ?) AND ends_at > ? ORDER BY starts_at')
    .all(memberId, since, since) as Row[]).map((r) => timeoutView(db, r, now));
}

/** Every kid's current time-outs and waiting buy-back requests, for the parent home and Home Assistant. */
export function homeTimeouts(db: DatabaseSync, homeId: string) {
  const off = kidsWithPageOff(db, homeId, 'timeout');
  const now = iso(Date.now());
  return (db.prepare(`SELECT t.*, m.name AS kid_name, m.avatar AS kid_avatar, m.color AS kid_color FROM timeouts t JOIN members m ON m.id = t.member_id
    WHERE t.home_id = ? AND t.ended_at IS NULL AND t.ends_at > ? ORDER BY t.ends_at`).all(homeId, now) as Row[])
    .filter((r) => !off.has(r.member_id as string))
    .map((r) => ({ ...timeoutView(db, r), kid: { name: r.kid_name as string, avatar: r.kid_avatar as string, color: r.kid_color as string } }));
}

function lengthMinutes(length: unknown, unit: unknown): number {
  const n = num(length);
  if (!Object.hasOwn(UNIT_MINUTES, String(unit))) throw new HttpError(400, 'Length is in hours, days or weeks');
  if (n == null || n <= 0 || n > 1000) throw new HttpError(400, 'How long? Use a number above zero');
  const minutes = Math.round(n * UNIT_MINUTES[unit as LengthUnit]);
  if (minutes > 366 * 1440) throw new HttpError(400, 'A time-out can be at most a year');
  return minutes;
}

/** The buy-back settings: off, or a price per hour/day and the most time that can be bought. */
function buySettings(b: Row): { unit: BuyUnit | null; price: number | null; maxMinutes: number | null } {
  if (!b.buyUnit) return { unit: null, price: null, maxMinutes: null };
  if (!Object.hasOwn(BUY_MINUTES, String(b.buyUnit))) throw new HttpError(400, 'Buying time back is priced per hour or per day');
  const unit = b.buyUnit as BuyUnit;
  const price = num(b.buyPrice);
  if (price == null || !Number.isInteger(price) || price < 1 || price > 100000) throw new HttpError(400, 'The price is a whole number of points, at least 1');
  const maxUnits = num(b.buyMaxUnits);
  if (maxUnits == null || !Number.isInteger(maxUnits) || maxUnits < 1 || maxUnits > 1000) throw new HttpError(400, `How many ${unit}s can be bought back, at most? At least 1`);
  return { unit, price, maxMinutes: maxUnits * BUY_MINUTES[unit] };
}

export function timeoutRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const get = (ctx: HomeCtx, id: string): Row => {
    const r = db.prepare('SELECT * FROM timeouts WHERE id = ? AND home_id = ?').get(id, ctx.homeId) as Row | undefined;
    if (!r) throw new HttpError(404, 'That time-out is gone');
    return r;
  };
  const view = (ctx: HomeCtx, id: string) => timeoutView(db, get(ctx, id));
  const on = (memberId: string) => {
    if (!pageOn(db, memberId, 'timeout')) throw new HttpError(403, 'Time-outs are switched off for this kid');
  };

  app.get('/api/homes/:homeId/timeouts', async (req) => homeTimeouts(db, homeCtx(db, req, 'parent').homeId));

  app.get('/api/homes/:homeId/kids/:memberId/timeouts', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    getKid(db, ctx, memberId);
    if (!pageOn(db, memberId, 'timeout')) return [];
    return kidTimeouts(db, memberId, ctx.actor.kind === 'parent');
  });

  app.post('/api/homes/:homeId/kids/:memberId/timeouts', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const { memberId } = req.params as { memberId: string };
    const kid = getKid(db, ctx, memberId);
    on(memberId);
    const b = (req.body ?? {}) as Row;
    const start = b.startsAt ? Date.parse(String(b.startsAt)) : Date.now();
    if (Number.isNaN(start)) throw new HttpError(400, "That start time doesn't look right");
    const minutes = lengthMinutes(b.length, b.unit);
    const buy = buySettings(b);
    const id = newId();
    db.prepare(`INSERT INTO timeouts (id, home_id, member_id, what, reason, starts_at, ends_at, buy_unit, buy_price, buy_max_minutes, created_by, games)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.homeId, memberId, requireStr(b.what, 'What', 80), str(b.reason, 300),
      iso(start), iso(start + minutes * 60000), buy.unit, buy.price, buy.maxMinutes, ctx.user?.id ?? null, gamesLock(b.games));
    const t = view(ctx, id);
    emit(db, ctx.homeId, 'timeout_started', memberId, { kid: kid.name, what: t.what, reason: t.reason, starts_at: t.startsAt, ends_at: t.endsAt });
    return t;
  });

  // Edit what/why/buy-back, add time ({ extend: { length, unit } }), or end it now ({ end: true }).
  app.patch('/api/homes/:homeId/timeouts/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const cur = get(ctx, (req.params as { id: string }).id);
    const b = (req.body ?? {}) as Row;
    if (cur.ended_at) throw new HttpError(400, 'That time-out is already over');
    tx(db, () => {
      if ('what' in b || 'reason' in b) {
        db.prepare('UPDATE timeouts SET what = ?, reason = ? WHERE id = ?').run(
          'what' in b ? requireStr(b.what, 'What', 80) : cur.what as string, 'reason' in b ? str(b.reason, 300) : cur.reason as string | null, cur.id as string);
      }
      if ('games' in b) db.prepare('UPDATE timeouts SET games = ? WHERE id = ?').run(gamesLock(b.games), cur.id as string);
      if ('buyUnit' in b) {
        const buy = buySettings(b);
        db.prepare('UPDATE timeouts SET buy_unit = ?, buy_price = ?, buy_max_minutes = ? WHERE id = ?').run(buy.unit, buy.price, buy.maxMinutes, cur.id as string);
        if (!buy.unit) db.prepare("UPDATE timeout_requests SET status = 'cancelled', decided_at = datetime('now') WHERE timeout_id = ? AND status = 'pending'").run(cur.id as string);
      }
      if (b.extend) {
        const e = b.extend as Row;
        const add = lengthMinutes(e.length, e.unit);
        const from = Math.max(Date.parse(cur.ends_at as string), Date.now());
        db.prepare('UPDATE timeouts SET ends_at = ? WHERE id = ?').run(iso(from + add * 60000), cur.id as string);
      }
      if (b.end) {
        const now = iso(Date.now());
        db.prepare('UPDATE timeouts SET ended_at = ?, ends_at = MIN(ends_at, ?) WHERE id = ?').run(now, now, cur.id as string);
        db.prepare("UPDATE timeout_requests SET status = 'cancelled', decided_at = datetime('now') WHERE timeout_id = ? AND status = 'pending'").run(cur.id as string);
      }
    });
    const t = view(ctx, cur.id as string);
    if (b.end) emit(db, ctx.homeId, 'timeout_ended', t.memberId, { what: t.what, early: true });
    return t;
  });

  app.delete('/api/homes/:homeId/timeouts/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM timeouts WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  // The kid asks to buy some time back. Nothing is spent until a parent approves.
  app.post('/api/homes/:homeId/timeouts/:id/requests', async (req) => {
    const ctx = homeCtx(db, req);
    // The kid themselves (signed in on the tablet, PIN and all) or a parent; not a tablet nobody has tapped into.
    if (ctx.actor.kind !== 'kid' && ctx.actor.kind !== 'parent') throw new HttpError(403, 'Kids ask for this on their own screen');
    const cur = get(ctx, (req.params as { id: string }).id);
    assertCanActFor(ctx, cur.member_id as string);
    on(cur.member_id as string);
    const t = timeoutView(db, cur);
    if (t.state === 'over') throw new HttpError(400, 'That time-out is already over');
    if (!t.buy || t.buy.unitsLeft < 1) throw new HttpError(400, "This time-out can't be shortened with points");
    const units = num((req.body as Row | undefined)?.units);
    if (units == null || !Number.isInteger(units) || units < 1) throw new HttpError(400, `Ask for at least 1 ${t.buy.unit}`);
    if (units > t.buy.unitsLeft) throw new HttpError(400, `You can ask for up to ${t.buy.unitsLeft} ${t.buy.unit}${t.buy.unitsLeft === 1 ? '' : 's'}`);
    const points = units * t.buy.price;
    if (balance(db, cur.member_id as string) < points) throw new HttpError(400, `That needs ${points} points. Keep going, you'll get there!`);
    const minutes = Math.min(units * BUY_MINUTES[t.buy.unit], t.minutesLeft, t.buy.maxMinutes - t.buy.boughtMinutes);
    const id = newId();
    tx(db, () => {
      // One question at a time: a new ask replaces an older one.
      db.prepare("UPDATE timeout_requests SET status = 'cancelled', decided_at = datetime('now') WHERE timeout_id = ? AND status = 'pending'").run(cur.id as string);
      db.prepare('INSERT INTO timeout_requests (id, timeout_id, units, minutes, points) VALUES (?, ?, ?, ?, ?)').run(id, cur.id as string, units, minutes, points);
    });
    emit(db, ctx.homeId, 'timeout_buy_requested', cur.member_id as string, { what: t.what, units, unit: t.buy.unit, points });
    return view(ctx, cur.id as string);
  });

  const request = (ctx: HomeCtx, rid: string) => {
    const r = db.prepare(`SELECT r.*, t.member_id, t.what FROM timeout_requests r JOIN timeouts t ON t.id = r.timeout_id
      WHERE r.id = ? AND t.home_id = ?`).get(rid, ctx.homeId) as Row | undefined;
    if (!r) throw new HttpError(404, 'That request is gone');
    if (r.status !== 'pending') throw new HttpError(400, 'That request was already answered');
    return r;
  };

  app.delete('/api/homes/:homeId/timeout-requests/:rid', async (req) => {
    const ctx = homeCtx(db, req);
    if (ctx.actor.kind !== 'kid' && ctx.actor.kind !== 'parent') throw new HttpError(403, 'Tap your raccoon first');
    const r = request(ctx, (req.params as { rid: string }).rid);
    assertCanActFor(ctx, r.member_id as string);
    db.prepare("UPDATE timeout_requests SET status = 'cancelled', decided_at = datetime('now') WHERE id = ?").run(r.id as string);
    return view(ctx, r.timeout_id as string);
  });

  app.post('/api/homes/:homeId/timeout-requests/:rid/deny', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const r = request(ctx, (req.params as { rid: string }).rid);
    db.prepare("UPDATE timeout_requests SET status = 'denied', decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(ctx.user?.id ?? null, r.id as string);
    return view(ctx, r.timeout_id as string);
  });

  app.post('/api/homes/:homeId/timeout-requests/:rid/approve', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const r = request(ctx, (req.params as { rid: string }).rid);
    const memberId = r.member_id as string;
    const home = homeInfo(db, ctx.homeId);
    const result = tx(db, () => {
      const t = timeoutView(db, get(ctx, r.timeout_id as string));
      if (t.state === 'over') throw new HttpError(400, 'That time-out is already over');
      if (balance(db, memberId) < (r.points as number)) throw new HttpError(400, "There aren't enough points for this any more");
      const minutes = Math.min(r.minutes as number, t.minutesLeft);
      const unit = t.buy?.unit ?? 'hour';
      writeLedger(db, {
        homeId: ctx.homeId, memberId, amount: -(r.points as number), kind: 'redeem',
        reason: `⏳ ${r.units} ${unit}${r.units === 1 ? '' : 's'} off “${t.what}”`, date: homeToday(home), by: byOf(ctx),
      });
      const newEnd = Date.parse(t.endsAt) - minutes * 60000;
      const done = newEnd <= Date.now();
      db.prepare('UPDATE timeouts SET ends_at = ?, bought_minutes = bought_minutes + ?, ended_at = ? WHERE id = ?')
        .run(iso(newEnd), minutes, done ? iso(Date.now()) : null, t.id);
      db.prepare("UPDATE timeout_requests SET status = 'approved', minutes = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(minutes, ctx.user?.id ?? null, r.id as string);
      return { t, minutes, done };
    });
    emit(db, ctx.homeId, 'timeout_time_bought', memberId, {
      what: result.t.what, minutes: result.minutes, points: r.points, balance: balance(db, memberId), ended: result.done,
    });
    return view(ctx, r.timeout_id as string);
  });
}
