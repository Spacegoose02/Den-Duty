import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { addDays } from '../../shared/schedule.ts';

test('medicines: doses given and skipped, supply counts down, refill reminder once, kid can tick their own', async () => {
  const { call, mom, base, ava, ben, tablet, asKid, today } = await family();
  const k = `${base}/kids/${ava.id}`;
  assert.equal((await call(mom, 'POST', `${k}/meds`, { name: 'Amoxicillin' })).status, 400, 'needs a time or as-needed');
  const { body: med } = await call(mom, 'POST', `${k}/meds`, { name: 'Amoxicillin', dose: '5 ml', times: ['19:00', '07:00', 'bad'], supply: 3, refillAt: 1, kidCanMark: true });
  assert.deepEqual(med.times, ['07:00', '19:00']);
  const { body: prn } = await call(mom, 'POST', `${k}/meds`, { name: 'Ibuprofen', asNeeded: true });

  // Parent marks the morning dose; marking it twice fails; a time that isn't scheduled fails.
  assert.equal((await call(mom, 'POST', `${base}/meds/${med.id}/doses`, { slot: '07:00' })).status, 200);
  assert.equal((await call(mom, 'POST', `${base}/meds/${med.id}/doses`, { slot: '07:00' })).status, 400);
  assert.equal((await call(mom, 'POST', `${base}/meds/${med.id}/doses`, { slot: '12:00' })).status, 400);
  assert.equal((await call(mom, 'POST', `${base}/meds/${med.id}/doses`, { slot: '07:00', date: addDays(today, 1) })).status, 400, 'not in the future');
  // As-needed doses stack up.
  assert.equal((await call(mom, 'POST', `${base}/meds/${prn.id}/doses`, { slot: 'prn' })).body.slot, 'prn-1');
  assert.equal((await call(mom, 'POST', `${base}/meds/${prn.id}/doses`, { slot: 'prn' })).body.slot, 'prn-2');

  // The kid sees only the "kid can mark" medicine and ticks the evening dose, which hits the refill point.
  await asKid(ava);
  const board = (await call(tablet, 'GET', `${k}/board`)).body;
  assert.equal(board.meds.length, 1);
  assert.equal(board.meds[0].slots.find((s: { slot: string }) => s.slot === '07:00').status, 'given');
  assert.equal((await call(tablet, 'POST', `${base}/meds/${prn.id}/kid-dose`, { slot: 'prn' })).status, 404);
  assert.equal((await call(tablet, 'POST', `${base}/meds/${med.id}/kid-dose`, { slot: '19:00' })).status, 200);
  assert.equal((await call(tablet, 'POST', `${base}/meds/${med.id}/kid-dose`, { slot: '19:00' })).status, 400);
  await asKid(ben);
  assert.equal((await call(tablet, 'POST', `${base}/meds/${med.id}/kid-dose`, { slot: '19:00' })).status, 404, "not Ben's");
  assert.equal((await call(tablet, 'GET', `${k}/health`)).status, 403, 'parents only');

  const h = (await call(mom, 'GET', `${k}/health`)).body;
  const m = h.meds.find((x: { id: string }) => x.id === med.id);
  assert.equal(m.supply, 1);
  assert.equal(m.low, true);
  assert.equal(m.today.slots[1].byKid, true);
  const reminders = (await call(mom, 'GET', `${base}/reminders`)).body as { title: string }[];
  assert.equal(reminders.filter((r) => r.title.startsWith('Refill Amoxicillin')).length, 1);

  // Undoing a given dose puts the supply back; the home list shows today's medicines.
  await call(mom, 'DELETE', `${base}/meds/${med.id}/doses?date=${today}&slot=19:00`);
  assert.equal((await call(mom, 'GET', `${k}/health`)).body.meds.find((x: { id: string }) => x.id === med.id).supply, 2);
  const home = (await call(mom, 'GET', `${base}/meds/today`)).body.meds as { name: string }[];
  assert.deepEqual(home.map((x) => x.name).sort(), ['Amoxicillin', 'Ibuprofen']);

  // Doctors off for Ava: no medicines on her board or the home list.
  await call(mom, 'PATCH', k, { pagesOff: ['doctors'] });
  assert.equal((await call(mom, 'GET', `${base}/meds/today`)).body.meds.length, 0);
  assert.equal((await call(mom, 'GET', `${k}/health`)).status, 403);
});

test('health card, care team, vaccines, growth and the log', async () => {
  const { call, mom, base, ava, today } = await family();
  const k = `${base}/kids/${ava.id}`;
  await call(mom, 'PUT', `${k}/health/profile`, { allergies: 'Peanuts', conditions: 'Asthma', insurance: 'Blue Raccoon', insuranceMember: 'X123' });
  await call(mom, 'POST', `${k}/health/care-team`, { name: 'Dr. Patel', role: 'Pediatrician', phone: '555-0100' });
  await call(mom, 'POST', `${k}/health/vaccines`, { name: 'Flu', date: today });
  assert.equal((await call(mom, 'POST', `${k}/health/growth`, {})).status, 400);
  await call(mom, 'POST', `${k}/health/growth`, { heightCm: 104.25, weightKg: 17 });
  const h = (await call(mom, 'GET', `${k}/health`)).body;
  assert.equal(h.profile.allergies, 'Peanuts');
  assert.equal(h.careTeam[0].phone, '555-0100');
  assert.equal(h.vaccines[0].name, 'Flu');
  assert.equal(h.growth[0].heightCm, 104.3);

  assert.equal((await call(mom, 'POST', `${k}/health/log`, { kind: 'nope', label: 'x' })).status, 400);
  assert.equal((await call(mom, 'POST', `${k}/health/log`, { kind: 'behavior', label: 'Meltdown', severity: 9 })).status, 400);
  await call(mom, 'POST', `${k}/health/log`, { kind: 'behavior', label: 'Meltdown', severity: 4, minutes: 10, trigger: 'Screen time ending', time: '19:30' });
  await call(mom, 'POST', `${k}/health/log`, { kind: 'behavior', label: 'meltdown', severity: 2, minutes: 4, date: addDays(today, -2) });
  const { body: mood } = await call(mom, 'POST', `${k}/health/log`, { kind: 'mood', label: 'Happy' });
  const log = (await call(mom, 'GET', `${k}/health/log?days=7`)).body;
  assert.equal(log.entries.length, 3);
  await call(mom, 'DELETE', `${base}/health/log/${mood.id}`);

  const s = (await call(mom, 'GET', `${k}/health/summary?days=30`)).body;
  assert.equal(s.profile.allergies, 'Peanuts');
  assert.deepEqual(s.log.groups[0], { kind: 'behavior', label: 'Meltdown', count: 2, avgSeverity: 3, avgMinutes: 7 });

  // Exports: everything as JSON, and CSVs that can't run formulas.
  await call(mom, 'POST', `${k}/health/log`, { kind: 'other', label: '=HYPERLINK("x")' });
  const json = (await call(mom, 'GET', `${k}/doctors/export`)).body;
  assert.equal(json.kind, 'doctors-export');
  assert.equal(json.healthLog.length, 3);
  assert.ok(!('home_id' in json.healthLog[0]));
  const csv = (await call(mom, 'GET', `${k}/doctors/export?format=csv&what=log`)).body as string;
  assert.ok(csv.startsWith('"date","time"'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
});

test('appointment prep and follow-up, and kid practice mode waits for a parent', async () => {
  const { call, mom, base, ava, tablet, asKid, today } = await family();
  const t = `${base}/kids/${ava.id}/therapy`;
  const { body: a } = await call(mom, 'POST', `${t}/appointments`, { kind: 'speech', title: 'Speech', startsAt: `${addDays(today, 1)}T09:00`, questions: ['Is she on track?', ''] });
  assert.deepEqual(a.questions, [{ text: 'Is she on track?', done: false }]);
  const { body: a2 } = await call(mom, 'PATCH', `${base}/therapy/appointments/${a.id}`, { status: 'done', summary: 'Doing great', questions: [{ text: 'Is she on track?', done: true }] });
  assert.equal(a2.summary, 'Doing great');
  assert.equal(a2.questions[0].done, true);

  const { body: g } = await call(mom, 'POST', `${t}/goals`, {
    area: 'speech', title: 'Say s', rewardStep: 2, kidPractice: true, practiceMinutes: 5, steps: [{ icon: '🐍', text: 'Hiss like a snake' }, { text: '' }],
    practiceSchedule: 'weekly', practiceWeekdays: [0, 1, 2, 3, 4, 5, 6],
  });
  assert.deepEqual(g.steps, [{ icon: '🐍', text: 'Hiss like a snake' }]);
  assert.equal((await call(mom, 'PATCH', `${base}/therapy/goals/${g.id}`, { practiceMinutes: 90 })).status, 400);

  await asKid(ava);
  assert.equal((await call(tablet, 'POST', `${base}/therapy/goals/${g.id}/kid-practice`, { minutes: 5 })).status, 403, 'not shared yet');
  await call(mom, 'PATCH', t, { kidVisible: true });
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(board.therapy.goals[0].practiceMode.steps.length, 1);
  assert.equal((await call(tablet, 'POST', `${base}/therapy/goals/${g.id}/kid-practice`, { minutes: 5 })).status, 200);
  assert.equal((await call(tablet, 'POST', `${base}/therapy/goals/${g.id}/kid-practice`, { minutes: 5 })).status, 400, 'one waiting at a time');
  assert.equal((await call(tablet, 'GET', `${base}/therapy/practice-requests`)).status, 403);

  const waiting = (await call(mom, 'GET', `${base}/therapy/practice-requests`)).body;
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].minutes, 5);
  assert.equal((await call(mom, 'POST', `${base}/therapy/practice-requests/${waiting[0].id}/approve`)).body.awarded, 2);
  assert.equal((await call(mom, 'POST', `${base}/therapy/practice-requests/${waiting[0].id}/approve`)).status, 400);
  // It counts as today's scheduled practice on the calendar.
  const day = (await call(mom, 'GET', `${base}/agenda?start=${today}&days=1`)).body.days[0];
  assert.equal(day.practices[0].done, true);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/board`)).body.stats.balance, 2);
  // A second practice the same day is a plain note, and rejecting pays nothing.
  await call(tablet, 'POST', `${base}/therapy/goals/${g.id}/kid-practice`, {});
  const w2 = (await call(mom, 'GET', `${base}/therapy/practice-requests`)).body;
  assert.equal((await call(mom, 'POST', `${base}/therapy/practice-requests/${w2[0].id}/reject`)).body.awarded, 0);
  const s = (await call(mom, 'GET', `${base}/kids/${ava.id}/health/summary`)).body;
  assert.equal(s.goals[0].practiced, 1);
  assert.equal(s.goals[0].scheduled, 1);
});

test('share links show only what was chosen, take notes when allowed, and can be turned off', async () => {
  const { call, mom, base, ava, ben, today } = await family();
  const t = `${base}/kids/${ava.id}/therapy`;
  const { body: g1 } = await call(mom, 'POST', `${t}/goals`, { area: 'speech', title: 'Say s' });
  const { body: g2 } = await call(mom, 'POST', `${t}/goals`, { area: 'dental', title: 'Floss' });
  await call(mom, 'POST', `${t}/notes`, { goalId: g2.id, body: 'Private flossing note' });
  await call(mom, 'PUT', `${base}/kids/${ava.id}/health/profile`, { allergies: 'Peanuts', insurance: 'Blue Raccoon' });
  await call(mom, 'POST', `${base}/kids/${ava.id}/health/log`, { kind: 'mood', label: 'Sad' });
  await call(mom, 'POST', `${t}/appointments`, { kind: 'speech', title: 'Speech visit', startsAt: `${today}T09:00` });
  await call(mom, 'POST', `${t}/appointments`, { kind: 'dental', title: 'Dentist', startsAt: `${today}T10:00` });
  const { body: other } = await call(mom, 'POST', `${base}/kids/${ben.id}/therapy/goals`, { area: 'speech', title: 'Ben goal' });
  assert.equal((await call(mom, 'POST', `${base}/kids/${ava.id}/share-links`, { label: 'Ms. Lee', goalIds: [other.id] })).status, 400);

  const { body: link } = await call(mom, 'POST', `${base}/kids/${ava.id}/share-links`, { label: 'Ms. Lee (speech)', goalIds: [g1.id], allowNotes: true, days: 30 });
  assert.match(link.url, /^\/share\/.{20,}$/);
  const anon = {};
  const seen = (await call(anon, 'GET', `/api${link.url}`)).body;
  assert.equal(seen.kid.name, 'Avaleigh');
  assert.deepEqual(seen.goals.map((g: { title: string }) => g.title), ['Say s']);
  assert.equal(seen.profile, null);
  assert.equal(seen.log, null);
  assert.deepEqual(seen.appointments.map((a: { title: string }) => a.title), ['Speech visit'], 'a speech link shows speech visits only');
  assert.ok(!JSON.stringify(seen).includes('Private flossing'));
  assert.ok(!JSON.stringify(seen).includes('Blue Raccoon'));

  // A note from the therapist moves the goal; not on goals outside the link.
  assert.equal((await call(anon, 'POST', `/api${link.url}/notes`, { name: 'Ms. Lee', body: 'x', goalId: g2.id })).status, 400);
  assert.equal((await call(anon, 'POST', `/api${link.url}/notes`, { name: 'Ms. Lee', body: 'Great session', goalId: g1.id, progress: 40 })).status, 200);
  const th = (await call(mom, 'GET', t)).body;
  assert.equal(th.goals.find((g: { id: string }) => g.id === g1.id).progress, 40);
  assert.ok(th.notes.some((n: { by: string }) => n.by === 'Ms. Lee (Ms. Lee (speech))'));

  const list = (await call(mom, 'GET', `${base}/kids/${ava.id}/share-links`)).body;
  assert.equal(list.length, 1);
  assert.ok(list[0].lastSeenAt);
  assert.ok(!('url' in list[0]), 'the token is only shown once');
  await call(mom, 'DELETE', `${base}/share-links/${list[0].id}`);
  assert.equal((await call(anon, 'GET', `/api${link.url}`)).status, 404);
  assert.equal((await call(anon, 'GET', '/api/share/short')).status, 404);

  // A read-only link with the log turned on, but no notes.
  const { body: l2 } = await call(mom, 'POST', `${base}/kids/${ava.id}/share-links`, { label: 'Dr. Patel', showLog: true });
  const s2 = (await call(anon, 'GET', `/api${l2.url}`)).body;
  assert.equal(s2.goals.length, 2);
  assert.equal(s2.log.total, 1);
  assert.equal((await call(anon, 'POST', `/api${l2.url}/notes`, { name: 'x', body: 'y' })).status, 403);
});
