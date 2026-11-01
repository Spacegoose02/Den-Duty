// LootDen on the family wall: LootDen is the family's game library. With its address and a LootDen API token saved
// here, the wall shows who is playing what right now, the next family game night and a slideshow of the family's
// screenshots. Use a kid profile's token in LootDen so only kid-safe games and pictures show on a shared screen.
// Screenshots are fetched through this server, so the tablet never needs to reach LootDen itself or hold its token.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, str } from '../util.ts';
import { openKey, sealKey } from '../ai.ts';

export interface LootDenWall {
  nowPlaying: Array<{ name: string; avatar: string; title: string; device: string; startedAt: string; playedFor: string }>;
  nextGameNight: { id: number; title: string; date: string; time: string; game: { title: string } | null; players: Array<{ name: string }>; goal: { icon: string; title: string } | null } | null;
  screenshots: Array<{ id: number; imageUrl: string; by: string; game: string | null; caption: string | null; createdAt: string }>;
}

let fetchImpl: typeof fetch = (...a) => fetch(...a);
/** Tests: a stand-in for LootDen. */
export function setLootDenFetch(f: typeof fetch): void {
  fetchImpl = f;
}

const cache = new Map<string, { at: number; data: LootDenWall | null }>();

function link(db: DatabaseSync, homeId: string): { url: string; token: string } | null {
  const h = db.prepare('SELECT lootden_url, lootden_token FROM homes WHERE id = ?').get(homeId) as Row | undefined;
  const token = h?.lootden_token ? openKey(h.lootden_token as string) : null;
  return h?.lootden_url && token ? { url: h.lootden_url as string, token } : null;
}

/** What LootDen has for the wall, cached half a minute; null when it isn't linked or can't be reached. */
export async function lootdenWall(db: DatabaseSync, homeId: string): Promise<LootDenWall | null> {
  const l = link(db, homeId);
  if (!l) return null;
  const hit = cache.get(homeId);
  if (hit && Date.now() - hit.at < 30_000) return hit.data;
  let data: LootDenWall | null = null;
  try {
    const res = await fetchImpl(`${l.url}/api/family/wall`, { headers: { authorization: `Bearer ${l.token}` }, signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const raw = (await res.json()) as LootDenWall;
      data = {
        nowPlaying: (raw.nowPlaying ?? []).slice(0, 8),
        nextGameNight: raw.nextGameNight ?? null,
        // The tablet loads pictures from here, not from LootDen.
        screenshots: (raw.screenshots ?? []).slice(0, 12).map((s) => ({ ...s, imageUrl: `/api/homes/${homeId}/lootden/shots/${Number(s.id)}` })),
      };
    }
  } catch { /* LootDen being down must not blank the wall */ }
  cache.set(homeId, { at: Date.now(), data });
  return data;
}

export function lootdenRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/lootden', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const h = db.prepare('SELECT lootden_url, lootden_token FROM homes WHERE id = ?').get(ctx.homeId) as Row;
    return { url: (h.lootden_url as string | null) ?? '', hasToken: !!h.lootden_token, wall: await lootdenWall(db, ctx.homeId) };
  });

  // { url, token }: a blank token keeps the saved one; token: null (or url '') unlinks.
  app.put('/api/homes/:homeId/lootden', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    let url = str(b.url, 300)?.replace(/\/+$/, '') ?? '';
    if (url) {
      if (!/^https?:\/\/[^/\s]+/i.test(url)) throw new HttpError(400, "LootDen's address starts with http:// or https://");
      url = new URL(url).origin;
    }
    db.prepare('UPDATE homes SET lootden_url = ? WHERE id = ?').run(url || null, ctx.homeId);
    if (b.token === null || !url) db.prepare('UPDATE homes SET lootden_token = NULL WHERE id = ?').run(ctx.homeId);
    else if (typeof b.token === 'string' && b.token.trim()) db.prepare('UPDATE homes SET lootden_token = ? WHERE id = ?').run(sealKey(b.token.trim()), ctx.homeId);
    cache.delete(ctx.homeId);
    const wall = await lootdenWall(db, ctx.homeId);
    const h = db.prepare('SELECT lootden_token FROM homes WHERE id = ?').get(ctx.homeId) as Row;
    return { url, hasToken: !!h.lootden_token, wall, reachable: !!wall || !url };
  });

  // A screenshot for the wall, through this server. The family tablet (or a parent) of this home only.
  app.get('/api/homes/:homeId/lootden/shots/:id', async (req, reply) => {
    const ctx = homeCtx(db, req);
    const id = Number((req.params as { id: string }).id);
    const l = link(db, ctx.homeId);
    if (!l || !Number.isInteger(id) || id < 1) throw new HttpError(404, 'No such picture');
    // Only pictures LootDen listed for this wall.
    const wall = await lootdenWall(db, ctx.homeId);
    if (!wall?.screenshots.some((s) => s.id === id)) throw new HttpError(404, 'No such picture');
    const res = await fetchImpl(`${l.url}/api/screenshots/${id}/image`, { headers: { authorization: `Bearer ${l.token}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    const type = res?.headers.get('content-type') ?? '';
    if (!res?.ok || !/^image\/(png|jpeg|webp)$/.test(type)) throw new HttpError(404, 'No such picture');
    return reply.header('content-type', type).header('cache-control', 'private, max-age=86400').send(Buffer.from(await res.arrayBuffer()));
  });
}
