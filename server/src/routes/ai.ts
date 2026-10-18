import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, num, str } from '../util.ts';
import { earnedBetween, homeInfo, homeToday } from '../chores.ts';
import { aiSettings, sealKey, suggest, therapyHelper, THERAPY_DISCLAIMER, type HelperArea, type IdeaKind } from '../ai.ts';
import { OT_AREAS } from './therapy.ts';
import type { HomeCtx } from '../auth.ts';
import { getKid, kidView, listKids } from './homes.ts';
import { rateLimit } from '../security.ts';
import { addDays } from '../../../shared/schedule.ts';

const helperAreas = (area: HelperArea) => (area === 'speech' ? ['speech'] : OT_AREAS);

function activeGoals(db: DatabaseSync, memberId: string, area: HelperArea): string[] {
  const areas = helperAreas(area);
  return (db.prepare(`SELECT title FROM therapy_goals WHERE member_id = ? AND status = 'active' AND area IN (${areas.map(() => '?').join(',')}) ORDER BY created_at`)
    .all(memberId, ...areas) as Row[]).map((r) => r.title as string);
}

/** Today's tip for one kid and area: from the cache, or freshly made (and cached) when missing or refreshed. */
async function dailyTip(db: DatabaseSync, ctx: HomeCtx, memberId: string, area: HelperArea, refresh: boolean) {
  const kid = kidView(db, getKid(db, ctx, memberId));
  const today = homeToday(homeInfo(db, ctx.homeId));
  if (!aiSettings(db, ctx.homeId).enabled) throw new HttpError(403, 'AI ideas are turned off. A parent can turn them on in Settings.');
  const cached = refresh ? undefined : db.prepare('SELECT data FROM ai_tips WHERE member_id = ? AND area = ? AND date = ?').get(memberId, area, today) as Row | undefined;
  if (cached) return { date: today, area, disclaimer: THERAPY_DISCLAIMER, cached: true, ...JSON.parse(cached.data as string) };
  rateLimit(`ai:${ctx.homeId}`, 40, 15 * 60e3);
  const result = await therapyHelper(db, ctx.homeId, area, kid.age, activeGoals(db, memberId, area), today);
  db.prepare('INSERT OR REPLACE INTO ai_tips (member_id, home_id, area, date, data) VALUES (?, ?, ?, ?, ?)').run(memberId, ctx.homeId, area, today, JSON.stringify(result));
  return { date: today, area, disclaimer: THERAPY_DISCLAIMER, cached: false, ...result };
}

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
    const kidAge = b.kidId ? kidView(db, getKid(db, ctx, String(b.kidId))).age : null;
    const age = num(b.age) ?? kidAge;
    return {
      ideas: await suggest(db, ctx.homeId, {
        kind, pointsName: home.pointsName, weeklyPoints: weekly || 20, existing,
        age: age && age > 0 && age < 19 ? Math.round(age) : null, hint: str(b.hint, 300),
      }),
    };
  });

  // ----- speech and occupational therapy helpers (parents only) -----
  app.get('/api/homes/:homeId/kids/:memberId/therapy/helper/:area', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const { memberId, area } = req.params as { memberId: string; area: string };
    if (area !== 'speech' && area !== 'ot') throw new HttpError(400, 'area must be speech or ot');
    return dailyTip(db, ctx, memberId, area, (req.query as { refresh?: string }).refresh === '1');
  });

  // Today's tips for the parents' home screen: one per kid per area they have active goals in. Off when AI is off.
  app.get('/api/homes/:homeId/therapy/tips', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    if (!aiSettings(db, ctx.homeId).enabled) return [];
    const wanted = listKids(db, ctx.homeId).flatMap((k) => (['speech', 'ot'] as HelperArea[])
      .filter((area) => activeGoals(db, k.id, area).length > 0).map((area) => ({ kid: k, area })));
    return Promise.all(wanted.map(async ({ kid, area }) => {
      try {
        return { kidId: kid.id, kidName: kid.name, kidAvatar: kid.avatar, ...(await dailyTip(db, ctx, kid.id, area, false)) };
      } catch (err) {
        return { kidId: kid.id, kidName: kid.name, kidAvatar: kid.avatar, area, error: (err as Error).message };
      }
    }));
  });
}
