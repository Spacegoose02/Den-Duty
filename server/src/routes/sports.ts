// Sports: each kid's followed teams from the family's sports tracker (Spacegoose02/sports-tracker). The tracker's
// address is saved once per home, and each kid gets the private key from their own tracker account (Account,
// Connect other apps). This server asks the tracker for that kid's teams with the key, so the tablet never holds a
// key or needs to reach the tracker itself. The tracker being down never breaks a board: the last good answer is
// shown (marked as old) for a few hours, and otherwise the cards just say the scores can't be reached.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, str } from '../util.ts';
import { openKey, sealKey } from '../ai.ts';
import { getKid } from './homes.ts';

export interface SportsSide {
  name: string | null; abbreviation: string | null; logo: string | null; color: string | null;
  score: number | null; winner: boolean; rank: number | null;
}
export interface SportsGame {
  id: string; date: string; timeValid: boolean; venue: string | null; broadcast: string | null;
  state: 'pre' | 'in' | 'post'; detail: string | null;
  /** Is the followed team the home side? Then `opponent` is the away team, and the other way round. */
  isHome: boolean; team: SportsSide; opponent: SportsSide;
}
export interface SportsTeam {
  sport: string; sportLabel: string; id: string; name: string; abbreviation: string | null; logo: string | null;
  color: string | null; record: string | null; rank: number | null;
  liveGame: SportsGame | null; nextGame: SportsGame | null; lastGame: SportsGame | null;
}
export interface KidSports {
  teams: SportsTeam[];
  /** When the tracker last answered. */
  updatedAt: string;
  /** True when the tracker didn't answer just now and these are older scores. */
  stale: boolean;
}
/** What a board or the wall gets: null when the kid isn't linked; `teams: null` when the tracker can't be reached. */
export type KidSportsView = (Omit<KidSports, 'teams'> & { teams: SportsTeam[] }) | { teams: null; updatedAt: null; stale: true } | null;

let fetchImpl: typeof fetch = (...a) => fetch(...a);
/** Tests: a stand-in for the sports tracker. */
export function setSportsFetch(f: typeof fetch): void {
  fetchImpl = f;
}

/** Fresh enough to reuse without asking again (live games move fast, so this stays short). */
const FRESH_MS = 30_000;
/** How long an old answer may stand in while the tracker is down. */
const KEEP_MS = 6 * 60 * 60_000;
const cache = new Map<string, { at: number; ok: boolean; data: KidSports | null }>();
const inflight = new Map<string, Promise<KidSportsView>>();

/** Tests: make every cached answer due for a new ask (as if half a minute went by). */
export function expireSportsCache(): void {
  for (const v of cache.values()) v.at = 0;
}

function forgetHome(homeId: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${homeId}:`)) cache.delete(k);
}

function trackerUrl(db: DatabaseSync, homeId: string): string | null {
  return ((db.prepare('SELECT sports_url FROM homes WHERE id = ?').get(homeId) as Row | undefined)?.sports_url as string | null) ?? null;
}

function kidKey(db: DatabaseSync, memberId: string): string | null {
  const sealed = (db.prepare('SELECT sports_key FROM members WHERE id = ?').get(memberId) as Row | undefined)?.sports_key as string | null;
  return sealed ? openKey(sealed) : null;
}

// ---------- cleaning what the tracker sends: only the fields the cards use, nothing that could run or redirect ----------

const text = (v: unknown, max = 80): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const httpUrl = (v: unknown): string | null => (typeof v === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(v) && v.length < 500 ? v : null);
const hex = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().replace(/^#?/, '#') : '';
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null;
};
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const rankOf = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n >= 1 && n <= 99 ? Math.round(n) : null;
};

function side(raw: unknown): SportsSide {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Row;
  return {
    name: text(c.shortName) ?? text(c.name), abbreviation: text(c.abbreviation, 12), logo: httpUrl(c.logo), color: hex(c.color),
    score: num(c.score), winner: c.winner === true, rank: rankOf(c.curatedRank),
  };
}

function game(raw: unknown, teamId: string, abbr: string | null): SportsGame | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Row;
  const date = text(g.date, 40);
  if (!date || Number.isNaN(Date.parse(date))) return null;
  const status = (g.status && typeof g.status === 'object' ? g.status : {}) as Row;
  const state = status.state === 'in' || status.state === 'post' ? status.state : 'pre';
  const home = side(g.home);
  const away = side(g.away);
  const idOf = (c: unknown) => (c && typeof c === 'object' ? String((c as Row).id ?? '') : '');
  // By id, and by abbreviation when the schedule's ids don't match the followed team's (a different data source).
  const isHome = idOf(g.home) === teamId || (idOf(g.away) !== teamId && !!abbr && home.abbreviation === abbr);
  return {
    id: String(g.id ?? '').slice(0, 40), date, timeValid: g.timeValid !== false, venue: text(g.venue), broadcast: text(g.broadcast, 40),
    state, detail: text(status.shortDetail) ?? text(status.detail),
    isHome, team: isHome ? home : away, opponent: isHome ? away : home,
  };
}

/** One team from the tracker's /api/account/teams, cleaned. */
export function cleanTeam(raw: unknown): SportsTeam | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Row;
  const id = text(String(t.id ?? ''), 40);
  const name = text(t.name);
  if (!id || !name) return null;
  const abbr = text(t.abbreviation, 12);
  return {
    sport: text(t.sport, 20) ?? 'other', sportLabel: text(t.sportLabel, 40) ?? '', id, name,
    abbreviation: abbr, logo: httpUrl(t.logo), color: hex(t.color), record: text(t.record, 20), rank: rankOf(t.rank),
    liveGame: game(t.liveGame, id, abbr), nextGame: game(t.nextGame, id, abbr), lastGame: game(t.lastGame, id, abbr),
  };
}

type Ask = { ok: true; teams: SportsTeam[]; displayName: string | null } | { ok: false; status: number | null };

async function askTracker(url: string, key: string): Promise<Ask> {
  try {
    const res = await fetchImpl(`${url}/api/account/teams`, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, status: res.status };
    const body = (await res.json()) as Row;
    const teams = (Array.isArray(body.teams) ? body.teams : []).slice(0, 12).map(cleanTeam).filter((t): t is SportsTeam => !!t);
    return { ok: true, teams, displayName: text((body.user as Row | undefined)?.displayName, 60) };
  } catch {
    return { ok: false, status: null };
  }
}

/** A kid's teams for their board or the wall, cached half a minute. Never throws. */
export async function kidSports(db: DatabaseSync, homeId: string, memberId: string): Promise<KidSportsView> {
  const url = trackerUrl(db, homeId);
  const key = url ? kidKey(db, memberId) : null;
  if (!url || !key) return null;
  const id = `${homeId}:${memberId}`;
  const hit = cache.get(id);
  const view = (h: NonNullable<typeof hit>): KidSportsView =>
    h.data && Date.now() - Date.parse(h.data.updatedAt) < KEEP_MS ? { ...h.data, stale: !h.ok } : { teams: null, updatedAt: null, stale: true };
  if (hit && Date.now() - hit.at < FRESH_MS) return view(hit);
  const pending = inflight.get(id);
  if (pending) return pending;
  const p = (async () => {
    const r = await askTracker(url, key);
    const prev = cache.get(id);
    const next = r.ok
      ? { at: Date.now(), ok: true, data: { teams: r.teams, updatedAt: new Date().toISOString(), stale: false } }
      : { at: Date.now(), ok: false, data: prev?.data ?? null };
    cache.set(id, next);
    return view(next);
  })().finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

function cleanTrackerUrl(raw: unknown): string {
  const url = str(raw, 300)?.trim().replace(/\/+$/, '') ?? '';
  if (!url) return '';
  if (!/^https?:\/\/[^/\s]+/i.test(url)) throw new HttpError(400, "The sports tracker's address starts with http:// or https://");
  // Keep a path prefix (a tracker behind /sports on a reverse proxy), drop any query or fragment.
  const u = new URL(url);
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

export function sportsRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // Parents: the tracker's address and which kids have a key.
  app.get('/api/homes/:homeId/sports', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kids = db.prepare("SELECT id, name, sports_key FROM members WHERE home_id = ? AND role = 'kid' ORDER BY position, created_at").all(ctx.homeId) as Row[];
    return { url: trackerUrl(db, ctx.homeId) ?? '', kids: kids.map((k) => ({ id: k.id as string, name: k.name as string, hasKey: !!k.sports_key })) };
  });

  // { url }: '' unlinks the tracker for the whole home (kids' keys are kept for when it comes back).
  app.put('/api/homes/:homeId/sports', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const url = cleanTrackerUrl(((req.body ?? {}) as Row).url);
    db.prepare('UPDATE homes SET sports_url = ? WHERE id = ?').run(url || null, ctx.homeId);
    forgetHome(ctx.homeId);
    return { url };
  });

  // { key }: a kid's private key from their tracker account; null or '' removes it. Answers with what the tracker
  // says for that key, so a parent knows straight away whether it worked.
  app.put('/api/homes/:homeId/kids/:memberId/sports', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const raw = ((req.body ?? {}) as Row).key;
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (key && (key.length > 200 || /\s/.test(key))) throw new HttpError(400, "That doesn't look like a sports tracker key");
    db.prepare('UPDATE members SET sports_key = ? WHERE id = ?').run(key ? sealKey(key) : null, kid.id as string);
    cache.delete(`${ctx.homeId}:${kid.id as string}`);
    const url = trackerUrl(db, ctx.homeId);
    if (!key || !url) return { hasKey: !!key, check: null };
    const r = await askTracker(url, key);
    return {
      hasKey: true,
      check: r.ok ? { ok: true, teams: r.teams.length, displayName: r.displayName }
        : { ok: false, reason: r.status === 401 ? 'The tracker says that key is wrong (or a newer one was made).' : "The sports tracker didn't answer." },
    };
  });

  // A kid's teams: that kid, the family tablet, or a parent.
  app.get('/api/homes/:homeId/kids/:memberId/sports', async (req) => {
    const ctx = homeCtx(db, req);
    const memberId = (req.params as { memberId: string }).memberId;
    assertCanActFor(ctx, memberId);
    getKid(db, ctx, memberId);
    return { sports: await kidSports(db, ctx.homeId, memberId) };
  });
}
