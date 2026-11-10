import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { addDays } from '../../shared/schedule.ts';
import { awayOn } from '../../shared/away.ts';

test('caregivers join with their own code and get the day-to-day only', async () => {
  const { call, mom, base, ava, tablet, asKid, today } = await family();
  await call(mom, 'POST', `${base}/chores`, { title: 'Dishes', icon: '🍽️', points: 2, schedule: 'daily', memberIds: [ava.id] });
  const code = (await call(mom, 'POST', `${base}/caregiver-code`)).body.caregiverCode as string;
  const gran: Record<string, string> = {};
  await call(gran, 'POST', '/api/auth/local', { name: 'Gran' });
  assert.equal((await call(gran, 'POST', '/api/homes/join', { code })).body.access, 'caregiver');

  const home = (await call(gran, 'GET', base)).body;
  assert.equal(home.access, 'caregiver');
  assert.equal(home.joinCode, undefined, "caregivers don't see the parents' join code");
  assert.equal((await call(gran, 'GET', `${base}/kids/${ava.id}/feelings`)).status, 403);
  assert.equal((await call(gran, 'GET', `${base}/money`)).status, 403);
  assert.equal((await call(gran, 'GET', `${base}/kids/${ava.id}/health`)).status, 403);
  assert.equal((await call(gran, 'GET', `${base}/tokens`)).status, 403);
  assert.equal((await call(gran, 'POST', `${base}/chores`, { title: 'Nope', points: 1, schedule: 'daily', memberIds: [ava.id] })).status, 403);
  assert.equal((await call(gran, 'PATCH', base, { name: 'Grans house' })).status, 403);
  assert.equal((await call(gran, 'POST', `${base}/kids/${ava.id}/points`, { amount: 50, reason: 'Spoiling' })).status, 403);

  // What they can do: see the board and approve.
  await asKid(ava);
  const item = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.todayItems[0];
  await call(tablet, 'POST', `${base}/instances/${item.id}/done`);
  assert.equal((await call(gran, 'GET', `${base}/review`)).status, 200);
  assert.equal((await call(gran, 'POST', `${base}/instances/${item.id}/approve`)).status, 200);

  // Mom sees her as a caregiver and sets an end date; after it, she's out.
  const parents = (await call(mom, 'GET', base)).body.parents as { id: string; name: string; access: string }[];
  const g = parents.find((p) => p.name === 'Gran')!;
  assert.equal(g.access, 'caregiver');
  await call(mom, 'PATCH', `${base}/parents/${g.id}`, { until: addDays(today, -1) });
  assert.match((await call(gran, 'GET', `${base}/kids/${ava.id}/board`)).body.error, /ended/);
  // Caregivers can't remove other people, and the last full parent can't be made a caregiver.
  const me = parents.find((p) => p.name === 'Mom')!;
  assert.equal((await call(mom, 'PATCH', `${base}/parents/${me.id}`, { access: 'caregiver' })).status, 400);
  // Joining with the parents' code later makes her a full parent.
  await call(mom, 'PATCH', `${base}/parents/${g.id}`, { until: null });
  assert.equal((await call(gran, 'DELETE', `${base}/parents/${me.id}`)).status, 403);
  const join = (await call(mom, 'GET', base)).body.joinCode;
  await call(gran, 'POST', '/api/homes/join', { code: join });
  assert.equal((await call(gran, 'GET', base)).body.access, 'full');
});

test('two homes: patterns and away dates', () => {
  const plan = { label: "At Dad's", anchor: '2026-11-02', days: [...Array(7).fill(false), ...Array(7).fill(true)] };
  assert.equal(awayOn(plan, [], '2026-11-02'), null);
  assert.equal(awayOn(plan, [], '2026-11-09'), "At Dad's");
  assert.equal(awayOn(plan, [], '2026-11-16'), null);
  assert.equal(awayOn(plan, [], '2026-10-01'), null, 'not before the pattern starts');
  assert.equal(awayOn(plan, [{ id: 'x', start: '2026-11-03', end: '2026-11-04', label: 'Camp' }], '2026-11-03'), 'Camp');
});

test("two homes: no chores on days away, the board and voice say where they are", async () => {
  const { call, mom, base, ava, tablet, asKid, today } = await family();
  await call(mom, 'POST', `${base}/chores`, { title: 'Dishes', icon: '🍽️', points: 2, schedule: 'daily', memberIds: [ava.id] });
  await asKid(ava);
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.todayItems.length, 1);
  assert.equal((await call(mom, 'GET', base)).body.twoHomes, false, 'off by default');
  await call(mom, 'PATCH', base, { twoHomes: true });
  // Away today and tomorrow, back the day after.
  const v = (await call(mom, 'POST', `${base}/kids/${ava.id}/away/dates`, { start: today, end: addDays(today, 1), label: "At Dad's" })).body;
  assert.equal(v.today.label, "At Dad's");
  assert.equal(v.today.back, addDays(today, 2));
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(board.todayItems.length, 0, "today's not-started chore went away");
  assert.equal(board.away.label, "At Dad's");
  const week = board.week as { date: string; items: unknown[] }[];
  assert.equal(week.find((d) => d.date === addDays(today, 1))?.items.length ?? 0, 0, 'no planned chores tomorrow');
  const tok = (await call(mom, 'POST', `${base}/tokens`, { name: 'HA' })).body.token as string;
  assert.equal((await call({}, 'GET', `${base}/ha/say?kid=Ava&about=chores`, undefined, { authorization: `Bearer ${tok}` })).body.speech, "Avaleigh is at Dad's today, so no chores here.");
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/away`)).status, 403, 'parents set it');
  // Back: removing the dates brings today's chore back.
  await call(mom, 'DELETE', `${base}/kids/${ava.id}/away/dates/${v.ranges[0].id}`);
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.todayItems.length, 1);
  // A week-on-week-off pattern starting today: here this week.
  const p = (await call(mom, 'PUT', `${base}/kids/${ava.id}/away/plan`, { label: "At Dad's", anchor: today, days: v.presets[0].days })).body;
  assert.equal(p.today, null);
  assert.equal((await call(mom, 'PUT', `${base}/kids/${ava.id}/away/plan`, { anchor: today, days: [true] })).status, 400);
});

test('two homes: the Settings switch hides it and keeps the dates', async () => {
  const { call, mom, base, ava, tablet, asKid, today } = await family();
  await call(mom, 'POST', `${base}/chores`, { title: 'Dishes', icon: '🍽️', points: 2, schedule: 'daily', memberIds: [ava.id] });
  await asKid(ava);
  await call(mom, 'PATCH', base, { twoHomes: true });
  await call(mom, 'POST', `${base}/kids/${ava.id}/away/dates`, { start: today, end: today, label: 'Camp' });
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.todayItems.length, 0);
  // Off: every day counts as here, the board doesn't say she's away, and the dates are still there.
  await call(mom, 'PATCH', base, { twoHomes: false });
  const off = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(off.away, null);
  assert.equal(off.todayItems.length, 1);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/away`)).body.ranges.length, 1);
  // Back on: today's not-started chore goes away again.
  await call(mom, 'PATCH', base, { twoHomes: true });
  const on = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(on.away.label, 'Camp');
  assert.equal(on.todayItems.length, 0);
});
