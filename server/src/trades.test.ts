import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';

test('trading chores: swap today\'s chores with a parent OK, help splits the points, undo takes back from both', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  await call(mom, 'POST', `${base}/chores`, { title: 'Dishes', icon: '🍽️', points: 4, schedule: 'daily', memberIds: [ava.id] });
  await call(mom, 'POST', `${base}/chores`, { title: 'Trash', icon: '🗑️', points: 2, schedule: 'daily', memberIds: [ben.id] });
  await call(mom, 'POST', `${base}/chores`, { title: 'Clean room', icon: '🧹', points: 6, schedule: 'daily', memberIds: [ava.id] });
  const board = async (kid: { id: string }) => (await call(tablet, 'GET', `${base}/kids/${kid.id}/board`)).body.todayItems as { id: string; title: string; points: number; helperId: string | null }[];

  await asKid(ava);
  const mine = await board(ava);
  const dishes = mine.find((i) => i.title === 'Dishes')!;
  const room = mine.find((i) => i.title === 'Clean room')!;
  const opts = (await call(tablet, 'GET', `${base}/trades/options`)).body;
  assert.equal(opts.length, 1);
  const trash = opts[0].chores.find((c: { title: string }) => c.title === 'Trash');

  // Ava offers dishes for Ben's trash; she can't offer the same chore twice or trade Ben's for him.
  const swap = (await call(tablet, 'POST', `${base}/trades`, { kind: 'swap', instanceId: dishes.id, toMemberId: ben.id, otherInstanceId: trash.id })).body;
  assert.equal(swap.status, 'offered');
  assert.equal((await call(tablet, 'POST', `${base}/trades`, { kind: 'help', instanceId: dishes.id, toMemberId: ben.id })).status, 400);
  assert.equal((await call(tablet, 'POST', `${base}/trades`, { kind: 'swap', instanceId: trash.id, toMemberId: ava.id, otherInstanceId: dishes.id })).status, 403);
  assert.equal((await call(tablet, 'POST', `${base}/trades/${swap.id}/accept`)).status, 403, 'only Ben can say yes');

  // Ben says yes; by default it waits for a parent.
  await asKid(ben);
  assert.equal((await call(tablet, 'GET', `${base}/trades`)).body.trades.length, 1);
  assert.equal((await call(tablet, 'POST', `${base}/trades/${swap.id}/accept`)).body.status, 'accepted');
  assert.equal((await call(tablet, 'POST', `${base}/trades/${swap.id}/approve`)).status, 403);
  assert.equal((await call(mom, 'GET', `${base}/trades`)).body.trades[0].status, 'accepted');
  assert.equal((await call(mom, 'POST', `${base}/trades/${swap.id}/approve`)).body.status, 'done');

  // The chores changed hands, and reloading the board doesn't bring the old ones back.
  assert.deepEqual((await board(ben)).map((i) => i.title).sort(), ['Dishes']);
  await asKid(ava);
  assert.deepEqual((await board(ava)).map((i) => i.title).sort(), ['Clean room', 'Trash']);

  // Help: free mode, Ben helps Ava clean her room and they split 6 points (3 each).
  await call(mom, 'PUT', `${base}/trades/mode`, { mode: 'free' });
  const help = (await call(tablet, 'POST', `${base}/trades`, { kind: 'help', instanceId: room.id, toMemberId: ben.id })).body;
  assert.equal(help.helperGets, 3);
  await asKid(ben);
  assert.equal((await call(tablet, 'POST', `${base}/trades/${help.id}/accept`)).body.status, 'done');
  await call(mom, 'POST', `${base}/instances/${room.id}/approve`);
  const balances = async () => Object.fromEntries(((await call(mom, 'GET', base)).body.kids as { name: string; balance: number }[]).map((k) => [k.name, k.balance]));
  assert.deepEqual(await balances(), { Avaleigh: 3, Benedict: 3 });
  // Undo takes back from both.
  await call(mom, 'POST', `${base}/instances/${room.id}/undo`);
  assert.deepEqual(await balances(), { Avaleigh: 0, Benedict: 0 });

  // Off: no options and no new trades.
  await call(mom, 'PUT', `${base}/trades/mode`, { mode: 'off' });
  assert.deepEqual((await call(tablet, 'GET', `${base}/trades/options`)).body, []);
  assert.equal((await call(mom, 'PUT', `${base}/trades/mode`, { mode: 'whatever' })).status, 400);
});
