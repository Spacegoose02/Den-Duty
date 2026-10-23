// The weekly chore archive (see archive.ts): parents look back at finished weeks and compare them.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import { homeInfo, homeToday } from '../chores.ts';
import { archiveFor } from '../archive.ts';
import { getKid } from './homes.ts';
import { startOfWeek } from '../../../shared/schedule.ts';

export function archiveRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // Every archived week, newest first; ?kid=<id> for one kid, ?limit= weeks (104 by default).
  app.get('/api/homes/:homeId/archive', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const q = req.query as { kid?: string; limit?: string };
    const home = homeInfo(db, ctx.homeId);
    const today = homeToday(home);
    const memberId = q.kid ? getKid(db, ctx, q.kid).id as string : undefined;
    const limit = Math.min(Math.max(Number(q.limit) || 104, 1), 104);
    return { today, thisWeek: startOfWeek(today, home.weekStart), weeks: archiveFor(db, home, { memberId, limit }) };
  });
}
