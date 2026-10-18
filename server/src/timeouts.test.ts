import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';

test('time-outs: parents set them, kids see a countdown, and buying time back waits for a parent', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  await call(mom, 'POST', `${base}/kids/${ava.id}/points`, { amount: 50, reason: 'Start' });

  // Kids can't make their own time-outs.
  await asKid(ava);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/timeouts`, { what: 'x', length: 1, unit: 'hours' })).status, 403);

  const bad = await call(mom, 'POST', `${base}/kids/${ava.id}/timeouts`, { what: 'No Roblox', length: 2, unit: 'fortnights' });
  assert.equal(bad.status, 400);
  const { body: t } = await call(mom, 'POST', `${base}/kids/${ava.id}/timeouts`, {
    what: 'No Roblox', reason: 'Hit her brother', length: 2, unit: 'days', buyUnit: 'hour', buyPrice: 5, buyMaxUnits: 4,
  });
  assert.equal(t.state, 'active');
  assert.ok(t.minutesLeft > 2879 && t.minutesLeft <= 2880);
  assert.deepEqual({ unit: t.buy.unit, price: t.buy.price, unitsLeft: t.buy.unitsLeft }, { unit: 'hour', price: 5, unitsLeft: 4 });

  // On the kid's board, and on the parent home.
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(board.timeouts.length, 1);
  assert.equal(board.timeouts[0].what, 'No Roblox');
  assert.equal((await call(mom, 'GET', `${base}/summary`)).body.timeouts.length, 1);

  // Ben can't ask on Ava's behalf; Ava can't ask for more than allowed or more than she can afford.
  assert.equal((await call(tablet, 'POST', `${base}/timeouts/${t.id}/requests`, { units: 5 })).status, 400);
  await call(mom, 'POST', `${base}/kids/${ava.id}/points`, { amount: -40, reason: 'Spent' });
  assert.match((await call(tablet, 'POST', `${base}/timeouts/${t.id}/requests`, { units: 3 })).body.error, /needs 15 points/);
  await call(mom, 'POST', `${base}/kids/${ava.id}/points`, { amount: 40, reason: 'Back' });
  await asKid(ben);
  assert.equal((await call(tablet, 'POST', `${base}/timeouts/${t.id}/requests`, { units: 1 })).status, 403);
  await asKid(ava);

  const asked = (await call(tablet, 'POST', `${base}/timeouts/${t.id}/requests`, { units: 3 })).body;
  assert.equal(asked.pending.points, 15);
  // Asking doesn't spend anything.
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/board`)).body.stats.balance, 50);
  assert.equal((await call(tablet, 'POST', `${base}/timeout-requests/${asked.pending.id}/approve`)).status, 403);

  const approved = (await call(mom, 'POST', `${base}/timeout-requests/${asked.pending.id}/approve`)).body;
  assert.equal(approved.pending, null);
  assert.ok(approved.minutesLeft <= 2880 - 180 && approved.minutesLeft > 2880 - 182);
  assert.equal(approved.buy.unitsLeft, 1);
  const after = (await call(mom, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(after.stats.balance, 35);
  assert.match(after.recent[0].reason, /3 hours off “No Roblox”/);
  assert.equal((await call(mom, 'POST', `${base}/timeout-requests/${asked.pending.id}/approve`)).status, 400, 'only once');

  // A denied ask costs nothing.
  const again = (await call(tablet, 'POST', `${base}/timeouts/${t.id}/requests`, { units: 1 })).body;
  await call(mom, 'POST', `${base}/timeout-requests/${again.pending.id}/deny`);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/board`)).body.stats.balance, 35);

  // Home Assistant sees it.
  const ha = (await call(mom, 'GET', `${base}/ha/summary`)).body;
  assert.equal(ha.active_timeouts, 1);
  assert.equal(ha.kids_by_name.avaleigh.in_timeout, true);
  assert.equal(ha.kids_by_name.avaleigh.timeouts[0].what, 'No Roblox');
  assert.equal(ha.kids_by_name.benedict.in_timeout, false);

  // Extend, then end early.
  const longer = (await call(mom, 'PATCH', `${base}/timeouts/${t.id}`, { extend: { length: 1, unit: 'weeks' } })).body;
  assert.ok(longer.minutesLeft > approved.minutesLeft + 10079);
  const ended = (await call(mom, 'PATCH', `${base}/timeouts/${t.id}`, { end: true })).body;
  assert.equal(ended.state, 'over');
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.timeouts.length, 0);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/timeouts`)).body.length, 1, 'parents still see last week’s');

  // Switched off for a kid: hidden everywhere and can't be added.
  await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { pagesOff: ['timeout'] });
  assert.equal((await call(mom, 'POST', `${base}/kids/${ben.id}/timeouts`, { what: 'No TV', length: 1, unit: 'hours' })).status, 403);
  assert.equal((await call(mom, 'GET', `${base}/ha/summary`)).body.kids_by_name.benedict.in_timeout, null);
});

test('time-outs: a start time in the future shows as coming up', async () => {
  const { call, mom, base, ava } = await family();
  const startsAt = new Date(Date.now() + 3 * 3600000).toISOString();
  const { body: t } = await call(mom, 'POST', `${base}/kids/${ava.id}/timeouts`, { what: 'No tablet', length: 1, unit: 'hours', startsAt });
  assert.equal(t.state, 'upcoming');
  assert.equal(t.minutesLeft, 60);
  assert.equal(t.buy, null);
});
