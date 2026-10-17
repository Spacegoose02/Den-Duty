import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, num, str } from '../util.ts';
import { earnedBetween, homeInfo, homeToday } from '../chores.ts';
import { aiSettings, sealKey, suggest, type IdeaKind } from '../ai.ts';
import { getKid, listKids } from './homes.ts';
import { rateLimit } from '../security.ts';
import { addDays } from '../../../shared/schedule.ts';

export function aiRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/ai', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return aiSettings(db, ctx.homeId);
  });

  app.patch('/api/homes/:homeId/ai', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    if ('apiKey' in b) {
      const key = str(b.apiKey, 300);
      if (key && !/^sk-ant-[\w-]{10,}$/.test(key)) throw new HttpError(400, "That doesn't look like an Anthropic API key (they start with sk-ant-)");
      db.prepare('UPDATE homes SET ai_key = ? WHERE id = ?').run(key ? sealKey(key) : null, ctx.homeId);
    }
    if ('model' in b) {
      const model = str(b.model, 80);
      if (model && !/^[a-z0-9.-]+$/.test(model)) throw new HttpError(400, 'Model names look like claude-opus-5-5');
      db.prepare('UPDATE homes SET ai_model = ? WHERE id = ?').run(model, ctx.homeId);
    }
    if (typeof b.enabled === 'boolean') {
      if (b.enabled && !aiSettings(db, ctx.homeId).hasKey) throw new HttpError(400, 'Paste an API key before turning AI ideas on');
      db.prepare('UPDATE homes SET ai_enabled = ? WHERE id = ?').run(b.enabled ? 1 : 0, ctx.homeId);
    }
    return aiSettings(db, ctx.homeId);
  });

  app.post('/api/homes/:homeId/ai/ideas', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    rateLimit(`ai:${ctx.homeId}`, 40, 15 * 60e3); // keeps API spend in check
    const b = (req.body ?? {}) as Row;
    const kind = b.kind as IdeaKind;
    if (!['goal', 'penalty', 'chore'].includes(kind)) throw new HttpError(400, 'kind must be goal, penalty or chore');
    const home = homeInfo(db, ctx.homeId);
    const today = homeToday(home);
    const from = addDays(today, -28);
    const kidIds = b.kidId ? [getKid(db, ctx, String(b.kidId)).id as string] : listKids(db, ctx.homeId).map((k) => k.id);
    const weekly = kidIds.length
      ? Math.round(kidIds.reduce((s, id) => s + earnedBetween(db, id, from, today), 0) / kidIds.length / 4)
      : 0;
    const existing = kind === 'goal'
      ? (db.prepare(`SELECT title FROM goals WHERE home_id = ? ${b.kidId ? 'AND member_id = ?' : ''} AND status = 'active'`).all(...(b.kidId ? [ctx.homeId, kidIds[0]] : [ctx.homeId])) as Row[]).map((r) => r.title as string)
      : kind === 'chore'
        ? (db.prepare('SELECT title FROM chores WHERE home_id = ? AND active = 1').all(ctx.homeId) as Row[]).map((r) => r.title as string)
        : [];
    const age = num(b.age);
    return {
      ideas: await suggest(db, ctx.homeId, {
        kind, pointsName: home.pointsName, weeklyPoints: weekly || 20, existing,
        age: age && age > 0 && age < 19 ? Math.round(age) : null, hint: str(b.hint, 300),
      }),
    };
  });
}
