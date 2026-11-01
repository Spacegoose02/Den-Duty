import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';

test('LootDen link: chores today, game locks from time-outs and game time from the shop', async () => {
  const { call, mom, base, ava, ben, tablet, asKid, today } = await family();
  const homeId = base.split('/').pop();
  const read = (await call(mom, 'POST', `${base}/tokens`, { name: 'LootDen look' })).body.token as string;
  const control = (await call(mom, 'POST', `${base}/tokens`, { name: 'LootDen', scope: 'control' })).body.token as string;
  const v1 = `/api/v1/homes/${homeId}`;
  const as = (token: string) => ({ authorization: `Bearer ${token}` });
  // Token calls go without anyone's cookie.
  const api = (method: string, url: string, token: string, body?: unknown) => call({}, method, url, body, as(token));

  // A chore for Ava today, half of it done.
  await call(mom, 'POST', `${base}/chores`, { title: 'Make bed', points: 2, schedule: 'daily', memberIds: [ava.id], startDate: today });
  await call(mom, 'POST', `${base}/chores`, { title: 'Feed cat', points: 2, schedule: 'daily', memberIds: [ava.id], startDate: today });
  // Ben can't play anything for a day; Ava just can't play Roblox. A plain time-out doesn't lock games.
  const lock = (await call(mom, 'POST', `${base}/kids/${ben.id}/timeouts`, { what: 'No games', length: 1, unit: 'days', games: 'all' })).body;
  assert.equal(lock.games, 'all');
  await call(mom, 'POST', `${base}/kids/${ava.id}/timeouts`, { what: 'No Roblox', length: 2, unit: 'hours', games: 'roblox' });
  await call(mom, 'POST', `${base}/kids/${ava.id}/timeouts`, { what: 'No TV', length: 2, unit: 'hours' });
  assert.equal((await call(mom, 'POST', `${base}/kids/${ava.id}/timeouts`, { what: 'x', length: 1, unit: 'hours', games: 'everything' })).status, 400);

  // Game time in the shop: Ava buys 30 minutes.
  assert.equal((await call(mom, 'POST', `${base}/shop`, { title: 'Too much', price: 5, gameMinutes: 2 })).status, 400);
  const item = (await call(mom, 'POST', `${base}/shop`, { title: '30 min game time', icon: '🎮', price: 10, gameMinutes: 30 })).body;
  assert.equal(item.gameMinutes, 30);
  await call(mom, 'POST', `${base}/kids/${ava.id}/points`, { amount: 15, reason: 'Start' });
  await asKid(ava);
  const order = (await call(tablet, 'POST', `${base}/kids/${ava.id}/shop/${item.id}/buy`)).body.order;
  assert.equal(order.gameMinutes, 30);
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  const first = board.todayItems.find((i: { title: string }) => i.title === 'Make bed');
  assert.equal((await call(tablet, 'POST', `${base}/instances/${first.id}/done`, {})).status, 200);

  const state = await api('GET', `${v1}/gaming`, read);
  assert.equal(state.status, 200);
  const a = state.body.kids.find((k: { id: string }) => k.id === ava.id);
  const b = state.body.kids.find((k: { id: string }) => k.id === ben.id);
  assert.equal(a.chores.due, 2);
  assert.equal(a.chores.left, 1);
  assert.deepEqual(a.locks.map((l: { games: string }) => l.games), ['roblox'], 'only time-outs that lock games');
  assert.deepEqual(b.locks.map((l: { what: string; games: string }) => [l.what, l.games]), [['No games', 'all']]);
  assert.equal(a.gameTime[0].minutes, 30);
  assert.equal(a.gameTime[0].orderId, order.id);

  // Claiming needs a control token, marks the order given and is safe to repeat.
  assert.equal((await api('POST', `${v1}/gaming/orders/${order.id}/claim`, read, {})).status, 403);
  const claimed = await api('POST', `${v1}/gaming/orders/${order.id}/claim`, control, {});
  assert.deepEqual(claimed.body, { ok: true, already: false });
  assert.equal((await api('POST', `${v1}/gaming/orders/${order.id}/claim`, control, {})).body.already, true);
  const orders = (await call(mom, 'GET', `${base}/shop/orders`)).body;
  assert.equal(orders[0].status, 'given');
  assert.equal(orders[0].closedBy, 'LootDen');
  assert.equal((await api('GET', `${v1}/gaming`, read)).body.kids.find((k: { id: string }) => k.id === ava.id).gameTime.length, 0);

  // Ending the time-out early unlocks Ben's games.
  await call(mom, 'PATCH', `${base}/timeouts/${lock.id}`, { end: true });
  assert.equal((await api('GET', `${v1}/gaming`, read)).body.kids.find((k: { id: string }) => k.id === ben.id).locks.length, 0);
  // The API docs list the LootDen endpoints.
  const docs = (await call(mom, 'GET', '/api/v1/openapi.json')).body;
  assert.ok(docs.paths['/homes/{homeId}/gaming']);
});
