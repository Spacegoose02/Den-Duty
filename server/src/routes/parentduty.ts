// Parent Duty: a kanban of the things parents need to do for each kid ("help Ava with her science project",
// "buy Ben new shoes"), plus a general list for everything else. Parents only; due dates show on the parents'
// calendar. Cards live in the honeydo table: kid_id is the kid the card is about (null = general).
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx, type HomeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, newId, num, requireStr, str } from '../util.ts';
import { getKid } from './homes.ts';
import { kidsWithPageOff } from '../chores.ts';
import { isIsoDate } from '../../../shared/schedule.ts';

const STATUSES = ['todo', 'doing', 'done'] as const;
type Status = (typeof STATUSES)[number];

export const dutyView = (r: Row) => ({
  id: r.id as string, title: r.title as string, notes: r.notes as string | null,
  kidId: (r.kid_id as string | null) ?? null, assigneeId: r.assignee_id as string | null,
  status: r.status as Status, dueDate: r.due_date as string | null, position: r.position as number,
  doneAt: r.done_at as string | null, createdAt: r.created_at as string,
});

/** Open cards with a due date in a range, for the parents' week view and the home calendar feed. */
export function dutyDue(db: DatabaseSync, homeId: string, from: string, to: string) {
  const off = kidsWithPageOff(db, homeId, 'parentduty');
  return (db.prepare(`SELECT h.*, m.name AS kid_name FROM honeydo h LEFT JOIN members m ON m.id = h.kid_id
    WHERE h.home_id = ? AND h.due_date BETWEEN ? AND ? AND h.status != 'done' ORDER BY h.due_date, h.position`).all(homeId, from, to) as Row[])
    .filter((r) => !r.kid_id || !off.has(r.kid_id as string))
    .map((r) => ({ ...dutyView(r), kidName: (r.kid_name as string | null) ?? null }));
}

export function parentDutyRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const parentIn = (homeId: string, memberId: unknown): string | null => {
    if (memberId == null || memberId === '') return null;
    if (!db.prepare("SELECT 1 FROM members WHERE id = ? AND home_id = ? AND role = 'parent'").get(String(memberId), homeId)) {
      throw new HttpError(400, 'Cards go to a parent in this home');
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
  const card = (ctx: HomeCtx, id: string): Row => {
    const r = db.prepare('SELECT * FROM honeydo WHERE id = ? AND home_id = ?').get(id, ctx.homeId) as Row | undefined;
    if (!r) throw new HttpError(404, 'That card is gone');
    return r;
  };
  const nextPosition = (homeId: string, kidId: string | null, st: Status) =>
    (((db.prepare('SELECT MAX(position) AS p FROM honeydo WHERE home_id = ? AND status = ? AND kid_id IS ?').get(homeId, st, kidId) as Row).p as number | null) ?? 0) + 1;

  function list(ctx: HomeCtx, kid: string | undefined) {
    const off = kidsWithPageOff(db, ctx.homeId, 'parentduty');
    const filter = kid === 'general' ? 'AND kid_id IS NULL' : kid ? 'AND kid_id = ?' : '';
    const args = kid && kid !== 'general' ? [ctx.homeId, getKid(db, ctx, kid).id as string] : [ctx.homeId];
    // Done cards older than 30 days drop off the board.
    return (db.prepare(`SELECT * FROM honeydo WHERE home_id = ? ${filter} AND (status != 'done' OR done_at > datetime('now', '-30 days'))
      ORDER BY status, position, created_at`).all(...args) as Row[])
      .filter((r) => !r.kid_id || !off.has(r.kid_id as string)).map(dutyView);
  }

  function create(ctx: HomeCtx, b: Row) {
    const kidId = b.kidId ? getKid(db, ctx, String(b.kidId)).id as string : null;
    const st = b.status == null ? 'todo' : status(b.status);
    const id = newId();
    db.prepare(`INSERT INTO honeydo (id, home_id, title, notes, kid_id, assignee_id, status, due_date, position, created_by, done_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${st === 'done' ? "datetime('now')" : 'NULL'})`)
      .run(id, ctx.homeId, requireStr(b.title, 'Title', 120), str(b.notes, 2000), kidId, parentIn(ctx.homeId, b.assigneeId), st, due(b.dueDate),
        nextPosition(ctx.homeId, kidId, st), ctx.user?.id ?? null);
    return dutyView(card(ctx, id));
  }

  function update(ctx: HomeCtx, cur: Row, b: Row) {
    const st = 'status' in b ? status(b.status) : cur.status as Status;
    const kidId = 'kidId' in b ? (b.kidId ? getKid(db, ctx, String(b.kidId)).id as string : null) : cur.kid_id as string | null;
    const position = 'position' in b && num(b.position) != null ? num(b.position)!
      : st !== cur.status || kidId !== cur.kid_id ? nextPosition(ctx.homeId, kidId, st) : cur.position as number;
    db.prepare(`UPDATE honeydo SET title = ?, notes = ?, kid_id = ?, assignee_id = ?, status = ?, due_date = ?, position = ?,
      done_at = CASE WHEN ? = 'done' THEN COALESCE(done_at, datetime('now')) ELSE NULL END WHERE id = ?`).run(
      'title' in b ? requireStr(b.title, 'Title', 120) : cur.title as string,
      'notes' in b ? str(b.notes, 2000) : cur.notes as string | null,
      kidId,
      'assigneeId' in b ? parentIn(ctx.homeId, b.assigneeId) : cur.assignee_id as string | null,
      st, 'dueDate' in b ? due(b.dueDate) : cur.due_date as string | null, position, st, cur.id as string);
    return dutyView(card(ctx, cur.id as string));
  }

  // ?kid=<id> for one kid's board, ?kid=general for the general list, nothing for all.
  app.get('/api/homes/:homeId/parent-duty', async (req) => list(homeCtx(db, req, 'parent'), (req.query as { kid?: string }).kid));
  app.post('/api/homes/:homeId/parent-duty', async (req) => create(homeCtx(db, req, 'parent'), (req.body ?? {}) as Row));
  app.patch('/api/homes/:homeId/parent-duty/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return update(ctx, card(ctx, (req.params as { id: string }).id), (req.body ?? {}) as Row);
  });
  app.delete('/api/homes/:homeId/parent-duty/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM honeydo WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  // The old honey-do endpoints keep working for the general list.
  app.get('/api/homes/:homeId/honeydo', async (req) => list(homeCtx(db, req, 'parent'), 'general'));
  app.post('/api/homes/:homeId/honeydo', async (req) => create(homeCtx(db, req, 'parent'), { ...(req.body as Row ?? {}), kidId: null }));
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
