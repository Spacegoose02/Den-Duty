// The honey-do board: a kanban for the parents' own to-dos and goals. Kids and tablets can't see it.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, newId, num, requireStr, str } from '../util.ts';
import { isIsoDate } from '../../../shared/schedule.ts';

const STATUSES = ['todo', 'doing', 'done'] as const;

const view = (r: Row) => ({
  id: r.id as string, title: r.title as string, notes: r.notes as string | null, assigneeId: r.assignee_id as string | null,
  status: r.status as (typeof STATUSES)[number], dueDate: r.due_date as string | null, position: r.position as number,
  doneAt: r.done_at as string | null, createdAt: r.created_at as string,
});

export function honeydoRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const parentIn = (homeId: string, memberId: unknown): string | null => {
    if (memberId == null || memberId === '') return null;
    if (!db.prepare("SELECT 1 FROM members WHERE id = ? AND home_id = ? AND role = 'parent'").get(String(memberId), homeId)) {
      throw new HttpError(400, 'Honey-do cards go to a parent in this home');
    }
    return String(memberId);
  };
  const due = (v: unknown): string | null => {
    if (v == null || v === '') return null;
    if (!isIsoDate(v)) throw new HttpError(400, 'Due dates look like 2026-10-20');
    return v;
  };
  const status = (v: unknown) => {
    if (!(STATUSES as readonly unknown[]).includes(v)) throw new HttpError(400, 'Status must be todo, doing or done');
    return v as (typeof STATUSES)[number];
  };

  app.get('/api/homes/:homeId/honeydo', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    // Done cards older than 30 days drop off the board.
    return (db.prepare(`SELECT * FROM honeydo WHERE home_id = ? AND (status != 'done' OR done_at > datetime('now', '-30 days'))
      ORDER BY status, position, created_at`).all(ctx.homeId) as Row[]).map(view);
  });

  app.post('/api/homes/:homeId/honeydo', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    const st = b.status == null ? 'todo' : status(b.status);
    const last = (db.prepare('SELECT MAX(position) AS p FROM honeydo WHERE home_id = ? AND status = ?').get(ctx.homeId, st) as Row).p as number | null;
    const id = newId();
    db.prepare(`INSERT INTO honeydo (id, home_id, title, notes, assignee_id, status, due_date, position, created_by, done_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${st === 'done' ? "datetime('now')" : 'NULL'})`)
      .run(id, ctx.homeId, requireStr(b.title, 'Title', 120), str(b.notes, 2000), parentIn(ctx.homeId, b.assigneeId), st, due(b.dueDate), (last ?? 0) + 1, ctx.user?.id ?? null);
    return view(db.prepare('SELECT * FROM honeydo WHERE id = ?').get(id) as Row);
  });

  // Moves (status + position) and edits.
  app.patch('/api/homes/:homeId/honeydo/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const cur = db.prepare('SELECT * FROM honeydo WHERE id = ? AND home_id = ?').get((req.params as { id: string }).id, ctx.homeId) as Row | undefined;
    if (!cur) throw new HttpError(404, 'That card is gone');
    const b = (req.body ?? {}) as Row;
    const st = 'status' in b ? status(b.status) : cur.status as string;
    let position = cur.position as number;
    if ('position' in b) {
      const p = num(b.position);
      if (p == null) throw new HttpError(400, 'Bad position');
      position = p;
    } else if (st !== cur.status) {
      position = (((db.prepare('SELECT MAX(position) AS p FROM honeydo WHERE home_id = ? AND status = ?').get(ctx.homeId, st) as Row).p as number | null) ?? 0) + 1;
    }
    db.prepare(`UPDATE honeydo SET title = ?, notes = ?, assignee_id = ?, status = ?, due_date = ?, position = ?,
      done_at = CASE WHEN ? = 'done' THEN COALESCE(done_at, datetime('now')) ELSE NULL END WHERE id = ?`).run(
      'title' in b ? requireStr(b.title, 'Title', 120) : cur.title as string,
      'notes' in b ? str(b.notes, 2000) : cur.notes as string | null,
      'assigneeId' in b ? parentIn(ctx.homeId, b.assigneeId) : cur.assignee_id as string | null,
      st, 'dueDate' in b ? due(b.dueDate) : cur.due_date as string | null, position, st, cur.id as string);
    return view(db.prepare('SELECT * FROM honeydo WHERE id = ?').get(cur.id as string) as Row);
  });

  app.delete('/api/homes/:homeId/honeydo/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM honeydo WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });
}
