// The Ask page: Judge Trash Panda and the two open chats. The Claude API is faked locally.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-advice-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { setAiFetch, scrubNames, fillNames, chatMessages } = await import('./ai.ts');

type Jar = Record<string, string>;
type Sent = { body: Record<string, unknown> };
const KEY = 'sk-ant-api03-test-key-abcdefghijklmnop';

async function setup(aiOn = true) {
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
  const ava = (await call(mom, 'POST', `${base}/kids`, { name: 'Avaleigh', birthdate: '2018-01-01' })).body;
  const max = (await call(mom, 'POST', `${base}/kids`, { name: 'Max', birthdate: '2021-01-01' })).body;
  const zoe = (await call(mom, 'POST', `${base}/kids`, { name: 'Zoe' })).body;
  if (aiOn) await call(mom, 'PATCH', `${base}/ai`, { apiKey: KEY, enabled: true });
  return { db, call, mom, base, ava, max, zoe };
}

function fakeClaude(sent: Sent[], reply: object) {
  setAiFetch((async (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 10, output_tokens: 10 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);
}

const RULING = {
  winner: '2',
  headline: '{2} had the scooter first, so {2} gets it back.',
  reasoning: '{2} asked first. {1} grabbed it.',
  sides: [{ who: '1', heard: '{1} really wanted a turn.', nextTime: 'Ask for a turn.' }, { who: '2', heard: '{2} felt it was taken.', nextTime: 'Set a timer.' }],
  fix: '{2} rides 10 minutes, then {1}.',
  readAloud: 'Order in the den! {2} rides first, then {1}.',
};

test('names are swapped out before sending and back in after', () => {
  assert.equal(scrubNames('Max took it from avaleigh, and Zoe laughed', ['Avaleigh', 'Max'], ['Zoe']), '{2} took it from {1}, and a sibling laughed');
  assert.equal(scrubNames('Maxine is not Max', ['Max']), 'Maxine is not {1}', 'whole words only');
  assert.equal(fillNames('{1} and {2} and {5}', ['Ava', 'Max']), 'Ava and Max and {5}');
});

test('the chat history is sent as alternating turns with the kid age only', () => {
  const m = chatMessages([{ role: 'assistant', content: 'stray' }, { role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }], 'Time-out?', 6);
  assert.deepEqual(m.map((x) => x.role), ['user', 'assistant', 'user']);
  assert.equal(m[2].content, '(About my 6-year-old.) Time-out?');
});

test('Judge Trash Panda rules without sending names, and keeps a history', async () => {
  const { call, mom, base, ava, max } = await setup();
  const sent: Sent[] = [];
  fakeClaude(sent, RULING);
  const res = await call(mom, 'POST', `${base}/judge`, {
    about: 'the scooter',
    sides: [{ kidId: ava.id, story: 'Max had it all morning!' }, { kidId: max.id, story: 'I had it first and Avaleigh grabbed it. Zoe saw.' }],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ruling.winner, '2');
  assert.equal(res.body.ruling.headline, 'Max had the scooter first, so Max gets it back.');
  assert.equal(res.body.ruling.sides[0].heard, 'Avaleigh really wanted a turn.');
  assert.equal(res.body.sides[1].name, 'Max');

  const text = JSON.stringify(sent[0].body);
  for (const n of ['Avaleigh', 'Max', 'Zoe']) assert.ok(!text.includes(n), `${n} is never sent`);
  assert.match(text, /\{1\} \(age \d+\) says: \{2\} had it all morning/);
  assert.match(text, /a sibling saw/);
  assert.match(text, /Judge Trash Panda/);

  const info = (await call(mom, 'GET', `${base}/judge`)).body;
  assert.equal(info.name, 'Judge Trash Panda');
  assert.equal(info.history.length, 1);
  await call(mom, 'DELETE', `${base}/judge/${info.history[0].id}`);
  assert.equal((await call(mom, 'GET', `${base}/judge`)).body.history.length, 0);
  setAiFetch(undefined);
});

test('the judge checks its inputs: two sides, a story each, a guest name, AI on', async () => {
  const { call, mom, base, ava, max } = await setup();
  const sent: Sent[] = [];
  fakeClaude(sent, { ...RULING, winner: '3' });
  assert.equal((await call(mom, 'POST', `${base}/judge`, { sides: [{ kidId: ava.id, story: 'x' }] })).status, 400);
  assert.equal((await call(mom, 'POST', `${base}/judge`, { sides: [{ kidId: ava.id, story: 'x' }, { kidId: max.id, story: '' }] })).status, 400);
  assert.equal((await call(mom, 'POST', `${base}/judge`, { sides: [{ kidId: ava.id, story: 'x' }, { kidId: ava.id, story: 'y' }] })).status, 400);
  const guest = await call(mom, 'POST', `${base}/judge`, { sides: [{ kidId: ava.id, story: 'mine' }, { name: 'Cousin Lou', age: 7, story: 'no, mine' }] });
  assert.equal(guest.status, 200);
  assert.equal(guest.body.ruling.winner, 'tie', 'a winner outside the sides becomes a tie');
  assert.ok(!JSON.stringify(sent.at(-1)!.body).includes('Cousin Lou'));

  await call(mom, 'PATCH', `${base}/kids/${max.id}`, { aiOn: false });
  assert.equal((await call(mom, 'POST', `${base}/judge`, { sides: [{ kidId: ava.id, story: 'x' }, { kidId: max.id, story: 'y' }] })).status, 403);
  await call(mom, 'PATCH', `${base}/ai`, { enabled: false });
  const before = sent.length;
  assert.equal((await call(mom, 'POST', `${base}/judge`, { sides: [{ kidId: ava.id, story: 'x' }, { name: 'Lou', story: 'y' }] })).status, 403);
  assert.equal(sent.length, before, 'nothing sent while AI is off');
  setAiFetch(undefined);
});

test('the doctor and parenting chats keep a conversation per home', async () => {
  const { call, mom, base, ava } = await setup();
  const sent: Sent[] = [];
  fakeClaude(sent, { answer: 'Two minutes is plenty, then a hug.', urgent: false });
  const first = await call(mom, 'POST', `${base}/chat/parenting`, { message: 'Hit his sister. Time-out?', kidId: ava.id });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.name, 'Coach Ringtail');
  assert.deepEqual(first.body.messages.map((m: { role: string }) => m.role), ['user', 'assistant']);
  assert.match(JSON.stringify(sent[0].body.system), /time-out/i);
  assert.match(JSON.stringify(sent[0].body.messages), /About my \d+-year-old/);

  await call(mom, 'POST', `${base}/chat/parenting`, { message: 'And if she does it again?' });
  const msgs = sent[1].body.messages as { role: string }[];
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user'], 'earlier turns go along');

  fakeClaude(sent, { answer: 'Call your doctor now.', urgent: true });
  const doc = await call(mom, 'POST', `${base}/chat/doctor`, { message: 'Baby has a 104 fever' });
  assert.equal(doc.body.name, 'Dr. Bandit');
  assert.equal(doc.body.messages.at(-1).urgent, true);
  assert.match(JSON.stringify(sent.at(-1)!.body.system), /raccoon doctor/);
  assert.equal((await call(mom, 'GET', `${base}/chat/parenting`)).body.messages.length, 4, 'chats are separate');

  assert.equal((await call(mom, 'POST', `${base}/chat/nope`, { message: 'hi' })).status, 404);
  await call(mom, 'DELETE', `${base}/chat/parenting`);
  assert.equal((await call(mom, 'GET', `${base}/chat/parenting`)).body.messages.length, 0);
  setAiFetch(undefined);
});
