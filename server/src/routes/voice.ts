// Voice: short spoken answers for Home Assistant Assist (or Alexa / Google through Home Assistant).
// "What are Ava's chores?" → "Ava has 3 chores left: dishes, trash and feed the cat."
// GET /ha/say answers questions with a read token; POST /ha/say/done marks a chore done with a control token.
// Sentences are short and plain so a speaker reads them well. See docs/voice.md for the Home Assistant side.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx, type HomeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, requireStr } from '../util.ts';
import { goalsFor, homeInfo, homeToday, kidWeek, submitInstance, todayList, type AgendaItem } from '../chores.ts';
import { streaks } from '../progress.ts';
import { listKids } from './homes.ts';
import { kidHabits } from './habits.ts';
import { awayToday } from '../away.ts';
import { findList, listsOf } from './lists.ts';

export const VOICE_TOPICS = ['chores', 'next', 'points', 'goal', 'streak', 'practice', 'everyone', 'list'] as const;
type Topic = (typeof VOICE_TOPICS)[number];

/** "a", "a and b", "a, b and c". */
export function spokenList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Emoji don't read aloud well; drop them. */
const clean = (s: string) => s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();

function findKid(db: DatabaseSync, homeId: string, v: unknown) {
  const key = requireStr(v, 'Kid', 60).trim();
  const kids = listKids(db, homeId);
  const k = kids.find((x) => x.id === key) ?? kids.find((x) => x.name.toLowerCase() === key.toLowerCase())
    // Assist often hears a first name or a nickname start ("Ava" for "Avaleigh").
    ?? kids.find((x) => x.name.toLowerCase().startsWith(key.toLowerCase()));
  if (!k) throw new HttpError(404, `I don't know anyone called ${key}`);
  return k;
}

/** The chore someone said, matched loosely: exact, then starts with, then contains. */
export function matchChore(items: AgendaItem[], said: string): AgendaItem | null {
  const s = clean(said).toLowerCase().replace(/^(the|my) /, '');
  const t = (i: AgendaItem) => clean(i.title).toLowerCase();
  return items.find((i) => t(i) === s) ?? items.find((i) => t(i).startsWith(s)) ?? items.find((i) => t(i).includes(s) || s.includes(t(i))) ?? null;
}

export function sayFor(db: DatabaseSync, ctx: HomeCtx, kidKey: unknown, about: Topic, listName = ''): string {
  const home = homeInfo(db, ctx.homeId);
  const today = homeToday(home);
  const pts = home.pointsName;
  if (about === 'list') {
    const l = findList(db, ctx.homeId, listName);
    if (!l) return listName ? `I couldn't find a list called ${listName}.` : 'There are no lists yet.';
    const open = listsOf(db, ctx.homeId).find((x) => x.id === l.id)!.items.filter((i) => !i.done).map((i) => clean(i.text));
    return open.length ? `On the ${l.name} list: ${spokenList(open.slice(0, 12))}${open.length > 12 ? `, and ${open.length - 12} more` : ''}.` : `The ${l.name} list is empty.`;
  }
  if (about === 'everyone') {
    const lines = listKids(db, ctx.homeId).filter((k) => !k.pagesOff.includes('chores')).map((k) => {
      const left = todayList(db, ctx.homeId, k.id, today).filter((i) => i.status === 'pending' || i.status === 'rejected').length;
      return left ? `${k.name} has ${plural(left, 'chore')} left` : `${k.name} is all done`;
    });
    return lines.length ? `${lines.join('. ')}.` : 'There are no chores today.';
  }
  const k = findKid(db, ctx.homeId, kidKey);
  const off = new Set(k.pagesOff);
  switch (about) {
    case 'chores':
    case 'next': {
      if (off.has('chores')) return `${k.name} has no chores in Den Duty.`;
      const away = awayToday(db, k.id, today);
      if (away) return `${k.name} is ${away.label.replace(/^At /, 'at ')} today, so no chores here.`;
      const items = todayList(db, ctx.homeId, k.id, today);
      const left = items.filter((i) => i.status === 'pending' || i.status === 'rejected');
      const waiting = items.filter((i) => i.status === 'submitted').length;
      if (!items.length) return `${k.name} has no chores today.`;
      if (!left.length) return `${k.name} is all done for today!${waiting ? ` ${plural(waiting, 'chore is', 'chores are')} waiting for a grown-up.` : ''}`;
      if (about === 'next') {
        const n = left.find((i) => i.dueTime) ?? left[0];
        return `Next up for ${k.name}: ${clean(n.title)}${n.dueTime ? `, by ${n.dueTime}` : ''}.`;
      }
      return `${k.name} has ${plural(left.length, 'chore')} left: ${spokenList(left.map((i) => clean(i.title)))}.`;
    }
    case 'points': {
      const w = kidWeek(db, home, k.id, today);
      return `${k.name} has ${w.balance} ${pts}, and earned ${w.pointsThisWeek} this week.`;
    }
    case 'goal': {
      if (off.has('goals')) return `${k.name} has no goals in Den Duty.`;
      const g = goalsFor(db, k.id).find((x) => !x.reached) ?? goalsFor(db, k.id)[0];
      if (!g) return `${k.name} doesn't have a goal yet.`;
      return g.reached ? `${k.name} reached ${clean(g.title)}! Time to ask a grown-up.` : `${k.name} needs ${g.targetPoints - g.progress} more ${pts} for ${clean(g.title)}.`;
    }
    case 'streak': {
      const s = streaks(db, k.id, today);
      return s.current ? `${k.name} is on a ${s.current} day streak. The best is ${s.best}.` : `${k.name} doesn't have a streak going right now. Today is a great day to start one!`;
    }
    case 'practice': {
      if (off.has('habits')) return `${k.name} has no practice in Den Duty.`;
      const hs = kidHabits(db, ctx.homeId, k.id);
      if (!hs.length) return `${k.name} has no practice set up.`;
      return hs.map((h) => `${clean(h.title)}: ${h.week.doneDays} of ${h.targetDays} days${h.today ? ', done today' : ''}`).join('. ') + '.';
    }
  }
  return '';
}

export function voiceRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/ha/say', async (req) => {
    const ctx = homeCtx(db, req);
    if (ctx.actor.kind !== 'token' && ctx.actor.kind !== 'parent') throw new HttpError(403, 'For Home Assistant tokens and parents');
    const q = req.query as { kid?: string; about?: string; list?: string };
    const about = (VOICE_TOPICS as readonly string[]).includes(q.about ?? '') ? q.about as Topic : q.kid ? 'chores' : 'everyone';
    try {
      return { speech: sayFor(db, ctx, q.kid, about, q.list ?? ''), about };
    } catch (err) {
      // Speak the problem rather than failing: Assist reads it out.
      if (err instanceof HttpError && err.status < 500) return { speech: err.message.endsWith('.') ? err.message : `${err.message}.`, about, error: true };
      throw err;
    }
  });

  // "Ava finished the dishes": marks it done (waits for a grown-up like a tap on the tablet would).
  app.post('/api/homes/:homeId/ha/say/done', async (req) => {
    const ctx = homeCtx(db, req);
    if (!(ctx.actor.kind === 'parent' || (ctx.actor.kind === 'token' && ctx.actor.scope === 'control'))) {
      throw new HttpError(403, 'This needs a control token (Settings → Home Assistant)');
    }
    const b = (req.body ?? {}) as Row;
    try {
      const k = findKid(db, ctx.homeId, b.kid);
      const today = homeToday(homeInfo(db, ctx.homeId));
      const open = todayList(db, ctx.homeId, k.id, today).filter((i) => i.status === 'pending' || i.status === 'rejected');
      const item = matchChore(open, requireStr(b.chore, 'Chore', 80));
      if (!item) return { speech: `I couldn't find ${clean(String(b.chore))} on ${k.name}'s list. ${open.length ? `Left today: ${spokenList(open.map((i) => clean(i.title)))}.` : 'Everything is done!'}`, error: true };
      const done = submitInstance(db, ctx.homeId, item.id!, today);
      const left = open.length - 1;
      return {
        speech: `${done.status === 'approved' ? 'Done!' : 'Nice work!'} ${clean(item.title)} is ${done.status === 'approved' ? 'checked off' : 'waiting for a grown-up'}. ${left ? `${plural(left, 'chore')} to go.` : 'That was the last one!'}`,
        status: done.status,
      };
    } catch (err) {
      if (err instanceof HttpError && err.status < 500) return { speech: err.message.endsWith('.') || err.message.endsWith('!') ? err.message : `${err.message}.`, error: true };
      throw err;
    }
  });
}
