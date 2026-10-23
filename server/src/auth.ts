import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import * as oidc from 'openid-client';
import { config } from './config.ts';
import { HttpError, newId, randomToken, readableCode, requireStr, sha256, str } from './util.ts';
import type { Row } from './db.ts';
import { isPrivateAddress, limitAuth } from './security.ts';
import { isAvatar } from '../../shared/catalog.ts';
import { isThemeId } from '../../shared/themes.ts';

export const SESSION_COOKIE = 'dn_session';
/** A family tablet's sign-in. It belongs to a home, not a person. */
export const DEVICE_COOKIE = 'dn_device';
/** The kid who tapped their avatar on a family tablet. Only valid together with that tablet's device cookie. */
export const KID_COOKIE = 'dn_kid';
const SESSION_DAYS = 60;
const DEVICE_DAYS = 400;
const KID_SESSION_HOURS = 12;

export interface User {
  id: string;
  email: string | null;
  name: string;
  username: string | null;
  avatar: string;
  theme: string;
  is_admin: number;
  disabled: number;
  last_home_id: string | null;
  google_sub: string | null;
  oidc_sub: string | null;
  forward_user: string | null;
  password_hash: string | null;
  totp_secret: string | null;
  totp_enabled: number;
  totp_last_step: number | null;
}

export type Role = 'parent' | 'kid';

/** Who is acting in a home. */
export type Actor =
  // memberId is null for a server admin who isn't in the home; user is null for an API token on a /api/v1 route (see routes/v1.ts)
  | { kind: 'parent'; user: User | null; memberId: string | null }
  | { kind: 'kid'; memberId: string }
  | { kind: 'device'; deviceId: string } // a family tablet with nobody picked yet
  | { kind: 'token'; scope: 'read' | 'control' }; // Home Assistant or another automation

export interface HomeCtx {
  homeId: string;
  actor: Actor;
  /** The signed-in parent, when the actor is one. */
  user: User | null;
  /** The API token's name, when one is acting (for the ledger's "by"). */
  tokenName?: string;
}

export interface DeviceAuth { id: string; homeId: string; name: string }
export interface KidAuth { memberId: string; homeId: string; sessionHash: string }

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    tokenHomeId: string | null;
    tokenScope: 'read' | 'control' | null;
    tokenName: string | null;
    /** Hash of the current session id, for "this device" in the sessions list. */
    sessionHash: string | null;
    device: DeviceAuth | null;
    kid: KidAuth | null;
  }
}

/**
 * Cookies are only marked Secure when this request really came in over HTTPS. Basing it on PUBLIC_URL broke
 * sign-in for anyone reaching an https server by its plain-http LAN address (the browser silently dropped the cookie).
 */
export function cookieOpts(reply: FastifyReply) {
  return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: reply.request.protocol === 'https', signed: true };
}

// ---------- server-wide sign-in settings (admins can change these in the app) ----------

export type SignupMode = 'open' | 'invite' | 'closed';
export type LocalLogin = 'off' | 'lan' | 'anywhere';

export function getSetting(db: DatabaseSync, key: string): string | null {
  return ((db.prepare('SELECT value FROM server_settings WHERE key = ?').get(key) as Row | undefined)?.value as string) ?? null;
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT INTO server_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function signupMode(db: DatabaseSync): SignupMode {
  const v = getSetting(db, 'signupMode') ?? config.signupMode;
  return v === 'open' || v === 'closed' ? v : 'invite';
}

export function localLoginMode(db: DatabaseSync): LocalLogin {
  const v = getSetting(db, 'localLogin') ?? config.localLogin;
  return v === 'off' || v === 'anywhere' ? v : 'lan';
}

/** Name-only sign-in: never from the internet unless an admin explicitly chose "anywhere". */
export function localLoginAllowed(db: DatabaseSync, req: FastifyRequest): boolean {
  const mode = localLoginMode(db);
  return mode === 'anywhere' || (mode === 'lan' && isPrivateAddress(req.ip));
}

export const hasUsers = (db: DatabaseSync): boolean => !!db.prepare('SELECT 1 FROM users LIMIT 1').get();

// ---------- sessions ----------

export function startSession(db: DatabaseSync, reply: FastifyReply, userId: string, method: string): void {
  const id = randomToken();
  const req = reply.request;
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, user_agent, ip, method, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(sha256(id), userId, expires, str(req.headers['user-agent'], 300), req.ip, method);
  reply.setCookie(SESSION_COOKIE, id, { ...cookieOpts(reply), maxAge: SESSION_DAYS * 86400 });
}

/** Two-factor step: a short-lived ticket the browser trades, along with a code, for a session. */
export function startMfa(db: DatabaseSync, userId: string, method: string): string {
  const id = randomToken();
  db.prepare('DELETE FROM mfa_tickets WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO mfa_tickets (id, user_id, method, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(id), userId, method, new Date(Date.now() + 5 * 60e3).toISOString());
  return id;
}

export function getUser(db: DatabaseSync, id: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
}

/** Creates a user. The very first account on a server becomes its admin. */
export function createUser(db: DatabaseSync, u: {
  name: string; username?: string | null; email?: string | null; googleSub?: string | null; oidcSub?: string | null;
  forwardUser?: string | null; passwordHash?: string | null;
}): User {
  const id = newId();
  db.prepare(`INSERT INTO users (id, name, username, email, google_sub, oidc_sub, forward_user, password_hash, is_admin, theme)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'home')`)
    .run(id, u.name, u.username ?? null, u.email ?? null, u.googleSub ?? null, u.oidcSub ?? null, u.forwardUser ?? null, u.passwordHash ?? null, hasUsers(db) ? 0 : 1);
  return getUser(db, id)!;
}

/** Adds a signed-in person to a home as a parent (no-op if they're already in it). */
export function addParent(db: DatabaseSync, homeId: string, user: Pick<User, 'id' | 'name' | 'avatar'>): void {
  db.prepare("INSERT OR IGNORE INTO members (id, home_id, user_id, role, name, avatar) VALUES (?, ?, ?, 'parent', ?, ?)")
    .run(newId(), homeId, user.id, user.name, user.avatar);
  db.prepare('UPDATE users SET last_home_id = ? WHERE id = ?').run(homeId, user.id);
}

/** Signs this browser in as a home's family tablet. */
export function startDevice(db: DatabaseSync, reply: FastifyReply, homeId: string, name: string, createdBy: string | null): DeviceAuth {
  const token = randomToken();
  const id = newId();
  db.prepare('INSERT INTO devices (id, home_id, name, token_hash, created_by) VALUES (?, ?, ?, ?, ?)').run(id, homeId, name, sha256(token), createdBy);
  reply.setCookie(DEVICE_COOKIE, token, { ...cookieOpts(reply), maxAge: DEVICE_DAYS * 86400 });
  return { id, homeId, name };
}

export function startKidSession(db: DatabaseSync, reply: FastifyReply, memberId: string, deviceId: string): void {
  const id = randomToken();
  db.prepare('DELETE FROM kid_sessions WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO kid_sessions (id, member_id, device_id, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(id), memberId, deviceId, new Date(Date.now() + KID_SESSION_HOURS * 3600e3).toISOString());
  reply.setCookie(KID_COOKIE, id, { ...cookieOpts(reply), maxAge: KID_SESSION_HOURS * 3600 });
}

function signedCookie(req: FastifyRequest, name: string): string | null {
  const raw = req.cookies[name];
  if (!raw) return null;
  const un = req.unsignCookie(raw);
  return un.valid ? un.value : null;
}

/**
 * Finds the account for a single sign-on identity: by its id at the provider, then by verified email (and links it).
 * New people get an account the same way the rest of sign-up works: open, invite-only (needs a home join code from
 * before the round trip), or closed. Returns the reason instead of a user when it can't.
 */
export function findOrCreateSsoUser(db: DatabaseSync, req: FastifyRequest, reply: FastifyReply | null,
  id: { column: 'google_sub' | 'oidc_sub' | 'forward_user'; sub: string; email: string | null; name: string; skipInvite?: boolean }): User | 'closed' | 'invite' {
  let user = db.prepare(`SELECT * FROM users WHERE ${id.column} = ?`).get(id.sub) as User | undefined;
  if (!user && id.email) {
    user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(id.email) as User | undefined;
    if (user) db.prepare(`UPDATE users SET ${id.column} = ? WHERE id = ?`).run(id.sub, user.id);
  }
  if (user) return user;
  const fields = {
    name: id.name, email: id.email,
    googleSub: id.column === 'google_sub' ? id.sub : null,
    oidcSub: id.column === 'oidc_sub' ? id.sub : null,
    forwardUser: id.column === 'forward_user' ? id.sub : null,
  };
  const mode = signupMode(db);
  if (!hasUsers(db) || mode === 'open') return createUser(db, fields);
  if (mode === 'closed') return 'closed';
  // The reverse proxy already decided who gets in, so it doesn't need a join code; they'll create or join a home next.
  if (id.skipInvite) return createUser(db, fields);
  const pending = req.cookies.dn_invite ? req.unsignCookie(req.cookies.dn_invite) : null;
  const home = pending?.valid && pending.value ? db.prepare('SELECT id FROM homes WHERE join_code = ?').get(pending.value) as Row | undefined : undefined;
  if (!home) return 'invite';
  const created = createUser(db, fields);
  addParent(db, home.id as string, created);
  reply?.clearCookie('dn_invite', { path: '/' });
  return created;
}

/** Is the machine that sent this request one of the reverse proxies allowed to vouch for people? */
export function trustedPeer(addr: string | undefined, trusted: string[]): boolean {
  if (!addr) return false;
  const ip = addr.replace(/^::ffff:/, '');
  const ipv4 = /^\d+\.\d+\.\d+\.\d+$/;
  const toNum = (s: string) => s.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
  return trusted.some((t) => {
    if (t === 'private') return isPrivateAddress(ip);
    if (!t.includes('/')) return t === ip;
    const [net, bits] = t.split('/');
    if (!ipv4.test(ip) || !ipv4.test(net)) return false;
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return (toNum(ip) & mask) === (toNum(net) & mask);
  });
}

/** Accounts protected by a password, Google, two-factor or a passkey can never be used through name-only sign-in. */
function isQuickAccount(db: DatabaseSync, u: User): boolean {
  return !u.password_hash && !u.google_sub && !u.oidc_sub && !u.forward_user && !u.email && !u.totp_enabled
    && !db.prepare('SELECT 1 FROM passkeys WHERE user_id = ?').get(u.id);
}

/** Resolves the caller from the session cookie, a bearer session, a home API token, and the family tablet cookies. */
export function installAuth(app: FastifyInstance, db: DatabaseSync): void {
  app.decorateRequest('user', null);
  app.decorateRequest('tokenHomeId', null);
  app.decorateRequest('tokenScope', null);
  app.decorateRequest('tokenName', null);
  app.decorateRequest('sessionHash', null);
  app.decorateRequest('device', null);
  app.decorateRequest('kid', null);
  app.addHook('onRequest', async (req) => {
    req.user = null;
    req.tokenHomeId = null;
    req.tokenScope = null;
    req.tokenName = null;
    req.sessionHash = null;
    req.device = null;
    req.kid = null;
    resolveDevice(db, req);
    let sessionId = signedCookie(req, SESSION_COOKIE);
    const authz = req.headers.authorization;
    if (!sessionId && authz?.startsWith('Bearer ')) {
      const token = authz.slice(7).trim();
      if (token.startsWith('dnk_')) {
        const t = db.prepare('SELECT id, home_id, scope, name FROM api_tokens WHERE token_hash = ?').get(sha256(token)) as Row | undefined;
        if (t) {
          req.tokenHomeId = t.home_id as string;
          req.tokenScope = t.scope === 'control' ? 'control' : 'read';
          req.tokenName = t.name as string;
          db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(t.id as string);
        }
        return;
      }
      sessionId = token;
    }
    if (!sessionId) {
      resolveForwardAuth(db, req);
      return;
    }
    const hash = sha256(sessionId);
    const row = db.prepare(`
      SELECT u.*, s.last_seen_at AS session_seen FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0`).get(hash, new Date().toISOString()) as (User & { session_seen: string | null }) | undefined;
    if (!row) return;
    req.user = row;
    req.sessionHash = hash;
    if (!row.session_seen || Date.parse(`${row.session_seen.replace(' ', 'T')}Z`) < Date.now() - 5 * 60e3) {
      db.prepare("UPDATE sessions SET last_seen_at = datetime('now'), ip = ? WHERE id = ?").run(req.ip, hash);
    }
  });
}

/** A reverse proxy in front of us signed this person in and says who they are in a header. */
function resolveForwardAuth(db: DatabaseSync, req: FastifyRequest): void {
  const fa = config.forwardAuth;
  if (!fa) return;
  const header = (name: string) => {
    const v = req.headers[name];
    return str(Array.isArray(v) ? v[0] : v, 200);
  };
  const username = header(fa.userHeader);
  // Only the proxy itself may send this header; anyone else could just type it.
  if (!username || !trustedPeer(req.socket.remoteAddress, fa.trusted)) return;
  const emailRaw = header(fa.emailHeader);
  const email = emailRaw && /^[^@\s]+@[^@\s]+$/.test(emailRaw) ? emailRaw.toLowerCase() : null;
  const user = findOrCreateSsoUser(db, req, null, { column: 'forward_user', sub: username, email, name: header(fa.nameHeader) ?? username, skipInvite: true });
  if (typeof user !== 'string' && !user.disabled) req.user = user;
}

function resolveDevice(db: DatabaseSync, req: FastifyRequest): void {
  const token = signedCookie(req, DEVICE_COOKIE);
  if (!token) return;
  const d = db.prepare('SELECT id, home_id, name, last_seen_at FROM devices WHERE token_hash = ?').get(sha256(token)) as Row | undefined;
  if (!d) return;
  req.device = { id: d.id as string, homeId: d.home_id as string, name: d.name as string };
  const seen = d.last_seen_at as string | null;
  if (!seen || Date.parse(`${seen.replace(' ', 'T')}Z`) < Date.now() - 5 * 60e3) {
    db.prepare("UPDATE devices SET last_seen_at = datetime('now') WHERE id = ?").run(d.id as string);
  }
  const kidId = signedCookie(req, KID_COOKIE);
  if (!kidId) return;
  const hash = sha256(kidId);
  const k = db.prepare(`SELECT ks.member_id, m.home_id FROM kid_sessions ks JOIN members m ON m.id = ks.member_id
    WHERE ks.id = ? AND ks.device_id = ? AND ks.expires_at > ? AND m.role = 'kid'`).get(hash, d.id as string, new Date().toISOString()) as Row | undefined;
  if (k) req.kid = { memberId: k.member_id as string, homeId: k.home_id as string, sessionHash: hash };
}

export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw new HttpError(401, 'Please sign in');
  return req.user;
}

export function requireAdmin(req: FastifyRequest): User {
  const u = requireUser(req);
  if (!u.is_admin) throw new HttpError(403, 'Server admins only');
  return u;
}

/**
 * Checks the caller can act in a home. 'parent' needs a parent (server admins count as parents everywhere);
 * 'viewer' also lets in the home's kids, family tablets and API tokens, which then get only what routes allow them.
 */
export function homeCtx(db: DatabaseSync, req: FastifyRequest, need: 'parent' | 'viewer' = 'viewer'): HomeCtx {
  const homeId = (req.params as { homeId?: string }).homeId;
  if (!homeId) throw new HttpError(400, 'Missing home');
  return homeCtxFor(db, req, homeId, need);
}

export function homeCtxFor(db: DatabaseSync, req: FastifyRequest, homeId: string, need: 'parent' | 'viewer' = 'viewer'): HomeCtx {
  if (req.user) {
    const m = db.prepare("SELECT id FROM members WHERE home_id = ? AND user_id = ? AND role = 'parent'").get(homeId, req.user.id) as Row | undefined;
    if (m) return { homeId, user: req.user, actor: { kind: 'parent', user: req.user, memberId: m.id as string } };
    if (req.user.is_admin && db.prepare('SELECT 1 FROM homes WHERE id = ?').get(homeId)) {
      return { homeId, user: req.user, actor: { kind: 'parent', user: req.user, memberId: null } };
    }
  }
  let actor: Actor | null = null;
  if (req.kid?.homeId === homeId) actor = { kind: 'kid', memberId: req.kid.memberId };
  else if (req.device?.homeId === homeId) actor = { kind: 'device', deviceId: req.device.id };
  else if (req.tokenHomeId) {
    if (req.tokenHomeId !== homeId) throw new HttpError(403, 'Token is for a different home');
    const scope = req.tokenScope ?? 'read';
    // On the public API a token stands in for a parent, as far as its scope reaches (read: GET only).
    const v1 = (req.routeOptions.config as { v1?: 'read' | 'control' } | undefined)?.v1;
    if (v1) {
      if (v1 === 'control' && scope !== 'control') throw new HttpError(403, 'This needs a control token. Read tokens can only look.');
      return { homeId, user: null, tokenName: req.tokenName ?? 'API', actor: { kind: 'parent', user: null, memberId: null } };
    }
    actor = { kind: 'token', scope };
    // Elsewhere, tokens only ever change things through the Home Assistant actions, and only control tokens can.
    // Checked here too so a route that forgets to refuse tokens can't be used to write with one.
    if (!['GET', 'HEAD'].includes(req.method) && (scope !== 'control' || !req.routeOptions.url?.startsWith('/api/homes/:homeId/ha/'))) {
      throw new HttpError(403, 'Tokens can only change things through the Home Assistant actions or /api/v1, with a control token');
    }
  }
  if (!actor) {
    if (!req.user && !req.device) throw new HttpError(401, 'Please sign in');
    throw new HttpError(404, 'Home not found');
  }
  if (need === 'parent') throw new HttpError(403, 'Parents only');
  return { homeId, user: null, actor };
}

/** Kids may only see and act on their own things; everyone else who passed homeCtx may look at any kid. */
export function assertCanActFor(ctx: HomeCtx, memberId: string): void {
  if (ctx.actor.kind === 'kid' && ctx.actor.memberId !== memberId) throw new HttpError(403, 'That belongs to someone else');
}

export const isParent = (ctx: HomeCtx): boolean => ctx.actor.kind === 'parent';

// ---------- single sign-on: Google and any OpenID Connect provider (Authentik, Authelia, Keycloak, Pocket ID...) ----------

interface Provider {
  key: 'google' | 'oidc';
  label: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  /** The users column that remembers who this is at the provider. */
  column: 'google_sub' | 'oidc_sub';
}

function provider(key: string): Provider {
  if (key === 'google' && config.google) {
    return { key, label: 'Google', issuer: 'https://accounts.google.com', ...config.google, scope: 'openid email profile', column: 'google_sub' };
  }
  if (key === 'oidc' && config.oidc) {
    return { key, label: config.oidc.name, issuer: config.oidc.issuer, clientId: config.oidc.clientId, clientSecret: config.oidc.clientSecret, scope: config.oidc.scopes, column: 'oidc_sub' };
  }
  throw new HttpError(404, 'That sign-in method is not configured');
}

const discovered = new Map<string, Promise<oidc.Configuration>>();
function discover(p: Provider): Promise<oidc.Configuration> {
  let cfg = discovered.get(p.key);
  if (!cfg) {
    cfg = oidc.discovery(new URL(p.issuer), p.clientId, p.clientSecret).catch((err) => { discovered.delete(p.key); throw err; });
    discovered.set(p.key, cfg);
  }
  return cfg;
}

export function publicUser(u: User) {
  return {
    id: u.id, name: u.name, username: u.username, email: u.email, avatar: u.avatar, theme: u.theme,
    isAdmin: !!u.is_admin, lastHomeId: u.last_home_id,
  };
}

function userHomes(db: DatabaseSync, userId: string) {
  return db.prepare(`
    SELECT h.id, h.name, m.role FROM members m JOIN homes h ON h.id = m.home_id
    WHERE m.user_id = ? ORDER BY h.name`).all(userId);
}

export function registerAuthRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/auth/config', async (req) => ({
    google: !!config.google,
    oidc: config.oidc ? { name: config.oidc.name } : null,
    local: localLoginAllowed(db, req),
    passwords: true,
    passkeys: true,
    signup: hasUsers(db) ? signupMode(db) : 'first',
  }));

  // Name-only sign-in for trusted home networks.
  app.post('/api/auth/local', async (req, reply) => {
    if (!localLoginAllowed(db, req)) throw new HttpError(403, 'Quick sign-in only works on your home network. Use your password, a passkey or Google.');
    limitAuth(req, 'local');
    const name = requireStr((req.body as Row)?.name, 'Name', 60);
    const existing = db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE ORDER BY created_at').all(name) as unknown as User[];
    let user = existing.find((u) => isQuickAccount(db, u) && !u.disabled);
    if (!user) {
      if (existing.length) throw new HttpError(403, `${name} has a password or passkey. Sign in with that instead.`);
      if (hasUsers(db) && signupMode(db) === 'closed') throw new HttpError(403, 'New accounts are turned off on this server');
      user = createUser(db, { name });
    }
    startSession(db, reply, user.id, 'quick');
    return { user: publicUser(user) };
  });

  app.get('/api/auth/:provider', async (req, reply) => {
    const p = provider((req.params as { provider: string }).provider);
    const cfg = await discover(p);
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(cfg, {
      redirect_uri: `${config.publicUrl}/api/auth/${p.key}/callback`,
      scope: p.scope,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
      ...(p.key === 'google' ? { prompt: 'select_account' } : {}),
    });
    reply.setCookie('dn_oidc', JSON.stringify({ verifier, state, nonce, provider: p.key }), { ...cookieOpts(reply), maxAge: 600 });
    return reply.redirect(url.href);
  });

  app.get('/api/auth/:provider/callback', async (req, reply) => {
    const p = provider((req.params as { provider: string }).provider);
    const cfg = await discover(p);
    const raw = req.cookies.dn_oidc;
    const un = raw ? req.unsignCookie(raw) : null;
    if (!un?.valid || !un.value) return reply.redirect('/?signin=expired');
    reply.clearCookie('dn_oidc', { path: '/' });
    const { verifier, state, nonce, provider: started } = JSON.parse(un.value) as { verifier: string; state: string; nonce: string; provider?: string };
    if (started && started !== p.key) return reply.redirect('/?signin=expired');
    const current = new URL(req.url, config.publicUrl);
    const tokens = await oidc.authorizationCodeGrant(cfg, current, { pkceCodeVerifier: verifier, expectedState: state, expectedNonce: nonce });
    const claims = tokens.claims();
    if (!claims) throw new HttpError(400, `${p.label} did not return an identity`);
    const email = typeof claims.email === 'string' && claims.email_verified ? claims.email.toLowerCase() : null;
    const name = str(claims.name, 60) ?? str(claims.preferred_username, 60) ?? email?.split('@')[0] ?? 'Parent';
    const user = findOrCreateSsoUser(db, req, reply, { column: p.column, sub: claims.sub, email, name });
    if (typeof user === 'string') return reply.redirect(`/?signin=${user}`);
    if (user.disabled) return reply.redirect('/?signin=disabled');
    if (user.totp_enabled) return reply.redirect(`/?mfa=${encodeURIComponent(startMfa(db, user.id, p.key))}`);
    startSession(db, reply, user.id, p.key);
    return reply.redirect('/');
  });

  // Remembers a join code across the Google round trip for invite-only servers.
  app.post('/api/auth/invite', async (req, reply) => {
    const code = requireStr((req.body as Row)?.code, 'Join code', 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
    limitAuth(req, 'invite');
    if (!db.prepare('SELECT 1 FROM homes WHERE join_code = ?').get(code)) throw new HttpError(404, 'No home has that join code');
    reply.setCookie('dn_invite', code, { ...cookieOpts(reply), maxAge: 900 });
    return { ok: true };
  });

  // Signs the parent out. A family tablet stays paired underneath, so it goes back to the kids' screen.
  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionHash);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // Pairing lets a tablet or app sign in without typing a password on it: either as you ('user'),
  // or as a home's family tablet where kids tap their avatar ('device').
  app.post('/api/auth/pair-code', async (req) => {
    const user = requireUser(req);
    const b = (req.body ?? {}) as Row;
    const kind = b.kind === 'device' ? 'device' : 'user';
    const homeId = kind === 'device' ? homeCtxFor(db, req, requireStr(b.homeId, 'Home', 60), 'parent').homeId : null;
    db.prepare('DELETE FROM pair_codes WHERE expires_at < ? OR user_id = ?').run(new Date().toISOString(), user.id);
    const code = readableCode(8);
    const expires = new Date(Date.now() + 10 * 60e3).toISOString();
    db.prepare('INSERT INTO pair_codes (code, user_id, kind, home_id, expires_at) VALUES (?, ?, ?, ?, ?)').run(code, user.id, kind, homeId, expires);
    return { code, kind, expiresAt: expires };
  });

  app.post('/api/auth/pair', async (req, reply) => {
    limitAuth(req, 'pair');
    const b = (req.body ?? {}) as Row;
    const code = requireStr(b.code, 'Code', 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const row = db.prepare('SELECT user_id, kind, home_id FROM pair_codes WHERE code = ? AND expires_at > ?').get(code, new Date().toISOString()) as Row | undefined;
    if (!row) throw new HttpError(400, 'That code is wrong or expired. Codes last 10 minutes and work once.');
    db.prepare('DELETE FROM pair_codes WHERE code = ?').run(code);
    const user = getUser(db, row.user_id as string);
    if (!user || user.disabled) throw new HttpError(403, 'That account is turned off');
    if (row.kind === 'device') {
      return { device: startDevice(db, reply, row.home_id as string, str(b.name, 60) ?? 'Family tablet', user.id) };
    }
    startSession(db, reply, user.id, 'pairing');
    return { user: publicUser(user) };
  });

  app.get('/api/me', async (req) => {
    const user = requireUser(req);
    return { user: publicUser(user), homes: userHomes(db, user.id) };
  });

  // Everything the app needs to pick a screen: the parent (if any), and the family tablet and kid (if any).
  app.get('/api/whoami', async (req) => {
    const kid = req.kid ? db.prepare('SELECT id, name, avatar, color, theme FROM members WHERE id = ?').get(req.kid.memberId) as Row : null;
    return {
      user: req.user ? publicUser(req.user) : null,
      homes: req.user ? userHomes(db, req.user.id) : [],
      device: req.device,
      kid,
    };
  });

  app.patch('/api/me', async (req) => {
    const user = requireUser(req);
    const b = (req.body ?? {}) as Row;
    const name = str(b.name, 60);
    if (name) {
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
      db.prepare('UPDATE members SET name = ? WHERE user_id = ?').run(name, user.id);
    }
    if (b.theme === 'home' || isThemeId(b.theme)) db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(b.theme, user.id);
    if (isAvatar(b.avatar)) {
      db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(b.avatar, user.id);
      db.prepare('UPDATE members SET avatar = ? WHERE user_id = ?').run(b.avatar, user.id);
    }
    if (typeof b.lastHomeId === 'string') db.prepare('UPDATE users SET last_home_id = ? WHERE id = ?').run(b.lastHomeId, user.id);
    return { user: publicUser(getUser(db, user.id)!) };
  });
}
