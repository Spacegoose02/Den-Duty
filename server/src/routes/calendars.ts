import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, newId, requireStr, str } from '../util.ts';
import { homeInfo } from '../chores.ts';
import { calendarFor, calendarToken, refreshFeed } from '../calendar.ts';
import { getKid, listKids } from './homes.ts';

const KINDS = ['lunch', 'meals', 'school', 'other'] as const;

const feedView = (r: Row) => ({
  id: r.id as string, name: r.name as string, url: r.url as string, kind: r.kind as string, showKids: !!r.show_kids,
  events: (JSON.parse(r.events as string) as unknown[]).length, fetchedAt: r.fetched_at as string | null, error: r.error as string | null,
});

export function calendarRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // The secret subscription link. Anyone with it can read the calendar, so parents can reset it.
  app.get('/api/calendar/:file', async (req, reply) => {
    const token = (req.params as { file: string }).file.replace(/\.ics$/, '');
    const ics = token.length >= 20 ? calendarFor(db, token) : null;
    if (!ics) throw new HttpError(404, 'No calendar here (the link may have been reset)');
    return reply.type('text/calendar; charset=utf-8').header('cache-control', 'private, max-age=900').send(ics);
  });

  app.get('/api/homes/:homeId/calendars', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const path = (t: string) => `/api/calendar/${t}.ics`;
    return {
      home: path(calendarToken(db, { homeId: ctx.homeId })),
      kids: listKids(db, ctx.homeId).map((k) => ({ id: k.id, name: k.name, avatar: k.avatar, url: path(calendarToken(db, { memberId: k.id })) })),
      feeds: (db.prepare('SELECT * FROM calendar_feeds WHERE home_id = ? ORDER BY created_at').all(ctx.homeId) as Row[]).map(feedView),
    };
  });

  app.post('/api/homes/:homeId/calendars/reset', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kidId = str((req.body as Row)?.kidId, 60);
    const token = kidId
      ? calendarToken(db, { memberId: getKid(db, ctx, kidId).id as string }, true)
      : calendarToken(db, { homeId: ctx.homeId }, true);
    return { url: `/api/calendar/${token}.ics` };
  });

  app.post('/api/homes/:homeId/calendar-feeds', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    const url = requireStr(b.url, 'Feed address', 1000);
    if (!/^(https?|webcal):\/\//i.test(url)) throw new HttpError(400, 'Paste an ICS address starting with https://, http:// or webcal://');
    const kind = (KINDS as readonly unknown[]).includes(b.kind) ? b.kind as string : 'other';
    const count = (db.prepare('SELECT COUNT(*) AS n FROM calendar_feeds WHERE home_id = ?').get(ctx.homeId) as Row).n as number;
    if (count >= 20) throw new HttpError(400, '20 feeds is the limit');
    const id = newId();
    db.prepare('INSERT INTO calendar_feeds (id, home_id, name, url, kind, show_kids) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, ctx.homeId, str(b.name, 60) ?? (kind === 'lunch' ? 'School lunch' : kind === 'meals' ? 'Meal plan' : 'Calendar'), url, kind, b.showKids === false ? 0 : 1);
    await refreshFeed(db, id, homeInfo(db, ctx.homeId));
    return feedView(db.prepare('SELECT * FROM calendar_feeds WHERE id = ?').get(id) as Row);
  });

  app.patch('/api/homes/:homeId/calendar-feeds/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as Row;
    if (typeof b.showKids === 'boolean') db.prepare('UPDATE calendar_feeds SET show_kids = ? WHERE id = ? AND home_id = ?').run(b.showKids ? 1 : 0, id, ctx.homeId);
    const name = str(b.name, 60);
    if (name) db.prepare('UPDATE calendar_feeds SET name = ? WHERE id = ? AND home_id = ?').run(name, id, ctx.homeId);
    const r = db.prepare('SELECT * FROM calendar_feeds WHERE id = ? AND home_id = ?').get(id, ctx.homeId) as Row | undefined;
    if (!r) throw new HttpError(404, 'That feed is gone');
    return feedView(r);
  });

  app.post('/api/homes/:homeId/calendar-feeds/:id/refresh', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const { id } = req.params as { id: string };
    if (!db.prepare('SELECT 1 FROM calendar_feeds WHERE id = ? AND home_id = ?').get(id, ctx.homeId)) throw new HttpError(404, 'That feed is gone');
    await refreshFeed(db, id, homeInfo(db, ctx.homeId));
    return feedView(db.prepare('SELECT * FROM calendar_feeds WHERE id = ?').get(id) as Row);
  });

  app.delete('/api/homes/:homeId/calendar-feeds/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM calendar_feeds WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });
}
