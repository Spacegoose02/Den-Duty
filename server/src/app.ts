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
import { therapyRoutes } from './routes/therapy.ts';
import { honeydoRoutes } from './routes/honeydo.ts';

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

  registerAuthRoutes(app, db);
  accountRoutes(app, db);
  homeRoutes(app, db);
  kioskRoutes(app, db);
  choreRoutes(app, db);
  goalRoutes(app, db);
  rewardRoutes(app, db);
  therapyRoutes(app, db);
  honeydoRoutes(app, db);

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
