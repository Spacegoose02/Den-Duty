// Family team goals: parents set them, everyone sees them fill up, parents mark them celebrated.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, newId, num, requireStr, str } from '../util.ts';
import { teamGoals, teamGoalView } from '../team.ts';
import { cleanIcon } from './homes.ts';

const MAX_ACTIVE = 3;

function target(v: unknown): number {
  const n = num(v);
  if (n == null || !Number.isInteger(n) || n < 1 || n > 1_000_000) throw new HttpError(400, 'The goal needs a whole number of points, at least 1');
  return n;
}

export function teamGoalRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const get = (homeId: string, id: string): Row => {
    const g = db.prepare('SELECT * FROM team_goals WHERE id = ? AND home_id = ?').get(id, homeId) as Row | undefined;
    if (!g) throw new HttpError(404, 'That family goal is gone');
    return g;
  };

  app.get('/api/homes/:homeId/team-goals', async (req) => {
    const ctx = homeCtx(db, req);
    return teamGoals(db, ctx.homeId);
  });

  app.post('/api/homes/:homeId/team-goals', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    const active = (db.prepare("SELECT COUNT(*) AS n FROM team_goals WHERE home_id = ? AND status = 'active'").get(ctx.homeId) as Row).n as number;
    if (active >= MAX_ACTIVE) throw new HttpError(400, `Finish a family goal first (${MAX_ACTIVE} at a time)`);
    const id = newId();
    db.prepare('INSERT INTO team_goals (id, home_id, title, icon, target, reward, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, ctx.homeId, requireStr(b.title, 'Goal', 80), cleanIcon(b.icon, '🏕️'), target(b.target), str(b.reward, 200), ctx.user?.id ?? null);
    return teamGoalView(db, get(ctx.homeId, id));
  });

  app.patch('/api/homes/:homeId/team-goals/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const g = get(ctx.homeId, (req.params as { id: string }).id);
    const b = (req.body ?? {}) as Row;
    if ('title' in b) db.prepare('UPDATE team_goals SET title = ? WHERE id = ?').run(requireStr(b.title, 'Goal', 80), g.id as string);
    if ('target' in b) db.prepare('UPDATE team_goals SET target = ?, reached_at = NULL WHERE id = ?').run(target(b.target), g.id as string);
    if ('reward' in b) db.prepare('UPDATE team_goals SET reward = ? WHERE id = ?').run(str(b.reward, 200), g.id as string);
    return teamGoalView(db, get(ctx.homeId, g.id as string));
  });

  // "We did it!": the family got their reward. It stays on screen for a couple of weeks as a trophy.
  app.post('/api/homes/:homeId/team-goals/:id/done', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const g = get(ctx.homeId, (req.params as { id: string }).id);
    if (!teamGoalView(db, g).reached) throw new HttpError(400, "The family isn't there yet");
    db.prepare("UPDATE team_goals SET status = 'done', done_at = datetime('now') WHERE id = ?").run(g.id as string);
    return teamGoalView(db, get(ctx.homeId, g.id as string));
  });

  app.delete('/api/homes/:homeId/team-goals/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM team_goals WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });
}
