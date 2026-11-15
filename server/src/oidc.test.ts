// The OpenID Connect sign-in flow end to end, against a fake provider that answers the way TinyAuth's OIDC server
// does: issuer without a trailing slash, authorize page at /authorize, client_secret_basic or _post, S256 PKCE, a
// nonce in an RS256 ID token, email_verified set whenever there's an email, and exact redirect URI matching.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-oidc-'));
// A path under the domain, to prove the redirect URI sent to the token endpoint is the one we registered.
process.env.PUBLIC_URL = 'https://chores.example.com/den';
process.env.SIGNUP_MODE = 'invite';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { saveOidcSettings, oidcScope } = await import('./auth.ts');

const ISSUER = 'https://auth.example.net';
const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';
const REDIRECT = 'https://chores.example.com/den/api/auth/oidc/callback';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };

const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
function idToken(claims: object): string {
  const head = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'k1' })}.${b64(claims)}`;
  return `${head}.${crypto.sign('sha256', Buffer.from(head), privateKey).toString('base64url')}`;
}

interface Pending { challenge: string; nonce: string; redirect: string; user: { sub: string; email?: string; name: string } }
const codes = new Map<string, Pending>();
const tokenCalls: { auth: string; redirect: string | null }[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== ISSUER) return realFetch(input, init);
  const json = (v: object, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/.well-known/openid-configuration') {
    return json({
      issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/api/oidc/token`,
      userinfo_endpoint: `${ISSUER}/api/oidc/userinfo`, jwks_uri: `${ISSUER}/.well-known/jwks.json`,
      scopes_supported: ['openid', 'profile', 'email', 'phone', 'address', 'groups'], response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'], subject_types_supported: ['pairwise'],
      id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    });
  }
  if (url.pathname === '/.well-known/jwks.json') return json({ keys: [jwk] });
  if (url.pathname === '/api/oidc/token') {
    const form = new URLSearchParams(String(init?.body ?? ''));
    const headers = new Headers(init?.headers);
    const basic = headers.get('authorization');
    let id = form.get('client_id'); let secret = form.get('client_secret');
    if (!secret && basic?.startsWith('Basic ')) [id, secret] = Buffer.from(basic.slice(6), 'base64').toString().split(':').map(decodeURIComponent);
    tokenCalls.push({ auth: form.get('client_secret') ? 'post' : 'basic', redirect: form.get('redirect_uri') });
    if (id !== CLIENT_ID || secret !== CLIENT_SECRET) return json({ error: 'invalid_client' }, 400);
    const entry = codes.get(form.get('code') ?? '');
    if (!entry) return json({ error: 'invalid_grant' }, 400);
    if (entry.redirect !== form.get('redirect_uri')) return json({ error: 'invalid_grant' }, 400);
    const verifier = form.get('code_verifier') ?? '';
    if (crypto.createHash('sha256').update(verifier).digest('base64url') !== entry.challenge) return json({ error: 'invalid_grant' }, 400);
    const now = Math.floor(Date.now() / 1000);
    return json({
      access_token: 'at', refresh_token: 'rt', token_type: 'Bearer', expires_in: 3600, scope: 'openid email profile',
      id_token: idToken({ iss: ISSUER, aud: CLIENT_ID, sub: entry.user.sub, iat: now, exp: now + 3600, auth_time: now, nonce: entry.nonce,
        name: entry.user.name, preferred_username: entry.user.name.toLowerCase(), email: entry.user.email, email_verified: !!entry.user.email }),
    });
  }
  return json({ error: 'not_found' }, 404);
}) as typeof fetch;

function cookiesOf(setCookie: string | string[] | undefined): string {
  return ([] as string[]).concat(setCookie ?? []).map((c) => c.split(';')[0]).join('; ');
}

/** Presses the sign-in button (or, with a signed-in cookie, Settings' Link button), "signs in" at the provider, and follows the redirect back. */
async function signIn(app: Awaited<ReturnType<typeof buildApp>>, user: Pending['user'], extraCookie = '') {
  const start = await app.inject({ method: 'GET', url: extraCookie ? '/api/auth/oidc?link=1' : '/api/auth/oidc', headers: extraCookie ? { cookie: extraCookie } : {} });
  assert.equal(start.statusCode, 302, start.body);
  const at = new URL(start.headers.location as string);
  assert.equal(at.origin + at.pathname, `${ISSUER}/authorize`);
  const q = at.searchParams;
  assert.equal(q.get('client_id'), CLIENT_ID);
  assert.equal(q.get('redirect_uri'), REDIRECT);
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('code_challenge_method'), 'S256');
  const code = crypto.randomUUID();
  codes.set(code, { challenge: q.get('code_challenge')!, nonce: q.get('nonce')!, redirect: q.get('redirect_uri')!, user });
  // TinyAuth sends back code and state only (no iss parameter).
  const back = await app.inject({
    method: 'GET', url: `/api/auth/oidc/callback?code=${code}&state=${encodeURIComponent(q.get('state')!)}`,
    headers: { cookie: [cookiesOf(start.headers['set-cookie']), extraCookie].filter(Boolean).join('; ') },
  });
  return { start: at, back, cookie: cookiesOf(back.headers['set-cookie']) };
}

test('scopes: openid, email and profile always, extras added once', () => {
  assert.equal(oidcScope(''), 'openid email profile');
  assert.equal(oidcScope('groups, email  offline_access'), 'openid email profile groups offline_access');
});

test('signing in with a TinyAuth-style provider saved in settings', async () => {
  const db = openMemoryDb();
  const app = await buildApp(db, { serveWeb: false });

  assert.equal(JSON.parse((await app.inject('/api/auth/config')).body).oidc, null, 'no provider, no button');
  saveOidcSettings(db, { name: 'TinyAuth', issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, extraScopes: 'groups', autoCreate: false, showOnLogin: true });
  assert.deepEqual(JSON.parse((await app.inject('/api/auth/config')).body).oidc, { name: 'TinyAuth' });

  // The first person on a fresh server becomes the admin.
  const first = await signIn(app, { sub: 'pairwise-mom', email: 'Mom@Example.com', name: 'Mom' });
  assert.equal(first.start.searchParams.get('scope'), 'openid email profile groups');
  assert.equal(first.back.statusCode, 302, first.back.body);
  assert.equal(first.back.headers.location, '/');
  assert.equal(tokenCalls.at(-1)?.redirect, REDIRECT, 'the token request repeats the exact registered redirect URI');
  const me = JSON.parse((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: first.cookie } })).body);
  assert.equal(me.user.name, 'Mom');
  assert.equal(me.user.email, 'mom@example.com');
  assert.equal(me.user.isAdmin, true);

  // Same person next time is the same account.
  const again = await signIn(app, { sub: 'pairwise-mom', name: 'Mom' });
  const me2 = JSON.parse((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: again.cookie } })).body);
  assert.equal(me2.user.id, me.user.id);

  // The admin editor never hands the secret back, and keeps it when the field is left empty.
  const admin = { cookie: first.cookie };
  const view = JSON.parse((await app.inject({ method: 'GET', url: '/api/admin/sso', headers: admin })).body);
  assert.equal(view.callbackUrl, REDIRECT);
  assert.equal(view.provider.hasSecret, true);
  assert.ok(!JSON.stringify(view).includes(CLIENT_SECRET));
  assert.ok(!(db.prepare("SELECT value FROM server_settings WHERE key = 'oidc'").get() as { value: string }).value.includes(CLIENT_SECRET), 'stored sealed');
  const put = await app.inject({ method: 'PUT', url: '/api/admin/sso', headers: admin,
    payload: { name: 'TinyAuth', issuer: ISSUER, clientId: CLIENT_ID, clientSecret: '', extraScopes: '', autoCreate: false, showOnLogin: true } });
  assert.equal(put.statusCode, 200, put.body);
  const test1 = JSON.parse((await app.inject({ method: 'POST', url: '/api/admin/sso/test', headers: admin, payload: {} })).body);
  assert.equal(test1.ok, true, JSON.stringify(test1));
  assert.equal(test1.tokenEndpoint, `${ISSUER}/api/oidc/token`);

  // Invite-only server: someone new without a join code is turned away...
  const stranger = await signIn(app, { sub: 'pairwise-aunt', email: 'aunt@example.com', name: 'Aunt' });
  assert.equal(stranger.back.headers.location, '/?signin=invite');
  // ...unless the admin trusts this provider to only let in their own people.
  await app.inject({ method: 'PUT', url: '/api/admin/sso', headers: admin,
    payload: { name: 'TinyAuth', issuer: ISSUER, clientId: CLIENT_ID, extraScopes: '', autoCreate: true, showOnLogin: false } });
  const trusted = await signIn(app, { sub: 'pairwise-aunt', email: 'aunt@example.com', name: 'Aunt' });
  assert.equal(trusted.back.headers.location, '/');
  assert.equal(JSON.parse((await app.inject('/api/auth/config')).body).oidc, null, 'hidden from the sign-in page');

  // The provider saying no comes back as a readable message, not a crash.
  const denied = await app.inject({ method: 'GET', url: '/api/auth/oidc/callback?error=access_denied&state=x',
    headers: { cookie: cookiesOf((await app.inject('/api/auth/oidc')).headers['set-cookie']) } });
  assert.equal(denied.headers.location, '/?signin=denied');

  // A wrong secret fails cleanly too.
  await app.inject({ method: 'PUT', url: '/api/admin/sso', headers: admin,
    payload: { name: 'TinyAuth', issuer: ISSUER, clientId: CLIENT_ID, clientSecret: 'wrong', autoCreate: true, showOnLogin: true } });
  const bad = await signIn(app, { sub: 'pairwise-mom', name: 'Mom' });
  assert.equal(bad.back.headers.location, '/?signin=failed');

  // Removing it takes the button away.
  await app.inject({ method: 'DELETE', url: '/api/admin/sso', headers: admin });
  assert.equal((await app.inject('/api/auth/oidc')).statusCode, 404);
});

test('linking existing accounts: by the person from Settings, and by an admin ahead of time', async () => {
  const db = openMemoryDb();
  const app = await buildApp(db, { serveWeb: false });
  saveOidcSettings(db, { name: 'TinyAuth', issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, extraScopes: '', autoCreate: false, showOnLogin: true });
  const register = async (username: string) => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: username, username, password: 'correct horse battery staple' } });
    assert.equal(r.statusCode, 200, r.body);
    return cookiesOf(r.headers['set-cookie']);
  };
  const mom = await register('mom');
  const who = async (cookie: string) => JSON.parse((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).body).user;
  const momId = (await who(mom)).id;

  // Mom links her TinyAuth account from Settings while signed in.
  const linked = await signIn(app, { sub: 'ta-mom', email: 'mom@home.lan', name: 'Mom' }, mom);
  assert.equal(linked.back.headers.location, '/settings/account?sso=linked');
  const sec = JSON.parse((await app.inject({ method: 'GET', url: '/api/auth/security', headers: { cookie: mom } })).body);
  assert.equal(sec.oidc, true);
  // From now on TinyAuth signs her into the same account.
  const viaTa = await signIn(app, { sub: 'ta-mom', name: 'Mom' });
  assert.equal((await who(viaTa.cookie)).id, momId);

  // Dad can't claim the TinyAuth account Mom already linked. (Open sign-up just long enough to make his account.)
  await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: { cookie: mom }, payload: { signupMode: 'open' } });
  const dad = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Dad', username: 'dad', password: 'correct horse battery staple' } });
  const dadCookie = cookiesOf(dad.headers['set-cookie']);
  const dadId = (await who(dadCookie)).id;
  await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: { cookie: mom }, payload: { signupMode: 'invite' } });
  const taken = await signIn(app, { sub: 'ta-mom', name: 'Mom' }, dadCookie);
  assert.equal(taken.back.headers.location, '/settings/account?sso=taken');

  // The admin (Mom, the first account) links Dad by his TinyAuth username; his first TinyAuth sign-in claims it.
  const hint = await app.inject({ method: 'POST', url: `/api/admin/users/${dadId}/security`, headers: { cookie: mom }, payload: { oidcLinkHint: 'dad' } });
  assert.equal(hint.statusCode, 200, hint.body);
  const dadTa = await signIn(app, { sub: 'ta-dad', name: 'Dad' });
  assert.equal(dadTa.back.headers.location, '/', 'no join code needed: it is an existing account');
  assert.equal((await who(dadTa.cookie)).id, dadId);
  const overview = JSON.parse((await app.inject({ method: 'GET', url: '/api/admin/overview', headers: { cookie: mom } })).body);
  const dadRow = overview.users.find((u: { id: string }) => u.id === dadId);
  assert.equal(dadRow.has_oidc, 1);
  assert.equal(dadRow.oidc_link_hint, null, 'the hint is used up');

  // Admin unlinks him; the next TinyAuth sign-in is a stranger again on this invite-only server.
  await app.inject({ method: 'POST', url: `/api/admin/users/${dadId}/security`, headers: { cookie: mom }, payload: { oidcUnlink: true } });
  assert.equal((await signIn(app, { sub: 'ta-dad', name: 'Dad' })).back.headers.location, '/?signin=invite');

  // Mom unlinks herself (she still has her password).
  const un = await app.inject({ method: 'POST', url: '/api/auth/oidc/unlink', headers: { cookie: mom }, payload: { currentPassword: 'correct horse battery staple' } });
  assert.equal(un.statusCode, 200, un.body);
  assert.equal((await signIn(app, { sub: 'ta-mom', name: 'Mom' })).back.headers.location, '/?signin=invite');
});
