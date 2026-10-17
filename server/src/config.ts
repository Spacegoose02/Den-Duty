import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function bool(v: string | undefined): boolean | undefined {
  if (v == null || v === '') return undefined;
  return /^(1|true|yes|on)$/i.test(v);
}

/** Without SESSION_SECRET, generate one once and keep it in the data folder so sign-ins survive restarts. */
function generatedSecret(): string {
  const dir = path.resolve(process.env.DATA_DIR || './data');
  const file = path.join(dir, '.session-secret');
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  } catch (err) {
    throw new Error(`Can't write to the data folder ${dir}. In Docker, set PUID/PGID to the folder's owner (Unraid: 99/100). ${(err as Error).message}`);
  }
}

const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
const port = Number(process.env.PORT || 8080);

export const config = {
  port,
  host: process.env.HOST || '0.0.0.0',
  // Only believe X-Forwarded-* headers from proxies on this machine or the local network, so nobody on the
  // internet can fake their address or protocol. Set TRUST_PROXY to a list of IPs/CIDRs to change it.
  trustProxy: (process.env.TRUST_PROXY || 'loopback,linklocal,uniquelocal').split(',').map((s) => s.trim()).filter(Boolean),
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  sessionSecret: process.env.SESSION_SECRET && process.env.SESSION_SECRET !== 'change-me'
    ? process.env.SESSION_SECRET
    : generatedSecret(),
  google: googleClientId && googleClientSecret ? { clientId: googleClientId, clientSecret: googleClientSecret } : null,
  // Name-only "quick sign-in" for parents: off, lan (home network addresses only) or anywhere. Admins can change it in the app.
  // ALLOW_LOCAL_LOGIN=true from older versions now means "lan".
  localLogin: process.env.LOCAL_LOGIN
    || (bool(process.env.ALLOW_LOCAL_LOGIN) === false ? 'off' : bool(process.env.ALLOW_LOCAL_LOGIN) ? 'lan' : null)
    || (googleClientId && googleClientSecret ? 'off' : 'lan'),
  // Who may create an account: open, invite (needs a home join code) or closed. The first account is always allowed.
  signupMode: process.env.SIGNUP_MODE || 'invite',
  // Fallback time zone for homes whose browser didn't say (each home stores its own).
  defaultTimezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  webDist: path.resolve(process.env.WEB_DIST || fileURLToPath(new URL('../../web/dist', import.meta.url))),
};
