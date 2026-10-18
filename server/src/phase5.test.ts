// Ages on kids, therapy rewards, the AI speech and OT helpers, and Den Duty room boards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-p5-'));

const { family, fakeClaude } = await import('./test-helpers.ts');
const { setAiFetch } = await import('./ai.ts');
type Sent = import('./test-helpers.ts').Sent;

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

test('speech and OT helpers: off unless AI is on, cached per day, and only age, area and goal text are sent', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  const t = `${base}/kids/${ava.id}/therapy`;
  await call(mom, 'POST', `${t}/goals`, { area: 'speech', title: 'Use 3-word sentences' });
  await call(mom, 'POST', `${t}/goals`, { area: 'motor', title: 'Hold a crayon with a tripod grip' });
  await call(mom, 'POST', `${t}/notes`, { body: 'Private: seemed tired after daycare' });
  await call(mom, 'POST', `${base}/kids/${ben.id}/therapy/goals`, { area: 'feeding', title: 'Try crunchy foods' });

  assert.equal((await call(mom, 'GET', `${t}/helper/speech`)).status, 403, 'off until AI is on');
  assert.deepEqual((await call(mom, 'GET', `${base}/therapy/tips`)).body, []);

  const sent: Sent[] = [];
  fakeClaude(sent, () => ({
    tip: { title: 'Bath-time narrating', activity: 'Talk about what you do in the bath. Pause so they can add a word.', minutes: 10, why: 'Builds longer phrases.' },
    goals: [{ title: 'Two-word requests at snack time', why: 'A small step toward three words' }],
  }));
  await call(mom, 'PATCH', `${base}/ai`, { apiKey: 'sk-ant-api03-test-key-abcdefghijklmnop', enabled: true });

  const tip = (await call(mom, 'GET', `${t}/helper/speech`)).body;
  assert.equal(tip.tip.title, 'Bath-time narrating');
  assert.match(tip.disclaimer, /not medical advice/i);
  assert.equal(tip.cached, false);
  const body = JSON.stringify(sent[0].body);
  assert.ok(body.includes('4 years old') && body.includes('Use 3-word sentences'));
  assert.ok(!body.includes('Avaleigh') && !body.includes('Private') && !body.includes('crayon'), 'no name, no notes, no other areas');
  assert.match(String(sent[0].body.system), /talk over with the child's speech therapist/);

  assert.equal((await call(mom, 'GET', `${t}/helper/speech`)).body.cached, true, 'the daily tip is cached');
  assert.equal(sent.length, 1);

  // The home screen gets a tip per kid per area with goals: Ava's OT (motor) tip is new, her speech tip is cached; Ben has neither.
  const tips = (await call(mom, 'GET', `${base}/therapy/tips`)).body as { kidName: string; area: string; cached: boolean }[];
  assert.deepEqual(tips.map((x) => `${x.kidName}:${x.area}:${x.cached}`).sort(), ['Avaleigh:ot:false', 'Avaleigh:speech:true']);
  assert.match(JSON.stringify(sent[1].body), /Hold a crayon/);
  assert.match(String(sent[1].body.system), /occupational therapist/);
  assert.equal((await call(mom, 'GET', `${t}/helper/speech?refresh=1`)).body.cached, false, 'parents can ask for a new one');

  await asKid(ava);
  assert.equal((await call(tablet, 'GET', `${t}/helper/speech`)).status, 403, 'kids never see the helper');
  setAiFetch(undefined);
});

test('Den Duty: room boards per kid, kids move their own cards, parents check them off (paid once a day)', async () => {
  const { db, call, mom, base, ava, ben, tablet, asKid } = await family();
  const bed = (await call(mom, 'POST', `${base}/den`, { kidId: ava.id, title: 'Make your bed', icon: '🛏️', points: 2 })).body;
  assert.deepEqual([bed.kidId, bed.repeatDaily, bed.points, bed.status], [ava.id, true, 2, 'todo']);
  const toys = (await call(mom, 'POST', `${base}/den`, { kidId: ben.id, title: 'Toys away', icon: '🧸' })).body;
  const parentTodo = (await call(mom, 'POST', `${base}/den`, { title: 'Fix the closet door' })).body;
  assert.equal(parentTodo.kidId, null);

  await asKid(ava);
  const mine = (await call(tablet, 'GET', `${base}/den`)).body as { id: string }[];
  assert.deepEqual(mine.map((c) => c.id), [bed.id], 'kids only see their own room');
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.den.length, 1);
  assert.equal((await call(tablet, 'PATCH', `${base}/den/${toys.id}`, { status: 'done' })).status, 403, "not a sibling's card");
  assert.equal((await call(tablet, 'PATCH', `${base}/den/${bed.id}`, { points: 99 })).status, 403, 'kids can only move cards');
  assert.equal((await call(tablet, 'POST', `${base}/den/${bed.id}/check`, {})).status, 403);
  assert.equal((await call(tablet, 'PATCH', `${base}/den/${bed.id}`, { status: 'done' })).body.status, 'done');

  const check = await call(mom, 'POST', `${base}/den/${bed.id}/check`, {});
  assert.equal(check.body.awarded, 2);
  assert.equal((await call(mom, 'POST', `${base}/den/${bed.id}/check`, {})).body.awarded, 0, 'no double pay');
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/ledger`)).body.entries[0].reason, '🦝 Den Duty: Make your bed');

  // Tomorrow the daily card is back on the board and can earn again.
  db.prepare("UPDATE honeydo SET done_date = '2000-01-01' WHERE id = ?").run(bed.id);
  const again = (await call(tablet, 'GET', `${base}/den`)).body[0];
  assert.deepEqual([again.status, again.checked], ['todo', false]);

  // Parents can filter boards; the old honey-do list is the parents' cards.
  assert.equal((await call(mom, 'GET', `${base}/den?kid=parents`)).body.length, 1);
  assert.equal((await call(mom, 'GET', `${base}/den?kid=${ben.id}`)).body[0].title, 'Toys away');
  assert.deepEqual((await call(mom, 'GET', `${base}/honeydo`)).body.map((c: { title: string }) => c.title), ['Fix the closet door']);
  await call(tablet, 'POST', '/api/kiosk/kid/logout', {});
  assert.equal((await call(tablet, 'GET', `${base}/den`)).status, 403, 'the tablet alone shows no boards');
});
