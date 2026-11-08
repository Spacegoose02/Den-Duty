// Photo frame on the family wall: a slideshow of an Immich album (the family's self-hosted photo library) and/or
// this week's photo-proof highlights (approved chores with a picture). Pictures come through this server, so the
// tablet never talks to Immich or holds its key. Immich is asked for the album at most every ten minutes.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, num, parseJson, str } from '../util.ts';
import { openKey, sealKey } from '../ai.ts';
import { homeInfo, homeToday } from '../chores.ts';
import { readPhoto } from '../photos.ts';
import { addDays } from '../../../shared/schedule.ts';
import { CHEERS } from '../../../shared/catalog.ts';

const cheerOf = (id: string | null) => CHEERS.find((c) => c.id === id) ?? null;

export interface PhotoFrameSettings { on: boolean; immichUrl: string; albumId: string; proof: boolean; seconds: number; shuffle: boolean }
export const FRAME_DEFAULTS: PhotoFrameSettings = { on: false, immichUrl: '', albumId: '', proof: true, seconds: 12, shuffle: true };
export interface FramePhoto { url: string; caption: string | null; kind: 'immich' | 'proof' }

const ALBUM = /^[0-9a-f-]{36}$/i;
const ASSET = /^[0-9a-f-]{36}$/i;
const MAX_IMMICH = 60;
const PROOF_DAYS = 7;

let fetchImpl: typeof fetch = (...a) => fetch(...a);
/** Tests: a stand-in for Immich. */
export function setImmichFetch(f: typeof fetch): void { fetchImpl = f; }

const albumCache = new Map<string, { at: number; ids: { id: string; caption: string | null }[] | null; error: string | null }>();

export function frameSettings(db: DatabaseSync, homeId: string): PhotoFrameSettings {
  const raw = parseJson<Partial<PhotoFrameSettings>>((db.prepare('SELECT photo_frame FROM homes WHERE id = ?').get(homeId) as Row | undefined)?.photo_frame, {});
  const seconds = Number(raw.seconds);
  return {
    on: !!raw.on, immichUrl: typeof raw.immichUrl === 'string' ? raw.immichUrl : '', albumId: typeof raw.albumId === 'string' ? raw.albumId : '',
    proof: raw.proof ?? FRAME_DEFAULTS.proof, seconds: Number.isInteger(seconds) && seconds >= 5 && seconds <= 300 ? seconds : FRAME_DEFAULTS.seconds,
    shuffle: raw.shuffle ?? FRAME_DEFAULTS.shuffle,
  };
}

function immichKey(db: DatabaseSync, homeId: string): string | null {
  const k = (db.prepare('SELECT immich_key FROM homes WHERE id = ?').get(homeId) as Row | undefined)?.immich_key as string | null;
  return k ? openKey(k) : null;
}

/** The album's pictures (ids only), cached ten minutes. Videos are left out. */
async function albumAssets(db: DatabaseSync, homeId: string, fresh = false): Promise<{ ids: { id: string; caption: string | null }[] | null; error: string | null }> {
  const s = frameSettings(db, homeId);
  const key = immichKey(db, homeId);
  if (!s.immichUrl || !s.albumId || !key) return { ids: null, error: null };
  const hit = albumCache.get(homeId);
  if (!fresh && hit && Date.now() - hit.at < 10 * 60e3) return hit;
  let out: { ids: { id: string; caption: string | null }[] | null; error: string | null } = { ids: null, error: "Immich didn't answer" };
  try {
    const res = await fetchImpl(`${s.immichUrl}/api/albums/${s.albumId}`, { headers: { 'x-api-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (res.status === 401 || res.status === 403) out = { ids: null, error: 'Immich refused the API key (it needs album.read and asset.view)' };
    else if (res.status === 404 || res.status === 400) out = { ids: null, error: "Immich can't find that album" };
    else if (res.ok) {
      const raw = (await res.json()) as { assets?: { id?: string; type?: string; exifInfo?: { description?: string | null } | null }[] };
      const ids = (raw.assets ?? []).filter((a) => typeof a.id === 'string' && ASSET.test(a.id) && (a.type ?? 'IMAGE') === 'IMAGE')
        .map((a) => ({ id: a.id!, caption: str(a.exifInfo?.description, 120) }));
      out = { ids, error: null };
    }
  } catch { /* keep the error above */ }
  // On a failure, keep showing what we had.
  if (!out.ids && hit?.ids) out = { ids: hit.ids, error: out.error };
  albumCache.set(homeId, { at: Date.now(), ...out });
  return out;
}

/** Shuffles by a seed (the hour), so the order changes through the day but stays put between wall refreshes. */
function seeded<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let x = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** What the wall shows: up to 60 album pictures, then this week's approved photo chores. */
export async function framePhotos(db: DatabaseSync, homeId: string): Promise<{ seconds: number; photos: FramePhoto[] } | null> {
  const s = frameSettings(db, homeId);
  if (!s.on) return null;
  const photos: FramePhoto[] = [];
  if (s.proof) {
    const today = homeToday(homeInfo(db, homeId));
    const rows = db.prepare(`SELECT i.id, i.title, i.icon, i.cheer, m.name FROM chore_instances i JOIN members m ON m.id = i.member_id
      WHERE i.home_id = ? AND i.status = 'approved' AND i.photo IS NOT NULL AND i.date >= ? ORDER BY i.reviewed_at DESC LIMIT 20`)
      .all(homeId, addDays(today, -(PROOF_DAYS - 1))) as Row[];
    for (const r of rows) {
      const cheer = cheerOf(r.cheer as string | null);
      photos.push({ url: `/api/homes/${homeId}/photo-frame/proof/${r.id as string}`, kind: 'proof',
        caption: `${r.icon} ${r.name}: ${r.title}${cheer ? ` · ${cheer.icon} ${cheer.text}` : ''}` });
    }
  }
  const album = await albumAssets(db, homeId);
  const ids = album.ids ?? [];
  const picked = s.shuffle ? seeded(ids, Math.floor(Date.now() / 3600e3)) : ids;
  for (const a of picked.slice(0, MAX_IMMICH)) photos.push({ url: `/api/homes/${homeId}/photo-frame/immich/${a.id}`, kind: 'immich', caption: a.caption });
  return { seconds: s.seconds, photos: s.shuffle ? seeded(photos, Math.floor(Date.now() / 3600e3) + 7) : photos };
}

export function photoFrameRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/photo-frame', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const album = await albumAssets(db, ctx.homeId);
    return { ...frameSettings(db, ctx.homeId), hasKey: !!immichKey(db, ctx.homeId), album: { count: album.ids?.length ?? null, error: album.error } };
  });

  // { on, immichUrl, albumId, key, proof, seconds, shuffle }: a blank key keeps the saved one; key: null removes it.
  app.put('/api/homes/:homeId/photo-frame', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    const cur = frameSettings(db, ctx.homeId);
    let url = 'immichUrl' in b ? str(b.immichUrl, 300)?.replace(/\/+$/, '') ?? '' : cur.immichUrl;
    if (url) {
      if (!/^https?:\/\/[^/\s]+/i.test(url)) throw new HttpError(400, "Immich's address starts with http:// or https://");
      const u = new URL(url);
      url = `${u.origin}${u.pathname.replace(/\/api\/?$/, '').replace(/\/+$/, '')}`;
    }
    // People paste the whole album link (…/albums/<id>); keep just the id.
    let albumId = 'albumId' in b ? str(b.albumId, 300) ?? '' : cur.albumId;
    const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(albumId);
    if (albumId && !m) throw new HttpError(400, "That doesn't look like an Immich album (open the album and copy its link)");
    albumId = m ? m[1].toLowerCase() : '';
    if (albumId && !ALBUM.test(albumId)) throw new HttpError(400, 'Unknown album');
    const seconds = 'seconds' in b ? num(b.seconds) : cur.seconds;
    if (seconds == null || !Number.isInteger(seconds) || seconds < 5 || seconds > 300) throw new HttpError(400, 'Each picture shows 5 to 300 seconds');
    const next: PhotoFrameSettings = {
      on: 'on' in b ? !!b.on : cur.on, immichUrl: url, albumId, proof: 'proof' in b ? !!b.proof : cur.proof, seconds, shuffle: 'shuffle' in b ? !!b.shuffle : cur.shuffle,
    };
    db.prepare('UPDATE homes SET photo_frame = ? WHERE id = ?').run(JSON.stringify(next), ctx.homeId);
    if (b.key === null || !url) db.prepare('UPDATE homes SET immich_key = NULL WHERE id = ?').run(ctx.homeId);
    else if (typeof b.key === 'string' && b.key.trim()) db.prepare('UPDATE homes SET immich_key = ? WHERE id = ?').run(sealKey(b.key.trim()), ctx.homeId);
    const album = await albumAssets(db, ctx.homeId, true);
    return { ...next, hasKey: !!immichKey(db, ctx.homeId), album: { count: album.ids?.length ?? null, error: album.error } };
  });

  // An album picture, through this server: only ones in the linked album, for this home's tablet or parents.
  app.get('/api/homes/:homeId/photo-frame/immich/:asset', async (req, reply) => {
    const ctx = homeCtx(db, req);
    if (ctx.actor.kind === 'token') throw new HttpError(403, 'Not for tokens');
    const asset = (req.params as { asset: string }).asset;
    const s = frameSettings(db, ctx.homeId);
    const key = immichKey(db, ctx.homeId);
    if (!s.on || !key || !ASSET.test(asset)) throw new HttpError(404, 'No such picture');
    const album = await albumAssets(db, ctx.homeId);
    if (!album.ids?.some((a) => a.id === asset)) throw new HttpError(404, 'No such picture');
    const res = await fetchImpl(`${s.immichUrl}/api/assets/${asset}/thumbnail?size=preview`, { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    const type = res?.headers.get('content-type')?.split(';')[0] ?? '';
    if (!res?.ok || !/^image\/(png|jpeg|webp|avif)$/.test(type)) throw new HttpError(404, 'No such picture');
    return reply.header('content-type', type).header('cache-control', 'private, max-age=86400').header('x-content-type-options', 'nosniff').send(Buffer.from(await res.arrayBuffer()));
  });

  // A photo-proof highlight: approved this week, with the frame's proof switch on.
  app.get('/api/homes/:homeId/photo-frame/proof/:id', async (req, reply) => {
    const ctx = homeCtx(db, req);
    if (ctx.actor.kind === 'token') throw new HttpError(403, 'Not for tokens');
    const s = frameSettings(db, ctx.homeId);
    const today = homeToday(homeInfo(db, ctx.homeId));
    const r = db.prepare("SELECT photo FROM chore_instances WHERE id = ? AND home_id = ? AND status = 'approved' AND photo IS NOT NULL AND date >= ?")
      .get((req.params as { id: string }).id, ctx.homeId, addDays(today, -(PROOF_DAYS - 1))) as Row | undefined;
    const photo = s.on && s.proof && r ? readPhoto(ctx.homeId, r.photo as string) : null;
    if (!photo) throw new HttpError(404, 'No such picture');
    return reply.header('content-type', photo.type).header('cache-control', 'private, max-age=86400').header('x-content-type-options', 'nosniff').send(photo.bytes);
  });
}

export function expireImmichCache(): void { albumCache.clear(); }
