// New words (Doctors → Speech): a list of words a kid is learning to say. A grown-up taps a word each time they hear
// it, and milestones ("say it 10 times: 5 points") pay the kid through the points ledger. Parents only; a speech
// therapist sees the list on the visit summary and on share links that include it.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, num, parseJson, requireStr, str } from '../util.ts';
import { homeInfo, homeToday, writeLedger } from '../chores.ts';
import { byOf } from './chores.ts';
import { doctorAreasOff, getKid, pageOn } from './homes.ts';
import { isIsoDate } from '../../../shared/schedule.ts';

export interface Milestone { times: number; points: number }

/** What a kid starts with until a parent changes it. */
export const DEFAULT_WORD_MILESTONES: Milestone[] = [{ times: 5, points: 2 }, { times: 10, points: 5 }, { times: 25, points: 10 }];

/** Milestones from a form: up to 10, each "said N times (1-1000) pays P points (0-1000)", sorted, one per N. */
export function cleanMilestones(v: unknown): Milestone[] {
  if (!Array.isArray(v)) throw new HttpError(400, 'Milestones are a list');
  if (v.length > 10) throw new HttpError(400, 'Up to 10 milestones');
  const out = new Map<number, number>();
  for (const x of v) {
    const o = (x ?? {}) as Row;
    const times = num(o.times);
    const points = num(o.points ?? 0);
    if (times == null || !Number.isInteger(times) || times < 1 || times > 1000) throw new HttpError(400, 'A milestone is said 1 to 1000 times');
    if (points == null || !Number.isInteger(points) || points < 0 || points > 1000) throw new HttpError(400, 'Milestone points are a whole number from 0 to 1000');
    if (out.has(times)) throw new HttpError(400, `There are two milestones for ${times} times`);
    out.set(times, points);
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([times, points]) => ({ times, points }));
}

/** The kid's milestones (the defaults until a parent sets them). */
export function kidMilestones(db: DatabaseSync, memberId: string): Milestone[] {
  const m = db.prepare('SELECT word_milestones FROM members WHERE id = ?').get(memberId) as Row | undefined;
  return m?.word_milestones ? parseJson<Milestone[]>(m.word_milestones, DEFAULT_WORD_MILESTONES) : DEFAULT_WORD_MILESTONES;
}

const wordMilestones = (w: Row, kidDefault: Milestone[]): Milestone[] => w.milestones ? parseJson<Milestone[]>(w.milestones, kidDefault) : kidDefault;

/** Doctors on and the Speech section on for this kid. */
function speechKid(db: DatabaseSync, ctx: HomeCtx, memberId: string): Row {
  const kid = getKid(db, ctx, memberId);
  if (!pageOn(db, kid.id as string, 'doctors')) throw new HttpError(403, `Doctors is turned off for ${kid.name}. Turn it on in Kids → Edit.`);
  if (doctorAreasOff(db, kid.id as string).includes('speech')) throw new HttpError(403, `Speech is turned off for ${kid.name}. Turn it on in Kids → Edit.`);
  return kid;
}

function ownWord(db: DatabaseSync, ctx: HomeCtx, id: string): Row {
  const w = db.prepare('SELECT * FROM speech_words WHERE id = ? AND home_id = ?').get(id, ctx.homeId) as Row | undefined;
  if (!w) throw new HttpError(404, 'That word is gone');
  speechKid(db, ctx, w.member_id as string);
  return w;
}

export function wordView(db: DatabaseSync, w: Row, kidDefault: Milestone[]) {
  const stats = db.prepare('SELECT COUNT(*) AS n, MAX(date) AS last, COALESCE(SUM(awarded), 0) AS pts FROM speech_word_says WHERE word_id = ?').get(w.id as string) as Row;
  const count = stats.n as number;
  const milestones = wordMilestones(w, kidDefault);
  const next = milestones.find((m) => m.times > count) ?? null;
  return {
    id: w.id as string, word: w.word as string, note: (w.note as string | null) ?? null, addedOn: w.added_on as string,
    count, lastSaid: (stats.last as string | null) ?? null, pointsEarned: stats.pts as number,
    ownMilestones: !!w.milestones, milestones, next,
    /** Said as often as the last milestone asks. */
    mastered: milestones.length > 0 && !next,
  };
}

/** Says per word per day, for the charts. */
function dailySays(db: DatabaseSync, memberId: string, from: string) {
  return (db.prepare('SELECT date, COUNT(*) AS n FROM speech_word_says WHERE member_id = ? AND date >= ? GROUP BY date ORDER BY date').all(memberId, from) as Row[])
    .map((r) => ({ date: r.date as string, count: r.n as number }));
}

/** The words part of the visit summary / share link: every word, with how often it was said in the period. */
export function wordsSummary(db: DatabaseSync, memberId: string, from: string, to: string) {
  if (doctorAreasOff(db, memberId).includes('speech')) return null;
  const rows = db.prepare(`SELECT w.word, w.added_on, w.note,
      (SELECT COUNT(*) FROM speech_word_says s WHERE s.word_id = w.id AND s.date <= ?) AS total,
      (SELECT COUNT(*) FROM speech_word_says s WHERE s.word_id = w.id AND s.date BETWEEN ? AND ?) AS in_range,
      (SELECT MAX(date) FROM speech_word_says s WHERE s.word_id = w.id AND s.date <= ?) AS last
    FROM speech_words w WHERE w.member_id = ? AND w.added_on <= ? ORDER BY w.added_on, lower(w.word)`).all(to, from, to, to, memberId, to) as Row[];
  if (!rows.length) return null;
  return {
    total: rows.length,
    newInRange: rows.filter((r) => (r.added_on as string) >= from).length,
    saysInRange: rows.reduce((a, r) => a + (r.in_range as number), 0),
    words: rows.map((r) => ({
      word: r.word as string, addedOn: r.added_on as string, note: (r.note as string | null) ?? null,
      total: r.total as number, inRange: r.in_range as number, lastSaid: (r.last as string | null) ?? null,
    })),
  };
}

/** The ledger reason a kid sees. Like therapy goals, only a kid whose Doctors is shared with them sees the word. */
function rewardReason(db: DatabaseSync, memberId: string, word: string, times: number): string {
  const shared = !!(db.prepare('SELECT therapy_kid_visible FROM members WHERE id = ?').get(memberId) as Row).therapy_kid_visible;
  return shared ? `🗣️ You said “${word}” ${times} time${times === 1 ? '' : 's'}!` : '🗣️ Great talking!';
}

export function wordRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const kidParam = (req: FastifyRequest) => (req.params as { memberId: string }).memberId;
  const today = (homeId: string) => homeToday(homeInfo(db, homeId));

  app.get('/api/homes/:homeId/kids/:memberId/words', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = speechKid(db, ctx, kidParam(req));
    const id = kid.id as string;
    const def = kidMilestones(db, id);
    const words = (db.prepare('SELECT * FROM speech_words WHERE member_id = ? ORDER BY created_at DESC').all(id) as Row[]).map((w) => wordView(db, w, def));
    const t = today(ctx.homeId);
    // The last 13 weeks for the charts.
    const from = new Date(Date.parse(`${t}T00:00:00Z`) - 90 * 864e5).toISOString().slice(0, 10);
    return { today: t, milestones: def, custom: !!kid.word_milestones, words, says: dailySays(db, id, from) };
  });

  // The kid's milestones, used by every word that doesn't have its own. null goes back to the defaults.
  app.put('/api/homes/:homeId/kids/:memberId/words/milestones', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = speechKid(db, ctx, kidParam(req));
    const v = (req.body as Row | undefined)?.milestones;
    db.prepare('UPDATE members SET word_milestones = ? WHERE id = ?').run(v == null ? null : JSON.stringify(cleanMilestones(v)), kid.id as string);
    return { milestones: kidMilestones(db, kid.id as string) };
  });

  // A new word. saidNow (the default) counts the first time, since you usually add a word right after hearing it.
  app.post('/api/homes/:homeId/kids/:memberId/words', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = speechKid(db, ctx, kidParam(req));
    const b = (req.body ?? {}) as Row;
    const word = requireStr(b.word, 'Word', 60);
    const t = today(ctx.homeId);
    const addedOn = b.addedOn == null || b.addedOn === '' ? t : b.addedOn;
    if (!isIsoDate(addedOn)) throw new HttpError(400, 'Dates look like 2026-11-01');
    if (addedOn > t) throw new HttpError(400, "That day hasn't happened yet");
    if (db.prepare('SELECT 1 FROM speech_words WHERE member_id = ? AND lower(word) = lower(?)').get(kid.id as string, word)) {
      throw new HttpError(400, `“${word}” is already on ${kid.name}'s list`);
    }
    const own = b.milestones == null ? null : JSON.stringify(cleanMilestones(b.milestones));
    const id = newId();
    let awarded = 0;
    tx(db, () => {
      db.prepare('INSERT INTO speech_words (id, home_id, member_id, word, note, milestones, added_on, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, ctx.homeId, kid.id as string, word, str(b.note, 300), own, addedOn as string, ctx.user?.id ?? null);
      if (b.saidNow !== false) awarded = say(ctx, db.prepare('SELECT * FROM speech_words WHERE id = ?').get(id) as Row, addedOn as string).awarded;
    });
    return { ...wordView(db, ownWord(db, ctx, id), kidMilestones(db, kid.id as string)), awarded };
  });

  app.patch('/api/homes/:homeId/words/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const w = ownWord(db, ctx, (req.params as { id: string }).id);
    const b = (req.body ?? {}) as Row;
    if ('word' in b) {
      const word = requireStr(b.word, 'Word', 60);
      if (db.prepare('SELECT 1 FROM speech_words WHERE member_id = ? AND lower(word) = lower(?) AND id != ?').get(w.member_id as string, word, w.id as string)) {
        throw new HttpError(400, `“${word}” is already on the list`);
      }
      db.prepare('UPDATE speech_words SET word = ? WHERE id = ?').run(word, w.id as string);
    }
    if ('note' in b) db.prepare('UPDATE speech_words SET note = ? WHERE id = ?').run(str(b.note, 300), w.id as string);
    if ('addedOn' in b) {
      if (!isIsoDate(b.addedOn) || b.addedOn > today(ctx.homeId)) throw new HttpError(400, 'Pick a day, today or earlier');
      db.prepare('UPDATE speech_words SET added_on = ? WHERE id = ?').run(b.addedOn, w.id as string);
    }
    // Its own milestones, or null to use the kid's. Changing them never pays or takes back points already given.
    if ('milestones' in b) db.prepare('UPDATE speech_words SET milestones = ? WHERE id = ?').run(b.milestones == null ? null : JSON.stringify(cleanMilestones(b.milestones)), w.id as string);
    return wordView(db, ownWord(db, ctx, w.id as string), kidMilestones(db, w.member_id as string));
  });

  // Points already paid for a word stay with the kid.
  app.delete('/api/homes/:homeId/words/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM speech_words WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  /** One more time heard. Pays a milestone when the count lands on it. */
  function say(ctx: HomeCtx, w: Row, date: string): { count: number; awarded: number; milestone: Milestone | null } {
    const count = ((db.prepare('SELECT COUNT(*) AS n FROM speech_word_says WHERE word_id = ?').get(w.id as string) as Row).n as number) + 1;
    const hit = wordMilestones(w, kidMilestones(db, w.member_id as string)).find((m) => m.times === count) ?? null;
    const awarded = hit?.points ?? 0;
    db.prepare('INSERT INTO speech_word_says (id, home_id, member_id, word_id, date, awarded, by_name) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), ctx.homeId, w.member_id as string, w.id as string, date, awarded, ctx.user?.name ?? null);
    if (awarded > 0) {
      writeLedger(db, {
        homeId: ctx.homeId, memberId: w.member_id as string, amount: awarded, kind: 'bonus',
        reason: rewardReason(db, w.member_id as string, w.word as string, count), date: today(ctx.homeId), by: byOf(ctx),
      });
    }
    return { count, awarded, milestone: hit };
  }

  app.post('/api/homes/:homeId/words/:id/say', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const w = ownWord(db, ctx, (req.params as { id: string }).id);
    const r = tx(db, () => say(ctx, w, today(ctx.homeId)));
    return { ...r, word: wordView(db, w, kidMilestones(db, w.member_id as string)) };
  });

  // Undo the last tap (a mis-tap). If that tap paid a milestone, the points come back off with a reversal.
  app.delete('/api/homes/:homeId/words/:id/say', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const w = ownWord(db, ctx, (req.params as { id: string }).id);
    const last = db.prepare('SELECT * FROM speech_word_says WHERE word_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(w.id as string) as Row | undefined;
    if (!last) throw new HttpError(400, 'Nothing to undo');
    tx(db, () => {
      db.prepare('DELETE FROM speech_word_says WHERE id = ?').run(last.id as string);
      if ((last.awarded as number) > 0) {
        writeLedger(db, {
          homeId: ctx.homeId, memberId: w.member_id as string, amount: -(last.awarded as number), kind: 'reversal',
          reason: 'Word count undone', date: today(ctx.homeId), by: byOf(ctx),
        });
      }
    });
    return { reversed: last.awarded as number, word: wordView(db, w, kidMilestones(db, w.member_id as string)) };
  });
}
