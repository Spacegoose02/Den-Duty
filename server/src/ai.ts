// Ideas for goals, penalties and chores from Claude. Off by default: nothing leaves the server until a parent
// turns it on and pastes their own Anthropic API key. Kids' names are never sent, only what the idea needs.
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.ts';
import type { Row } from './db.ts';
import { HttpError } from './util.ts';

export const DEFAULT_MODEL = 'claude-opus-5-5';

// ---------- the key, encrypted at rest with a key derived from the session secret ----------

const keyBytes = () => crypto.createHash('sha256').update(`ai-key:${config.sessionSecret}`).digest();

export function sealKey(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

export function openKey(sealed: string): string | null {
  try {
    const [v, iv, tag, data] = sealed.split('.');
    if (v !== 'v1') return null;
    const d = crypto.createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null; // e.g. the session secret changed
  }
}

export interface AiSettings { enabled: boolean; hasKey: boolean; keyHint: string | null; model: string }

export function aiSettings(db: DatabaseSync, homeId: string): AiSettings {
  const h = db.prepare('SELECT ai_enabled, ai_key, ai_model FROM homes WHERE id = ?').get(homeId) as Row;
  const key = h.ai_key ? openKey(h.ai_key as string) : null;
  return { enabled: !!h.ai_enabled, hasKey: !!key, keyHint: key ? `…${key.slice(-4)}` : null, model: (h.ai_model as string) || DEFAULT_MODEL };
}

// ---------- asking for ideas ----------

export type IdeaKind = 'goal' | 'penalty' | 'chore';

export interface Idea { title: string; points: number; detail: string }

/** Swapped in tests so no request leaves the machine. */
let fetchOverride: typeof fetch | undefined;
export function setAiFetch(f: typeof fetch | undefined): void { fetchOverride = f; }

const SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short, kid-friendly title' },
          points: { type: 'integer', description: 'Suggested points' },
          detail: { type: 'string', description: 'One sentence: the reward, the kind wording, or how to do it' },
        },
        required: ['title', 'points', 'detail'],
        additionalProperties: false,
      },
    },
  },
  required: ['ideas'],
  additionalProperties: false,
};

const SYSTEM = `You help parents run a kids' chore chart with points. Suggest practical, age-appropriate, kind ideas.
Never shame or frighten. Penalties are small, fair, explained gently, and focused on what to do next time.
Goals are real rewards a family can give: experiences, privileges, small treats, time together. Keep titles under 40 characters.`;

export interface IdeaContext {
  kind: IdeaKind;
  pointsName: string;
  /** What a typical week earns, so suggested sizes make sense. */
  weeklyPoints: number;
  age?: number | null;
  existing: string[];
  hint?: string | null;
}

export function buildPrompt(c: IdeaContext): string {
  const ask = {
    goal: `Suggest 5 goals (rewards to save up for). Size "points" so the goal takes about 1 to 4 weeks at this pace.`,
    penalty: 'Suggest 5 gentle consequences for a small slip. "points" is how many to take away (1 to 5 usually). "detail" is a kind way to say it to the child.',
    chore: 'Suggest 5 chores. "points" fits the effort compared with the weekly pace. "detail" says how to do it well.',
  }[c.kind];
  return [
    ask,
    `Points are called ${c.pointsName}. A typical week earns about ${c.weeklyPoints}.`,
    c.age ? `The child is about ${c.age} years old.` : '',
    c.existing.length ? `Already have (don't repeat): ${c.existing.slice(0, 20).join('; ')}.` : '',
    c.hint ? `The parent adds: ${c.hint}` : '',
  ].filter(Boolean).join('\n');
}

/** One structured request to Claude with the home's key. Throws friendly HttpErrors for the app to show. */
async function askJson<T>(db: DatabaseSync, homeId: string, system: string, prompt: string, schema: Record<string, unknown>): Promise<T> {
  const h = db.prepare('SELECT ai_enabled, ai_key, ai_model FROM homes WHERE id = ?').get(homeId) as Row;
  if (!h.ai_enabled) throw new HttpError(403, 'AI ideas are turned off. A parent can turn them on in Settings.');
  const apiKey = h.ai_key ? openKey(h.ai_key as string) : null;
  if (!apiKey) throw new HttpError(400, 'Add an Anthropic API key in Settings first');
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000, ...(fetchOverride ? { fetch: fetchOverride } : {}) });
  try {
    const res = await client.beta.messages.create({
      model: (h.ai_model as string) || DEFAULT_MODEL,
      max_tokens: 16000,
      // If the model declines for policy reasons, let the API retry on its recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    if (res.stop_reason === 'refusal') throw new HttpError(422, "Claude couldn't help with that one. Try rewording the note.");
    const text = res.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') throw new SyntaxError('no text');
    return JSON.parse(text.text) as T;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(400, 'Anthropic rejected that API key. Check it in Settings.');
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Too many AI requests right now. Try again in a minute.');
    if (err instanceof Anthropic.APIError) throw new HttpError(502, `The AI service had a problem (${err.status ?? 'network'}). Try again later.`);
    if (err instanceof SyntaxError) throw new HttpError(502, 'The AI answer was garbled. Try again.');
    throw new HttpError(502, 'Could not reach the AI service. Check the server has internet access.');
  }
}

export async function suggest(db: DatabaseSync, homeId: string, ctx: IdeaContext): Promise<Idea[]> {
  const parsed = await askJson<{ ideas?: Idea[] }>(db, homeId, SYSTEM, buildPrompt(ctx), SCHEMA);
  return (parsed?.ideas ?? [])
    .filter((i) => i && typeof i.title === 'string' && Number.isFinite(i.points))
    .slice(0, 6)
    .map((i) => ({ title: i.title.slice(0, 80), points: Math.max(1, Math.min(100000, Math.round(i.points))), detail: String(i.detail ?? '').slice(0, 300) }));
}

// ---------- speech and occupational therapy helpers ----------

export type HelperArea = 'speech' | 'ot';

export const THERAPY_DISCLAIMER = "General ideas to talk over with your child's therapist or doctor. Not medical advice.";

export interface HelperResult {
  tip: { title: string; activity: string; minutes: number; why: string };
  goals: { title: string; why: string }[];
}

const HELPER_SCHEMA = {
  type: 'object',
  properties: {
    tip: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, friendly name for today\'s activity' },
        activity: { type: 'string', description: 'What the parent does, in 2 to 4 plain sentences' },
        minutes: { type: 'integer', description: 'About how long it takes' },
        why: { type: 'string', description: 'One sentence on what it practices' },
      },
      required: ['title', 'activity', 'minutes', 'why'],
      additionalProperties: false,
    },
    goals: {
      type: 'array',
      description: '3 possible goals or next steps the parent could discuss with the therapist',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, why: { type: 'string' } },
        required: ['title', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['tip', 'goals'],
  additionalProperties: false,
};

const HELPER_SYSTEM: Record<HelperArea, string> = {
  speech: `You give parents simple, play-based speech and language practice ideas for home: games, books, songs, everyday routines
(bath, meals, car rides). Use warm, plain words and no jargon. You are not the child's therapist: never diagnose, never promise outcomes,
never contradict a professional, and frame ideas as things to try and talk over with the child's speech therapist.`,
  ot: `You give parents simple, play-based occupational therapy ideas for home: fine motor play (playdough, tongs, stickers, drawing),
sensory play and calming routines, and self-care practice (dressing, buttons, brushing teeth, using utensils) built into everyday life.
Use warm, plain words and no jargon. You are not the child's therapist: never diagnose, never promise outcomes, never contradict a
professional, keep everything safe for the child's age, and frame ideas as things to try and talk over with the child's occupational therapist.`,
};

/** Only the age, the area and the goal text are sent. Never names, notes or appointments. */
export function helperPrompt(area: HelperArea, age: number | null, goals: string[], date: string): string {
  const what = area === 'speech' ? 'speech and language' : 'occupational therapy (fine motor, sensory, self-care)';
  return [
    `Give one short daily activity for ${what} practice at home, and 3 goal ideas.`,
    age != null ? `The child is ${age} years old.` : 'The child\'s age is unknown; keep it suitable for young children.',
    goals.length ? `Goals the family is working on: ${goals.slice(0, 10).join('; ')}.` : 'No goals set yet: suggest common, gentle starting points for this age.',
    `Today is ${date}; vary the activity from day to day.`,
  ].join('\n');
}

export async function therapyHelper(db: DatabaseSync, homeId: string, area: HelperArea, age: number | null, goals: string[], date: string): Promise<HelperResult> {
  const r = await askJson<HelperResult>(db, homeId, HELPER_SYSTEM[area], helperPrompt(area, age, goals, date), HELPER_SCHEMA);
  return {
    tip: {
      title: String(r.tip?.title ?? '').slice(0, 80), activity: String(r.tip?.activity ?? '').slice(0, 800),
      minutes: Math.max(1, Math.min(60, Math.round(Number(r.tip?.minutes) || 10))), why: String(r.tip?.why ?? '').slice(0, 300),
    },
    goals: (r.goals ?? []).slice(0, 5).map((g) => ({ title: String(g.title).slice(0, 120), why: String(g.why ?? '').slice(0, 300) })),
  };
}

// ---------- the daily den message on a kid's screen ----------

const ROOM_SCHEMA = {
  type: 'object',
  properties: { message: { type: 'string', description: 'One or two short, upbeat sentences that include {name} exactly once' } },
  required: ['message'],
  additionalProperties: false,
};

const ROOM_SYSTEM = `You write one short, warm, encouraging message a day for a child's chore app, about keeping their room tidy.
The app's mascot is a raccoon, and a raccoon's home is a den, so playful den and raccoon touches are welcome. Be positive and specific
(make the bed, toys in bins, clothes in the hamper, books on the shelf), never nagging, shaming or scary. Match the reading level to the age:
very short and simple for little ones. Use {name} once where the child's name goes. At most 2 sentences and one emoji.`;

/** Only the age and the date are sent. The name is a {name} placeholder filled in on the server. */
export function roomPrompt(age: number | null, date: string): string {
  return [age != null ? `The child is ${age} years old.` : "The child's age isn't known; keep it simple.", `Today is ${date}; make it different from other days.`].join('\n');
}

export async function roomMessageAi(db: DatabaseSync, homeId: string, age: number | null, date: string): Promise<string> {
  const r = await askJson<{ message: string }>(db, homeId, ROOM_SYSTEM, roomPrompt(age, date), ROOM_SCHEMA);
  const text = String(r.message ?? '').trim().slice(0, 300);
  if (!text) throw new Error('empty');
  return text.includes('{name}') ? text : `{name}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

// ---------- "Ask Dr. Bandit" in Doctors ----------

export const ASK_DISCLAIMER = "General information to talk over with your child's doctor or therapist. Not medical advice.";
export const URGENT_NOTE = 'For anything urgent, call your doctor now, or your local emergency number (911 in the US) in an emergency.';

const ASK_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'A short, practical answer in plain words: 2 to 6 sentences or a few short bullets' },
    urgent: { type: 'boolean', description: 'True if the question describes something that may need a doctor today or emergency care' },
  },
  required: ['answer', 'urgent'],
  additionalProperties: false,
};

const ASK_SYSTEM = (name: string) => `You are ${name}, a friendly raccoon doctor character in a family app. You help parents with short, practical,
everyday information about their child's health, development and therapy goals: what is common at an age, simple things to try at home,
and good questions to ask their doctor or therapist. Keep answers short and warm. You are not the child's doctor: never diagnose, never
recommend or dose medicines, never contradict their professionals. If anything sounds urgent or serious (breathing trouble, injury,
high fever in a baby, dehydration, a sudden change, self-harm), say clearly to contact their doctor or emergency services now and set urgent to true.
Stay within the areas the parent has turned on; if the question is outside them, answer briefly and suggest asking their doctor.`;

/** Only the age, the areas turned on, active goal text and the question are sent. Never names, notes or appointments. */
const BEHAVIOR_FOCUS = 'The parent wants practical, age-appropriate ideas for feelings and behavior: what to say, what to try in the moment, and '
  + 'how to practice when everyone is calm. Be gentle and positive: name the feeling, connect first, no shaming or harsh punishment.';

export function askPrompt(age: number | null, areas: string[], goals: string[], question: string, behavior = false): string {
  return [
    behavior ? BEHAVIOR_FOCUS : '',
    age != null ? `The child is ${age} years old.` : "The child's age isn't known.",
    `Areas the parent follows for this child: ${areas.length ? areas.join(', ') : 'none set'}.`,
    goals.length ? `Current goals: ${goals.slice(0, 15).join('; ')}.` : '',
    `Question: ${question}`,
  ].filter(Boolean).join('\n');
}

export async function askDoctor(db: DatabaseSync, homeId: string, name: string, age: number | null, areas: string[], goals: string[], question: string, behavior = false): Promise<{ answer: string; urgent: boolean }> {
  const r = await askJson<{ answer: string; urgent: boolean }>(db, homeId, ASK_SYSTEM(name), askPrompt(age, areas, goals, question, behavior), ASK_SCHEMA);
  return { answer: String(r.answer ?? '').slice(0, 2000), urgent: !!r.urgent };
}
