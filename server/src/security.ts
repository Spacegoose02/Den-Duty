// Password hashing, two-factor codes, rate limiting and HTTP hardening. Built on node:crypto only.
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from './util.ts';

// ---------- passwords (scrypt) ----------

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

function scrypt(password: string, salt: Buffer, opts = SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFKC'), salt, opts.keylen, { N: opts.N, r: opts.r, p: opts.p, maxmem: opts.maxmem }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // Spend the same time as a real check so response times don't reveal which usernames exist.
    await scrypt(password, crypto.randomBytes(16));
    return false;
  }
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), { ...SCRYPT, N: Number(n), r: Number(r), p: Number(p), keylen: expected.length });
  return crypto.timingSafeEqual(key, expected);
}

const COMMON = new Set(['password', 'password1', 'password123', '123456789', '1234567890', 'qwertyuiop', 'iloveyou', 'letmein123', 'welcome123', 'daytimeninja']);

/** Returns a reason the password is too weak, or null when it's fine. */
export function passwordProblem(password: string, username = ''): string | null {
  if (password.length < 10) return 'Use at least 10 characters';
  if (password.length > 200) return 'That password is too long';
  if (COMMON.has(password.toLowerCase())) return 'That password is too common';
  if (username && password.toLowerCase().includes(username.toLowerCase())) return "Don't put your username in your password";
  if (/^(.)\1+$/.test(password)) return 'That password is too simple';
  return null;
}

// ---------- TOTP two-factor codes (RFC 6238) ----------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = (): string => base32Encode(crypto.randomBytes(20));

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 1_000_000).padStart(6, '0');
}

/**
 * Checks a 6-digit code, allowing one 30-second step of clock drift either way.
 * Returns the matched step so callers can refuse to accept the same code twice.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const step = Math.floor(now / 30000);
  for (const s of [step - 1, step, step + 1]) {
    if (lastStep != null && s <= lastStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(totpCode(secret, s)), Buffer.from(c))) return s;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer = 'Daytime Ninja'): string {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function newRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const s = base32Encode(crypto.randomBytes(8)).slice(0, 10).toLowerCase();
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

// ---------- rate limiting ----------

interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();

/**
 * Allows `limit` hits per `windowMs` for a key (an IP, a username, ...). Throws 429 when exceeded.
 * In-memory is enough for a single self-hosted server.
 */
export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  if (buckets.size > 50_000) for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  b.count++;
  if (b.count > limit) {
    const mins = Math.ceil((b.resetAt - now) / 60000);
    throw new HttpError(429, `Too many tries. Wait ${mins} minute${mins === 1 ? '' : 's'} and try again.`);
  }
}

export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/** Login-style endpoints: limited per client address and per account name. */
export function limitAuth(req: FastifyRequest, kind: string, account?: string | null): void {
  rateLimit(`${kind}:ip:${req.ip}`, 20, 15 * 60e3);
  if (account) rateLimit(`${kind}:acct:${account.toLowerCase()}`, 8, 15 * 60e3);
}

// ---------- network ----------

/** True for loopback and private-network addresses (the people in your house). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.replace(/^::ffff:/, '');
  if (v === '::1' || v.startsWith('127.')) return true;
  if (/^(10\.|192\.168\.|169\.254\.)/.test(v)) return true;
  const m = v.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v)) return true; // Tailscale / CGNAT
  if (/^f[cd][0-9a-f]{2}:/i.test(v) || /^fe80:/i.test(v)) return true;
  return false;
}

// ---------- HTTP hardening ----------

export function installHardening(app: FastifyInstance): void {
  // Cross-site request forgery: state-changing API calls must come from this site.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (!origin || origin === 'null') return; // non-browser clients (Home Assistant, curl) send no Origin
    let host: string;
    try { host = new URL(origin).host; } catch { throw new HttpError(403, 'Bad origin'); }
    if (host !== req.headers.host && host !== req.headers['x-forwarded-host']) throw new HttpError(403, 'Requests from other sites are not allowed');
  });

  app.addHook('onSend', async (req, reply, payload) => {
    // The Android and desktop apps check this from their own built-in page before switching to the server.
    if (req.url === '/api/health') reply.header('access-control-allow-origin', '*');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('x-frame-options', 'DENY');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)');
    reply.header('cross-origin-opener-policy', 'same-origin');
    if (req.protocol === 'https') reply.header('strict-transport-security', 'max-age=31536000');
    if (!req.url.startsWith('/api/')) {
      reply.header('content-security-policy', [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https: http:",
        "connect-src 'self'",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self' https://accounts.google.com",
        "frame-ancestors 'none'",
      ].join('; '));
    }
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    return payload;
  });
}
