// Learning time: a few questions a day at each kid's grade (Virginia SOL), or "Talk & play" picture questions for a kid
// working on speech. The server picks today's cards (a skill and a seed each; the board makes the question from them),
// keeps every answer by skill so a parent can see what's clicking, and pays the day's points once the cards are done.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx, isParent, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, parseJson } from '../util.ts';
import { homeInfo, homeToday, writeLedger } from '../chores.ts';
import { getKid, pageOn, setGrade } from './homes.ts';
import { addDays } from '../../../shared/schedule.ts';
import {
  DEFAULT_LEARN_PLAN, MASTERED, accuracy, cleanLearnPlan, currentLevel, levelInfo, mastered, pickCards, readsFirst, skillById, skillsFor, subjectsAt,
  type LearnPlan, type LearnResult, type Level, type SkillStat,
} from '../../../shared/learning.ts';

/** How many answers back a skill's "how sure are we" looks. */
const RECENT = 10;
/** Extra practice a kid can do after today's cards, at most. */
const MAX_EXTRA = 30;

export function learnPlanOf(db: DatabaseSync, memberId: string): LearnPlan | null {
  const r = db.prepare('SELECT learn_plan FROM members WHERE id = ?').get(memberId) as Row | undefined;
  return r?.learn_plan ? cleanLearnPlan(parseJson(r.learn_plan, {})) : null;
}

function levelOf(db: DatabaseSync, kid: Row, today: string) {
  return currentLevel(kid.grade as string | null, kid.grade_year as number | null, kid.birthdate as string | null, today);
}

/** Each skill's last few answers (a second try counts half), optionally only from before a date. */
function skillStats(db: DatabaseSync, memberId: string, before?: string): SkillStat[] {
  const rows = db.prepare(`SELECT skill, SUM(CASE result WHEN 'right' THEN 1.0 WHEN 'second' THEN 0.5 ELSE 0 END) AS right_n, COUNT(*) AS total FROM (
      SELECT skill, result, ROW_NUMBER() OVER (PARTITION BY skill ORDER BY id DESC) AS rn FROM learn_log WHERE member_id = ? ${before ? 'AND date < ?' : ''}
    ) WHERE rn <= ${RECENT} GROUP BY skill`).all(...(before ? [memberId, before] : [memberId])) as Row[];
  return rows.map((r) => ({ skill: r.skill as string, right: Number(r.right_n), total: Number(r.total) }));
}

/** Today's cards (and `extra` more for practice). Picked from what the kid knew before today, so they hold all day. */
function cardsFor(db: DatabaseSync, kid: Row, level: Level | null, plan: LearnPlan, today: string, count: number) {
  return pickCards(skillsFor(level, plan.subjectsOff), skillStats(db, kid.id as string, today), `${kid.id as string}|${today}`, count);
}

export function learnView(db: DatabaseSync, homeId: string, kid: Row, extra = 0) {
  const memberId = kid.id as string;
  const today = homeToday(homeInfo(db, homeId));
  const { level, auto } = levelOf(db, kid, today);
  const plan = learnPlanOf(db, memberId);
  const answered = new Map((db.prepare('SELECT card, result FROM learn_log WHERE member_id = ? AND date = ?').all(memberId, today) as Row[])
    .map((r) => [r.card as number, r.result as LearnResult]));
  const extraDone = [...answered.keys()].filter((c) => plan && c >= plan.perDay).length;
  const count = plan ? plan.perDay + Math.min(MAX_EXTRA, Math.max(extra, extraDone)) : 0;
  const cards = plan && level ? cardsFor(db, kid, level, plan, today, count).map((c, i) => ({ ...c, card: i, result: answered.get(i) ?? null, extra: i >= plan.perDay })) : [];
  const stats = skillStats(db, memberId);
  const byId = new Map(stats.map((s) => [s.skill, s]));
  const skills = skillsFor(level, plan?.subjectsOff ?? []).map((s) => {
    const st = byId.get(s.id);
    const acc = accuracy(st);
    return { id: s.id, label: s.label, subject: s.subject, area: s.area, total: st?.total ?? 0, pct: acc == null ? null : Math.round(acc * 100), got: mastered(st) };
  });
  const sum = (from: string) => db.prepare(`SELECT COUNT(*) AS n, SUM(result = 'right') AS r, COUNT(DISTINCT date) AS days FROM learn_log WHERE member_id = ? AND date >= ?`).get(memberId, from) as Row;
  const week = sum(addDays(today, -6));
  const daily = (db.prepare(`SELECT date, COUNT(*) AS n, SUM(result = 'right') AS r FROM learn_log WHERE member_id = ? AND date >= ? GROUP BY date ORDER BY date`)
    .all(memberId, addDays(today, -13)) as Row[]).map((r) => ({ date: r.date as string, answered: Number(r.n), right: Number(r.r) }));
  // By subject over the last month, from every level (a kid who moved up still sees last month's work).
  const bySubject = new Map<string, { answered: number; right: number }>();
  for (const r of db.prepare('SELECT skill, result FROM learn_log WHERE member_id = ? AND date >= ?').all(memberId, addDays(today, -29)) as Row[]) {
    const subject = skillById(r.skill as string)?.subject;
    if (!subject) continue;
    const cur = bySubject.get(subject) ?? { answered: 0, right: 0 };
    cur.answered++;
    if (r.result === 'right') cur.right++;
    bySubject.set(subject, cur);
  }
  const todays = cards.filter((c) => !c.extra);
  return {
    today, level, levelLabel: levelInfo(level)?.label ?? null, auto, pictures: readsFirst(level), plan, subjects: subjectsAt(level),
    cards, left: todays.filter((c) => !c.result).length, rightToday: todays.filter((c) => c.result === 'right').length,
    paidToday: (db.prepare('SELECT learn_paid_on FROM members WHERE id = ?').get(memberId) as Row).learn_paid_on === today,
    skills, gotCount: skills.filter((s) => s.got).length, mastered: MASTERED,
    practice: skills.filter((s) => s.total >= 3 && (s.pct ?? 100) < 60).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0)).slice(0, 6),
    week: { answered: Number(week.n ?? 0), right: Number(week.r ?? 0), days: Number(week.days ?? 0) },
    daily, bySubject: [...bySubject].map(([subject, v]) => ({ subject, ...v })),
  };
}
export type LearnView = ReturnType<typeof learnView>;

export function learningRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const kidFor = (ctx: HomeCtx, memberId: string) => {
    assertCanActFor(ctx, memberId);
    const kid = getKid(db, ctx, memberId);
    if (!isParent(ctx)) {
      if (ctx.actor.kind !== 'kid') throw new HttpError(403, 'Pick your raccoon first');
      if (!pageOn(db, memberId, 'learning')) throw new HttpError(403, 'Learning time is switched off');
    }
    return kid;
  };
  const today = (ctx: HomeCtx) => homeToday(homeInfo(db, ctx.homeId));
  const extraOf = (q: unknown) => Math.min(MAX_EXTRA, Math.max(0, Number((q as { extra?: string })?.extra) || 0));

  app.get('/api/homes/:homeId/kids/:memberId/learn', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    const kid = getKid(db, ctx, memberId);
    if (!isParent(ctx) && !pageOn(db, memberId, 'learning')) return null;
    return learnView(db, ctx.homeId, kid, extraOf(req.query));
  });

  // The plan: questions a day, points, subjects off, and the grade (null = by age). { off: true } turns it off.
  app.put('/api/homes/:homeId/kids/:memberId/learn/plan', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const b = (req.body ?? {}) as Row;
    if ('grade' in b) setGrade(db, kid.id as string, b.grade, today(ctx));
    const plan = b.off ? null : cleanLearnPlan(b, learnPlanOf(db, kid.id as string) ?? DEFAULT_LEARN_PLAN);
    db.prepare('UPDATE members SET learn_plan = ? WHERE id = ?').run(plan ? JSON.stringify(plan) : null, kid.id as string);
    return learnView(db, ctx.homeId, getKid(db, ctx, kid.id as string));
  });

  // One card answered: right the first time, right on the second try, or not yet. The first answer to a card is the one
  // that counts. Finishing today's cards pays the day's points, once.
  app.post('/api/homes/:homeId/kids/:memberId/learn/answer', async (req) => {
    const ctx = homeCtx(db, req);
    const kid = kidFor(ctx, (req.params as { memberId: string }).memberId);
    const b = (req.body ?? {}) as Row;
    const result = String(b.result) as LearnResult;
    if (!['right', 'second', 'wrong'].includes(result)) throw new HttpError(400, 'Right, second or wrong');
    const plan = learnPlanOf(db, kid.id as string);
    if (!plan) throw new HttpError(400, 'Learning time isn\'t set up yet');
    const card = Number(b.card);
    if (!Number.isInteger(card) || card < 0 || card >= plan.perDay + MAX_EXTRA) throw new HttpError(400, 'That card looks wrong');
    const t = today(ctx);
    const { level } = levelOf(db, kid, t);
    const want = cardsFor(db, kid, level, plan, t, card + 1)[card];
    if (!want || want.skill !== b.skill) throw new HttpError(400, 'That card isn\'t one of today\'s');
    let paid = 0;
    tx(db, () => {
      db.prepare('INSERT OR IGNORE INTO learn_log (home_id, member_id, date, card, level, skill, result) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(ctx.homeId, kid.id as string, t, card, level, want.skill, result);
      const m = db.prepare('SELECT learn_paid_on FROM members WHERE id = ?').get(kid.id as string) as Row;
      const done = (db.prepare('SELECT COUNT(*) AS n FROM learn_log WHERE member_id = ? AND date = ? AND card < ?').get(kid.id as string, t, plan.perDay) as Row).n as number;
      if (!plan.points || m.learn_paid_on === t || done < plan.perDay) return;
      writeLedger(db, { homeId: ctx.homeId, memberId: kid.id as string, amount: plan.points, kind: 'bonus', reason: '🎓 Learning time', date: t,
        by: isParent(ctx) ? { userId: ctx.user?.id ?? null, name: ctx.user?.name ?? 'Parent' } : { userId: null, name: '✨ Auto-approved' } });
      db.prepare('UPDATE members SET learn_paid_on = ? WHERE id = ?').run(t, kid.id as string);
      paid = plan.points;
    });
    return { paid };
  });
}
