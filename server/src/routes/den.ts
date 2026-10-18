// Den Duty: a room board per kid (a raccoon's den is their room) with cards like "make bed" and "toys away", plus the
// parents' own to-do list (cards with no kid, which is what the old honey-do board was). Kids see and move their own
// room cards; points, if any, are paid when a parent checks the card off.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, num, requireStr, str } from '../util.ts';
import { homeInfo, homeToday, writeLedger } from '../chores.ts';
import { byOf } from './chores.ts';
import { cleanIcon, getKid, pageOn } from './homes.ts';
import { isIsoDate } from '../../../shared/schedule.ts';

const STATUSES = ['todo', 'doing', 'done'] as const;
type Status = (typeof STATUSES)[number];

export const denView = (r: Row) => ({
  id: r.id as string, title: r.title as string, icon: (r.icon as string | null) ?? null, notes: r.notes as string | null,
  kidId: (r.kid_id as string | null) ?? null, assigneeId: r.assignee_id as string | null,
  status: r.status as Status, dueDate: r.due_date as string | null, position: r.position as number,
  points: (r.points as number) ?? 0, repeatDaily: !!r.repeat_daily, checked: !!r.paid_at,
  doneAt: r.done_at as string | null, createdAt: r.created_at as string,
});

/** Daily room cards that were done on an earlier day go back to "to do" (and can be paid again). */
export function resetDailyDen(db: DatabaseSync, homeId: string, today: string): void {
  db.prepare(`UPDATE honeydo SET status = 'todo', done_at = NULL, done_date = NULL, paid_at = NULL
    WHERE home_id = ? AND repeat_daily = 1 AND status = 'done' AND done_date < ?`).run(homeId, today);
}

/** A kid's room cards, for their board. */
export function denFor(db: DatabaseSync, homeId: string, kidId: string, today: string) {
  resetDailyDen(db, homeId, today);
  return (db.prepare('SELECT * FROM honeydo WHERE home_id = ? AND kid_id = ? ORDER BY status, position, created_at').all(homeId, kidId) as Row[]).map(denView);
}

export function denRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const parentIn = (homeId: string, memberId: unknown): string | null => {
    if (memberId == null || memberId === '') return null;
    if (!db.prepare("SELECT 1 FROM members WHERE id = ? AND home_id = ? AND role = 'parent'").get(String(memberId), homeId)) {
      throw new HttpError(400, 'Parent to-dos go to a parent in this home');
    }
    return String(memberId);
  };
  const due = (v: unknown): string | null => {
    if (v == null || v === '') return null;
    if (!isIsoDate(v)) throw new HttpError(400, 'Due dates look like 2026-10-20');
    return v;
  };
  const status = (v: unknown): Status => {
    if (!(STATUSES as readonly unknown[]).includes(v)) throw new HttpError(400, 'Status must be todo, doing or done');
    return v as Status;
  };
  const points = (v: unknown): number => {
    if (v == null || v === '') return 0;
    const n = num(v);
    if (n == null || !Number.isInteger(n) || n < 0 || n > 1000) throw new HttpError(400, 'Points are a whole number from 0 to 1000');
    return n;
  };
  const card = (ctx: HomeCtx, id: string): Row => {
    const r = db.prepare('SELECT * FROM honeydo WHERE id = ? AND home_id = ?').get(id, ctx.homeId) as Row | undefined;
    if (!r) throw new HttpError(404, 'That card is gone');
    return r;
  };
  const nextPosition = (homeId: string, kidId: string | null, st: Status) =>
    (((db.prepare(`SELECT MAX(position) AS p FROM honeydo WHERE home_id = ? AND status = ? AND kid_id IS ?`).get(homeId, st, kidId) as Row).p as number | null) ?? 0) + 1;

  function create(ctx: HomeCtx, b: Row, kidId: string | null) {
    const st = b.status == null ? 'todo' : status(b.status);
    const id = newId();
    db.prepare(`INSERT INTO honeydo (id, home_id, title, icon, notes, kid_id, assignee_id, status, due_date, position, points, repeat_daily, created_by, done_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${st === 'done' ? "datetime('now')" : 'NULL'})`)
      .run(id, ctx.homeId, requireStr(b.title, 'Title', 120), b.icon ? cleanIcon(b.icon, '🧹') : null, str(b.notes, 2000), kidId,
        kidId ? null : parentIn(ctx.homeId, b.assigneeId), st, due(b.dueDate), nextPosition(ctx.homeId, kidId, st),
        kidId ? points(b.points) : 0, kidId && b.repeatDaily !== false ? 1 : 0, ctx.user?.id ?? null);
    return denView(card(ctx, id));
  }

  function update(ctx: HomeCtx, cur: Row, b: Row) {
    const kid = ctx.actor.kind === 'kid';
    // Kids can only move their own room cards; everything else is for parents.
    if (kid && (ctx.actor.kind === 'kid' && cur.kid_id !== ctx.actor.memberId)) throw new HttpError(403, 'That card is on someone else\'s board');
    if (kid && Object.keys(b).some((k) => k !== 'status')) throw new HttpError(403, 'Kids can only move their cards');
    if (kid && !pageOn(db, cur.kid_id as string, 'den')) throw new HttpError(403, 'Den Duty is turned off');
    const st = 'status' in b ? status(b.status) : cur.status as Status;
    const position = 'position' in b && num(b.position) != null ? num(b.position)!
      : st !== cur.status ? nextPosition(ctx.homeId, cur.kid_id as string | null, st) : cur.position as number;
    const today = homeToday(homeInfo(db, ctx.homeId));
    db.prepare(`UPDATE honeydo SET title = ?, icon = ?, notes = ?, assignee_id = ?, status = ?, due_date = ?, position = ?, points = ?, repeat_daily = ?,
      done_at = CASE WHEN ? = 'done' THEN COALESCE(done_at, datetime('now')) ELSE NULL END,
      done_date = CASE WHEN ? = 'done' THEN COALESCE(done_date, ?) ELSE NULL END,
      paid_at = CASE WHEN ? = 'done' THEN paid_at ELSE NULL END WHERE id = ?`).run(
      'title' in b ? requireStr(b.title, 'Title', 120) : cur.title as string,
      'icon' in b ? (b.icon ? cleanIcon(b.icon, '🧹') : null) : cur.icon as string | null,
      'notes' in b ? str(b.notes, 2000) : cur.notes as string | null,
      'assigneeId' in b && !cur.kid_id ? parentIn(ctx.homeId, b.assigneeId) : cur.assignee_id as string | null,
      st, 'dueDate' in b ? due(b.dueDate) : cur.due_date as string | null, position,
      'points' in b && cur.kid_id ? points(b.points) : cur.points as number,
      'repeatDaily' in b && cur.kid_id ? (b.repeatDaily ? 1 : 0) : cur.repeat_daily as number,
      st, st, today, st, cur.id as string);
    return denView(card(ctx, cur.id as string));
  }

  // ----- Den Duty -----
  // Parents see every board (?kid=<id> or ?kid=parents to filter); a kid sees only their own room.
  app.get('/api/homes/:homeId/den', async (req) => {
    const ctx = homeCtx(db, req);
    const today = homeToday(homeInfo(db, ctx.homeId));
    if (ctx.actor.kind === 'kid') return pageOn(db, ctx.actor.memberId, 'den') ? denFor(db, ctx.homeId, ctx.actor.memberId, today) : [];
    if (ctx.actor.kind !== 'parent') throw new HttpError(403, 'Tap your avatar first');
    resetDailyDen(db, ctx.homeId, today);
    const kid = (req.query as { kid?: string }).kid;
    const filter = kid === 'parents' ? 'AND kid_id IS NULL' : kid ? 'AND kid_id = ?' : '';
    const args = kid && kid !== 'parents' ? [ctx.homeId, getKid(db, ctx, kid).id as string] : [ctx.homeId];
    return (db.prepare(`SELECT * FROM honeydo WHERE home_id = ? ${filter} AND (status != 'done' OR kid_id IS NOT NULL OR done_at > datetime('now', '-30 days'))
      ORDER BY status, position, created_at`).all(...args) as Row[]).map(denView);
  });

  app.post('/api/homes/:homeId/den', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    const kidId = b.kidId ? getKid(db, ctx, String(b.kidId)).id as string : null;
    return create(ctx, b, kidId);
  });

  app.patch('/api/homes/:homeId/den/:id', async (req) => {
    const ctx = homeCtx(db, req);
    if (ctx.actor.kind !== 'parent' && ctx.actor.kind !== 'kid') throw new HttpError(403, 'Tap your avatar first');
    return update(ctx, card(ctx, (req.params as { id: string }).id), (req.body ?? {}) as Row);
  });

  // A parent checks a finished room card. Its points (if any) are paid once per time it's done.
  app.post('/api/homes/:homeId/den/:id/check', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return tx(db, () => {
      const c = card(ctx, (req.params as { id: string }).id);
      if (!c.kid_id) throw new HttpError(400, 'Only room cards get checked');
      if (c.status !== 'done') throw new HttpError(400, "That card isn't done yet");
      if (c.paid_at) return { card: denView(c), awarded: 0 };
      const pts = c.points as number;
      if (pts > 0) {
        writeLedger(db, {
          homeId: ctx.homeId, memberId: c.kid_id as string, amount: pts, kind: 'bonus', reason: `🦝 Den Duty: ${c.title}`,
          date: homeToday(homeInfo(db, ctx.homeId)), by: byOf(ctx),
        });
      }
      db.prepare("UPDATE honeydo SET paid_at = datetime('now') WHERE id = ?").run(c.id as string);
      return { card: denView(card(ctx, c.id as string)), awarded: pts };
    });
  });

  app.delete('/api/homes/:homeId/den/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM honeydo WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  // ----- the old honey-do endpoints: the parents' own list (cards with no kid) -----
  app.get('/api/homes/:homeId/honeydo', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return (db.prepare(`SELECT * FROM honeydo WHERE home_id = ? AND kid_id IS NULL AND (status != 'done' OR done_at > datetime('now', '-30 days'))
      ORDER BY status, position, created_at`).all(ctx.homeId) as Row[]).map(denView);
  });
  app.post('/api/homes/:homeId/honeydo', async (req) => create(homeCtx(db, req, 'parent'), (req.body ?? {}) as Row, null));
  app.patch('/api/homes/:homeId/honeydo/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return update(ctx, card(ctx, (req.params as { id: string }).id), (req.body ?? {}) as Row);
  });
  app.delete('/api/homes/:homeId/honeydo/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM honeydo WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });
}
