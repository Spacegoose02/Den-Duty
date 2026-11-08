import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';

test('family meeting: prep, cheers pay points, each kid sees their "this week I\'ll..."', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  const prep = (await call(mom, 'GET', `${base}/meetings/prep`)).body;
  assert.equal(prep.kids.length, 2);
  assert.ok(prep.recap.weekStart);
  assert.equal(prep.last, null);
  assert.equal((await call(tablet, 'GET', `${base}/meetings/prep`)).status, 403);

  assert.equal((await call(mom, 'POST', `${base}/meetings`, { cheers: [{ memberId: 'nobody', text: 'hi' }] })).status, 400);
  const m = (await call(mom, 'POST', `${base}/meetings`, {
    intentions: { [ava.id]: 'Read every night', [ben.id]: '  ', nobody: 'x' },
    cheers: [{ memberId: ben.id, text: 'Helped with dinner', points: 5 }, { memberId: ava.id, text: 'So kind to her brother', points: 0 }],
    plans: ['Zoo on Saturday', ''], notes: 'Good one',
  })).body;
  assert.deepEqual(m.intentions, { [ava.id]: 'Read every night' });
  assert.deepEqual(m.plans, ['Zoo on Saturday']);

  const kids = (await call(mom, 'GET', base)).body.kids as { id: string; balance: number }[];
  assert.equal(kids.find((k) => k.id === ben.id)!.balance, 5);
  assert.equal(kids.find((k) => k.id === ava.id)!.balance, 0);

  await asKid(ava);
  const mine = (await call(tablet, 'GET', `${base}/kids/${ava.id}/meeting`)).body;
  assert.equal(mine.intention, 'Read every night');
  assert.deepEqual(mine.cheers, ['So kind to her brother']);
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ben.id}/meeting`)).status, 403);

  assert.equal((await call(mom, 'GET', `${base}/meetings/prep`)).body.last.id, m.id);
  assert.equal((await call(mom, 'GET', `${base}/meetings`)).body.length, 1);
});
