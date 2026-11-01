import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError } from '../util.ts';
import { notify, saveSubscription, vapidKeys } from '../push.ts';

export function pushRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/push/key', async () => ({ publicKey: vapidKeys(db).publicKey }));

  // A parent's browser, or the family tablet (signed in as the tablet, with or without a kid tapped in).
  app.post('/api/homes/:homeId/push', async (req) => {
    const ctx = homeCtx(db, req);
    // A parent signed in on the family tablet can turn on the tablet's (kid) notifications instead of their own.
    const asTablet = (req.body as Row)?.as === 'tablet' && req.device?.homeId === ctx.homeId;
    const who = ctx.actor.kind === 'parent' && ctx.user && !asTablet ? { userId: ctx.user.id, deviceId: null }
      : req.device?.homeId === ctx.homeId ? { userId: null, deviceId: req.device.id } : null;
    if (!who) throw new HttpError(403, 'Only parents and the family tablet can get notifications');
    try { saveSubscription(db, ctx.homeId, who, (req.body as Row)?.subscription); } catch (e) { throw new HttpError(400, (e as Error).message); }
    return { ok: true, audience: who.userId ? 'parents' : 'tablet' };
  });

  app.post('/api/homes/:homeId/push/remove', async (req) => {
    const ctx = homeCtx(db, req);
    db.prepare('DELETE FROM push_subscriptions WHERE home_id = ? AND endpoint = ?').run(ctx.homeId, String((req.body as Row)?.endpoint ?? ''));
    return { ok: true };
  });

  app.post('/api/homes/:homeId/push/test', async (req) => {
    const ctx = homeCtx(db, req);
    const endpoint = String((req.body as Row)?.endpoint ?? '');
    const sub = db.prepare('SELECT 1 FROM push_subscriptions WHERE home_id = ? AND endpoint = ?').get(ctx.homeId, endpoint);
    if (!sub) throw new HttpError(404, 'Turn notifications on first');
    notify(db, ctx.homeId, 'all', { title: '🦝 Den Duty notifications are on', body: 'This is what they look like.', url: '/' }, endpoint);
    return { ok: true };
  });
}
