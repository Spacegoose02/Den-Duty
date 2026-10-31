import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';

test('surprise bonus chores: a gift box hides one of today’s bonus chores, worth double', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  const car = (await call(mom, 'POST', `${base}/chores`, { title: 'Wash the car', icon: '🚗', points: 10, bonus: true, memberIds: [] })).body;
  await asKid(ava);
  // Off by default.
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.surprise, null);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/surprise/open`)).status, 404);

  assert.equal((await call(mom, 'PATCH', base, { surprise: 'daily' })).status, 200);
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.deepEqual(board.surprise, { state: 'waiting' }, 'what is inside stays a secret');
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ben.id}/surprise/open`)).status, 403, 'not your gift');

  const opened = (await call(tablet, 'POST', `${base}/kids/${ava.id}/surprise/open`)).body.item;
  assert.equal(opened.choreId, car.id);
  assert.equal(opened.points, 20);
  assert.equal(opened.surprise, true);
  // Opening again gives the same chore, not a second one.
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/surprise/open`)).body.item.id, opened.id);
  const after = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(after.surprise.state, 'opened');
  assert.ok(after.todayItems.some((i: { id: string; surprise: boolean }) => i.id === opened.id && i.surprise));

  // Double points when approved.
  await call(tablet, 'POST', `${base}/instances/${opened.id}/done`);
  assert.equal((await call(mom, 'POST', `${base}/instances/${opened.id}/approve`)).body.awarded, 20);

  // With every bonus chore already claimed there's nothing to hide.
  await asKid(ben);
  await call(tablet, 'POST', `${base}/chores/${car.id}/claim`, {});
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ben.id}/board`)).body.surprise, null);
  assert.equal((await call(mom, 'PATCH', base, { surprise: 'sometimes' })).status, 200);
  assert.equal((await call(mom, 'GET', base)).body.surprise, 'sometimes');
});
