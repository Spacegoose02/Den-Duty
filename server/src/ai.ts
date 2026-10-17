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

export async function suggest(db: DatabaseSync, homeId: string, ctx: IdeaContext): Promise<Idea[]> {
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
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(ctx) }],
    });
    if (res.stop_reason === 'refusal') throw new HttpError(422, "Claude couldn't help with that one. Try rewording the note.");
    const text = res.content.find((b) => b.type === 'text');
    const parsed = text && text.type === 'text' ? JSON.parse(text.text) as { ideas?: Idea[] } : null;
    return (parsed?.ideas ?? [])
      .filter((i) => i && typeof i.title === 'string' && Number.isFinite(i.points))
      .slice(0, 6)
      .map((i) => ({ title: i.title.slice(0, 80), points: Math.max(1, Math.min(100000, Math.round(i.points))), detail: String(i.detail ?? '').slice(0, 300) }));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(400, 'Anthropic rejected that API key. Check it in Settings.');
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Too many AI requests right now. Try again in a minute.');
    if (err instanceof Anthropic.APIError) throw new HttpError(502, `The AI service had a problem (${err.status ?? 'network'}). Try again later.`);
    if (err instanceof SyntaxError) throw new HttpError(502, 'The AI answer was garbled. Try again.');
    throw new HttpError(502, 'Could not reach the AI service. Check the server has internet access.');
  }
}
