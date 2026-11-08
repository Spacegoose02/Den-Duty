// Weather: today's weather from the family's Weather Scout server (Spacegoose02/weather-scout). The server's address
// and an app key (Weather Scout → Family & settings → Connected apps) are saved once per home. This server asks
// Weather Scout with the key, so the tablet never holds a key or needs to reach Weather Scout itself. Weather Scout
// being down never breaks a board: the last good answer is shown (marked as old) for a few hours.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, str } from '../util.ts';
import { openKey, sealKey } from '../ai.ts';

export type WeatherIcon = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'sleet' | 'snow' | 'thunder';
export type RockyMood = 'happy' | 'worried' | 'shivering' | 'hot';
export interface WeatherAlert { id: string; event: string; severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown'; kid: string; ends: string | null }
export interface HomeWeatherData {
  place: string | null;
  tempUnit: string;
  now: { temp: number | null; feelsLike: number | null; icon: WeatherIcon; isDay: boolean; label: string; kidLabel: string };
  today: { high: number | null; low: number | null; rainChance: number | null };
  /** What Rocky the raccoon is wearing in Weather Scout: raincoat, boots, beanie, mittens, sunglasses… */
  outfit: string[];
  /** Rocky's mood badge: 🥶 shivering, 💦 hot, ⚡ worried (thunder), none when happy. */
  mood: RockyMood;
  /** Weather Scout can draw Rocky in this outfit (GET …/weather/rocky.svg). False on older Weather Scout servers. */
  rocky: boolean;
  checklist: { id: string; emoji: string; label: string; why: string }[];
  recess: { rating: 'green' | 'yellow' | 'red'; label: string; emoji: string; reasons: string[] };
  sunset: string | null;
  alerts: WeatherAlert[];
  updatedAt: string;
}
/** What a board or the wall gets: null when not linked; `now: null` when Weather Scout can't be reached. */
export type HomeWeatherView = (HomeWeatherData & { stale: boolean }) | { now: null; stale: true } | null;

let fetchImpl: typeof fetch = (...a) => fetch(...a);
/** Tests: a stand-in for Weather Scout. */
export function setWeatherFetch(f: typeof fetch): void {
  fetchImpl = f;
}

/** Weather moves slowly; Weather Scout caches its own sources for 2 to 10 minutes. */
const FRESH_MS = 3 * 60_000;
/** How long an old answer may stand in while Weather Scout is down. */
const KEEP_MS = 3 * 60 * 60_000;
const cache = new Map<string, { at: number; ok: boolean; data: HomeWeatherData | null }>();
const inflight = new Map<string, Promise<HomeWeatherView>>();

/** Tests: make every cached answer due for a new ask. */
export function expireWeatherCache(): void {
  for (const v of cache.values()) v.at = 0;
}

function link(db: DatabaseSync, homeId: string): { url: string | null; key: string | null } {
  const r = db.prepare('SELECT weather_url, weather_key FROM homes WHERE id = ?').get(homeId) as Row | undefined;
  return { url: (r?.weather_url as string | null) ?? null, key: r?.weather_key ? openKey(r.weather_key as string) : null };
}

// ---------- cleaning what Weather Scout sends: only the fields the cards use, as plain text and numbers ----------

const text = (v: unknown, max = 120): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const ICONS: WeatherIcon[] = ['clear', 'partly-cloudy', 'cloudy', 'fog', 'drizzle', 'rain', 'sleet', 'snow', 'thunder'];
const SEVERITIES = ['Extreme', 'Severe', 'Moderate', 'Minor'] as const;
const MOODS: RockyMood[] = ['happy', 'worried', 'shivering', 'hot'];
const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

export function cleanWeather(raw: unknown): HomeWeatherData | null {
  const b = obj(raw);
  const cur = obj(b.current);
  if (num(cur.temp) == null) return null;
  const today = obj(b.today);
  const pg = obj(b.playground);
  const rating = pg.rating === 'red' || pg.rating === 'yellow' ? pg.rating : 'green';
  return {
    place: text(obj(b.location).name, 60),
    tempUnit: text(obj(b.units).temp, 4) ?? '°',
    now: {
      temp: num(cur.temp), feelsLike: num(cur.feelsLike),
      icon: ICONS.includes(cur.icon as WeatherIcon) ? cur.icon as WeatherIcon : 'cloudy',
      isDay: cur.isDay !== false, label: text(cur.label, 40) ?? '', kidLabel: text(cur.kidLabel, 60) ?? text(cur.label, 40) ?? '',
    },
    today: { high: num(today.high), low: num(today.low), rainChance: num(today.precipChance) },
    outfit: list(obj(b.raccoon).items, 12).map((x) => text(x, 20)).filter((x): x is string => !!x && /^[a-z-]+$/.test(x)),
    mood: MOODS.includes(obj(b.raccoon).mood as RockyMood) ? obj(b.raccoon).mood as RockyMood : 'happy',
    rocky: typeof obj(obj(b.raccoon).art).dressed === 'string',
    checklist: list(b.checklist, 10).map(obj).map((c) => ({ id: text(c.id, 20) ?? '', emoji: text(c.emoji, 8) ?? '•', label: text(c.label, 40) ?? '', why: text(c.why, 80) ?? '' }))
      .filter((c) => c.id && c.label),
    recess: {
      rating, label: text(pg.label, 40) ?? '', emoji: text(pg.emoji, 8) ?? (rating === 'green' ? '🛝' : rating === 'yellow' ? '⚠️' : '🏠'),
      reasons: list(pg.reasons, 4).map((r) => text(r, 120)).filter((r): r is string => !!r),
    },
    sunset: text(obj(b.sky).sunset, 25),
    alerts: list(b.alerts, 5).map(obj).map((a) => ({
      id: text(a.id, 200) ?? '', event: text(a.event, 60) ?? 'Weather alert',
      severity: (SEVERITIES as readonly string[]).includes(a.severity as string) ? a.severity as WeatherAlert['severity'] : 'Unknown',
      kid: text(a.kid, 200) ?? '', ends: text(a.ends, 40),
    })),
    updatedAt: new Date().toISOString(),
  };
}

type Ask = { ok: true; data: HomeWeatherData } | { ok: false; status: number | null };

async function askWeatherScout(url: string, key: string): Promise<Ask> {
  try {
    const res = await fetchImpl(`${url}/api/connect/summary`, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, status: res.status };
    const data = cleanWeather(await res.json());
    return data ? { ok: true, data } : { ok: false, status: null };
  } catch {
    return { ok: false, status: null };
  }
}

/** The home's weather for boards and the wall, cached a few minutes. Never throws. */
export async function homeWeather(db: DatabaseSync, homeId: string): Promise<HomeWeatherView> {
  const { url, key } = link(db, homeId);
  if (!url || !key) return null;
  const hit = cache.get(homeId);
  const view = (h: NonNullable<typeof hit>): HomeWeatherView =>
    h.data && Date.now() - Date.parse(h.data.updatedAt) < KEEP_MS ? { ...h.data, stale: !h.ok } : { now: null, stale: true };
  if (hit && Date.now() - hit.at < FRESH_MS) return view(hit);
  const pending = inflight.get(homeId);
  if (pending) return pending;
  const p = (async () => {
    const r = await askWeatherScout(url, key);
    const next = r.ok ? { at: Date.now(), ok: true, data: r.data } : { at: Date.now(), ok: false, data: cache.get(homeId)?.data ?? null };
    cache.set(homeId, next);
    return view(next);
  })().finally(() => inflight.delete(homeId));
  inflight.set(homeId, p);
  return p;
}

// ---------- Rocky dressed for today, drawn by Weather Scout ----------

/** Rocky's picture is a few dozen KB (the base art is inside it). Anything far bigger isn't Rocky. */
const ROCKY_MAX_BYTES = 512 * 1024;
const rockyCache = new Map<string, { outfitKey: string; svg: string }>();

/** Which picture a weather answer needs: the same outfit and mood is the same picture. */
export const rockyKey = (w: Pick<HomeWeatherData, 'outfit' | 'mood'>): string => `${w.outfit.join(',')}|${w.mood}`;

async function askRocky(url: string, w: HomeWeatherData): Promise<string | null> {
  try {
    const q = new URLSearchParams({ items: w.outfit.join(','), mood: w.mood });
    const res = await fetchImpl(`${url}/api/connect/rocky.svg?${q}`, { headers: { accept: 'image/svg+xml' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok || !/^image\/svg\+xml/i.test(res.headers.get('content-type') ?? '')) return null;
    const svg = await res.text();
    return svg.length <= ROCKY_MAX_BYTES && /^\s*<svg[\s>]/.test(svg) ? svg : null;
  } catch {
    return null;
  }
}

/** Today's Rocky for this home, or null when Weather Scout isn't linked, can't draw him, or can't be reached. */
export async function homeRocky(db: DatabaseSync, homeId: string): Promise<string | null> {
  const w = await homeWeather(db, homeId);
  if (!w?.now || !w.rocky) return null;
  const outfitKey = rockyKey(w);
  const hit = rockyCache.get(homeId);
  if (hit?.outfitKey === outfitKey) return hit.svg;
  const { url } = link(db, homeId);
  const svg = url ? await askRocky(url, w) : null;
  if (svg) rockyCache.set(homeId, { outfitKey, svg });
  // Weather Scout down: yesterday's outfit is better than no Rocky.
  return svg ?? hit?.svg ?? null;
}

function cleanUrl(raw: unknown): string {
  const url = str(raw, 300)?.trim().replace(/\/+$/, '') ?? '';
  if (!url) return '';
  if (!/^https?:\/\/[^/\s]+/i.test(url)) throw new HttpError(400, "Weather Scout's address starts with http:// or https://");
  // Keep a path prefix (behind /weather on a reverse proxy), drop any query or fragment.
  const u = new URL(url);
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

export function weatherRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // Parents: the link's settings (the key never comes back out).
  app.get('/api/homes/:homeId/weather-link', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const { url, key } = link(db, ctx.homeId);
    return { url: url ?? '', hasKey: !!key };
  });

  // { url, key? }: url '' unlinks. A key is only replaced when one is sent. Answers with whether Weather Scout
  // accepted it, so a parent knows straight away whether it worked.
  app.put('/api/homes/:homeId/weather-link', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    const url = cleanUrl(b.url);
    const key = typeof b.key === 'string' ? b.key.trim() : '';
    if (key && (key.length > 200 || /\s/.test(key))) throw new HttpError(400, "That doesn't look like a Weather Scout app key");
    if (!url) {
      db.prepare('UPDATE homes SET weather_url = NULL, weather_key = NULL WHERE id = ?').run(ctx.homeId);
      cache.delete(ctx.homeId);
      rockyCache.delete(ctx.homeId);
      return { url: '', hasKey: false, check: null };
    }
    db.prepare('UPDATE homes SET weather_url = ? WHERE id = ?').run(url, ctx.homeId);
    if (key) db.prepare('UPDATE homes SET weather_key = ? WHERE id = ?').run(sealKey(key), ctx.homeId);
    cache.delete(ctx.homeId);
    rockyCache.delete(ctx.homeId);
    const saved = link(db, ctx.homeId);
    if (!saved.key) return { url, hasKey: false, check: null };
    const r = await askWeatherScout(url, saved.key);
    if (r.ok) cache.set(ctx.homeId, { at: Date.now(), ok: true, data: r.data });
    return {
      url, hasKey: true,
      check: r.ok ? { ok: true, place: r.data.place, temp: r.data.now.temp }
        : { ok: false, reason: r.status === 401 ? 'Weather Scout says that key is wrong (or it was removed).' : "Weather Scout didn't answer at that address." },
    };
  });

  // Anyone in the home: a parent, a kid, or the family tablet.
  app.get('/api/homes/:homeId/weather', async (req) => {
    const ctx = homeCtx(db, req);
    return { weather: await homeWeather(db, ctx.homeId) };
  });

  // Anyone in the home: Rocky in today's outfit, for the weather card's <img>. Fetched from Weather Scout by this
  // server, like the weather, so the tablet never needs to reach Weather Scout. The card adds ?v=<outfit> so a new
  // outfit is a new picture; the SVG is locked down so it can only ever be a picture.
  app.get('/api/homes/:homeId/weather/rocky.svg', async (req, reply) => {
    const ctx = homeCtx(db, req);
    const svg = await homeRocky(db, ctx.homeId);
    if (!svg) return reply.code(404).send({ error: "Rocky isn't here right now" });
    return reply
      .type('image/svg+xml; charset=utf-8')
      .header('cache-control', 'private, max-age=3600')
      .header('content-security-policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox")
      .header('x-content-type-options', 'nosniff')
      .send(svg);
  });
}
