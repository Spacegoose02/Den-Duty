// AI ideas: off by default, key encrypted at rest, kids' names never sent. The Claude API is faked locally.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-ai-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { setAiFetch, sealKey, openKey } = await import('./ai.ts');

type Jar = Record<string, string>;
const KEY = 'sk-ant-api03-test-key-abcdefghijklmnop';

async function setup() {
  const db = openMemoryDb();
  const app = await buildApp(db, { serveWeb: false });
  const call = async (jar: Jar, method: string, url: string, payload?: unknown) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: cookie ? { cookie } : {} });
    for (const ck of res.cookies) { if (ck.value) jar[ck.name] = ck.value; else delete jar[ck.name]; }
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  const mom: Jar = {};
  await call(mom, 'POST', '/api/auth/local', { name: 'Mom' });
  const { body: home } = await call(mom, 'POST', '/api/homes', { name: 'Den', timezone: 'UTC' });
  const base = `/api/homes/${home.id}`;
  const ava = (await call(mom, 'POST', `${base}/kids`, { name: 'Avaleigh' })).body;
  await call(mom, 'POST', `${base}/kids/${ava.id}/goals`, { title: 'Zoo trip', targetPoints: 50 });
  return { db, call, mom, base, ava };
}

/** A fake Claude API that records what was sent and answers with structured ideas. */
function fakeClaude(sent: { url: string; body: Record<string, unknown>; headers: Headers }[], reply: object = {
  ideas: [{ title: 'Pizza night pick', points: 40, detail: 'Choose the toppings for family pizza night.' }],
}) {
  setAiFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify(reply) }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);
}

test('the key is encrypted at rest and only a hint is ever shown', async () => {
  const { db, call, mom, base } = await setup();
  assert.equal(openKey(sealKey(KEY)), KEY);
  assert.equal((await call(mom, 'GET', `${base}/ai`)).body.enabled, false, 'off by default');
  assert.equal((await call(mom, 'PATCH', `${base}/ai`, { enabled: true })).status, 400, 'needs a key first');
  assert.equal((await call(mom, 'PATCH', `${base}/ai`, { apiKey: 'hunter2' })).status, 400);
  const saved = (await call(mom, 'PATCH', `${base}/ai`, { apiKey: KEY, enabled: true })).body;
  assert.deepEqual(saved, { enabled: true, hasKey: true, keyHint: '…mnop', model: 'claude-opus-5-5' });
  const raw = (db.prepare('SELECT ai_key FROM homes').get() as { ai_key: string }).ai_key;
  assert.ok(!raw.includes(KEY) && raw.startsWith('v1.'));
});

test('nothing is sent while AI is off; when on, ideas come back and no names leave the server', async () => {
  const { call, mom, base, ava } = await setup();
  const sent: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  fakeClaude(sent);
  assert.equal((await call(mom, 'POST', `${base}/ai/ideas`, { kind: 'goal', kidId: ava.id })).status, 403);
  assert.equal(sent.length, 0);

  await call(mom, 'PATCH', `${base}/ai`, { apiKey: KEY, enabled: true });
  const res = await call(mom, 'POST', `${base}/ai/ideas`, { kind: 'goal', kidId: ava.id, age: 8, hint: 'she loves animals' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.ideas, [{ title: 'Pizza night pick', points: 40, detail: 'Choose the toppings for family pizza night.' }]);

  const req = sent[0];
  assert.match(req.url, /\/v1\/messages/);
  assert.equal(req.headers.get('x-api-key'), KEY);
  assert.match(req.headers.get('anthropic-beta') ?? '', /server-side-fallback-2026-07-01/);
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.deepEqual((req.body.output_config as { effort: string }).effort, 'low');
  const text = JSON.stringify(req.body);
  assert.ok(!text.includes('Avaleigh'), "the kid's name is never sent");
  assert.ok(text.includes('Zoo trip') && text.includes('about 8 years old') && text.includes('loves animals'));
});

test('penalty ideas, refusals and bad keys turn into friendly errors', async () => {
  const { call, mom, base } = await setup();
  await call(mom, 'PATCH', `${base}/ai`, { apiKey: KEY, enabled: true });
  const sent: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  fakeClaude(sent, { ideas: [{ title: 'Toys back on the shelf', points: 2.4, detail: "Let's put them back together." }] });
  const pen = await call(mom, 'POST', `${base}/ai/ideas`, { kind: 'penalty' });
  assert.equal(pen.body.ideas[0].points, 2, 'points are whole numbers');
  assert.match(JSON.stringify(sent[0].body), /gentle consequences/);

  setAiFetch((async () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json' } })) as typeof fetch);
  const bad = await call(mom, 'POST', `${base}/ai/ideas`, { kind: 'chore' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /rejected that API key/);
  setAiFetch(undefined);
});
