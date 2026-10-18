// Home Assistant: read vs control tokens, per-kid sensors, actions by kid and chore name, events and the webhook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-ha-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { setDeliver } = await import('./events.ts');

type Jar = Record<string, string>;

async function setup() {
  const app = await buildApp(openMemoryDb(), { serveWeb: false });
  const call = async (jar: Jar, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { ...headers, ...(cookie ? { cookie } : {}) } });
    for (const ck of res.cookies) { if (ck.value) jar[ck.name] = ck.value; else delete jar[ck.name]; }
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  const mom: Jar = {};
  await call(mom, 'POST', '/api/auth/local', { name: 'Mom' });
  const { body: home } = await call(mom, 'POST', '/api/homes', { name: 'Den', timezone: 'UTC' });
  const base = `/api/homes/${home.id}`;
  const ava = (await call(mom, 'POST', `${base}/kids`, { name: 'Ava' })).body;
  await call(mom, 'POST', `${base}/chores`, { title: 'Feed the cat', icon: '🐱', points: 4, memberIds: [ava.id] });
  await call(mom, 'POST', `${base}/kids/${ava.id}/goals`, { title: 'Zoo trip', targetPoints: 6, reward: 'Zoo!' });
  const read = (await call(mom, 'POST', `${base}/tokens`, { name: 'HA sensors' })).body.token as string;
  const control = (await call(mom, 'POST', `${base}/tokens`, { name: 'HA actions', scope: 'control' })).body.token as string;
  const asToken = (token: string) => (method: string, url: string, payload?: unknown) => call({}, method, url, payload, { authorization: `Bearer ${token}` });
  return { call, mom, base, ava, read: asToken(read), control: asToken(control) };
}

test('sensors: one summary with per-kid numbers, easy to template by name', async () => {
  const { base, read } = await setup();
  const s = (await read('GET', `${base}/ha/summary`)).body;
  assert.equal(s.points_name, 'Shinies');
  const ava = s.kids_by_name.ava;
  assert.deepEqual(
    [ava.balance, ava.left_today, ava.total_today, ava.waiting_for_review, ava.streak, ava.level_name, ava.next_goal],
    [0, 1, 1, 0, 0, 'Kit', 'Zoo trip'],
  );
  assert.deepEqual(ava.chores_left, ['Feed the cat']);
  const today = (await read('GET', `${base}/ha/today`)).body;
  assert.equal(today[0].chores[0].title, 'Feed the cat');
});

test('read tokens only look; control tokens act by kid and chore name', async () => {
  const { base, read, control, mom, ava, call } = await setup();
  assert.equal((await read('POST', `${base}/ha/complete`, { kid: 'Ava', chore: 'Feed the cat' })).status, 403);
  assert.equal((await control('POST', `${base}/ha/complete`, { kid: 'nobody', chore: 'Feed the cat' })).status, 404);
  assert.equal((await control('POST', `${base}/ha/complete`, { kid: 'ava', chore: 'Walk the moon' })).status, 404);
  const done = await control('POST', `${base}/ha/complete`, { kid: 'ava', chore: 'feed the cat' });
  assert.equal(done.body.item.status, 'submitted', 'marking done still waits for a parent');
  assert.equal((await read('GET', `${base}/ha/summary`)).body.waiting_for_review, 1);
  const approved = await control('POST', `${base}/ha/approve`, { kid: 'Ava', chore: 'Feed the cat' });
  assert.equal(approved.body.awarded, 4);
  const quick = await control('POST', `${base}/ha/quick-reward`, { kid: 'Ava', reward: 'Great attitude' });
  assert.equal(quick.body.balance, 6);
  const pen = await control('POST', `${base}/ha/penalty`, { kid: 'Ava', points: 10, reason: 'Screen time over' });
  assert.deepEqual(pen.body, { taken: 6, balance: 0 }, 'the zero floor applies to automations too');
  assert.equal((await control('POST', `${base}/ha/points`, { kid: 'Ava', amount: 2, reason: 'Robot vacuum helper' })).body.balance, 2);
  // Control tokens still can't manage the home.
  assert.equal((await control('POST', `${base}/kids`, { name: 'x' })).status, 403);
  assert.equal((await control('DELETE', base)).status, 403);
  const ledger = (await call(mom, 'GET', `${base}/kids/${ava.id}/ledger`)).body.entries as { by: string }[];
  assert.ok(ledger.every((e) => e.by === 'Home Assistant'), 'automations are credited in the points history');
});

test('events: chores submitted and approved, goals reached and redeemed; webhook gets them after commit', async () => {
  const { base, read, control, call, mom, ava } = await setup();
  const sent: { url: string; payload: { event: string; kid: string; goal?: string } }[] = [];
  setDeliver(async (url, payload) => { sent.push({ url, payload: payload as never }); });
  assert.equal((await call(mom, 'PATCH', base, { haWebhookUrl: 'ftp://nope' })).status, 400);
  await call(mom, 'PATCH', base, { haWebhookUrl: 'http://homeassistant.local:8123/api/webhook/den-duty' });

  await control('POST', `${base}/ha/complete`, { kid: 'Ava', chore: 'Feed the cat' });
  await control('POST', `${base}/ha/approve`, { kid: 'Ava', chore: 'Feed the cat' });
  await control('POST', `${base}/ha/quick-reward`, { kid: 'Ava', reward: 'Ready on time' });
  await control('POST', `${base}/ha/quick-reward`, { kid: 'Ava', reward: 'Great attitude' }); // 4 + 1 + 2 = 7, goal at 6
  const goals = (await call(mom, 'GET', `${base}/kids/${ava.id}/goals`)).body;
  await call(mom, 'POST', `${base}/goals/${goals[0].id}/redeem`, {});

  const events = (await read('GET', `${base}/ha/events`)).body as { id: number; event: string; kid: string; goal?: string; balance?: number }[];
  assert.deepEqual(events.map((e) => e.event).reverse(), ['chore_submitted', 'chore_approved', 'points_changed', 'points_changed', 'goal_reached', 'goal_redeemed']);
  const reached = events.find((e) => e.event === 'goal_reached')!;
  assert.equal(reached.goal, 'Zoo trip');
  assert.equal(reached.kid, 'Ava');
  assert.equal(reached.balance, 7);
  assert.equal((await read('GET', `${base}/ha/events?after=${events[1].id}`)).body.length, 1, 'polling picks up where you left off');

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 6);
  assert.equal(sent[0].url, 'http://homeassistant.local:8123/api/webhook/den-duty');
  assert.equal(sent.find((s) => s.payload.event === 'goal_reached')!.payload.goal, 'Zoo trip');
});
