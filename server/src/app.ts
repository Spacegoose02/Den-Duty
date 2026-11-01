import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';
import { installAuth, registerAuthRoutes } from './auth.ts';
import { HttpError } from './util.ts';
import { installHardening } from './security.ts';
import { accountRoutes } from './accounts.ts';
import { homeRoutes } from './routes/homes.ts';
import { kioskRoutes } from './routes/kiosk.ts';
import { choreRoutes } from './routes/chores.ts';
import { goalRoutes } from './routes/goals.ts';
import { rewardRoutes } from './routes/rewards.ts';
import { shopRoutes } from './routes/shop.ts';
import { teamGoalRoutes } from './routes/teamgoals.ts';
import { therapyRoutes } from './routes/therapy.ts';
import { parentDutyRoutes } from './routes/parentduty.ts';
import { timeoutRoutes } from './routes/timeouts.ts';
import { wallRoutes } from './routes/wall.ts';
import { helpdeskRoutes } from './routes/helpdesk.ts';
import { reminderRoutes } from './routes/reminders.ts';
import { haRoutes } from './routes/ha.ts';
import { calendarRoutes } from './routes/calendars.ts';
import { aiRoutes } from './routes/ai.ts';
import { archiveRoutes } from './routes/archive.ts';
import { installV1, v1Routes } from './routes/v1.ts';
import { gamingRoutes } from './routes/gaming.ts';
import { lootdenRoutes } from './routes/lootden.ts';
import { downloadRoutes } from './routes/downloads.ts';

export async function buildApp(db: DatabaseSync, opts: { logger?: boolean; serveWeb?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024, trustProxy: config.trustProxy });
  await app.register(cookie, { secret: config.sessionSecret });
  installHardening(app);
  installAuth(app, db);

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Something went wrong. The raccoon is looking into it.' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  // Before the routes, so it can serve the public ones again under /api/v1.
  installV1(app);
  registerAuthRoutes(app, db);
  accountRoutes(app, db);
  homeRoutes(app, db);
  kioskRoutes(app, db);
  choreRoutes(app, db);
  goalRoutes(app, db);
  rewardRoutes(app, db);
  shopRoutes(app, db);
  teamGoalRoutes(app, db);
  therapyRoutes(app, db);
  parentDutyRoutes(app, db);
  timeoutRoutes(app, db);
  wallRoutes(app, db);
  helpdeskRoutes(app, db);
  reminderRoutes(app, db);
  haRoutes(app, db);
  calendarRoutes(app, db);
  aiRoutes(app, db);
  archiveRoutes(app, db);
  v1Routes(app, db);
  gamingRoutes(app, db);
  lootdenRoutes(app, db);
  downloadRoutes(app);

  const hasWeb = opts.serveWeb !== false && fs.existsSync(path.join(config.webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: '/', wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET' || !hasWeb) {
      return reply.status(404).send({ error: 'Not found' });
    }
    // Single-page app: let the browser router handle it.
    return reply.sendFile('index.html', config.webDist);
  });

  return app;
}
