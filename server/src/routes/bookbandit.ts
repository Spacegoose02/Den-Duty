// BookBandit link: BookBandit is the family's book library and reader. With a control token it reports, every few
// minutes, how long each linked kid has read today (POST /api/v1/homes/:homeId/reading/report):
//   - the minutes go into the kid's Reading practice (a habit picked on BookBandit's side), with the same rules as a
//     kid's "I did it!": it waits for a grown-up unless the practice is trusted, and pays its points once a day;
//   - each book a kid finishes can pay a "Finished a book" bonus (Settings → BookBandit), once per book.
// BookBandit sends its running total for the day each time. It is kept apart from the kid's own taps
// (habit_logs.external_minutes), so a repeated report only adds what's new.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, num, str } from '../util.ts';
import { homeInfo, homeToday, writeLedger } from '../chores.ts';
import { emit } from '../events.ts';
import { pageOn } from './homes.ts';
import { byOf } from './chores.ts';
import { approveLog } from './habits.ts';
import { v1Path } from './v1.ts';
import { addDays, isIsoDate } from '../../../shared/schedule.ts';

/** How far back a report may log: BookBandit can catch up on a week of reading done offline. */
export const READING_REPORT_DAYS = 7;

export interface BookBonus { points: number; needsOk: boolean }

export function bookBonus(db: DatabaseSync, homeId: string): BookBonus {
  const h = db.prepare('SELECT book_bonus, book_bonus_needs_ok FROM homes WHERE id = ?').get(homeId) as Row | undefined;
  return { points: (h?.book_bonus as number | undefined) ?? 0, needsOk: !!(h?.book_bonus_needs_ok ?? 1) };
}

const bookReason = (title: string | null) => (title ? `📕 Finished “${title}”` : '📕 Finished a book');

interface KidReport { kidId: string; minutes: number; habitPaid: number; finishedPaid: number }

/** Logs one kid's reading for one day. Null when the kid, habit or date doesn't fit (skipped, not an error). */
function reportKid(db: DatabaseSync, ctx: HomeCtx, today: string, raw: unknown): KidReport | null {
  const r = (raw ?? {}) as { kidId?: unknown; habitId?: unknown; date?: unknown; minutes?: unknown; finished?: unknown };
  const kidId = String(r.kidId ?? '');
  const h = db.prepare(`SELECT h.* FROM habits h JOIN members m ON m.id = h.member_id
    WHERE h.id = ? AND h.home_id = ? AND h.member_id = ? AND h.active = 1 AND m.role = 'kid'`).get(String(r.habitId ?? ''), ctx.homeId, kidId) as Row | undefined;
  if (!h) return null;
  // Practice switched off for this kid: BookBandit can't log into it either.
  if (!pageOn(db, kidId, 'habits')) return null;
  const date = String(r.date ?? '');
  if (!isIsoDate(date) || date > today || date < addDays(today, 1 - READING_REPORT_DAYS)) return null;
  const minutes = Math.max(0, Math.min(24 * 60, Math.round(Number(r.minutes) || 0)));
  const by = byOf(ctx);
  const out: KidReport = { kidId, minutes: 0, habitPaid: 0, finishedPaid: 0 };

  const cur = db.prepare('SELECT * FROM habit_logs WHERE habit_id = ? AND date = ?').get(h.id as string, date) as Row | undefined;
  const before = (cur?.external_minutes as number | undefined) ?? 0;
  const add = Math.max(0, minutes - before);
  out.minutes = Math.max(minutes, before);
  if (add > 0) {
    const trusted = !h.needs_ok;
    let id = cur?.id as string | undefined;
    if (cur) {
      // Like a kid practicing again: approved stays approved, anything else (a "try again" too) waits; trusted approves below.
      db.prepare('UPDATE habit_logs SET minutes = minutes + ?, external_minutes = ?, status = ? WHERE id = ?')
        .run(add, minutes, cur.status === 'approved' ? 'approved' : 'waiting', id!);
    } else {
      id = newId();
      db.prepare(`INSERT INTO habit_logs (id, home_id, habit_id, member_id, date, minutes, external_minutes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting')`).run(id, ctx.homeId, h.id as string, kidId, date, add, minutes);
    }
    const log = db.prepare('SELECT * FROM habit_logs WHERE id = ?').get(id!) as Row;
    if (trusted && (log.status !== 'approved' || !log.paid)) out.habitPaid = approveLog(db, ctx.homeId, log, by);
    const now = (db.prepare('SELECT status FROM habit_logs WHERE id = ?').get(id!) as Row).status as string;
    // Only a change is news: BookBandit reports every few minutes, and parents shouldn't be buzzed each time.
    if (now !== cur?.status) {
      emit(db, ctx.homeId, 'habit_logged', kidId, { habit: h.title, icon: h.icon, minutes: add, waiting: now === 'waiting', habit_id: h.id, by: by.name });
    }
  }

  const bonus = bookBonus(db, ctx.homeId);
  if (bonus.points > 0) {
    for (const f of Array.isArray(r.finished) ? r.finished.slice(0, 20) : []) {
      const bookId = String((f as { id?: unknown })?.id ?? '').trim().slice(0, 200);
      if (!bookId) continue;
      const title = str((f as { title?: unknown })?.title, 120);
      const fid = newId();
      const status = bonus.needsOk ? 'waiting' : 'approved';
      const added = db.prepare(`INSERT INTO finished_books (id, home_id, member_id, book_id, title, date, points, status, reviewed_at, reviewed_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${bonus.needsOk ? 'NULL' : "datetime('now')"}, ?) ON CONFLICT(member_id, book_id) DO NOTHING`)
        .run(fid, ctx.homeId, kidId, bookId, title, date, bonus.points, status, bonus.needsOk ? null : by.name);
      if (!added.changes || bonus.needsOk) continue;
      writeLedger(db, { homeId: ctx.homeId, memberId: kidId, amount: bonus.points, kind: 'bonus', reason: bookReason(title), date, by });
      out.finishedPaid += bonus.points;
    }
  }
  return out;
}

export function bookbanditRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.post(v1Path('/homes/:homeId/reading/report'), { config: { v1: 'control' } }, async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as { kids?: unknown };
    if (b.kids != null && !Array.isArray(b.kids)) throw new HttpError(400, 'kids is a list');
    const today = homeToday(homeInfo(db, ctx.homeId));
    const kids = tx(db, () => (b.kids as unknown[] | undefined ?? []).slice(0, 50).flatMap((k) => reportKid(db, ctx, today, k) ?? []));
    return { ok: true, kids };
  });

  // Settings → BookBandit: the "Finished a book" bonus.
  app.get('/api/homes/:homeId/bookbandit', async (req) => bookBonus(db, homeCtx(db, req, 'parent').homeId));

  app.put('/api/homes/:homeId/bookbandit', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    if ('points' in b) {
      const p = num(b.points) ?? 0;
      if (!Number.isInteger(p) || p < 0 || p > 1000) throw new HttpError(400, 'Points are 0 to 1000');
      db.prepare('UPDATE homes SET book_bonus = ? WHERE id = ?').run(p, ctx.homeId);
    }
    if ('needsOk' in b) db.prepare('UPDATE homes SET book_bonus_needs_ok = ? WHERE id = ?').run(b.needsOk ? 1 : 0, ctx.homeId);
    return bookBonus(db, ctx.homeId);
  });

  // A finished book waiting for a grown-up (it shows on the parent home's practice card).
  const waitingBook = (ctx: HomeCtx, id: string) => {
    const r = db.prepare("SELECT * FROM finished_books WHERE id = ? AND home_id = ? AND status = 'waiting'").get(id, ctx.homeId) as Row | undefined;
    if (!r) throw new HttpError(404, 'That book is gone');
    return r;
  };

  app.post('/api/homes/:homeId/finished-books/:id/approve', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const r = waitingBook(ctx, (req.params as { id: string }).id);
    const by = byOf(ctx);
    return {
      paid: tx(db, () => {
        db.prepare("UPDATE finished_books SET status = 'approved', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?").run(by.name, r.id as string);
        const pts = r.points as number;
        if (pts > 0) writeLedger(db, { homeId: ctx.homeId, memberId: r.member_id as string, amount: pts, kind: 'bonus', reason: bookReason(r.title as string | null), date: r.date as string, by });
        return pts;
      }),
    };
  });

  // "Not yet": no bonus for this book. BookBandit reporting it again doesn't bring it back.
  app.post('/api/homes/:homeId/finished-books/:id/reject', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const r = waitingBook(ctx, (req.params as { id: string }).id);
    db.prepare("UPDATE finished_books SET status = 'rejected', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?").run(byOf(ctx).name, r.id as string);
    return { ok: true };
  });
}
