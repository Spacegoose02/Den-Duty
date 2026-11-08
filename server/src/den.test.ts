import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { tidinessOf } from '../../shared/den.ts';

test('den tidiness from the share of chores done', () => {
  assert.equal(tidinessOf(null), 'tidy');
  assert.equal(tidinessOf(1), 'sparkling');
  assert.equal(tidinessOf(0.7), 'tidy');
  assert.equal(tidinessOf(0.4), 'messy');
  assert.equal(tidinessOf(0), 'very-messy');
});

test("Rocky's den: buy furniture with points, levels lock fancy things, chores make it tidy", async () => {
  const { call, mom, base, ava, tablet, asKid } = await family();
  await call(mom, 'POST', `${base}/chores`, { title: 'Dishes', icon: '🍽️', points: 2, schedule: 'daily', memberIds: [ava.id] });
  await asKid(ava);
  let den = (await call(tablet, 'GET', `${base}/kids/${ava.id}/den`)).body;
  assert.equal(den.tidiness, 'tidy', 'nothing finished yet today is not messy');
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/den/buy`, { itemId: 'plant' })).status, 400, 'no points yet');

  await call(mom, 'POST', `${base}/kids/${ava.id}/points`, { amount: 20, reason: 'Birthday' }).catch(() => null);
  const quick = (await call(mom, 'GET', `${base}/quick-rewards`)).body[0];
  for (let i = 0; i < 6; i++) await call(mom, 'POST', `${base}/quick-rewards/${quick.id}/give`, { memberId: ava.id });
  const bal = (await call(tablet, 'GET', `${base}/kids/${ava.id}/den`)).body.balance;
  assert.ok(bal >= 8);

  den = (await call(tablet, 'POST', `${base}/kids/${ava.id}/den/buy`, { itemId: 'plant' })).body;
  assert.equal(den.items.find((i: { id: string }) => i.id === 'plant').owned, true);
  assert.equal(den.balance, bal - 8);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/den/buy`, { itemId: 'plant' })).status, 400, 'only once');
  assert.match((await call(tablet, 'POST', `${base}/kids/${ava.id}/den/buy`, { itemId: 'crown' })).body.error, /level 7/);
  den = (await call(tablet, 'POST', `${base}/kids/${ava.id}/den/place`, { itemId: 'plant', placed: false })).body;
  assert.equal(den.items.find((i: { id: string }) => i.id === 'plant').placed, false);

  // Finishing today's chore makes it sparkle.
  const item = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.todayItems[0];
  await call(tablet, 'POST', `${base}/instances/${item.id}/done`);
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/den`)).body.tidiness, 'sparkling');

  // The ledger says what it was.
  const recent = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.recent as { reason: string }[];
  assert.ok(recent.some((r) => r.reason.includes('Plant for my den')));

  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { pagesOff: ['den'] });
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/den`)).body, null);
});
