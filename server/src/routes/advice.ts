// The Ask page (parents only): Judge Trash Panda settles kids' arguments, and two open chats, Dr. Bandit for everyday
// health questions and Coach Ringtail for behavior and time-out calls. All of it needs AI ideas turned on in Settings.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx, isFullParent, type HomeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, newId, num, str } from '../util.ts';
import {
  aiSettings, ASK_DISCLAIMER, chat, fillNames, judgeArgument, JUDGE_DISCLAIMER, PARENTING_DISCLAIMER, SAFETY_NOTE, scrubNames, URGENT_NOTE,
  type ChatKind, type ChatTurn,
} from '../ai.ts';
import { COACH_NAME, DOCTOR_NAME, JUDGE_NAME, PARENTING_STARTERS } from '../../../shared/pages.ts';
import { getKid, kidView, listKids } from './homes.ts';
import { rateLimit } from '../security.ts';

const KEEP_RULINGS = 20;
const KEEP_CHAT = 60;

function parentOnly(db: DatabaseSync, req: Parameters<typeof homeCtx>[1]): HomeCtx {
  const ctx = homeCtx(db, req, 'parent');
  if (!isFullParent(ctx)) throw new HttpError(403, 'Parents only');
  return ctx;
}

function needAi(db: DatabaseSync, homeId: string): void {
  if (!aiSettings(db, homeId).enabled) throw new HttpError(403, 'AI ideas are turned off. A parent can turn them on in Settings.');
}

const chatInfo = (kind: ChatKind) => kind === 'doctor'
  ? { name: DOCTOR_NAME, disclaimer: ASK_DISCLAIMER, urgentNote: URGENT_NOTE, starters: [] as { icon: string; label: string; ask: string }[] }
  : { name: COACH_NAME, disclaimer: PARENTING_DISCLAIMER, urgentNote: SAFETY_NOTE, starters: PARENTING_STARTERS as unknown as { icon: string; label: string; ask: string }[] };

function chatKind(raw: string): ChatKind {
  if (raw !== 'doctor' && raw !== 'parenting') throw new HttpError(404, 'No such chat');
  return raw;
}

export function adviceRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // ----- Judge Trash Panda -----
  const rulings = (homeId: string) => (db.prepare('SELECT id, data, created_at FROM ai_rulings WHERE home_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(homeId, KEEP_RULINGS) as Row[]).map((r) => ({ id: r.id as string, at: r.created_at as string, ...JSON.parse(r.data as string) }));

  app.get('/api/homes/:homeId/judge', async (req) => {
    const ctx = parentOnly(db, req);
    return { name: JUDGE_NAME, disclaimer: JUDGE_DISCLAIMER, aiOn: aiSettings(db, ctx.homeId).enabled, history: rulings(ctx.homeId) };
  });

  app.post('/api/homes/:homeId/judge', async (req) => {
    const ctx = parentOnly(db, req);
    needAi(db, ctx.homeId);
    const b = (req.body ?? {}) as Row;
    const raw = Array.isArray(b.sides) ? b.sides as Row[] : [];
    if (raw.length < 2 || raw.length > 4) throw new HttpError(400, 'Tell the judge 2 to 4 sides');
    const seen = new Set<string>();
    const sides = raw.map((s, i) => {
      const story = str(s?.story, 800);
      if (!story) throw new HttpError(400, `Side ${i + 1} needs their story`);
      if (s?.kidId) {
        const kid = kidView(db, getKid(db, ctx, String(s.kidId)));
        if (seen.has(kid.id)) throw new HttpError(400, `${kid.name} is on two sides`);
        seen.add(kid.id);
        if (!kid.aiOn) throw new HttpError(403, `AI ideas are turned off for ${kid.name} (Kids → Edit)`);
        return { kidId: kid.id, name: kid.name, avatar: kid.avatar, age: kid.age, story };
      }
      // Someone who isn't a kid in the app (a cousin, a friend over to play).
      const name = str(s?.name, 40);
      if (!name) throw new HttpError(400, `Pick a kid or type a name for side ${i + 1}`);
      const age = num(s?.age);
      return { kidId: null, name, avatar: null, age: age && age > 0 && age < 19 ? Math.round(age) : null, story };
    });
    rateLimit(`ai:${ctx.homeId}`, 40, 15 * 60e3);
    const names = sides.map((s) => s.name);
    const others = listKids(db, ctx.homeId).map((k) => k.name).filter((n) => !names.some((x) => x.toLowerCase() === n.toLowerCase()));
    const scrub = (t: string | null) => (t ? scrubNames(t, names, others) : null);
    const about = str(b.about, 200);
    const parentSaw = str(b.parentSaw, 600);
    const ruling = await judgeArgument(db, ctx.homeId, JUDGE_NAME, {
      about: scrub(about), parentSaw: scrub(parentSaw), sides: sides.map((s) => ({ age: s.age, story: scrub(s.story) as string })),
    });
    const fill = (t: string) => fillNames(t, names);
    const named = {
      ...ruling, headline: fill(ruling.headline), reasoning: fill(ruling.reasoning), fix: fill(ruling.fix), readAloud: fill(ruling.readAloud),
      sides: ruling.sides.map((s) => ({ ...s, heard: fill(s.heard), nextTime: fill(s.nextTime) })),
    };
    const data = { about, parentSaw, sides: sides.map(({ age: _age, ...s }) => s), ruling: named };
    const id = newId();
    db.prepare('INSERT INTO ai_rulings (id, home_id, data) VALUES (?, ?, ?)').run(id, ctx.homeId, JSON.stringify(data));
    db.prepare('DELETE FROM ai_rulings WHERE home_id = ? AND id NOT IN (SELECT id FROM ai_rulings WHERE home_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)')
      .run(ctx.homeId, ctx.homeId, KEEP_RULINGS);
    return { id, at: new Date().toISOString(), ...data };
  });

  app.delete('/api/homes/:homeId/judge', async (req) => {
    const ctx = parentOnly(db, req);
    db.prepare('DELETE FROM ai_rulings WHERE home_id = ?').run(ctx.homeId);
    return { ok: true };
  });

  app.delete('/api/homes/:homeId/judge/:id', async (req) => {
    const ctx = parentOnly(db, req);
    db.prepare('DELETE FROM ai_rulings WHERE home_id = ? AND id = ?').run(ctx.homeId, (req.params as { id: string }).id);
    return { ok: true };
  });

  // ----- the open chats -----
  const messages = (homeId: string, kind: ChatKind) => (db.prepare(`SELECT * FROM (SELECT id, role, content, urgent, created_at, rowid AS n FROM ai_chats
    WHERE home_id = ? AND kind = ? ORDER BY created_at DESC, rowid DESC LIMIT ?) ORDER BY created_at, n`).all(homeId, kind, KEEP_CHAT) as Row[])
    .map((r) => ({ id: r.id as string, role: r.role as 'user' | 'assistant', content: r.content as string, urgent: !!r.urgent, at: r.created_at as string }));

  app.get('/api/homes/:homeId/chat/:kind', async (req) => {
    const ctx = parentOnly(db, req);
    const kind = chatKind((req.params as { kind: string }).kind);
    return { kind, ...chatInfo(kind), aiOn: aiSettings(db, ctx.homeId).enabled, messages: messages(ctx.homeId, kind) };
  });

  app.post('/api/homes/:homeId/chat/:kind', async (req) => {
    const ctx = parentOnly(db, req);
    const kind = chatKind((req.params as { kind: string }).kind);
    needAi(db, ctx.homeId);
    const b = (req.body ?? {}) as Row;
    const message = str(b.message, 1500);
    if (!message) throw new HttpError(400, 'Type a message');
    let age: number | null = null;
    if (b.kidId) {
      const kid = kidView(db, getKid(db, ctx, String(b.kidId)));
      if (!kid.aiOn) throw new HttpError(403, `AI ideas are turned off for ${kid.name} (Kids → Edit)`);
      age = kid.age;
    }
    rateLimit(`ai:${ctx.homeId}`, 40, 15 * 60e3);
    const history: ChatTurn[] = messages(ctx.homeId, kind).map((m) => ({ role: m.role, content: m.content }));
    const r = await chat(db, ctx.homeId, kind, chatInfo(kind).name, history, message, age);
    const add = db.prepare('INSERT INTO ai_chats (id, home_id, kind, role, content, urgent) VALUES (?, ?, ?, ?, ?, ?)');
    add.run(newId(), ctx.homeId, kind, 'user', message, 0);
    add.run(newId(), ctx.homeId, kind, 'assistant', r.answer, r.urgent ? 1 : 0);
    db.prepare(`DELETE FROM ai_chats WHERE home_id = ? AND kind = ? AND id NOT IN
      (SELECT id FROM ai_chats WHERE home_id = ? AND kind = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)`).run(ctx.homeId, kind, ctx.homeId, kind, KEEP_CHAT);
    return { kind, ...chatInfo(kind), aiOn: true, messages: messages(ctx.homeId, kind) };
  });

  app.delete('/api/homes/:homeId/chat/:kind', async (req) => {
    const ctx = parentOnly(db, req);
    const kind = chatKind((req.params as { kind: string }).kind);
    db.prepare('DELETE FROM ai_chats WHERE home_id = ? AND kind = ?').run(ctx.homeId, kind);
    return { ok: true };
  });
}
