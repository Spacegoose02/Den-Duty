import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';

// A 1×1 PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
type Item = { id: string; choreId: string; status: string; hasPhoto: boolean; photoVersion: string | null };

test('a 0-point chore can be approved, and one bad chore does not stop Approve all', async () => {
  const { call, mom, base, ava, tablet, asKid } = await family();
  const habit = (await call(mom, 'POST', `${base}/chores`, { title: 'Brush teeth', points: 0, memberIds: [ava.id] })).body;
  const cat = (await call(mom, 'POST', `${base}/chores`, { title: 'Feed the cat', points: 3, memberIds: [ava.id] })).body;
  await asKid(ava);
  const items = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.todayItems as Item[];
  const zero = items.find((i) => i.choreId === habit.id)!;
  const three = items.find((i) => i.choreId === cat.id)!;
  for (const i of [zero, three]) await call(tablet, 'POST', `${base}/instances/${i.id}/done`);

  const one = await call(mom, 'POST', `${base}/instances/${zero.id}/approve`, {});
  assert.equal(one.status, 200);
  assert.equal(one.body.item.status, 'approved');
  assert.equal(one.body.awarded, 0);

  const all = await call(mom, 'POST', `${base}/review/approve`, { ids: ['gone', zero.id, three.id] });
  assert.equal(all.status, 200);
  assert.deepEqual(all.body, { approved: 2, awarded: 3, failed: 1 });
  assert.equal((await call(mom, 'GET', `${base}/review`)).body.length, 0);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/ledger`)).body.balance, 3);
});

test('"not yet" on a photo chore asks for a new photo, and the new photo gets a new version', async () => {
  const { call, mom, base, ben, tablet, asKid } = await family();
  const room = (await call(mom, 'POST', `${base}/chores`, { title: 'Clean your room', points: 5, memberIds: [ben.id], photo: true })).body;
  await asKid(ben);
  const item = ((await call(tablet, 'GET', `${base}/kids/${ben.id}/board`)).body.todayItems as Item[]).find((i) => i.choreId === room.id)!;
  const first = (await call(tablet, 'POST', `${base}/instances/${item.id}/photo`, { image: PNG })).body.item as Item;
  assert.ok(first.photoVersion);
  await call(tablet, 'POST', `${base}/instances/${item.id}/done`);

  const rejected = (await call(mom, 'POST', `${base}/instances/${item.id}/reject`, { note: 'Still messy' })).body.item as Item;
  assert.equal(rejected.hasPhoto, false);
  assert.equal(rejected.photoVersion, null);
  assert.equal((await call(tablet, 'POST', `${base}/instances/${item.id}/done`)).status, 400, 'the old photo is not enough');

  const second = (await call(tablet, 'POST', `${base}/instances/${item.id}/photo`, { image: PNG })).body.item as Item;
  assert.ok(second.photoVersion && second.photoVersion !== first.photoVersion);
  assert.equal((await call(tablet, 'POST', `${base}/instances/${item.id}/done`)).body.item.status, 'submitted');
});

test('undoing an approval after the points were spent stops at zero, unless the home allows going below', async () => {
  const { call, mom, base, ben, tablet, asKid } = await family();
  const chore = (await call(mom, 'POST', `${base}/chores`, { title: 'Dishes', points: 5, memberIds: [ben.id] })).body;
  const treat = (await call(mom, 'POST', `${base}/shop`, { title: 'Ice cream', price: 4 })).body;
  const item = ((await call(mom, 'GET', `${base}/kids/${ben.id}/board`)).body.todayItems as Item[]).find((i) => i.choreId === chore.id)!;
  await call(mom, 'POST', `${base}/instances/${item.id}/done`);
  await asKid(ben);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ben.id}/shop/${treat.id}/buy`, {})).status, 200);

  const undo = (await call(mom, 'POST', `${base}/instances/${item.id}/undo`, {})).body;
  assert.equal(undo.item.status, 'submitted');
  assert.deepEqual([undo.paid, undo.taken], [5, 1]);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ben.id}/ledger`)).body.balance, 0);

  // Approving again pays the chore again; undoing it now takes all of it back.
  await call(mom, 'POST', `${base}/instances/${item.id}/approve`, {});
  assert.equal((await call(mom, 'POST', `${base}/instances/${item.id}/undo`, {})).body.taken, 5);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ben.id}/ledger`)).body.balance, 0);

  // A home that allows going below zero takes it all back.
  await call(mom, 'PATCH', base, { allowNegative: true });
  await call(mom, 'POST', `${base}/instances/${item.id}/approve`, {});
  await asKid(ben);
  await call(tablet, 'POST', `${base}/kids/${ben.id}/shop/${treat.id}/buy`, {});
  assert.equal((await call(mom, 'POST', `${base}/instances/${item.id}/undo`, {})).body.taken, 5);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ben.id}/ledger`)).body.balance, -4);
});
