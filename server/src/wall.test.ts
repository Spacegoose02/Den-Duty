import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { addDays } from '../../shared/schedule.ts';

test('family wall: every kid at a glance on a paired tablet, careful by default about private things', async () => {
  const { call, mom, base, ava, ben, tablet, asKid, today } = await family();
  const tomorrow = addDays(today, 1);
  assert.equal((await call({}, 'GET', '/api/kiosk/wall')).status, 401, 'paired tablets only');

  await call(mom, 'POST', `${base}/chores`, { title: 'Make bed', points: 2, schedule: 'daily', memberIds: [ava.id, ben.id] });
  await call(mom, 'POST', `${base}/chores`, { title: 'Feed cat', points: 2, schedule: 'daily', memberIds: [ava.id] });
  await call(mom, 'POST', `${base}/kids/${ava.id}/goals`, { title: 'Ice cream', targetPoints: 10 });
  const board = (await call(mom, 'GET', `${base}/kids/${ava.id}/board`)).body;
  await call(mom, 'POST', `${base}/instances/${board.todayItems[0].id}/done`, {});
  await call(mom, 'POST', `${base}/kids/${ben.id}/points`, { amount: 5, reason: 'Gift' });
  await call(mom, 'POST', `${base}/kids/${ben.id}/penalty`, { points: 1, reason: 'Left toys out' });
  await call(mom, 'POST', `${base}/kids/${ben.id}/timeouts`, { what: 'No Roblox', reason: 'Hit sister', length: 1, unit: 'days' });
  const t = `${base}/kids/${ava.id}/therapy`;
  await call(mom, 'POST', `${t}/goals`, { area: 'speech', title: 'S sounds', practiceSchedule: 'weekly', practiceWeekdays: [0, 1, 2, 3, 4, 5, 6] });
  await call(mom, 'POST', `${t}/notes`, { body: 'Private note' });
  await call(mom, 'POST', `${t}/appointments`, { kind: 'speech', title: 'Speech with Ms. Lee', startsAt: `${tomorrow}T09:00` });
  await call(mom, 'POST', `${base}/kids/${ben.id}/therapy/appointments`, { kind: 'dental', title: 'Dentist', startsAt: `${today}T15:00` });
  await call(mom, 'POST', `${base}/polls`, { title: 'Friday treat', options: [{ title: 'Pizza', icon: '🍕' }, { title: 'Tacos', icon: '🌮' }] });

  const w = (await call(tablet, 'GET', '/api/kiosk/wall')).body;
  assert.equal(w.settings.landing, 'wall');
  const a = w.kids.find((k: { id: string }) => k.id === ava.id);
  const b = w.kids.find((k: { id: string }) => k.id === ben.id);
  assert.deepEqual(a.chores, { done: 1, waiting: 0, total: 2 });
  assert.equal(a.goal.title, 'Ice cream');
  assert.ok(a.denMessage.includes('Avaleigh'));
  assert.ok(a.badgesToday.some((x: { id: string }) => x.id === 'first-chore'), 'first chore badge earned today');
  assert.equal(a.level.name.length > 0, true);
  // Private by default.
  assert.deepEqual(b.penalties, []);
  assert.deepEqual(b.timeouts, []);
  assert.deepEqual(a.doctorGoals, []);
  const json = JSON.stringify(w);
  assert.ok(!json.includes('Private note') && !json.includes('Hit sister') && !json.includes('Left toys out') && !json.includes('Dentist') && !json.includes('Ms. Lee'));
  assert.equal(w.family.length, 2);
  assert.equal(w.family[0].kids.find((k: { kidId: string }) => k.kidId === ava.id).chores, 2);
  assert.equal(w.family[0].kids.find((k: { kidId: string }) => k.kidId === ava.id).practices, 0);
  assert.equal(w.polls[0].title, 'Friday treat');
  assert.equal(w.polls[0].options.length, 2);
  assert.ok(!('votes' in w.polls[0].options[0]));

  // Shared Doctors: that kid's appointments show (under their name only); goals/practices still need the wall switch.
  await call(mom, 'PATCH', t, { kidVisible: true });
  let w2 = (await call(tablet, 'GET', '/api/kiosk/wall')).body;
  assert.equal(w2.family[1].kids.find((k: { kidId: string }) => k.kidId === ava.id).appointments[0].title, 'Speech with Ms. Lee');
  assert.ok(!JSON.stringify(w2).includes('Dentist'), "Ben's isn't shared");
  assert.deepEqual(w2.kids.find((k: { id: string }) => k.id === ava.id).doctorGoals, []);

  // A parent turns the extras on; kids can't change wall settings.
  await asKid(ava);
  assert.equal((await call(tablet, 'PATCH', `${base}/wall`, { show: { penalties: true } })).status, 403);
  const s = (await call(mom, 'PATCH', `${base}/wall`, { show: { doctors: true, penalties: true, timeouts: true }, dim: { on: true, from: '20:30' } })).body;
  assert.deepEqual(s.dim, { on: true, from: '20:30', to: '06:30' });
  assert.equal((await call(mom, 'PATCH', `${base}/wall`, { dim: { from: '25:00' } })).status, 400);
  w2 = (await call(tablet, 'GET', '/api/kiosk/wall')).body;
  const b2 = w2.kids.find((k: { id: string }) => k.id === ben.id);
  assert.equal(b2.penalties[0].reason, 'Left toys out');
  assert.equal(b2.timeouts[0].what, 'No Roblox');
  assert.equal(w2.kids.find((k: { id: string }) => k.id === ava.id).doctorGoals[0].title, 'S sounds');
  assert.equal(w2.family[0].kids.find((k: { kidId: string }) => k.kidId === ava.id).practices, 1);
  assert.ok(!JSON.stringify(w2).includes('Private note'), 'notes never');

  // Page switches hide what's off; the landing page can go back to the picker.
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { pagesOff: ['chores', 'goals', 'stats'] });
  await call(mom, 'PATCH', `${base}/wall`, { landing: 'picker' });
  const w3 = (await call(tablet, 'GET', '/api/kiosk/wall')).body;
  const a3 = w3.kids.find((k: { id: string }) => k.id === ava.id);
  assert.equal(a3.chores, null);
  assert.equal(a3.goal, null);
  assert.equal(a3.level, null);
  assert.equal(a3.denMessage, null);
  assert.equal(w3.settings.landing, 'picker');
});
