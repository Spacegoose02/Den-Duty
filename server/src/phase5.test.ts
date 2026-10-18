// Ages on kids, therapy rewards, the AI speech and OT helpers, and Den Duty room boards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-p5-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { setAiFetch } = await import('./ai.ts');
const { todayIn, addDays } = await import('../../shared/schedule.ts');

type Jar = Record<string, string>;
export type Sent = { url: string; body: Record<string, unknown> };

export async function family() {
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
  const today = todayIn('UTC');
  const ava = (await call(mom, 'POST', `${base}/kids`, { name: 'Avaleigh', birthdate: addDays(today, -365 * 4 - 30) })).body;
  const ben = (await call(mom, 'POST', `${base}/kids`, { name: 'Benedict', birthdate: addDays(today, -365 * 9 - 30) })).body;
  const tablet: Jar = {};
  const { body: code } = await call(mom, 'POST', '/api/auth/pair-code', { kind: 'device', homeId: home.id });
  await call(tablet, 'POST', '/api/auth/pair', { code: code.code });
  const asKid = async (kid: { id: string }) => {
    await call(tablet, 'POST', '/api/kiosk/kid/logout', {});
    await call(tablet, 'POST', '/api/kiosk/kid', { memberId: kid.id });
  };
  return { db, call, mom, base, ava, ben, tablet, asKid, today };
}

/** A local stand-in for the Claude API that answers with `reply` and records each request body. */
export function fakeClaude(sent: Sent[], reply: (body: Record<string, unknown>) => object) {
  setAiFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push({ url: String(input), body });
    return new Response(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify(reply(body)) }], usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);
}

test('kids have birthdays; age and picture mode follow, and AI ideas get the age but not the name', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  assert.equal(ava.age, 4);
  assert.equal(ava.pictureMode, true, 'four-year-olds get the picture-first board');
  assert.equal(ben.age, 9);
  assert.equal(ben.pictureMode, false);
  assert.equal((await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { birthdate: '2999-01-01' })).status, 400);
  assert.equal((await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { pictureMode: 'on' })).body.pictureMode, true, 'parents can override');
  assert.equal((await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { birthdate: '' })).body.age, null);
  await asKid(ava);
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(board.kid.pictureMode, true);

  const sent: Sent[] = [];
  fakeClaude(sent, () => ({ ideas: [{ title: 'Pick a bedtime story', points: 10, detail: 'You choose tonight' }] }));
  await call(mom, 'PATCH', `${base}/ai`, { apiKey: 'sk-ant-api03-test-key-abcdefghijklmnop', enabled: true });
  await call(mom, 'POST', `${base}/ai/ideas`, { kind: 'chore', kidId: ava.id });
  const text = JSON.stringify(sent[0].body);
  assert.ok(text.includes('about 4 years old'));
  assert.ok(!text.includes('Avaleigh'));
  setAiFetch(undefined);
});

test('therapy goals earn points through the ledger, worded kindly and privately', async () => {
  const { call, mom, base, ava, tablet, asKid } = await family();
  const t = `${base}/kids/${ava.id}/therapy`;
  assert.equal((await call(mom, 'POST', `${t}/goals`, { title: 'x', rewardStep: -1 })).status, 400);
  const goal = (await call(mom, 'POST', `${t}/goals`, { area: 'speech', title: 'Say "s" clearly', rewardStep: 2, rewardMet: 10 })).body;
  assert.deepEqual([goal.rewardStep, goal.rewardMet, goal.rewardMetPaid], [2, 10, false]);

  const practice = await call(mom, 'POST', `${t}/notes`, { goalId: goal.id, body: 'Practiced with flashcards', progress: 30 });
  assert.equal(practice.body.awarded, 2);
  assert.equal((await call(mom, 'POST', `${t}/notes`, { goalId: goal.id, body: 'Plan: try the snake game', noReward: true })).body.awarded, 0, 'saved plans are not paid');
  assert.equal((await call(mom, 'POST', `${t}/notes`, { body: 'General note' })).body.awarded, 0);

  await call(mom, 'PATCH', `${base}/therapy/goals/${goal.id}`, { status: 'met' });
  await call(mom, 'PATCH', `${base}/therapy/goals/${goal.id}`, { status: 'active' });
  const met = (await call(mom, 'PATCH', `${base}/therapy/goals/${goal.id}`, { status: 'met' })).body;
  assert.equal(met.rewardMetPaid, true);

  const ledger = (await call(mom, 'GET', `${base}/kids/${ava.id}/ledger`)).body;
  assert.equal(ledger.balance, 12, 'the met bonus is paid once');
  assert.deepEqual(ledger.entries.map((e: { reason: string }) => e.reason), ['🏆 You reached a big goal!', '🌈 Great practice!'], 'the goal stays private until shared');

  // Shared with the kid: the board shows what each practice earns, and new entries name the goal.
  const goal2 = (await call(mom, 'POST', `${t}/goals`, { area: 'feeding', title: 'Try a new food', rewardStep: 3 })).body;
  await call(mom, 'PATCH', t, { kidVisible: true });
  await call(mom, 'POST', `${t}/notes`, { goalId: goal2.id, body: 'Tried peas' });
  await asKid(ava);
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(board.therapy.goals[0].rewardStep, 3);
  assert.equal(board.recent[0].reason, '🌈 Great practice: Try a new food');
});
