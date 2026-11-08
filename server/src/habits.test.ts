import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';

test('practice: kids log with a timer, a grown-up approves once a day for points, the week fills up', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  const reading = (await call(mom, 'POST', `${base}/kids/${ava.id}/habits`, { title: 'Reading', icon: '📚', minutes: 20, targetDays: 3, points: 2 })).body;
  assert.equal(reading.week.doneDays, 0);
  assert.equal((await call(mom, 'POST', `${base}/kids/${ava.id}/habits`, { title: 'x', minutes: 9999 })).status, 400);
  const piano = (await call(mom, 'POST', `${base}/kids/${ava.id}/habits`, { title: 'Piano', icon: '🎹', minutes: 15, points: 1, needsOk: false })).body;

  // Ava logs reading: it waits. Ben can't log Ava's.
  await asKid(ben);
  assert.equal((await call(tablet, 'POST', `${base}/habits/${reading.id}/log`, { minutes: 20 })).status, 403);
  await asKid(ava);
  const logged = (await call(tablet, 'POST', `${base}/habits/${reading.id}/log`, { minutes: 20 })).body;
  assert.equal(logged.paid, 0);
  assert.equal(logged.habit.today, 'waiting');
  assert.equal(logged.habit.week.doneDays, 1, 'waiting counts toward the week');
  // Trusted piano counts straight away.
  const p = (await call(tablet, 'POST', `${base}/habits/${piano.id}/log`, { minutes: 15 })).body;
  assert.equal(p.paid, 1);
  assert.equal(p.habit.today, 'approved');
  // A second piano practice adds minutes, no more points.
  const again = (await call(tablet, 'POST', `${base}/habits/${piano.id}/log`, { minutes: 10 })).body;
  assert.equal(again.paid, 0);
  assert.equal(again.habit.todayMinutes, 25);

  // Kids can't approve; parents see it waiting and approve it for points.
  assert.equal((await call(tablet, 'GET', `${base}/habit-logs`)).status, 403);
  const waiting = (await call(mom, 'GET', `${base}/habit-logs`)).body;
  assert.deepEqual(waiting.map((w: { title: string; minutes: number; points: number }) => [w.title, w.minutes, w.points]), [['Reading', 20, 2]]);
  assert.equal((await call(mom, 'POST', `${base}/habit-logs/${waiting[0].id}/approve`)).body.paid, 2);
  assert.equal((await call(mom, 'POST', `${base}/habit-logs/${waiting[0].id}/approve`)).status, 400);
  const kidsNow = (await call(mom, 'GET', `${base}`)).body.kids as { id: string; balance: number }[];
  assert.equal(kidsNow.find((k) => k.id === ava.id)!.balance, 3);

  // Switched off for Ava: her board shows none and she can't log.
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { pagesOff: ['habits'] });
  assert.deepEqual((await call(tablet, 'GET', `${base}/kids/${ava.id}/habits`)).body, []);
  assert.equal((await call(tablet, 'POST', `${base}/habits/${reading.id}/log`, {})).status, 403);
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { pagesOff: [] });

  // Rejected goes back to waiting when she tries again; deleting keeps history but hides it.
  await call(mom, 'DELETE', `${base}/habits/${piano.id}`);
  assert.deepEqual((await call(mom, 'GET', `${base}/kids/${ava.id}/habits`)).body.map((h: { title: string }) => h.title), ['Reading']);
});
