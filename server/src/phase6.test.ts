// Per-kid page switches, Doctors section switches, and "Ask Dr. Bandit".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-p6-'));
const { family, fakeClaude } = await import('./test-helpers.ts');
type Sent = import('./test-helpers.ts').Sent;

const { setAiFetch } = await import('./ai.ts');
const { parseIcs } = await import('../../shared/ics.ts');
const { DOCTOR_NAME } = await import('../../shared/pages.ts');

test('turning a page off for one kid hides it everywhere for that kid, keeps the data, and brings it back', async () => {
  const { call, mom, base, ava, ben, tablet, asKid, today } = await family();
  await call(mom, 'POST', `${base}/chores`, { title: 'Make bed', points: 2, memberIds: [ava.id, ben.id] });
  const goal = (await call(mom, 'POST', `${base}/kids/${ava.id}/goals`, { title: 'Zoo trip', targetPoints: 50 })).body;
  await call(mom, 'POST', `${base}/parent-duty`, { kidId: ava.id, title: 'Sign the field trip form' });
  await call(mom, 'POST', `${base}/kids/${ava.id}/therapy/goals`, { area: 'speech', title: 'Use 3-word sentences' });
  await asKid(ava);
  const item = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.todayItems[0];
  await call(tablet, 'POST', `${base}/instances/${item.id}/done`, {});
  const { body: tok } = await call(mom, 'POST', `${base}/tokens`, { name: 'HA' });
  const links = (await call(mom, 'GET', `${base}/calendars`)).body;
  const avaLink = links.kids.find((k: { id: string }) => k.id === ava.id).url;

  const off = (await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { pagesOff: ['chores', 'parentduty', 'goals', 'stats', 'doctors', 'calendar', 'nonsense'] })).body;
  assert.deepEqual(off.pagesOff, ['chores', 'parentduty', 'goals', 'stats', 'doctors', 'calendar'], 'unknown pages are dropped');

  // The tablet board leaves it all out.
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.deepEqual([board.todayItems.length, board.goals.length, board.achievements.length, board.therapy], [0, 0, 0, null]);
  assert.ok(board.week.every((d: { items: unknown[] }) => d.items.length === 0));

  // Parent views: week, review queue, stats and Doctors skip her; Ben is unaffected.
  const agenda = (await call(mom, 'GET', `${base}/agenda`)).body;
  assert.ok(agenda.days.flatMap((d: { items: { memberId: string }[] }) => d.items).every((i: { memberId: string }) => i.memberId === ben.id));
  assert.equal((await call(mom, 'GET', `${base}/review`)).body.length, 0, "her waiting chore is hidden from review");
  assert.deepEqual((await call(mom, 'GET', `${base}/stats`)).body.kids.map((k: { id: string }) => k.id), [ben.id]);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/therapy`)).status, 403);

  // Calendar: no personal feed, and she's left out of the home feed.
  assert.equal((await call({}, 'GET', avaLink)).status, 404);
  const homeIcs = parseIcs((await call({}, 'GET', links.home)).body ?? '', 'UTC');
  assert.ok(homeIcs.every((e) => !e.summary.includes('Avaleigh')));

  // Home Assistant: her chore, goal and stats sensors are empty.
  const sensors = (await call({}, 'GET', `${base}/ha/summary`, undefined, { authorization: `Bearer ${tok.token}` })).body.kids_by_name.avaleigh;
  assert.deepEqual([sensors.left_today, sensors.next_goal, sensors.streak, sensors.level_name], [null, null, null, null]);
  assert.ok(typeof sensors.balance === 'number', 'points still show');

  // Back on: nothing was lost.
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { pagesOff: [] });
  const back = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(back.todayItems[0].status, 'submitted');
  assert.equal(back.goals[0].id, goal.id);
  assert.equal((await call(mom, 'GET', `${base}/parent-duty?kid=${ava.id}`)).body[0].title, 'Sign the field trip form');
  assert.equal((await call({}, 'GET', avaLink)).status, 200);
  assert.ok(today);
});

test('Doctors sections switch per kid; only the on ones show (data kept)', async () => {
  const { call, mom, base, ava, tablet, asKid } = await family();
  const t = `${base}/kids/${ava.id}/therapy`;
  await call(mom, 'POST', `${t}/goals`, { area: 'speech', title: 'Use 3-word sentences' });
  const motor = (await call(mom, 'POST', `${t}/goals`, { area: 'motor', title: 'Tripod grip' })).body;
  await call(mom, 'POST', `${t}/goals`, { area: 'other', title: 'Sleep through the night' });
  await call(mom, 'POST', `${t}/notes`, { goalId: motor.id, body: 'Held the crayon well' });
  await call(mom, 'POST', `${t}/appointments`, { kind: 'dental', title: 'Dentist', startsAt: '2099-01-01T09:00' });
  await call(mom, 'POST', `${t}/appointments`, { kind: 'speech', title: 'Speech', startsAt: '2099-01-02T09:00' });

  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { doctorAreasOff: ['ot', 'dental'] });
  let data = (await call(mom, 'GET', t)).body;
  assert.deepEqual(data.areasOff, ['ot', 'dental']);
  assert.deepEqual(data.goals.map((g: { title: string }) => g.title).sort(), ['Sleep through the night', 'Use 3-word sentences'], "'other' goals always show");
  assert.deepEqual(data.appointments.map((a: { title: string }) => a.title), ['Speech']);
  assert.ok(data.notes.every((n: { body: string }) => !n.body.includes('crayon')), "an off section's notes are hidden too");

  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { doctorAreasOff: ['appointments'] });
  data = (await call(mom, 'GET', t)).body;
  assert.equal(data.appointments.length, 0, 'the appointments switch hides them all');
  assert.equal(data.goals.length, 3, 'turning ot back on brings its goal back');
  assert.equal((await call(mom, 'GET', `${base}/therapy/upcoming`)).body.length, 0);

  await call(mom, 'PATCH', t, { kidVisible: true });
  await asKid(ava);
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.therapy.upcoming.length, 0);
});

test(`Ask ${DOCTOR_NAME}: parent-only, AI-gated, scoped to the kid's areas, short history the parent can clear`, async () => {
  const { call, mom, base, ava, tablet, asKid } = await family();
  const t = `${base}/kids/${ava.id}/therapy`;
  await call(mom, 'POST', `${t}/goals`, { area: 'speech', title: 'Use 3-word sentences' });
  await call(mom, 'POST', `${t}/goals`, { area: 'dental', title: 'Brush twice a day' });
  await call(mom, 'POST', `${t}/notes`, { body: 'Private: had a rough night' });
  await call(mom, 'POST', `${t}/appointments`, { kind: 'speech', title: 'Speech with Ms. Lee', startsAt: '2099-01-02T09:00' });
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { doctorAreasOff: ['dental', 'pt'] });
  const ask = `${base}/kids/${ava.id}/doctors/ask`;

  assert.equal((await call(mom, 'POST', ask, { question: 'Is stuttering normal?' })).status, 403, 'needs AI ideas turned on');
  const sent: Sent[] = [];
  let urgent = false;
  fakeClaude(sent, () => ({ answer: 'Many children repeat sounds at this age. Keep talking slowly and calmly.', urgent }));
  await call(mom, 'PATCH', `${base}/ai`, { apiKey: 'sk-ant-api03-test-key-abcdefghijklmnop', enabled: true });

  assert.equal((await call(mom, 'POST', ask, { question: '' })).status, 400);
  const r = (await call(mom, 'POST', ask, { question: 'Is stuttering normal?' })).body;
  assert.equal(r.name, DOCTOR_NAME);
  assert.match(r.disclaimer, /not medical advice/i);
  assert.match(r.urgentNote, /emergency/i);
  assert.equal(r.urgent, false);
  const body = JSON.stringify(sent[0].body);
  assert.ok(body.includes('4 years old') && body.includes('Speech') && body.includes('Use 3-word sentences') && body.includes('Is stuttering normal?'));
  assert.ok(!body.includes('Avaleigh') && !body.includes('Private') && !body.includes('Ms. Lee'), 'no name, notes or appointments');
  assert.ok(!body.includes('Brush twice') && !body.includes('Dental'), 'sections turned off are not mentioned');
  assert.match(String(sent[0].body.system), new RegExp(DOCTOR_NAME));

  urgent = true;
  assert.equal((await call(mom, 'POST', ask, { question: 'She has a fever of 105' })).body.urgent, true);
  for (let i = 0; i < 10; i++) { urgent = false; await call(mom, 'POST', ask, { question: `Question ${i}` }); }
  const hist = (await call(mom, 'GET', ask)).body.history as { question: string }[];
  assert.equal(hist.length, 10, 'only the newest 10 are kept');
  assert.equal(hist[0].question, 'Question 9');

  await asKid(ava);
  assert.equal((await call(tablet, 'POST', ask, { question: 'hi' })).status, 403, 'parents only');
  assert.equal((await call(tablet, 'GET', ask)).status, 403);

  await call(mom, 'DELETE', ask);
  assert.equal((await call(mom, 'GET', ask)).body.history.length, 0, 'the parent can clear it');
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { pagesOff: ['doctors'] });
  assert.equal((await call(mom, 'POST', ask, { question: 'x' })).status, 403, 'off with the Doctors page');
  setAiFetch(undefined);
});
