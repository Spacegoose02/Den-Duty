// Family events: add, edit and delete, and "snap to calendar" (a photo of a flyer or pasted text → drafts to check).
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx, isParent } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, str } from '../util.ts';
import { homeInfo, homeToday } from '../chores.ts';
import { decodePhoto } from '../photos.ts';
import { snapEvents } from '../ai.ts';
import { addDays } from '../../../shared/schedule.ts';
import { deleteEvent, eventInput, eventsBetween, getEvent, insertEvent, updateEvent } from '../familyevents.ts';
import { syncSoon } from '../calsync.ts';

/** Events mirrored from a linked calendar are changed there (the next sync brings the change here). */
function readOnly(db: DatabaseSync, e: { accountId: string | null }) {
  if (!e.accountId) return;
  const a = db.prepare('SELECT name FROM calendar_accounts WHERE id = ?').get(e.accountId) as Row | undefined;
  throw new HttpError(400, `This one comes from ${a?.name ?? 'a linked calendar'}. Change it there and it updates here.`);
}

const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export function eventRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/events', async (req) => {
    const ctx = homeCtx(db, req);
    const today = homeToday(homeInfo(db, ctx.homeId));
    const q = req.query as { from?: string; to?: string };
    const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : today;
    const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : addDays(from, 60);
    const kid = ctx.actor.kind === 'kid' ? ctx.actor.memberId : isParent(ctx) ? undefined : null;
    return eventsBetween(db, ctx.homeId, from, to, kid);
  });

  app.post('/api/homes/:homeId/events', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const f = eventInput(db, ctx.homeId, (req.body ?? {}) as Row);
    const id = insertEvent(db, ctx.homeId, f, String((req.body as Row)?.source ?? '') === 'snap' ? 'snap' : 'manual', ctx.user?.name ?? null);
    syncSoon(db, ctx.homeId);
    return getEvent(db, ctx.homeId, id);
  });

  // Several at once (the drafts from a snapped flyer, after the parent checked them).
  app.post('/api/homes/:homeId/events/bulk', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const list = (req.body as Row | undefined)?.events;
    if (!Array.isArray(list) || !list.length || list.length > 30) throw new HttpError(400, 'Send 1 to 30 events');
    const fields = list.map((e) => eventInput(db, ctx.homeId, e as Row));
    const ids = fields.map((f) => insertEvent(db, ctx.homeId, f, 'snap', ctx.user?.name ?? null));
    syncSoon(db, ctx.homeId);
    return ids.map((id) => getEvent(db, ctx.homeId, id));
  });

  app.patch('/api/homes/:homeId/events/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const cur = getEvent(db, ctx.homeId, (req.params as { id: string }).id);
    readOnly(db, cur);
    updateEvent(db, cur.id, eventInput(db, ctx.homeId, (req.body ?? {}) as Row, cur));
    syncSoon(db, ctx.homeId);
    return getEvent(db, ctx.homeId, cur.id);
  });

  app.delete('/api/homes/:homeId/events/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const cur = getEvent(db, ctx.homeId, (req.params as { id: string }).id);
    readOnly(db, cur);
    deleteEvent(db, cur.id);
    syncSoon(db, ctx.homeId);
    return { ok: true };
  });

  // Snap to calendar: a photo of a flyer (or pasted text from an email) → event drafts. Nothing is saved until the
  // parent checks the drafts and sends them to /events/bulk. Only the picture or text and today's date go to the AI.
  app.post('/api/homes/:homeId/events/snap', { bodyLimit: 4 * 1024 * 1024 }, async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    const home = homeInfo(db, ctx.homeId);
    const text = str(b.text, 8000);
    let image: { mediaType: string; data: string } | undefined;
    if (b.image) {
      const p = decodePhoto(b.image);
      image = { mediaType: MIME[p.ext] ?? 'image/jpeg', data: p.bytes.toString('base64') };
    }
    if (!image && !text) throw new HttpError(400, 'Add a photo or paste some text');
    const drafts = await snapEvents(db, ctx.homeId, homeToday(home), home.timezone, { image, text: text ?? undefined });
    return { drafts };
  });
}
