// Parent Duty: a kanban of the things parents need to do for each kid ("help Ava with her science project",
// "buy Ben new shoes"), plus a general list for everything else. Parents only; due dates show on the parents'
// calendar. Cards live in the honeydo table: kid_id is the kid the card is about (null = general).
// Closing a card (done or not) takes it off the board and into that board's history, where it can be reopened.
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
  closedAt: (r.closed_at as string | null) ?? null, closeNote: (r.close_note as string | null) ?? null,
});

/** Open cards with a due date in a range, for the parents' week view and the home calendar feed. */
export function dutyDue(db: DatabaseSync, homeId: string, from: string, to: string) {
  const off = kidsWithPageOff(db, homeId, 'parentduty');
  return (db.prepare(`SELECT h.*, m.name AS kid_name FROM honeydo h LEFT JOIN members m ON m.id = h.kid_id
    WHERE h.home_id = ? AND h.due_date BETWEEN ? AND ? AND h.status != 'done' AND h.closed_at IS NULL ORDER BY h.due_date, h.position`).all(homeId, from, to) as Row[])
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

  const boardFilter = (ctx: HomeCtx, kid: string | undefined): [string, string[]] => {
    if (kid === 'general') return ['AND h.kid_id IS NULL', [ctx.homeId]];
    if (kid) return ['AND h.kid_id = ?', [ctx.homeId, getKid(db, ctx, kid).id as string]];
    return ['', [ctx.homeId]];
  };

  function list(ctx: HomeCtx, kid: string | undefined) {
    const off = kidsWithPageOff(db, ctx.homeId, 'parentduty');
    const [filter, args] = boardFilter(ctx, kid);
    // Done cards close themselves after 30 days, so the Done column doesn't grow forever.
    db.prepare("UPDATE honeydo SET closed_at = done_at WHERE home_id = ? AND closed_at IS NULL AND status = 'done' AND done_at <= datetime('now', '-30 days')").run(ctx.homeId);
    return (db.prepare(`SELECT * FROM honeydo h WHERE h.home_id = ? ${filter} AND h.closed_at IS NULL
      ORDER BY h.status, h.position, h.created_at`).all(...args) as Row[])
      .filter((r) => !r.kid_id || !off.has(r.kid_id as string)).map(dutyView);
  }

  /** Closed cards, newest first, with who closed them. `q` searches titles and notes. */
  function history(ctx: HomeCtx, kid: string | undefined, q: string | undefined, limit: number) {
    const off = kidsWithPageOff(db, ctx.homeId, 'parentduty');
    const [filter, args] = boardFilter(ctx, kid);
    const search = q?.trim() ? `%${q.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    return (db.prepare(`SELECT h.*, u.name AS closed_by_name FROM honeydo h LEFT JOIN users u ON u.id = h.closed_by
      WHERE h.home_id = ? ${filter} AND h.closed_at IS NOT NULL
      ${search ? "AND (lower(h.title) LIKE ? ESCAPE '\\' OR lower(COALESCE(h.notes, '')) LIKE ? ESCAPE '\\')" : ''}
      ORDER BY h.closed_at DESC, h.id LIMIT ?`).all(...args, ...(search ? [search, search] : []), limit) as Row[])
      .filter((r) => !r.kid_id || !off.has(r.kid_id as string))
      .map((r) => ({ ...dutyView(r), closedBy: (r.closed_by_name as string | null) ?? null }));
  }

  /** Close a card at any stage. By default it counts as done; `done: false` closes it unfinished ("not needed after all"). */
  function close(ctx: HomeCtx, cur: Row, b: Row) {
    if (cur.closed_at) throw new HttpError(400, 'That card is already closed');
    const finish = b.done !== false;
    db.prepare(`UPDATE honeydo SET closed_at = datetime('now'), close_note = ?, closed_by = ?,
      status = CASE WHEN ? THEN 'done' ELSE status END,
      done_at = CASE WHEN ? THEN COALESCE(done_at, datetime('now')) ELSE done_at END WHERE id = ?`)
      .run(str(b.note, 300), ctx.user?.id ?? null, finish ? 1 : 0, finish ? 1 : 0, cur.id as string);
    return dutyView(card(ctx, cur.id as string));
  }

  /** Back on the board, in the column it was closed from, at the bottom. */
  function reopen(ctx: HomeCtx, cur: Row) {
    if (!cur.closed_at) throw new HttpError(400, "That card isn't closed");
    db.prepare(`UPDATE honeydo SET closed_at = NULL, close_note = NULL, closed_by = NULL, position = ?,
      done_at = CASE WHEN status = 'done' THEN datetime('now') ELSE done_at END WHERE id = ?`)
      .run(nextPosition(ctx.homeId, cur.kid_id as string | null, cur.status as Status), cur.id as string);
    return dutyView(card(ctx, cur.id as string));
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
  // History of closed cards, same ?kid= as the board; ?q= searches, ?limit= up to 500 (100 by default).
  app.get('/api/homes/:homeId/parent-duty/history', async (req) => {
    const q = req.query as { kid?: string; q?: string; limit?: string };
    return history(homeCtx(db, req, 'parent'), q.kid, q.q, Math.min(Math.max(Number(q.limit) || 100, 1), 500));
  });
  app.post('/api/homes/:homeId/parent-duty/:id/close', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return close(ctx, card(ctx, (req.params as { id: string }).id), (req.body ?? {}) as Row);
  });
  app.post('/api/homes/:homeId/parent-duty/:id/reopen', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return reopen(ctx, card(ctx, (req.params as { id: string }).id));
  });
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
