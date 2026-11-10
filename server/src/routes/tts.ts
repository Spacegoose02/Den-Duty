// Read-aloud with Kokoro: a natural-sounding voice from the family's own Kokoro speech server (Kokoro-FastAPI or any
// server with the same OpenAI-style /v1/audio/speech and /v1/audio/voices). A parent saves its address (and a key, if
// it wants one) and picks a voice once per home. Tablets ask this server for the audio, so they never need to reach
// Kokoro themselves. When Kokoro isn't set up, can't be reached, or has no voice for a kid's language, the app falls
// back to the device's own voice, so read-aloud never goes quiet.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, str } from '../util.ts';
import { openKey, sealKey } from '../ai.ts';
import { rateLimit } from '../security.ts';
import { isLang, type Lang } from '../../../shared/languages.ts';

let fetchImpl: typeof fetch = (...a) => fetch(...a);
/** Tests: a stand-in for Kokoro. */
export function setTtsFetch(f: typeof fetch): void {
  fetchImpl = f;
}

/** Kokoro's voice names start with their language: a = American English, b = British English, e = Spanish, f = French. */
const LANG_PREFIXES: Record<Lang, string[]> = { en: ['a', 'b'], es: ['e'], fr: ['f'] };
/** Kokoro's nicest voice per language, used when the chosen voice speaks another language. */
const LANG_DEFAULTS: Record<Lang, string> = { en: 'af_heart', es: 'ef_dora', fr: 'ff_siwis' };
export const DEFAULT_VOICE = 'af_heart';
/** One voice (af_heart) or a Kokoro-FastAPI mix (af_bella(2)+af_sky(1)). */
const VOICE_RE = /^[a-z]{2}_[a-z0-9]+(\(\d+(\.\d+)?\))?(\+[a-z]{2}_[a-z0-9]+(\(\d+(\.\d+)?\))?){0,3}$/;
export const MAX_TEXT = 600;
/** Kids' read-aloud is a little slower than normal speech, like the device voice's 0.92. */
const SPEED = 0.92;

function link(db: DatabaseSync, homeId: string): { url: string | null; key: string | null; voice: string } {
  const r = db.prepare('SELECT tts_url, tts_key, tts_voice FROM homes WHERE id = ?').get(homeId) as Row | undefined;
  return {
    url: (r?.tts_url as string | null) ?? null,
    key: r?.tts_key ? openKey(r.tts_key as string) : null,
    voice: (r?.tts_voice as string | null) || DEFAULT_VOICE,
  };
}

/** Is Kokoro set up for this home? */
export function kokoroOn(db: DatabaseSync, homeId: string): boolean {
  return !!link(db, homeId).url;
}

const headers = (key: string | null, extra: Record<string, string> = {}) => ({ ...extra, ...(key ? { authorization: `Bearer ${key}` } : {}) });

// ---------- the voice list, asked for once in a while ----------

const VOICES_FRESH_MS = 60 * 60_000;
const voiceCache = new Map<string, { at: number; voices: string[] }>();

/** Kokoro-FastAPI answers { voices: ["af_heart", ...] }; other OpenAI-style servers may send objects. */
export function cleanVoices(raw: unknown): string[] {
  const b = raw && typeof raw === 'object' ? raw as Row : {};
  const list = Array.isArray(raw) ? raw : Array.isArray(b.voices) ? b.voices : Array.isArray(b.data) ? b.data : [];
  const names = list.slice(0, 500).map((v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? (v as Row).id ?? (v as Row).name : null))
    .filter((v): v is string => typeof v === 'string' && /^[a-z]{2}_[a-z0-9]+$/.test(v));
  return [...new Set(names)].sort();
}

type VoicesAsk = { ok: true; voices: string[] } | { ok: false; status: number | null };

async function askVoices(url: string, key: string | null): Promise<VoicesAsk> {
  try {
    const res = await fetchImpl(`${url}/v1/audio/voices`, { headers: headers(key, { accept: 'application/json' }), signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return { ok: false, status: res.status };
    const voices = cleanVoices(await res.json());
    return voices.length ? { ok: true, voices } : { ok: false, status: null };
  } catch {
    return { ok: false, status: null };
  }
}

async function homeVoices(db: DatabaseSync, homeId: string): Promise<string[] | null> {
  const { url, key } = link(db, homeId);
  if (!url) return null;
  const hit = voiceCache.get(homeId);
  if (hit && Date.now() - hit.at < VOICES_FRESH_MS) return hit.voices;
  const r = await askVoices(url, key);
  if (r.ok) voiceCache.set(homeId, { at: Date.now(), voices: r.voices });
  return r.ok ? r.voices : hit?.voices ?? null;
}

/**
 * The voice to read `lang` with: the chosen voice when it speaks that language, else Kokoro's usual voice for it, else
 * any voice Kokoro has for it. Null when Kokoro has none (the app then uses the device's voice for that language).
 */
export function voiceFor(lang: Lang, chosen: string, available: string[] | null): string | null {
  const prefixes = LANG_PREFIXES[lang];
  if (prefixes.includes(chosen[0])) return chosen;
  const has = (v: string) => !available || available.includes(v);
  if (has(LANG_DEFAULTS[lang])) return LANG_DEFAULTS[lang];
  return available?.find((v) => prefixes.includes(v[0])) ?? null;
}

// ---------- the audio, kept a while: chore titles and routine steps are said again and again ----------

const AUDIO_MAX_BYTES = 4 * 1024 * 1024;
const CACHE_MAX_BYTES = 32 * 1024 * 1024;
const audioCache = new Map<string, Buffer>();
let cacheBytes = 0;

function remember(k: string, audio: Buffer): void {
  audioCache.set(k, audio);
  cacheBytes += audio.length;
  for (const [old, buf] of audioCache) {
    if (cacheBytes <= CACHE_MAX_BYTES) break;
    audioCache.delete(old);
    cacheBytes -= buf.length;
  }
}

function forgetHome(homeId: string): void {
  voiceCache.delete(homeId);
  for (const [k, buf] of audioCache) if (k.startsWith(`${homeId}|`)) { audioCache.delete(k); cacheBytes -= buf.length; }
}

type SpeechAsk = { ok: true; audio: Buffer } | { ok: false; status: number | null };

async function askSpeech(url: string, key: string | null, voice: string, text: string): Promise<SpeechAsk> {
  try {
    const res = await fetchImpl(`${url}/v1/audio/speech`, {
      method: 'POST',
      headers: headers(key, { 'content-type': 'application/json', accept: 'audio/mpeg' }),
      body: JSON.stringify({ model: 'kokoro', input: text, voice, response_format: 'mp3', speed: SPEED, stream: false }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, status: res.status };
    if (!/^audio\//i.test(res.headers.get('content-type') ?? 'audio/mpeg')) return { ok: false, status: null };
    const audio = Buffer.from(await res.arrayBuffer());
    return audio.length && audio.length <= AUDIO_MAX_BYTES ? { ok: true, audio } : { ok: false, status: null };
  } catch {
    return { ok: false, status: null };
  }
}

/** The same cleanup the device voice gets: no emoji, single spaces. */
export const sayable = (text: string): string =>
  text.replace(/\p{Extended_Pictographic}|️|‍/gu, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

function cleanUrl(raw: unknown): string {
  const url = str(raw, 300)?.trim().replace(/\/+$/, '') ?? '';
  if (!url) return '';
  if (!/^https?:\/\/[^/\s]+/i.test(url)) throw new HttpError(400, "Kokoro's address starts with http:// or https://");
  // Keep a path prefix (behind /kokoro on a reverse proxy), drop a pasted /v1 and any query or fragment.
  const u = new URL(url);
  return `${u.origin}${u.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}`;
}

function cleanVoice(raw: unknown): string | null {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return null;
  if (v.length > 120 || !VOICE_RE.test(v)) throw new HttpError(400, 'Kokoro voices look like af_heart');
  return v;
}

export function ttsRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // Parents: the link's settings (the key never comes back out).
  app.get('/api/homes/:homeId/tts-link', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const { url, key, voice } = link(db, ctx.homeId);
    return { url: url ?? '', hasKey: !!key, voice };
  });

  // { url, key?, voice? }: url '' unlinks (back to the device voice). A key is only replaced when one is sent, and
  // key: '' removes it. Answers with Kokoro's voices, so a parent knows straight away whether it worked.
  app.put('/api/homes/:homeId/tts-link', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    const url = cleanUrl(b.url);
    forgetHome(ctx.homeId);
    if (!url) {
      db.prepare('UPDATE homes SET tts_url = NULL, tts_key = NULL WHERE id = ?').run(ctx.homeId);
      return { url: '', hasKey: false, voice: link(db, ctx.homeId).voice, check: null };
    }
    if (typeof b.key === 'string') {
      const key = b.key.trim();
      if (key.length > 300 || /\s/.test(key)) throw new HttpError(400, "That doesn't look like a key");
      db.prepare('UPDATE homes SET tts_key = ? WHERE id = ?').run(key ? sealKey(key) : null, ctx.homeId);
    }
    if ('voice' in b) db.prepare('UPDATE homes SET tts_voice = ? WHERE id = ?').run(cleanVoice(b.voice), ctx.homeId);
    db.prepare('UPDATE homes SET tts_url = ? WHERE id = ?').run(url, ctx.homeId);
    const saved = link(db, ctx.homeId);
    const r = await askVoices(url, saved.key);
    if (r.ok) voiceCache.set(ctx.homeId, { at: Date.now(), voices: r.voices });
    return {
      url, hasKey: !!saved.key, voice: saved.voice,
      check: r.ok ? { ok: true, voices: r.voices, voiceFound: r.voices.includes(saved.voice.split(/[(+]/)[0]) }
        : { ok: false, reason: r.status === 401 || r.status === 403 ? 'Kokoro says that key is wrong (or it wants one).' : "Kokoro didn't answer at that address." },
    };
  });

  // Parents: the voices to pick from.
  app.get('/api/homes/:homeId/tts/voices', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    if (!kokoroOn(db, ctx.homeId)) throw new HttpError(404, 'Kokoro isn\'t set up');
    const voices = await homeVoices(db, ctx.homeId);
    if (!voices) throw new HttpError(502, "Kokoro didn't answer");
    return { voices };
  });

  // Anyone in the home: `text` read out in the home's Kokoro voice, as MP3. ?lang= picks a voice that speaks the
  // kid's language. Parents can try another voice with ?voice= before saving it. The app adds ?v=<saved voice> so a
  // new voice is a new address (the audio is cached by the browser for a week).
  app.get('/api/homes/:homeId/tts/say', async (req, reply) => {
    const ctx = homeCtx(db, req);
    const q = (req.query ?? {}) as Row;
    const { url, key, voice: saved } = link(db, ctx.homeId);
    if (!url) throw new HttpError(404, 'Kokoro isn\'t set up');
    const text = sayable(typeof q.text === 'string' ? q.text : '');
    if (!text) throw new HttpError(400, 'Nothing to say');
    const lang: Lang = isLang(q.lang) ? q.lang : 'en';
    const tryVoice = ctx.actor.kind === 'parent' && typeof q.voice === 'string' && q.voice ? cleanVoice(q.voice) : null;
    const voice = tryVoice ?? voiceFor(lang, saved, await homeVoices(db, ctx.homeId));
    if (!voice) throw new HttpError(404, 'Kokoro has no voice for that language');
    const k = `${ctx.homeId}|${voice}|${text}`;
    let audio = audioCache.get(k);
    if (audio) {
      // Most recently used goes to the back of the line.
      audioCache.delete(k);
      audioCache.set(k, audio);
    } else {
      rateLimit(`tts:${ctx.homeId}`, 300, 15 * 60e3);
      const r = await askSpeech(url, key, voice, text);
      if (!r.ok) throw new HttpError(502, "Kokoro didn't answer");
      audio = r.audio;
      remember(k, audio);
    }
    return reply
      .type('audio/mpeg')
      .header('cache-control', 'private, max-age=604800')
      .header('x-content-type-options', 'nosniff')
      .send(audio);
  });
}
