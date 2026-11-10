// Nighttime Ninja grocery requests. Nighttime Ninja is the family's kitchen app. With its address and a home API token
// saved here, a list marked "Kids' picks are requests" sends what a kid (or the family tablet) adds to Nighttime
// Ninja's Requests tab. A parent says yes there, onto the shopping list they pick, or no, and the answer shows back on
// the kid's list. A kid's Helpdesk "Buy something" ask goes there the same way, and the answer shows on their Helpdesk.
// Nothing waits on Nighttime Ninja being up: an ask that couldn't be sent goes on the next sync.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, str } from '../util.ts';
import { openKey, sealKey } from '../ai.ts';
import { emit } from '../events.ts';

/** How Nighttime Ninja knows the asks from here. */
const SOURCE = 'den-duty';

export type RequestStatus = 'sending' | 'waiting' | 'approved' | 'declined';

let fetchImpl: typeof fetch = (...a) => fetch(...a);
/** Tests: a stand-in for Nighttime Ninja. */
export function setNinjaFetch(f: typeof fetch): void {
  fetchImpl = f;
}

interface Link { url: string; homeId: string; token: string }

function link(db: DatabaseSync, homeId: string): Link | null {
  const h = db.prepare('SELECT ninja_url, ninja_home_id, ninja_token FROM homes WHERE id = ?').get(homeId) as Row | undefined;
  const token = h?.ninja_token ? openKey(h.ninja_token as string) : null;
  return h?.ninja_url && h.ninja_home_id && token ? { url: h.ninja_url as string, homeId: h.ninja_home_id as string, token } : null;
}

export function ninjaLinked(db: DatabaseSync, homeId: string): boolean {
  return !!link(db, homeId);
}

async function call<T>(l: Link, method: string, path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetchImpl(`${l.url}/api/homes/${encodeURIComponent(l.homeId)}${path}`, {
      method,
      headers: { authorization: `Bearer ${l.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? (await res.json()) as T : null;
  } catch {
    return null;
  }
}

/** Sends one ask. The item stays 'sending' if Nighttime Ninja can't be reached, and goes with the next sync. */
export async function sendRequest(db: DatabaseSync, homeId: string, itemId: string): Promise<void> {
  const l = link(db, homeId);
  const it = db.prepare("SELECT * FROM list_items WHERE id = ? AND request_status = 'sending'").get(itemId) as Row | undefined;
  if (!l || !it) return;
  const r = await call<{ status: RequestStatus; listName: string | null }>(l, 'POST', '/shopping/requests', {
    name: it.text, note: it.note ?? null, requestedBy: it.added_by_name ?? null, source: SOURCE, externalId: it.id,
  });
  if (r) settle(db, itemId, r.status, r.listName);
}

/** Records an answer: yes or no ticks the item off here (the answer stays on it for the kid to see). */
function settle(db: DatabaseSync, itemId: string, status: RequestStatus, listName: string | null): void {
  if (status === 'approved' || status === 'declined') {
    db.prepare("UPDATE list_items SET request_status = ?, request_list = ?, done = 1, done_at = COALESCE(done_at, datetime('now')) WHERE id = ? AND request_status IS NOT ?")
      .run(status, listName, itemId, status);
  } else {
    db.prepare("UPDATE list_items SET request_status = 'waiting' WHERE id = ? AND request_status = 'sending'").run(itemId);
  }
}

/** Sends one Helpdesk "Buy something" ask, like a list item. */
export async function sendHelpdeskAsk(db: DatabaseSync, homeId: string, requestId: string): Promise<void> {
  const l = link(db, homeId);
  const r = db.prepare(`SELECT r.*, m.name AS kid_name FROM helpdesk_requests r JOIN members m ON m.id = r.member_id
    WHERE r.id = ? AND r.ninja_status = 'sending'`).get(requestId) as Row | undefined;
  if (!l || !r) return;
  const res = await call<{ status: RequestStatus; listName: string | null }>(l, 'POST', '/shopping/requests', {
    name: r.text, note: r.due_date ? `Needed by ${r.due_date as string}` : null, requestedBy: r.kid_name ?? null, source: SOURCE, externalId: r.id,
  });
  if (res) settleHelpdesk(db, requestId, res.status, res.listName);
}

/** An answer from Nighttime Ninja to a Helpdesk ask: yes closes the ticket as on the shopping list, no is "not this time". */
function settleHelpdesk(db: DatabaseSync, requestId: string, status: RequestStatus, listName: string | null): void {
  const r = db.prepare('SELECT * FROM helpdesk_requests WHERE id = ?').get(requestId) as Row | undefined;
  if (!r) return;
  // Already answered here (or taken back): Nighttime Ninja's copy no longer matters.
  if (r.status !== 'waiting' || r.closed_at) {
    db.prepare("UPDATE helpdesk_requests SET ninja_status = NULL WHERE id = ? AND ninja_status IN ('sending', 'waiting')").run(requestId);
    return;
  }
  if (status === 'approved') {
    db.prepare(`UPDATE helpdesk_requests SET status = 'approved', ninja_status = 'approved', decided_at = datetime('now'),
      closed_at = datetime('now'), close_note = ? WHERE id = ?`).run(listName ? `On the ${listName} list` : null, requestId);
    emit(db, r.home_id as string, 'helpdesk_answered', r.member_id as string, { answer: 'yes', request: r.text, request_id: requestId, via: 'nighttime-ninja' });
  } else if (status === 'declined') {
    db.prepare("UPDATE helpdesk_requests SET status = 'denied', ninja_status = 'declined', decided_at = datetime('now') WHERE id = ?").run(requestId);
    emit(db, r.home_id as string, 'helpdesk_answered', r.member_id as string, { answer: 'not this time', request_id: requestId, via: 'nighttime-ninja' });
  } else {
    db.prepare("UPDATE helpdesk_requests SET ninja_status = 'waiting' WHERE id = ? AND ninja_status = 'sending'").run(requestId);
  }
}

/** A Helpdesk ask was answered, closed or taken back here: it leaves Nighttime Ninja's Requests tab. */
export async function dropHelpdeskAsk(db: DatabaseSync, homeId: string, r: Row): Promise<void> {
  if (r.ninja_status !== 'sending' && r.ninja_status !== 'waiting') return;
  db.prepare('UPDATE helpdesk_requests SET ninja_status = NULL WHERE id = ?').run(r.id as string);
  await withdrawRequest(db, homeId, r.id as string);
}

const lastSync = new Map<string, number>();

/**
 * Sends asks that didn't go yet and picks up answers, at most every 20 seconds per home (lists are read often:
 * the wall, every kid board). Never throws: an unreachable Nighttime Ninja just leaves things waiting.
 */
export async function syncRequests(db: DatabaseSync, homeId: string, force = false): Promise<void> {
  const l = link(db, homeId);
  if (!l) return;
  if (!force && Date.now() - (lastSync.get(homeId) ?? 0) < 20_000) return;
  lastSync.set(homeId, Date.now());
  const open = db.prepare(`SELECT i.id, i.request_status FROM list_items i JOIN lists l ON l.id = i.list_id
    WHERE l.home_id = ? AND i.request_status IN ('sending', 'waiting') ORDER BY i.created_at LIMIT 200`).all(homeId) as Row[];
  const asks = db.prepare(`SELECT id, ninja_status FROM helpdesk_requests WHERE home_id = ? AND ninja_status IN ('sending', 'waiting')
    ORDER BY created_at LIMIT 200`).all(homeId) as Row[];
  for (const it of open.filter((x) => x.request_status === 'sending')) await sendRequest(db, homeId, it.id as string);
  for (const r of asks.filter((x) => x.ninja_status === 'sending')) await sendHelpdeskAsk(db, homeId, r.id as string);
  const waiting = open.filter((x) => x.request_status === 'waiting').map((x) => x.id as string);
  const waitingAsks = new Set(asks.filter((x) => x.ninja_status === 'waiting').map((x) => x.id as string));
  const ids = [...waiting, ...waitingAsks];
  if (!ids.length) return;
  const answers = await call<{ externalId: string; status: RequestStatus; listName: string | null }[]>(l, 'GET',
    `/shopping/requests?source=${SOURCE}&ids=${ids.map(encodeURIComponent).join(',')}`);
  if (!answers) return;
  for (const a of answers) {
    if (waitingAsks.has(a.externalId)) settleHelpdesk(db, a.externalId, a.status, a.listName);
    else settle(db, a.externalId, a.status, a.listName);
  }
  // Gone on that side without an answer (deleted there): back to a plain item, or a Helpdesk ask only answered here,
  // so it isn't stuck waiting forever.
  const known = new Set(answers.map((a) => a.externalId));
  for (const id of waiting.filter((x) => !known.has(x))) db.prepare('UPDATE list_items SET request_status = NULL WHERE id = ?').run(id);
  for (const id of [...waitingAsks].filter((x) => !known.has(x))) db.prepare('UPDATE helpdesk_requests SET ninja_status = NULL WHERE id = ?').run(id);
}

/** The kid took it back before anyone answered: it leaves Nighttime Ninja's Requests tab too. */
export async function withdrawRequest(db: DatabaseSync, homeId: string, itemId: string): Promise<void> {
  const l = link(db, homeId);
  if (l) await call(l, 'POST', '/shopping/requests/withdraw', { source: SOURCE, externalId: itemId });
}

/** Everyday things for kids to pick from when the home's own favourites aren't known yet. */
export const STARTER_PICKS = [
  { name: 'Milk', icon: '🥛' }, { name: 'Bananas', icon: '🍌' }, { name: 'Apples', icon: '🍎' }, { name: 'Strawberries', icon: '🍓' },
  { name: 'Grapes', icon: '🍇' }, { name: 'Carrots', icon: '🥕' }, { name: 'Cereal', icon: '🥣' }, { name: 'Bread', icon: '🍞' },
  { name: 'Cheese', icon: '🧀' }, { name: 'Yogurt', icon: '🥄' }, { name: 'Eggs', icon: '🥚' }, { name: 'Juice', icon: '🧃' },
  { name: 'Crackers', icon: '🍘' }, { name: 'Popcorn', icon: '🍿' }, { name: 'Granola bars', icon: '🍫' }, { name: 'Ice cream', icon: '🍨' },
];

const pickCache = new Map<string, { at: number; picks: { name: string; icon: string }[] }>();

/** What kids can tap to ask for: the home's most-bought groceries from Nighttime Ninja, or everyday starters. */
export async function picks(db: DatabaseSync, homeId: string): Promise<{ name: string; icon: string }[]> {
  const l = link(db, homeId);
  if (!l) return STARTER_PICKS;
  const hit = pickCache.get(homeId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.picks;
  const got = await call<{ name: string; icon: string }[]>(l, 'GET', '/shopping/requests/picks');
  const out = got && got.length >= 4 ? got.slice(0, 24).map((p) => ({ name: String(p.name).slice(0, 120), icon: String(p.icon ?? '🛒').slice(0, 8) })) : STARTER_PICKS;
  pickCache.set(homeId, { at: Date.now(), picks: out });
  return out;
}

export function ninjaRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/ninja', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const h = db.prepare('SELECT ninja_url, ninja_home_id, ninja_token FROM homes WHERE id = ?').get(ctx.homeId) as Row;
    return { url: (h.ninja_url as string | null) ?? '', hasToken: !!h.ninja_token, linked: !!h.ninja_home_id };
  });

  // { url, token }: checks the token with Nighttime Ninja and remembers which of its homes it's for. url '' unlinks.
  app.put('/api/homes/:homeId/ninja', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    let url = str(b.url, 300)?.replace(/\/+$/, '') ?? '';
    if (!url) {
      db.prepare('UPDATE homes SET ninja_url = NULL, ninja_home_id = NULL, ninja_token = NULL WHERE id = ?').run(ctx.homeId);
      return { url: '', hasToken: false, linked: false };
    }
    if (!/^https?:\/\/[^/\s]+/i.test(url)) throw new HttpError(400, "Nighttime Ninja's address starts with http:// or https://");
    url = new URL(url).origin;
    const h = db.prepare('SELECT ninja_token FROM homes WHERE id = ?').get(ctx.homeId) as Row;
    const token = typeof b.token === 'string' && b.token.trim() ? b.token.trim() : h.ninja_token ? openKey(h.ninja_token as string) : null;
    if (!token) throw new HttpError(400, 'Add a Nighttime Ninja API token too');
    let who: { homeId: string; name: string } | null = null;
    try {
      const res = await fetchImpl(`${url}/api/token/home`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      if (res.status === 401 || res.status === 403) throw new HttpError(400, "Nighttime Ninja didn't take that token. Make one in its Settings, Home, API tokens.");
      if (res.ok) who = (await res.json()) as { homeId: string; name: string };
    } catch (e) {
      if (e instanceof HttpError) throw e;
    }
    if (!who?.homeId) throw new HttpError(502, "Couldn't reach Nighttime Ninja at that address. Check it and try again.");
    db.prepare('UPDATE homes SET ninja_url = ?, ninja_home_id = ?, ninja_token = ? WHERE id = ?').run(url, who.homeId, sealKey(token), ctx.homeId);
    pickCache.delete(ctx.homeId);
    // Helpdesk "Buy something" asks already waiting go over too.
    db.prepare(`UPDATE helpdesk_requests SET ninja_status = 'sending' WHERE home_id = ? AND kind = 'buy' AND text IS NOT NULL
      AND status = 'waiting' AND closed_at IS NULL AND ninja_status IS NULL`).run(ctx.homeId);
    await syncRequests(db, ctx.homeId, true);
    return { url, hasToken: true, linked: true, home: who.name };
  });

  // The picks kids can tap on a request list.
  app.get('/api/homes/:homeId/lists/:id/picks', async (req) => {
    const ctx = homeCtx(db, req);
    return picks(db, ctx.homeId);
  });
}
