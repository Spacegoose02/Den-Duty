// Wishes, the family's wishlist app. With its address and an API key saved here, a kid's Helpdesk "Add to my wishlist"
// ask goes straight onto their Wishes list, where it waits for a grown-up's OK there (Wishes alerts the list's managers).
// Each Den Duty kid is matched to a Wishes kid (by name when linking, and a parent can change it). Nothing waits on
// Wishes being up: an ask that couldn't be sent stays on the Helpdesk and goes on the next sync. Duplicates are safe.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, str } from '../util.ts';
import { openKey, sealKey } from '../ai.ts';
import { emit } from '../events.ts';
import { getKid } from './homes.ts';

let fetchImpl: typeof fetch = (...a) => fetch(...a);
/** Tests: a stand-in for Wishes. */
export function setWishesFetch(f: typeof fetch): void {
  fetchImpl = f;
}

interface Link { url: string; token: string }
interface WishKid { profile_id: number; name: string; is_kid: boolean }

function link(db: DatabaseSync, homeId: string): Link | null {
  const h = db.prepare('SELECT wishes_url, wishes_token FROM homes WHERE id = ?').get(homeId) as Row | undefined;
  const token = h?.wishes_token ? openKey(h.wishes_token as string) : null;
  return h?.wishes_url && token ? { url: h.wishes_url as string, token } : null;
}

export function wishesLinked(db: DatabaseSync, homeId: string): boolean {
  return !!link(db, homeId);
}

/** status 0 means Wishes couldn't be reached. */
async function call<T>(l: Link, method: string, path: string, body?: unknown): Promise<{ status: number; body: T | null }> {
  try {
    const res = await fetchImpl(`${l.url}/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${l.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    let json: T | null = null;
    try { json = (await res.json()) as T; } catch { /* not JSON */ }
    return { status: res.status, body: json };
  } catch {
    return { status: 0, body: null };
  }
}

const norm = (s: string) => s.trim().toLowerCase();

/** Best guess at which Wishes kid is which Den Duty kid: same name, or one is the other's first name or nickname. */
function guessProfile(name: string, wishKids: WishKid[]): number | null {
  const n = norm(name);
  const kids = wishKids.filter((k) => k.is_kid);
  const hit = kids.filter((k) => norm(k.name) === n);
  if (hit.length === 1) return hit[0].profile_id;
  const loose = kids.filter((k) => { const w = norm(k.name); return w.split(/\s+/)[0] === n.split(/\s+/)[0] || n.startsWith(w) || w.startsWith(n); });
  return loose.length === 1 ? loose[0].profile_id : null;
}

/** Sends one "Add to my wishlist" ask. It stays 'sending' (and waiting on the Helpdesk) if Wishes can't be reached. */
export async function sendWish(db: DatabaseSync, homeId: string, requestId: string): Promise<void> {
  const l = link(db, homeId);
  const r = db.prepare(`SELECT r.*, m.name AS kid_name, m.wishes_profile_id FROM helpdesk_requests r JOIN members m ON m.id = r.member_id
    WHERE r.id = ? AND r.wishes_status = 'sending'`).get(requestId) as Row | undefined;
  if (!l || !r) return;
  const who = r.wishes_profile_id != null ? { profile_id: r.wishes_profile_id } : { kid: r.kid_name };
  const res = await call<{ error?: string; duplicate?: boolean; wish?: { list_title?: string; link?: string } }>(l, 'POST', '/wishes', {
    ...who, title: r.text, notes: `Asked on the Den Duty Helpdesk${r.due_date ? `, by ${r.due_date as string}` : ''}`, approved: false,
  });
  if (res.status === 200 || res.status === 201) {
    const dup = !!res.body?.duplicate;
    const listTitle = res.body?.wish?.list_title;
    db.prepare(`UPDATE helpdesk_requests SET status = 'approved', wishes_status = ?, wishes_link = ?, wishes_error = NULL,
      decided_at = datetime('now'), closed_at = datetime('now'), close_note = ? WHERE id = ? AND wishes_status = 'sending'`)
      .run(dup ? 'duplicate' : 'sent', res.body?.wish?.link ?? null, listTitle ? `On ${listTitle}` : null, requestId);
    emit(db, homeId, 'helpdesk_answered', r.member_id as string, { answer: dup ? 'already on the wishlist' : 'on the wishlist', request: r.text, request_id: requestId, via: 'wishes' });
  } else if (res.status === 0 || res.status >= 500 || res.status === 429) {
    // Not reachable right now: try again on the next sync.
  } else {
    // Wishes said no (no such kid, no list yet, a revoked key): it stays waiting here, and a parent sees why.
    const why = res.status === 401 ? "Wishes didn't take Den Duty's key. Make a new one in Wishes and save it in Settings." : res.body?.error ?? `Wishes answered ${res.status}`;
    db.prepare("UPDATE helpdesk_requests SET wishes_status = 'failed', wishes_error = ? WHERE id = ?").run(String(why).slice(0, 300), requestId);
  }
}

const lastSync = new Map<string, number>();

/** Sends asks that didn't go yet, at most every 30 seconds per home. Never throws. */
export async function syncWishes(db: DatabaseSync, homeId: string, force = false): Promise<void> {
  if (!link(db, homeId)) return;
  if (!force && Date.now() - (lastSync.get(homeId) ?? 0) < 30_000) return;
  lastSync.set(homeId, Date.now());
  const sending = db.prepare("SELECT id FROM helpdesk_requests WHERE home_id = ? AND wishes_status = 'sending' ORDER BY created_at LIMIT 50").all(homeId) as Row[];
  for (const r of sending) await sendWish(db, homeId, r.id as string);
}

/** Waiting "Add to my wishlist" asks (new, or ones Wishes turned away) go (again). */
function queueWaiting(db: DatabaseSync, homeId: string, memberId?: string): void {
  db.prepare(`UPDATE helpdesk_requests SET wishes_status = 'sending', wishes_error = NULL WHERE home_id = ? AND kind = 'wish' AND text IS NOT NULL
    AND status = 'waiting' AND closed_at IS NULL AND (wishes_status IS NULL OR wishes_status = 'failed') AND (? IS NULL OR member_id = ?)`)
    .run(homeId, memberId ?? null, memberId ?? null);
}

export function wishesRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const kidsHere = (homeId: string) => db.prepare("SELECT id, name, wishes_profile_id FROM members WHERE home_id = ? AND role = 'kid' ORDER BY position, created_at").all(homeId) as Row[];

  // Settings: the address, whether a key is saved, and which Wishes kid each kid is (with Wishes' kids to pick from).
  app.get('/api/homes/:homeId/wishes', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const h = db.prepare('SELECT wishes_url, wishes_token FROM homes WHERE id = ?').get(ctx.homeId) as Row;
    const l = link(db, ctx.homeId);
    const got = l ? await call<{ kids: WishKid[] }>(l, 'GET', '/kids') : null;
    return {
      url: (h.wishes_url as string | null) ?? '', hasToken: !!h.wishes_token, linked: !!l,
      reachable: got ? got.status === 200 : null,
      wishKids: got?.status === 200 ? (got.body?.kids ?? []).map((k) => ({ profileId: k.profile_id, name: k.name, isKid: !!k.is_kid })) : [],
      kids: kidsHere(ctx.homeId).map((k) => ({ id: k.id as string, name: k.name as string, profileId: (k.wishes_profile_id as number | null) ?? null })),
    };
  });

  // { url, token }: checks the key with Wishes and matches kids by name. url '' unlinks.
  app.put('/api/homes/:homeId/wishes', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    let url = str(b.url, 300)?.replace(/\/+$/, '') ?? '';
    if (!url) {
      db.prepare('UPDATE homes SET wishes_url = NULL, wishes_token = NULL WHERE id = ?').run(ctx.homeId);
      return { url: '', hasToken: false, linked: false };
    }
    if (!/^https?:\/\/[^/\s]+/i.test(url)) throw new HttpError(400, "Wishes' address starts with http:// or https://");
    url = new URL(url).origin;
    const h = db.prepare('SELECT wishes_token FROM homes WHERE id = ?').get(ctx.homeId) as Row;
    const token = typeof b.token === 'string' && b.token.trim() ? b.token.trim() : h.wishes_token ? openKey(h.wishes_token as string) : null;
    if (!token) throw new HttpError(400, 'Add a Wishes API key too');
    const got = await call<{ user?: { name: string }; kids?: WishKid[] }>({ url, token }, 'GET', '/kids');
    if (got.status === 401 || got.status === 403) throw new HttpError(400, "Wishes didn't take that key. Make one in Wishes: Settings, Sign-in & 2FA, Connected apps.");
    if (got.status !== 200 || !got.body?.kids) throw new HttpError(502, "Couldn't reach Wishes at that address. Check it and try again.");
    db.prepare('UPDATE homes SET wishes_url = ?, wishes_token = ? WHERE id = ?').run(url, sealKey(token), ctx.homeId);
    // Match kids that aren't matched yet (or whose Wishes kid is gone).
    const ids = new Set(got.body.kids.map((k) => k.profile_id));
    for (const k of kidsHere(ctx.homeId)) {
      if (k.wishes_profile_id != null && ids.has(k.wishes_profile_id as number)) continue;
      db.prepare('UPDATE members SET wishes_profile_id = ? WHERE id = ?').run(guessProfile(k.name as string, got.body.kids), k.id as string);
    }
    queueWaiting(db, ctx.homeId);
    await syncWishes(db, ctx.homeId, true);
    return { url, hasToken: true, linked: true, user: got.body.user?.name ?? null };
  });

  // { profileId }: which Wishes kid this kid is (null: match by name).
  app.put('/api/homes/:homeId/kids/:memberId/wishes', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const p = (req.body as Row | undefined)?.profileId;
    if (p != null && !(Number.isInteger(p) && (p as number) > 0)) throw new HttpError(400, 'Pick a kid from Wishes');
    db.prepare('UPDATE members SET wishes_profile_id = ? WHERE id = ?').run((p as number | null) ?? null, kid.id as string);
    // Asks Wishes turned away for this kid get another go.
    queueWaiting(db, ctx.homeId, kid.id as string);
    await syncWishes(db, ctx.homeId, true);
    return { ok: true };
  });
}
