import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, num, str } from '../util.ts';
import { earnedBetween, homeInfo, homeToday } from '../chores.ts';
import { aiSettings, ASK_DISCLAIMER, askDoctor, sealKey, suggest, therapyHelper, THERAPY_DISCLAIMER, URGENT_NOTE, type HelperArea, type IdeaKind } from '../ai.ts';
import { BEHAVIOR_TOPICS, DOCTOR_AREAS, DOCTOR_NAME, GOAL_AREA_SECTION } from '../../../shared/pages.ts';
import { newId } from '../util.ts';
import { OT_AREAS } from './therapy.ts';
import type { HomeCtx } from '../auth.ts';
import { doctorAreasOff, getKid, ideasOff, kidAiOn, kidView, listKids, pageOn } from './homes.ts';
import { goalAreaOn } from '../../../shared/pages.ts';
import { rateLimit } from '../security.ts';
import { addDays } from '../../../shared/schedule.ts';

const helperAreas = (area: HelperArea) => (area === 'speech' ? ['speech'] : area === 'anger' ? ['behavioral'] : OT_AREAS);

function activeGoals(db: DatabaseSync, memberId: string, area: HelperArea): string[] {
  const off = doctorAreasOff(db, memberId);
  const areas = helperAreas(area).filter((a) => goalAreaOn(a, off));
  if (!areas.length) return [];
  return (db.prepare(`SELECT title FROM therapy_goals WHERE member_id = ? AND status = 'active' AND area IN (${areas.map(() => '?').join(',')}) ORDER BY created_at`)
    .all(memberId, ...areas) as Row[]).map((r) => r.title as string);
}

/** Is this helper turned on for the kid (Doctors page on, its section(s) on, and the idea itself not switched off)? */
function helperOn(db: DatabaseSync, memberId: string, area: HelperArea): boolean {
  if (!kidAiOn(db, memberId) || !pageOn(db, memberId, 'doctors') || ideasOff(db, memberId).includes(area)) return false;
  const off = doctorAreasOff(db, memberId);
  return helperAreas(area).some((a) => goalAreaOn(a, off));
}

/** Today's tip for one kid and area: from the cache, or freshly made (and cached) when missing or refreshed. */
async function dailyTip(db: DatabaseSync, ctx: HomeCtx, memberId: string, area: HelperArea, refresh: boolean) {
  const kid = kidView(db, getKid(db, ctx, memberId));
  if (!kid.aiOn) throw new HttpError(403, `AI ideas are turned off for ${kid.name} (Kids → Edit)`);
  if (ideasOff(db, memberId).includes(area)) throw new HttpError(403, `This practice idea is switched off for ${kid.name} (Kids → Edit)`);
  if (!helperOn(db, memberId, area)) throw new HttpError(403, `That section is turned off for ${kid.name}`);
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
    if (b.kidId && !kidAiOn(db, kidIds[0])) throw new HttpError(403, 'AI ideas are turned off for this kid (Kids → Edit)');
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
    if (area !== 'speech' && area !== 'ot' && area !== 'anger') throw new HttpError(400, 'area must be speech, ot or anger');
    return dailyTip(db, ctx, memberId, area, (req.query as { refresh?: string }).refresh === '1');
  });

  // Today's tips for the parents' home screen: speech and OT when the kid has goals there, anger whenever it's switched on.
  // Off when AI is off.
  app.get('/api/homes/:homeId/therapy/tips', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    if (!aiSettings(db, ctx.homeId).enabled) return [];
    const wanted = listKids(db, ctx.homeId).flatMap((k) => (['speech', 'ot', 'anger'] as HelperArea[])
      .filter((area) => helperOn(db, k.id, area) && (area === 'anger' || activeGoals(db, k.id, area).length > 0)).map((area) => ({ kid: k, area })));
    return Promise.all(wanted.map(async ({ kid, area }) => {
      try {
        return { kidId: kid.id, kidName: kid.name, kidAvatar: kid.avatar, ...(await dailyTip(db, ctx, kid.id, area, false)) };
      } catch (err) {
        return { kidId: kid.id, kidName: kid.name, kidAvatar: kid.avatar, area, error: (err as Error).message };
      }
    }));
  });

  // ----- Ask Dr. Bandit (DOCTOR_NAME): parent-only questions about one kid, scoped to the Doctors sections turned on for them -----
  const history = (memberId: string) => (db.prepare('SELECT id, question, answer, created_at FROM ai_questions WHERE member_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10')
    .all(memberId) as Row[]).map((r) => ({ id: r.id as string, question: r.question as string, ...JSON.parse(r.answer as string), at: r.created_at as string }));

  app.get('/api/homes/:homeId/kids/:memberId/doctors/ask', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    // Quick behavior topics only when the Behavioral section is on for this kid.
    const behavior = !doctorAreasOff(db, kid.id as string).includes('behavioral');
    return { name: DOCTOR_NAME, disclaimer: ASK_DISCLAIMER, urgentNote: URGENT_NOTE, history: history(kid.id as string), topics: behavior ? BEHAVIOR_TOPICS : [], aiOn: kidAiOn(db, kid.id as string) };
  });

  app.post('/api/homes/:homeId/kids/:memberId/doctors/ask', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = kidView(db, getKid(db, ctx, (req.params as { memberId: string }).memberId));
    if (!pageOn(db, kid.id, 'doctors')) throw new HttpError(403, `Doctors is turned off for ${kid.name}`);
    if (!aiSettings(db, ctx.homeId).enabled) throw new HttpError(403, 'AI ideas are turned off. A parent can turn them on in Settings.');
    if (!kid.aiOn) throw new HttpError(403, `AI ideas are turned off for ${kid.name} (Kids → Edit)`);
    const off = doctorAreasOff(db, kid.id);
    // A quick topic button sends a topic id; the question for it is fixed here.
    const topicId = (req.body as Row)?.topic;
    const topic = topicId ? BEHAVIOR_TOPICS.find((t) => t.id === topicId) : undefined;
    if (topicId && !topic) throw new HttpError(400, 'Unknown topic');
    if (topic && off.includes('behavioral')) throw new HttpError(403, `Behavioral is turned off for ${kid.name}`);
    const question = topic ? `${topic.icon} ${topic.label}: ${topic.ask}` : str((req.body as Row)?.question, 500);
    if (!question) throw new HttpError(400, 'Type a question');
    rateLimit(`ai:${ctx.homeId}`, 40, 15 * 60e3);
    const areas = DOCTOR_AREAS.filter((a) => a.id !== 'appointments' && !off.includes(a.id)).map((a) => a.label);
    const goals = (db.prepare("SELECT title, area FROM therapy_goals WHERE member_id = ? AND status = 'active'").all(kid.id) as Row[])
      .filter((g) => { const sec = GOAL_AREA_SECTION[g.area as string]; return !sec || !off.includes(sec); }).map((g) => g.title as string);
    const r = await askDoctor(db, ctx.homeId, DOCTOR_NAME, kid.age, areas, goals, topic ? topic.ask : question, !!topic);
    const id = newId();
    db.prepare('INSERT INTO ai_questions (id, member_id, home_id, question, answer) VALUES (?, ?, ?, ?, ?)').run(id, kid.id, ctx.homeId, question, JSON.stringify(r));
    // A short history: the newest 10 are kept.
    db.prepare('DELETE FROM ai_questions WHERE member_id = ? AND id NOT IN (SELECT id FROM ai_questions WHERE member_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10)').run(kid.id, kid.id);
    return { id, question, ...r, name: DOCTOR_NAME, disclaimer: ASK_DISCLAIMER, urgentNote: URGENT_NOTE };
  });

  app.delete('/api/homes/:homeId/kids/:memberId/doctors/ask', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    db.prepare('DELETE FROM ai_questions WHERE member_id = ?').run(kid.id as string);
    return { ok: true };
  });
}
