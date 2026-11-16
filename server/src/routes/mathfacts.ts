// Math facts helper. A parent picks the tables a kid is working on; the kid's board offers "today's remember cards"
// (spaced review: facts they miss come back tomorrow, facts they know come back later and later) and "see it different
// ways" for any fact (groups, arrays, hops, breaking it apart, fact families, a story, a memory trick, or Rocky the AI).
// After exploring a fact the kid says whether it clicked and which way helped, so a parent can see what works for them.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx, isParent, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, parseJson } from '../util.ts';
import { homeInfo, homeToday, writeLedger } from '../chores.ts';
import { getKid, kidAiOn, pageOn } from './homes.ts';
import { aiSettings, mathExplain } from '../ai.ts';
import { ageOn } from '../../../shared/ages.ts';
import { addDays } from '../../../shared/schedule.ts';
import {
  DEFAULT_PLAN, REMEMBERED_BOX, WAY_IDS, answerOf, cleanPlan, factKey, factText, factsFor, nextBox, nextDue, parseFact, pickReview,
  type FactState, type MathPlan, type Recall,
} from '../../../shared/mathfacts.ts';

export function planOf(db: DatabaseSync, memberId: string): MathPlan | null {
  const r = db.prepare('SELECT math_plan FROM members WHERE id = ?').get(memberId) as Row | undefined;
  return r?.math_plan ? cleanPlan(parseJson(r.math_plan, {})) : null;
}

function states(db: DatabaseSync, memberId: string): FactState[] {
  return (db.prepare('SELECT fact, box, due, right_count, wrong_count FROM math_facts WHERE member_id = ?').all(memberId) as Row[])
    .map((r) => ({ fact: r.fact as string, box: r.box as number, due: r.due as string, right: r.right_count as number, wrong: r.wrong_count as number }));
}

/** Everything the helper card shows: today's cards, the fact map, tricky facts and which ways helped. */
export function mathView(db: DatabaseSync, homeId: string, memberId: string) {
  const today = homeToday(homeInfo(db, homeId));
  const plan = planOf(db, memberId);
  const all = states(db, memberId);
  const done = (db.prepare(`SELECT fact, result, NOT EXISTS (SELECT 1 FROM math_log o WHERE o.member_id = l.member_id AND o.fact = l.fact AND o.kind = 'recall' AND o.date < l.date) AS fresh
    FROM math_log l WHERE member_id = ? AND date = ? AND kind = 'recall'`).all(memberId, today) as Row[]);
  const doneKeys = new Set(done.map((r) => r.fact as string));
  // Cards answered today count against today's allowance (and brand-new ones against the new-facts allowance).
  const review = plan ? pickReview(plan, all, today, {
    cards: plan.perDay - doneKeys.size, fresh: 4 - new Set(done.filter((r) => r.fresh).map((r) => r.fact as string)).size,
  }).filter((f) => !doneKeys.has(factKey(f))) : [];
  const inPlan = plan ? factsFor(plan.tables, plan.ops, plan.upTo) : [];
  const byKey = new Map(all.map((s) => [s.fact, s]));
  const weekFrom = addDays(today, -6);
  const week = db.prepare(`SELECT
      SUM(kind = 'recall') AS recalled, SUM(kind = 'recall' AND result = 'right') AS right_n, SUM(kind = 'explore') AS explored,
      COUNT(DISTINCT date) AS days FROM math_log WHERE member_id = ? AND date >= ?`).get(memberId, weekFrom) as Row;
  const helped = (db.prepare(`SELECT way, COUNT(*) AS n FROM math_log WHERE member_id = ? AND kind = 'explore' AND way IS NOT NULL GROUP BY way ORDER BY n DESC`)
    .all(memberId) as Row[]).map((r) => ({ way: r.way as string, n: r.n as number }));
  const daily = (db.prepare(`SELECT date, SUM(kind = 'recall') AS recalled, SUM(kind = 'recall' AND result = 'right') AS right_n, SUM(kind = 'explore') AS explored
      FROM math_log WHERE member_id = ? AND date >= ? GROUP BY date ORDER BY date`).all(memberId, addDays(today, -27)) as Row[])
    .map((r) => ({ date: r.date as string, recalled: Number(r.recalled), right: Number(r.right_n), explored: Number(r.explored) }));
  return {
    today, plan, review, answeredToday: done.length, rightToday: done.filter((r) => r.result === 'right').length,
    paidToday: (db.prepare('SELECT math_paid_on FROM members WHERE id = ?').get(memberId) as Row).math_paid_on === today,
    facts: inPlan.map((f) => { const s = byKey.get(factKey(f)); return { fact: factKey(f), box: s?.box ?? null, right: s?.right ?? 0, wrong: s?.wrong ?? 0 }; }),
    remembered: inPlan.filter((f) => (byKey.get(factKey(f))?.box ?? 0) >= REMEMBERED_BOX).length,
    total: inPlan.length,
    tricky: all.filter((s) => s.wrong > 0 && s.box < REMEMBERED_BOX).sort((a, b) => b.wrong - a.wrong || a.box - b.box).slice(0, 12)
      .map((s) => ({ fact: s.fact, wrong: s.wrong, right: s.right, box: s.box })),
    week: { recalled: Number(week.recalled ?? 0), right: Number(week.right_n ?? 0), explored: Number(week.explored ?? 0), days: Number(week.days ?? 0) },
    daily, helped, ai: aiSettings(db, homeId).enabled && kidAiOn(db, memberId),
  };
}
export type MathView = ReturnType<typeof mathView>;

export function mathRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const kidFor = (ctx: HomeCtx, memberId: string) => {
    assertCanActFor(ctx, memberId);
    const kid = getKid(db, ctx, memberId);
    if (!isParent(ctx)) {
      if (ctx.actor.kind !== 'kid') throw new HttpError(403, 'Pick your raccoon first');
      if (!pageOn(db, memberId, 'math')) throw new HttpError(403, 'The math helper is switched off');
    }
    return kid;
  };
  const factOf = (v: unknown) => {
    const f = parseFact(v);
    if (!f) throw new HttpError(400, 'That fact looks wrong');
    return f;
  };
  const today = (ctx: HomeCtx) => homeToday(homeInfo(db, ctx.homeId));

  app.get('/api/homes/:homeId/kids/:memberId/math', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    getKid(db, ctx, memberId);
    if (!isParent(ctx) && !pageOn(db, memberId, 'math')) return null;
    return mathView(db, ctx.homeId, memberId);
  });

  // The plan: which tables, × and/or ÷, cards a day and points. null turns the helper off for this kid.
  app.put('/api/homes/:homeId/kids/:memberId/math/plan', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const b = req.body as Row | null;
    const plan = b === null || (b as Row & { off?: boolean })?.off ? null : cleanPlan(b, planOf(db, kid.id as string) ?? DEFAULT_PLAN);
    db.prepare('UPDATE members SET math_plan = ? WHERE id = ?').run(plan ? JSON.stringify(plan) : null, kid.id as string);
    return mathView(db, ctx.homeId, kid.id as string);
  });

  // One remember card answered: right, right after a hint, or not yet.
  app.post('/api/homes/:homeId/kids/:memberId/math/answer', async (req) => {
    const ctx = homeCtx(db, req);
    const kid = kidFor(ctx, (req.params as { memberId: string }).memberId);
    const b = (req.body ?? {}) as Row;
    const f = factOf(b.fact);
    const result = String(b.result) as Recall;
    if (!['right', 'hint', 'wrong'].includes(result)) throw new HttpError(400, 'Right, hint or wrong');
    const t = today(ctx);
    const key = factKey(f);
    tx(db, () => {
      const cur = db.prepare('SELECT box FROM math_facts WHERE member_id = ? AND fact = ?').get(kid.id as string, key) as Row | undefined;
      // The first answer of the day is the one that moves the box, so trying the same card again can't game it.
      const already = db.prepare("SELECT 1 FROM math_log WHERE member_id = ? AND date = ? AND fact = ? AND kind = 'recall'").get(kid.id as string, t, key);
      if (!already) {
        const box = nextBox((cur?.box as number | undefined) ?? 0, result);
        db.prepare(`INSERT INTO math_facts (member_id, fact, box, due, right_count, wrong_count, hint_count, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (member_id, fact) DO UPDATE SET box = excluded.box, due = excluded.due, right_count = right_count + excluded.right_count,
          wrong_count = wrong_count + excluded.wrong_count, hint_count = hint_count + excluded.hint_count, last_seen = excluded.last_seen`)
          .run(kid.id as string, key, box, nextDue(t, box, result), result === 'right' ? 1 : 0, result === 'wrong' ? 1 : 0, result === 'hint' ? 1 : 0, t);
        db.prepare("INSERT INTO math_log (home_id, member_id, date, fact, kind, result) VALUES (?, ?, ?, ?, 'recall', ?)").run(ctx.homeId, kid.id as string, t, key, result);
      }
    });
    return { answer: answerOf(f), right: result === 'right' };
  });

  // After exploring a fact: did it click, and which way helped? "Still tricky" brings it back tomorrow.
  app.post('/api/homes/:homeId/kids/:memberId/math/explore', async (req) => {
    const ctx = homeCtx(db, req);
    const kid = kidFor(ctx, (req.params as { memberId: string }).memberId);
    const b = (req.body ?? {}) as Row;
    const f = factOf(b.fact);
    const feel = b.feel === 'tricky' ? 'tricky' : 'got';
    const way = b.way && WAY_IDS.includes(b.way as never) ? String(b.way) : null;
    const t = today(ctx);
    tx(db, () => {
      db.prepare("INSERT INTO math_log (home_id, member_id, date, fact, kind, result, way) VALUES (?, ?, ?, ?, 'explore', ?, ?)").run(ctx.homeId, kid.id as string, t, factKey(f), feel, way);
      if (feel === 'tricky') {
        db.prepare(`INSERT INTO math_facts (member_id, fact, box, due, last_seen) VALUES (?, ?, 0, ?, ?)
          ON CONFLICT (member_id, fact) DO UPDATE SET box = 0, due = excluded.due, last_seen = excluded.last_seen`).run(kid.id as string, factKey(f), addDays(t, 1), t);
      }
    });
    return { ok: true };
  });

  // Finished today's cards (or explored a fact): the day's points, once a day.
  app.post('/api/homes/:homeId/kids/:memberId/math/finish', async (req) => {
    const ctx = homeCtx(db, req);
    const kid = kidFor(ctx, (req.params as { memberId: string }).memberId);
    const plan = planOf(db, kid.id as string);
    const t = today(ctx);
    let paid = 0;
    tx(db, () => {
      const m = db.prepare('SELECT math_paid_on FROM members WHERE id = ?').get(kid.id as string) as Row;
      const did = db.prepare("SELECT SUM(kind = 'recall') AS r, SUM(kind = 'explore') AS e FROM math_log WHERE member_id = ? AND date = ?").get(kid.id as string, t) as Row;
      const enough = Number(did.r ?? 0) >= Math.min(3, plan?.perDay ?? 3) || Number(did.e ?? 0) >= 1;
      if (!plan?.points || m.math_paid_on === t || !enough) return;
      writeLedger(db, { homeId: ctx.homeId, memberId: kid.id as string, amount: plan.points, kind: 'bonus', reason: '🧮 Math facts', date: t,
        by: isParent(ctx) ? { userId: ctx.user?.id ?? null, name: ctx.user?.name ?? 'Parent' } : { userId: null, name: '✨ Auto-approved' } });
      db.prepare('UPDATE members SET math_paid_on = ? WHERE id = ?').run(t, kid.id as string);
      paid = plan.points;
    });
    return { paid, view: mathView(db, ctx.homeId, kid.id as string) };
  });

  // Rocky explains the fact another way (only the fact, the age and the ways already seen go to Claude).
  app.post('/api/homes/:homeId/kids/:memberId/math/explain', async (req) => {
    const ctx = homeCtx(db, req);
    const kid = kidFor(ctx, (req.params as { memberId: string }).memberId);
    if (!kidAiOn(db, kid.id as string)) throw new HttpError(403, 'Rocky is switched off for this kid');
    const b = (req.body ?? {}) as Row;
    const f = factOf(b.fact);
    const tried = (Array.isArray(b.tried) ? b.tried : []).map(String).filter((w) => WAY_IDS.includes(w as never)).slice(0, 8);
    const age = ageOn(kid.birthdate as string | null, today(ctx));
    return mathExplain(db, ctx.homeId, factText(f), answerOf(f), age, tried);
  });
}
