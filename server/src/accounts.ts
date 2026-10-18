// Accounts and strong sign-in: passwords, two-factor codes, passkeys, sessions, and admin controls.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import QRCode from 'qrcode';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { config } from './config.ts';
import { tx, type Row } from './db.ts';
import { HttpError, randomToken, requireStr, sha256, str } from './util.ts';
import {
  addParent, createUser, cookieOpts, getUser, hasUsers, localLoginMode, publicUser, requireAdmin, requireUser, setSetting,
  signupMode, startMfa, startSession, type User,
} from './auth.ts';
import {
  clearRateLimit, hashPassword, limitAuth, newRecoveryCodes, newTotpSecret, otpauthUrl, passwordProblem,
  verifyPassword, verifyTotp,
} from './security.ts';

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/i;

function body(req: FastifyRequest): Row {
  return (req.body ?? {}) as Row;
}

/** Checks a TOTP code or an unused recovery code. Recovery codes are burned on use. */
function checkSecondFactor(db: DatabaseSync, user: User, code: string): boolean {
  const c = code.trim().toLowerCase();
  if (/^\d{3}\s?\d{3}$/.test(c) && user.totp_secret) {
    const step = verifyTotp(user.totp_secret, c, user.totp_last_step);
    if (step != null) {
      db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, user.id);
      return true;
    }
    return false;
  }
  const hash = sha256(c.replace(/[^a-z0-9]/g, ''));
  const r = db.prepare('UPDATE recovery_codes SET used_at = datetime(\'now\') WHERE user_id = ? AND code_hash = ? AND used_at IS NULL').run(user.id, hash);
  return r.changes > 0;
}

function issueRecoveryCodes(db: DatabaseSync, userId: string): string[] {
  const codes = newRecoveryCodes();
  tx(db, () => {
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
    const ins = db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)');
    for (const c of codes) ins.run(userId, sha256(c.replace(/[^a-z0-9]/g, '')));
  });
  return codes;
}

/** Sensitive changes need the current password (or a two-factor code) when the account has them. */
async function requireReauth(db: DatabaseSync, req: FastifyRequest, user: User): Promise<void> {
  const b = body(req);
  limitAuth(req, 'reauth', user.id);
  if (user.password_hash) {
    if (typeof b.currentPassword === 'string' && await verifyPassword(b.currentPassword, user.password_hash)) return;
    if (user.totp_enabled && typeof b.code === 'string' && checkSecondFactor(db, user, b.code)) return;
    throw new HttpError(403, user.totp_enabled ? 'Enter your current password or a two-factor code' : 'Enter your current password');
  }
  if (user.totp_enabled) {
    if (typeof b.code === 'string' && checkSecondFactor(db, user, b.code)) return;
    throw new HttpError(403, 'Enter a two-factor code');
  }
}

// ---------- passkeys (WebAuthn) ----------

const rp = () => {
  const u = new URL(config.publicUrl);
  return { id: u.hostname, origin: u.origin };
};

function saveChallenge(db: DatabaseSync, reply: FastifyReply, challenge: string, userId: string | null): void {
  const id = randomToken(16);
  db.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO webauthn_challenges (id, challenge, user_id, expires_at) VALUES (?, ?, ?, ?)')
    .run(id, challenge, userId, new Date(Date.now() + 5 * 60e3).toISOString());
  reply.setCookie('dn_webauthn', id, { ...cookieOpts(reply), maxAge: 300 });
}

function takeChallenge(db: DatabaseSync, req: FastifyRequest, reply: FastifyReply): { challenge: string; userId: string | null } {
  const raw = req.cookies.dn_webauthn;
  const un = raw ? req.unsignCookie(raw) : null;
  reply.clearCookie('dn_webauthn', { path: '/' });
  if (!un?.valid || !un.value) throw new HttpError(400, 'Passkey request expired. Try again.');
  const row = db.prepare('SELECT challenge, user_id FROM webauthn_challenges WHERE id = ? AND expires_at > ?').get(un.value, new Date().toISOString()) as Row | undefined;
  db.prepare('DELETE FROM webauthn_challenges WHERE id = ?').run(un.value);
  if (!row) throw new HttpError(400, 'Passkey request expired. Try again.');
  return { challenge: row.challenge as string, userId: row.user_id as string | null };
}

function passkeyHint(): string {
  return `Passkeys work only at ${config.publicUrl} (set PUBLIC_URL to the address you use, with https).`;
}

export function accountRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // ----- create an account with a username and password -----
  app.post('/api/auth/register', async (req, reply) => {
    limitAuth(req, 'register');
    const b = body(req);
    const username = requireStr(b.username, 'Username', 32).toLowerCase();
    if (!USERNAME.test(username)) throw new HttpError(400, 'Usernames are 3 to 32 letters, numbers, dots, dashes or underscores');
    const password = String(b.password ?? '');
    const problem = passwordProblem(password, username);
    if (problem) throw new HttpError(400, problem);
    const name = str(b.name, 60) ?? username;
    const first = !hasUsers(db);
    let homeId: string | null = null;
    if (!first) {
      const mode = signupMode(db);
      const code = str(b.joinCode, 20)?.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code) {
        homeId = ((db.prepare('SELECT id FROM homes WHERE join_code = ?').get(code) as Row | undefined)?.id as string) ?? null;
        if (!homeId) throw new HttpError(400, 'No home has that join code');
      }
      if (mode === 'closed') throw new HttpError(403, 'New accounts are turned off on this server. Ask the admin.');
      if (mode === 'invite' && !homeId) throw new HttpError(403, "You need a join code from someone's home to make an account here");
    }
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'That username is taken');
    const user = createUser(db, { name, username, passwordHash: await hashPassword(password) });
    if (homeId) addParent(db, homeId, user);
    startSession(db, reply, user.id, 'password');
    return { user: publicUser(user) };
  });

  // ----- password sign-in, then a two-factor code if turned on -----
  app.post('/api/auth/login', async (req, reply) => {
    const b = body(req);
    const username = requireStr(b.username, 'Username', 100).toLowerCase();
    limitAuth(req, 'login', username);
    const user = db.prepare('SELECT * FROM users WHERE username = ? OR (email = ? COLLATE NOCASE AND password_hash IS NOT NULL)').get(username, username) as User | undefined;
    const ok = await verifyPassword(String(b.password ?? ''), user?.password_hash);
    if (!user || !ok) throw new HttpError(401, 'Wrong username or password');
    if (user.disabled) throw new HttpError(403, 'That account is turned off. Ask the admin.');
    clearRateLimit(`login:acct:${username}`);
    if (user.totp_enabled) return { mfaRequired: true, ticket: startMfa(db, user.id, 'password') };
    startSession(db, reply, user.id, 'password');
    return { user: publicUser(user) };
  });

  app.post('/api/auth/login/2fa', async (req, reply) => {
    const b = body(req);
    const ticket = requireStr(b.ticket, 'Ticket', 200);
    const row = db.prepare('SELECT user_id, method FROM mfa_tickets WHERE id = ? AND expires_at > ?').get(sha256(ticket), new Date().toISOString()) as Row | undefined;
    if (!row) throw new HttpError(400, 'That sign-in expired. Start again.');
    limitAuth(req, '2fa', row.user_id as string);
    const user = getUser(db, row.user_id as string);
    if (!user || user.disabled) throw new HttpError(403, 'That account is turned off');
    if (!checkSecondFactor(db, user, requireStr(b.code, 'Code', 20))) throw new HttpError(401, "That code didn't work");
    db.prepare('DELETE FROM mfa_tickets WHERE id = ?').run(sha256(ticket));
    startSession(db, reply, user.id, `${row.method}+2fa`);
    return { user: publicUser(user) };
  });

  // ----- the signed-in person's own security settings -----
  app.get('/api/auth/security', async (req) => {
    const user = requireUser(req);
    const passkeys = db.prepare('SELECT id, name, created_at AS createdAt, last_used_at AS lastUsedAt FROM passkeys WHERE user_id = ? ORDER BY created_at').all(user.id);
    const left = (db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').get(user.id) as Row).n;
    return {
      username: user.username, hasPassword: !!user.password_hash, google: !!user.google_sub, email: user.email,
      totpEnabled: !!user.totp_enabled, recoveryCodesLeft: left, passkeys,
      passkeyOrigin: rp().origin,
    };
  });

  app.post('/api/auth/password', async (req) => {
    const user = requireUser(req);
    const b = body(req);
    await requireReauth(db, req, user);
    let username = user.username;
    if (!username) {
      username = requireStr(b.username, 'Username', 32).toLowerCase();
      if (!USERNAME.test(username)) throw new HttpError(400, 'Usernames are 3 to 32 letters, numbers, dots, dashes or underscores');
      if (db.prepare('SELECT 1 FROM users WHERE username = ? AND id != ?').get(username, user.id)) throw new HttpError(409, 'That username is taken');
    }
    const password = String(b.newPassword ?? '');
    const problem = passwordProblem(password, username);
    if (problem) throw new HttpError(400, problem);
    db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?').run(username, await hashPassword(password), user.id);
    // A new password signs out every other device.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(user.id, req.sessionHash ?? '');
    return { ok: true, username };
  });

  app.post('/api/auth/totp/setup', async (req) => {
    const user = requireUser(req);
    if (user.totp_enabled) throw new HttpError(400, 'Two-factor is already on');
    await requireReauth(db, req, user);
    const secret = newTotpSecret();
    db.prepare('UPDATE users SET totp_secret = ?, totp_last_step = NULL WHERE id = ?').run(secret, user.id);
    const url = otpauthUrl(secret, user.username ?? user.email ?? user.name);
    return { secret, otpauthUrl: url, qrSvg: await QRCode.toString(url, { type: 'svg', margin: 1, width: 220 }) };
  });

  app.post('/api/auth/totp/enable', async (req) => {
    const user = requireUser(req);
    if (!user.totp_secret) throw new HttpError(400, 'Start two-factor setup first');
    const step = verifyTotp(user.totp_secret, requireStr(body(req).code, 'Code', 10), null);
    limitAuth(req, 'totp-enable', user.id);
    if (step == null) throw new HttpError(400, "That code didn't match. Check your phone's clock and try the newest code.");
    db.prepare('UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?').run(step, user.id);
    return { recoveryCodes: issueRecoveryCodes(db, user.id) };
  });

  app.post('/api/auth/totp/disable', async (req) => {
    const user = requireUser(req);
    if (!user.totp_enabled) return { ok: true };
    limitAuth(req, 'totp-disable', user.id);
    if (!checkSecondFactor(db, user, requireStr(body(req).code, 'Code', 20))) throw new HttpError(403, "That code didn't work");
    db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL WHERE id = ?').run(user.id);
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(user.id);
    return { ok: true };
  });

  app.post('/api/auth/recovery-codes', async (req) => {
    const user = requireUser(req);
    if (!user.totp_enabled) throw new HttpError(400, 'Turn on two-factor first');
    limitAuth(req, 'recovery', user.id);
    if (!checkSecondFactor(db, user, requireStr(body(req).code, 'Code', 20))) throw new HttpError(403, "That code didn't work");
    return { recoveryCodes: issueRecoveryCodes(db, user.id) };
  });

  // ----- passkeys -----
  app.post('/api/auth/passkey/register-options', async (req, reply) => {
    const user = requireUser(req);
    // Adding a passkey grants lasting access, so prove it's really you first.
    await requireReauth(db, req, user);
    const existing = db.prepare('SELECT id, transports FROM passkeys WHERE user_id = ?').all(user.id) as Row[];
    const options = await generateRegistrationOptions({
      rpName: 'Den Duty',
      rpID: rp().id,
      userName: user.username ?? user.email ?? user.name,
      userDisplayName: user.name,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({ id: p.id as string, transports: p.transports ? JSON.parse(p.transports as string) : undefined })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    saveChallenge(db, reply, options.challenge, user.id);
    return options;
  });

  app.post('/api/auth/passkey/register', async (req, reply) => {
    const user = requireUser(req);
    const { challenge, userId } = takeChallenge(db, req, reply);
    if (userId !== user.id) throw new HttpError(400, 'Passkey request expired. Try again.');
    const b = body(req);
    let result;
    try {
      result = await verifyRegistrationResponse({
        response: b.response as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: rp().origin,
        expectedRPID: rp().id,
        requireUserVerification: false,
      });
    } catch (e) {
      throw new HttpError(400, `${(e as Error).message}. ${passkeyHint()}`);
    }
    if (!result.verified) throw new HttpError(400, "That passkey couldn't be verified");
    const cred = result.registrationInfo.credential;
    db.prepare('INSERT INTO passkeys (id, user_id, public_key, counter, transports, name) VALUES (?, ?, ?, ?, ?, ?)')
      .run(cred.id, user.id, Buffer.from(cred.publicKey), cred.counter, JSON.stringify(cred.transports ?? []), str(b.name, 60) ?? 'Passkey');
    return { ok: true };
  });

  app.post('/api/auth/passkey/login-options', async (req, reply) => {
    limitAuth(req, 'passkey');
    const options = await generateAuthenticationOptions({ rpID: rp().id, userVerification: 'preferred' });
    saveChallenge(db, reply, options.challenge, null);
    return options;
  });

  app.post('/api/auth/passkey/login', async (req, reply) => {
    limitAuth(req, 'passkey');
    const { challenge } = takeChallenge(db, req, reply);
    const response = body(req).response as AuthenticationResponseJSON;
    const pk = db.prepare('SELECT * FROM passkeys WHERE id = ?').get(String(response?.id ?? '')) as Row | undefined;
    if (!pk) throw new HttpError(401, "This server doesn't know that passkey");
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: rp().origin,
        expectedRPID: rp().id,
        credential: {
          id: pk.id as string,
          publicKey: new Uint8Array(pk.public_key as Uint8Array),
          counter: pk.counter as number,
          transports: pk.transports ? JSON.parse(pk.transports as string) : undefined,
        },
        requireUserVerification: false,
      });
    } catch (e) {
      throw new HttpError(401, `${(e as Error).message}. ${passkeyHint()}`);
    }
    if (!result.verified) throw new HttpError(401, "That passkey couldn't be verified");
    const user = getUser(db, pk.user_id as string);
    if (!user || user.disabled) throw new HttpError(403, 'That account is turned off');
    db.prepare("UPDATE passkeys SET counter = ?, last_used_at = datetime('now') WHERE id = ?").run(result.authenticationInfo.newCounter, pk.id as string);
    startSession(db, reply, user.id, 'passkey');
    return { user: publicUser(user) };
  });

  app.delete('/api/auth/passkeys/:id', async (req) => {
    const user = requireUser(req);
    db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').run((req.params as { id: string }).id, user.id);
    return { ok: true };
  });

  // ----- devices that are signed in -----
  app.get('/api/auth/sessions', async (req) => {
    const user = requireUser(req);
    const rows = db.prepare(`SELECT id, user_agent, ip, method, created_at, last_seen_at FROM sessions
      WHERE user_id = ? AND expires_at > ? ORDER BY COALESCE(last_seen_at, created_at) DESC`).all(user.id, new Date().toISOString()) as Row[];
    return rows.map((r) => ({
      id: (r.id as string).slice(0, 24), current: r.id === req.sessionHash, userAgent: r.user_agent, ip: r.ip,
      method: r.method ?? 'unknown', createdAt: r.created_at, lastSeenAt: r.last_seen_at,
    }));
  });

  app.delete('/api/auth/sessions/:id', async (req) => {
    const user = requireUser(req);
    const prefix = (req.params as { id: string }).id.replace(/[^0-9a-f]/g, '');
    if (prefix.length < 24) throw new HttpError(400, 'Bad session id');
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND substr(id, 1, 24) = ?').run(user.id, prefix);
    return { ok: true };
  });

  app.post('/api/auth/sessions/sign-out-others', async (req) => {
    const user = requireUser(req);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(user.id, req.sessionHash ?? '');
    return { ok: true };
  });

  // ----- server admin -----
  app.get('/api/admin/settings', async (req) => {
    requireAdmin(req);
    return { signupMode: signupMode(db), localLogin: localLoginMode(db), google: !!config.google, publicUrl: config.publicUrl };
  });

  app.patch('/api/admin/settings', async (req) => {
    requireAdmin(req);
    const b = body(req);
    if (b.signupMode === 'open' || b.signupMode === 'invite' || b.signupMode === 'closed') setSetting(db, 'signupMode', b.signupMode);
    if (b.localLogin === 'off' || b.localLogin === 'lan' || b.localLogin === 'anywhere') setSetting(db, 'localLogin', b.localLogin);
    return { signupMode: signupMode(db), localLogin: localLoginMode(db) };
  });

  // Help someone who's locked out: turn the account off/on, clear two-factor, or hand them a temporary password.
  app.post('/api/admin/users/:userId/security', async (req) => {
    const admin = requireAdmin(req);
    const { userId } = req.params as { userId: string };
    const target = getUser(db, userId);
    if (!target) throw new HttpError(404, 'No such person');
    const b = body(req);
    const out: Record<string, unknown> = { ok: true };
    if (typeof b.disabled === 'boolean') {
      if (userId === admin.id) throw new HttpError(400, "You can't turn off your own account");
      db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(b.disabled ? 1 : 0, userId);
      if (b.disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    }
    if (b.resetTwoFactor) {
      db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL WHERE id = ?').run(userId);
      db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
    }
    if (b.tempPassword) {
      const temp = randomToken(9);
      const username = target.username ?? `${target.name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'parent'}${userId.slice(0, 4)}`;
      db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?').run(username, await hashPassword(temp), userId);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      out.username = username;
      out.tempPassword = temp;
    }
    if (b.signOut) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    return out;
  });
}
