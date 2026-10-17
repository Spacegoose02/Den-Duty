// Forward-auth (TinyAuth and friends) and the generic OIDC provider settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-sso-'));
process.env.FORWARD_AUTH_HEADER = 'Remote-User';
process.env.FORWARD_AUTH_TRUSTED = 'private,198.51.100.0/24';
process.env.OIDC_ISSUER = 'https://auth.example.com';
process.env.OIDC_CLIENT_ID = 'daytime-ninja';
process.env.OIDC_NAME = 'Authentik';
process.env.SIGNUP_MODE = 'invite';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { trustedPeer } = await import('./auth.ts');

async function setup() {
  const app = await buildApp(openMemoryDb(), { serveWeb: false });
  const req = async (url: string, headers: Record<string, string>, remoteAddress: string, method = 'GET', payload?: object) => {
    const res = await app.inject({ method: method as 'GET', url, headers, remoteAddress, payload });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  return { req };
}

test('trusted proxy addresses: private ranges, single IPs and CIDRs', () => {
  assert.ok(trustedPeer('127.0.0.1', ['private']));
  assert.ok(trustedPeer('::ffff:172.18.0.4', ['private']), 'Docker networks count as private');
  assert.ok(!trustedPeer('203.0.113.9', ['private']));
  assert.ok(trustedPeer('198.51.100.77', ['198.51.100.0/24']));
  assert.ok(!trustedPeer('198.51.101.1', ['198.51.100.0/24']));
  assert.ok(trustedPeer('203.0.113.9', ['203.0.113.9']));
  assert.ok(!trustedPeer(undefined, ['private']));
});

test('forward-auth signs people in from the proxy header, and only from the proxy', async () => {
  const { req } = await setup();
  const headers = { 'remote-user': 'mom', 'remote-email': 'Mom@Example.com', 'remote-name': 'Mom' };
  const me = await req('/api/me', headers, '172.18.0.4');
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal(me.body.user.name, 'Mom');
  assert.equal(me.body.user.email, 'mom@example.com');
  assert.equal(me.body.user.isAdmin, true, 'the first person is still the admin');
  assert.equal((await req('/api/me', headers, '203.0.113.9')).status, 401, 'a header typed by someone on the internet is ignored');
  assert.equal((await req('/api/me', headers, '198.51.100.20')).body.user.name, 'Mom', 'a listed proxy address works');
  // Same person next time, even if the display name changes.
  const again = await req('/api/me', { 'remote-user': 'MOM', 'remote-name': 'Mother' }, '127.0.0.1');
  assert.equal(again.body.user.id, me.body.user.id);
  // Someone new behind the proxy gets an account without a join code (the proxy decided they may come in).
  const dad = await req('/api/me', { 'remote-user': 'dad' }, '127.0.0.1');
  assert.equal(dad.status, 200);
  assert.equal(dad.body.homes.length, 0, 'they still have to create or join a home');
  // They can act like any signed-in parent.
  const home = await req('/api/homes', { 'remote-user': 'dad' }, '127.0.0.1', 'POST', { name: 'Dad den' });
  assert.equal(home.status, 200);
});

test('the generic OIDC provider is advertised by name; unknown providers are 404', async () => {
  const { req } = await setup();
  const cfg = await req('/api/auth/config', {}, '127.0.0.1');
  assert.deepEqual(cfg.body.oidc, { name: 'Authentik' });
  assert.equal(cfg.body.google, false);
  assert.equal((await req('/api/auth/google', {}, '127.0.0.1')).status, 404, 'Google is off without its keys');
  assert.equal((await req('/api/auth/myspace', {}, '127.0.0.1')).status, 404);
  assert.equal((await req('/api/auth/security', { 'remote-user': 'mom' }, '127.0.0.1')).status, 200, 'fixed auth routes still win');
});
