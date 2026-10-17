import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-acct-'));
process.env.LOCAL_LOGIN = 'lan';
process.env.SIGNUP_MODE = 'invite';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { totpCode, verifyTotp, hashPassword, verifyPassword, isPrivateAddress } = await import('./security.ts');

async function setup() {
  const app = await buildApp(openMemoryDb(), { serveWeb: false });
  const req = async (method: string, url: string, payload?: unknown, headers: Record<string, string> = {}, remoteAddress = '127.0.0.1') => {
    const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers, remoteAddress });
    const cookie = res.cookies.find((c) => c.name === 'dn_session');
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, cookie: cookie ? `dn_session=${cookie.value}` : null, headers: res.headers };
  };
  return { app, req };
}

test('password hashing and TOTP primitives', async () => {
  const h = await hashPassword('correct horse battery');
  assert.ok(await verifyPassword('correct horse battery', h));
  assert.ok(!(await verifyPassword('wrong horse battery', h)));
  // RFC 6238 test vector (SHA1, secret "12345678901234567890").
  assert.equal(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', Math.floor(59 / 30)), '287082');
  const step = verifyTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082', null, 59_000);
  assert.equal(step, 1);
  assert.equal(verifyTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082', step, 59_000), null, 'codes cannot be reused');
  assert.ok(isPrivateAddress('192.168.1.5') && isPrivateAddress('::ffff:10.0.0.2') && !isPrivateAddress('8.8.8.8'));
});

test('first account registers freely and becomes admin; later ones need a join code', async () => {
  const { req } = await setup();
  const cfg = await req('GET', '/api/auth/config');
  assert.equal(cfg.body.signup, 'first');
  const weak = await req('POST', '/api/auth/register', { username: 'owner', password: 'short' });
  assert.equal(weak.status, 400);
  const owner = await req('POST', '/api/auth/register', { username: 'Owner', password: 'raccoons love snacks', name: 'Owner' });
  assert.equal(owner.status, 200, JSON.stringify(owner.body));
  assert.equal(owner.body.user.isAdmin, true);
  const home = await req('POST', '/api/homes', { name: 'Den' }, { cookie: owner.cookie! });
  const { body: detail } = await req('GET', `/api/homes/${home.body.id}`, undefined, { cookie: owner.cookie! });

  const noCode = await req('POST', '/api/auth/register', { username: 'stranger', password: 'raccoons love snacks too' });
  assert.equal(noCode.status, 403);
  const withCode = await req('POST', '/api/auth/register', { username: 'kid', password: 'raccoons love snacks too', joinCode: detail.joinCode });
  assert.equal(withCode.status, 200);
  const me = await req('GET', '/api/me', undefined, { cookie: withCode.cookie! });
  assert.equal(me.body.homes[0].id, home.body.id);
  const dupe = await req('POST', '/api/auth/register', { username: 'KID', password: 'raccoons love snacks too', joinCode: detail.joinCode });
  assert.equal(dupe.status, 409);
});

test('password login with two-factor and recovery codes', async () => {
  const { req } = await setup();
  const reg = await req('POST', '/api/auth/register', { username: 'chef', password: 'midnight pancakes 42' });
  const c = { cookie: reg.cookie! };
  assert.equal((await req('POST', '/api/auth/login', { username: 'chef', password: 'nope nope nope' })).status, 401);

  assert.equal((await req('POST', '/api/auth/totp/setup', {}, c)).status, 403, 'needs the current password');
  const setupRes = await req('POST', '/api/auth/totp/setup', { currentPassword: 'midnight pancakes 42' }, c);
  assert.match(setupRes.body.qrSvg, /<svg/);
  const secret = setupRes.body.secret as string;
  const now = Math.floor(Date.now() / 30000);
  const enabled = await req('POST', '/api/auth/totp/enable', { code: totpCode(secret, now) }, c);
  assert.equal(enabled.body.recoveryCodes.length, 10);

  const step1 = await req('POST', '/api/auth/login', { username: 'CHEF', password: 'midnight pancakes 42' });
  assert.equal(step1.body.mfaRequired, true);
  assert.equal(step1.cookie, null, 'no session before the second factor');
  assert.equal((await req('POST', '/api/auth/login/2fa', { ticket: step1.body.ticket, code: '000000' })).status, 401);
  const step2 = await req('POST', '/api/auth/login/2fa', { ticket: step1.body.ticket, code: totpCode(secret, now + 1) });
  assert.equal(step2.status, 200, JSON.stringify(step2.body));
  assert.ok(step2.cookie);

  const again = await req('POST', '/api/auth/login', { username: 'chef', password: 'midnight pancakes 42' });
  const recovery = enabled.body.recoveryCodes[0].toUpperCase();
  assert.equal((await req('POST', '/api/auth/login/2fa', { ticket: again.body.ticket, code: recovery })).status, 200);
  const third = await req('POST', '/api/auth/login', { username: 'chef', password: 'midnight pancakes 42' });
  assert.equal((await req('POST', '/api/auth/login/2fa', { ticket: third.body.ticket, code: recovery })).status, 401, 'recovery codes work once');

  const sessions = await req('GET', '/api/auth/sessions', undefined, { cookie: step2.cookie! });
  assert.ok(sessions.body.some((s: { current: boolean; method: string }) => s.current && s.method === 'password+2fa'));
});

test('quick sign-in stays on the home network and cannot take over protected accounts', async () => {
  const { req } = await setup();
  await req('POST', '/api/auth/register', { username: 'mom', password: 'secret family recipe', name: 'Mom' });
  const fromInternet = await req('POST', '/api/auth/local', { name: 'Dad' }, {}, '203.0.113.9');
  assert.equal(fromInternet.status, 403);
  assert.equal((await req('GET', '/api/auth/config', undefined, {}, '203.0.113.9')).body.local, false);
  const hijack = await req('POST', '/api/auth/local', { name: 'mom' }, {}, '192.168.1.20');
  assert.equal(hijack.status, 403);
  // Invite-only servers still let people on the LAN make a quick account.
  assert.equal((await req('POST', '/api/auth/local', { name: 'Grandpa' }, {}, '192.168.1.20')).status, 200);
});

test('repeated wrong passwords get rate limited', async () => {
  const { req } = await setup();
  await req('POST', '/api/auth/register', { username: 'target', password: 'a very good password' });
  let last = 0;
  for (let i = 0; i < 10; i++) last = (await req('POST', '/api/auth/login', { username: 'target', password: `guess ${i} guess` }, {}, '198.51.100.7')).status;
  assert.equal(last, 429);
});

test('security headers and cross-site request blocking', async () => {
  const { req } = await setup();
  const r = await req('GET', '/api/health');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['x-frame-options'], 'DENY');
  const csrf = await req('POST', '/api/auth/register', { username: 'evil', password: 'cross site attack' }, { origin: 'https://evil.example', host: 'chores.local' });
  assert.equal(csrf.status, 403);
  const same = await req('POST', '/api/auth/register', { username: 'good', password: 'same site request ok' }, { origin: 'http://chores.local', host: 'chores.local' });
  assert.equal(same.status, 200);
});

test('admins can unlock people', async () => {
  const { req } = await setup();
  const admin = await req('POST', '/api/auth/register', { username: 'admin', password: 'the boss raccoon' });
  const quick = await req('POST', '/api/auth/local', { name: 'Kiddo' });
  const kid = (await req('GET', '/api/me', undefined, { cookie: quick.cookie! })).body.user;
  const reset = await req('POST', `/api/admin/users/${kid.id}/security`, { tempPassword: true }, { cookie: admin.cookie! });
  assert.ok(reset.body.tempPassword);
  assert.equal((await req('GET', '/api/me', undefined, { cookie: quick.cookie! })).status, 401, 'old sessions are signed out');
  const login = await req('POST', '/api/auth/login', { username: reset.body.username, password: reset.body.tempPassword });
  assert.equal(login.status, 200);
  await req('POST', `/api/admin/users/${kid.id}/security`, { disabled: true }, { cookie: admin.cookie! });
  assert.equal((await req('POST', '/api/auth/login', { username: reset.body.username, password: reset.body.tempPassword })).status, 403);
});

test('the app launcher can check the server from another origin', async () => {
  const { req } = await setup();
  const r = await req('GET', '/api/health', undefined, { origin: 'https://localhost' });
  assert.equal(r.headers['access-control-allow-origin'], '*');
  const other = await req('GET', '/api/auth/config', undefined, { origin: 'https://localhost' });
  assert.equal(other.headers['access-control-allow-origin'], undefined, 'only the health check is open to other origins');
});
