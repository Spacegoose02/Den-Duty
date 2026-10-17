import crypto from 'node:crypto';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const newId = (): string => crypto.randomUUID();

const READABLE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Short human-friendly code without look-alike characters (no 0/O, 1/I). */
export function readableCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const b of bytes) out += READABLE[b % READABLE.length];
  return out;
}

export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');

export function str(v: unknown, max = 500): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

export function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function requireStr(v: unknown, field: string, max = 500): string {
  const s = str(v, max);
  if (!s) throw new HttpError(400, `${field} is required`);
  return s;
}

export function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export const nowIso = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);
