// Chore trading between siblings, for today's chores only:
// - swap: "my dishes for your trash". The two chores change hands for the day.
// - help: "help me clean my room?". The helper is added to the chore and they split its points when it's approved.
// The other kid accepts on their board. Depending on the home's setting the trade then happens straight away
// ('free'), waits for a parent ('ask', the default), or trading is off ('off').
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx, isParent, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId } from '../util.ts';
import { getInstance, homeInfo, homeToday, helperShare, type AgendaItem } from '../chores.ts';
import { emit } from '../events.ts';
import { getKid } from './homes.ts';

export type TradeMode = 'off' | 'ask' | 'free';
export const TRADE_MODES: TradeMode[] = ['off', 'ask', 'free'];

export const tradeMode = (db: DatabaseSync, homeId: string): TradeMode =>
  ((db.prepare('SELECT trade_mode FROM homes WHERE id = ?').get(homeId) as Row | undefined)?.trade_mode as TradeMode | undefined) ?? 'ask';

const OPEN = ['pending', 'rejected'];
// What a swap trades between the two instances. The rows (and their chore ids) stay with their kids, so the daily
// fill-in never re-creates the chore that was traded away; "traded" stops chore edits from overwriting the swap.
const SWAP_COLS = ['title', 'icon', 'points', 'needs_photo', 'due_time', 'late_points', 'routine', 'routine_pos', 'minutes', 'surprise'] as const;

function tradeView(db: DatabaseSync, t: Row) {
  const name = (id: string) => ((db.prepare('SELECT name FROM members WHERE id = ?').get(id) as Row | undefined)?.name as string) ?? 'Someone';
  const inst = (id: string | null) => {
    if (!id) return null;
    const r = db.prepare('SELECT id, title, icon, points FROM chore_instances WHERE id = ?').get(id) as Row | undefined;
    return r ? { id: r.id as string, title: r.title as string, icon: r.icon as string, points: r.points as number } : null;
  };
  const chore = inst(t.instance_id as string);
  return {
    id: t.id as string, kind: t.kind as 'swap' | 'help', status: t.status as string, date: t.date as string,
    from: { id: t.from_member as string, name: name(t.from_member as string) }, to: { id: t.to_member as string, name: name(t.to_member as string) },
    chore, other: inst(t.other_instance_id as string | null),
    helperGets: t.kind === 'help' && chore ? helperShare(chore.points) : null,
  };
}
export type TradeView = ReturnType<typeof tradeView>;

/** Makes the trade happen: a swap trades what the two chores are; help adds the helper. */
function apply(db: DatabaseSync, homeId: string, t: Row): void {
  const a = db.prepare('SELECT * FROM chore_instances WHERE id = ?').get(t.instance_id as string) as Row | undefined;
  const b = t.other_instance_id ? db.prepare('SELECT * FROM chore_instances WHERE id = ?').get(t.other_instance_id as string) as Row | undefined : undefined;
  if (!a || !OPEN.includes(a.status as string) || (t.kind === 'swap' && (!b || !OPEN.includes(b.status as string)))) {
    db.prepare("UPDATE chore_trades SET status = 'cancelled', decided_at = datetime('now') WHERE id = ?").run(t.id as string);
    throw new HttpError(400, 'One of those chores is already done, so the trade is off');
  }
  if (t.kind === 'help') {
    db.prepare('UPDATE chore_instances SET helper_id = ? WHERE id = ?').run(t.to_member as string, a.id as string);
  } else {
    // A chore_id can't be on the same kid twice in a day; swapping the same chore makes no sense anyway.
    if (a.chore_id && a.chore_id === b!.chore_id) throw new HttpError(400, "That's the same chore");
    const set = SWAP_COLS.map((c) => `${c} = ?`).join(', ');
    const upd = db.prepare(`UPDATE chore_instances SET ${set}, traded = 1, started_at = NULL, status = 'pending', note = NULL WHERE id = ?`);
    upd.run(...SWAP_COLS.map((c) => b![c] as never), a.id as string);
    upd.run(...SWAP_COLS.map((c) => a[c] as never), b!.id as string);
  }
  db.prepare("UPDATE chore_trades SET status = 'done', decided_at = datetime('now') WHERE id = ?").run(t.id as string);
  // Any other open offers on these chores are now stale.
  db.prepare(`UPDATE chore_trades SET status = 'cancelled', decided_at = datetime('now') WHERE home_id = ? AND id != ? AND status IN ('offered', 'accepted')
    AND (instance_id IN (?, ?) OR other_instance_id IN (?, ?))`).run(homeId, t.id as string, a.id as string, (b?.id as string) ?? '', a.id as string, (b?.id as string) ?? '');
}

export function openTrades(db: DatabaseSync, homeId: string, memberId?: string) {
  const today = homeToday(homeInfo(db, homeId));
  const rows = db.prepare(`SELECT * FROM chore_trades WHERE home_id = ? AND date = ? AND status IN ('offered', 'accepted')
    ${memberId ? 'AND (from_member = ? OR to_member = ?)' : ''} ORDER BY created_at`).all(...(memberId ? [homeId, today, memberId, memberId] : [homeId, today])) as Row[];
  return rows.map((t) => tradeView(db, t));
}

export function tradeRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const kidOf = (ctx: HomeCtx) => {
    if (ctx.actor.kind !== 'kid') throw new HttpError(403, 'Kids trade chores from their own board');
    return ctx.actor.memberId;
  };
  const trade = (ctx: HomeCtx, id: string) => {
    const t = db.prepare('SELECT * FROM chore_trades WHERE id = ? AND home_id = ?').get(id, ctx.homeId) as Row | undefined;
    if (!t) throw new HttpError(404, 'That trade is gone');
    return t;
  };

  // A kid's offers (made and received) plus the home's mode; parents get every open one.
  app.get('/api/homes/:homeId/trades', async (req) => {
    const ctx = homeCtx(db, req);
    const mode = tradeMode(db, ctx.homeId);
    if (isParent(ctx)) return { mode, trades: openTrades(db, ctx.homeId) };
    if (ctx.actor.kind !== 'kid') throw new HttpError(403, 'Pick your raccoon first');
    return { mode, trades: mode === 'off' ? [] : openTrades(db, ctx.homeId, ctx.actor.memberId) };
  });

  // Siblings and the chores of theirs a kid could swap for (today's, not done yet). Titles only.
  app.get('/api/homes/:homeId/trades/options', async (req) => {
    const ctx = homeCtx(db, req);
    const me = kidOf(ctx);
    if (tradeMode(db, ctx.homeId) === 'off') return [];
    const today = homeToday(homeInfo(db, ctx.homeId));
    const sibs = db.prepare(`SELECT id, name, avatar, color FROM members WHERE home_id = ? AND role = 'kid' AND id != ?
      AND NOT EXISTS (SELECT 1 FROM json_each(pages_off) WHERE value = 'chores') ORDER BY position, created_at`).all(ctx.homeId, me) as Row[];
    return sibs.map((s) => ({
      id: s.id as string, name: s.name as string, avatar: s.avatar as string, color: s.color as string,
      chores: (db.prepare(`SELECT id, title, icon, points FROM chore_instances WHERE member_id = ? AND date = ? AND status IN ('pending', 'rejected') ORDER BY routine_pos, title`)
        .all(s.id as string, today) as Row[]).map((r) => ({ id: r.id as string, title: r.title as string, icon: r.icon as string, points: r.points as number })),
    }));
  });

  // { kind: 'swap' | 'help', instanceId (mine), toMemberId, otherInstanceId (theirs, for a swap) }
  app.post('/api/homes/:homeId/trades', async (req) => {
    const ctx = homeCtx(db, req);
    const me = kidOf(ctx);
    if (tradeMode(db, ctx.homeId) === 'off') throw new HttpError(403, 'Trading chores is switched off');
    const b = (req.body ?? {}) as Row;
    const kind = b.kind === 'help' ? 'help' : b.kind === 'swap' ? 'swap' : null;
    if (!kind) throw new HttpError(400, 'Swap or help?');
    const today = homeToday(homeInfo(db, ctx.homeId));
    const mine: AgendaItem = getInstance(db, ctx.homeId, String(b.instanceId ?? ''));
    if (mine.memberId !== me) throw new HttpError(403, "That's not your chore");
    if (mine.date !== today || !OPEN.includes(mine.status)) throw new HttpError(400, 'Only today\'s chores that aren\'t done yet');
    const to = getKid(db, ctx, String(b.toMemberId ?? ''));
    if (to.id === me) throw new HttpError(400, 'Pick a brother or sister');
    let other: AgendaItem | null = null;
    if (kind === 'swap') {
      other = getInstance(db, ctx.homeId, String(b.otherInstanceId ?? ''));
      if (other.memberId !== to.id || other.date !== today || !OPEN.includes(other.status)) throw new HttpError(400, 'Pick one of their chores for today');
      if (other.choreId && other.choreId === mine.choreId) throw new HttpError(400, "That's the same chore");
    } else if (mine.helperId) throw new HttpError(400, 'Someone is already helping with that');
    if (db.prepare("SELECT 1 FROM chore_trades WHERE instance_id = ? AND status IN ('offered', 'accepted')").get(mine.id)) throw new HttpError(400, "You've already asked about that chore");
    const id = newId();
    db.prepare('INSERT INTO chore_trades (id, home_id, kind, from_member, to_member, instance_id, other_instance_id, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, ctx.homeId, kind, me, to.id as string, mine.id, other?.id ?? null, today);
    return tradeView(db, trade(ctx, id));
  });

  // The other kid says yes (or no). The kid who asked can call it off.
  app.post('/api/homes/:homeId/trades/:id/:answer', async (req) => {
    const ctx = homeCtx(db, req);
    const { id, answer } = req.params as { id: string; answer: string };
    const t = trade(ctx, id);
    if (!['accept', 'decline', 'cancel', 'approve', 'deny'].includes(answer)) throw new HttpError(404, 'Not found');
    return tx(db, () => {
      if (answer === 'approve' || answer === 'deny') {
        if (!isParent(ctx)) throw new HttpError(403, 'Parents only');
        if (t.status !== 'accepted' && t.status !== 'offered') throw new HttpError(400, 'That trade is already sorted out');
        if (answer === 'deny') db.prepare("UPDATE chore_trades SET status = 'declined', decided_at = datetime('now') WHERE id = ?").run(id);
        else apply(db, ctx.homeId, t);
        return tradeView(db, trade(ctx, id));
      }
      const me = kidOf(ctx);
      if (t.status !== 'offered') throw new HttpError(400, 'That trade is already sorted out');
      if (answer === 'cancel') {
        if (t.from_member !== me) throw new HttpError(403, 'Only the one who asked can call it off');
        db.prepare("UPDATE chore_trades SET status = 'cancelled', decided_at = datetime('now') WHERE id = ?").run(id);
      } else {
        if (t.to_member !== me) throw new HttpError(403, 'That question is for someone else');
        if (answer === 'decline') db.prepare("UPDATE chore_trades SET status = 'declined', decided_at = datetime('now') WHERE id = ?").run(id);
        else if (tradeMode(db, ctx.homeId) === 'free') apply(db, ctx.homeId, t);
        else {
          db.prepare("UPDATE chore_trades SET status = 'accepted' WHERE id = ?").run(id);
          const v = tradeView(db, t);
          emit(db, ctx.homeId, 'trade_waiting', t.from_member as string, { kind: t.kind, other: v.to.name, chore: v.chore?.title ?? '', trade_id: id });
        }
      }
      return tradeView(db, trade(ctx, id));
    });
  });

  app.put('/api/homes/:homeId/trades/mode', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const mode = (req.body as Row | undefined)?.mode;
    if (!TRADE_MODES.includes(mode as TradeMode)) throw new HttpError(400, 'Trading is off, ask or free');
    db.prepare('UPDATE homes SET trade_mode = ? WHERE id = ?').run(mode as string, ctx.homeId);
    return { mode };
  });
}
