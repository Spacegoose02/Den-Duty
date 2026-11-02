import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { topUpSeries } from './routes/therapy.ts';
import { addDays, addMonths, describeRepeat, repeatDate } from '../../shared/schedule.ts';

type Appt = { id: string; title: string; startsAt: string; status: string; questions: unknown[]; repeat: { seriesId: string; index: number; every: number; unit: string; count: number | null; endDate: string | null } | null };

test('repeat dates and labels', () => {
  assert.equal(repeatDate('2026-01-31', 1, 'month', 1), '2026-02-28');
  assert.equal(repeatDate('2026-01-31', 1, 'month', 2), '2026-03-31', 'months count from the first visit, not the last');
  assert.equal(repeatDate('2026-11-02', 2, 'week', 3), '2026-12-14');
  assert.equal(repeatDate('2026-11-02', 3, 'day', 2), '2026-11-08');
  assert.equal(describeRepeat({ every: 1, unit: 'week', endDate: null, count: null }), 'Weekly');
  assert.equal(describeRepeat({ every: 2, unit: 'week', endDate: null, count: 6 }), 'Every 2 weeks, 6 times');
});

test('repeating Doctors appointments: create, edit one or all following, stop, delete', async () => {
  const { db, call, mom, base, ava, today } = await family();
  const t = `${base}/kids/${ava.id}/therapy`;
  const list = async () => ((await call(mom, 'GET', t)).body.appointments as Appt[]).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const first = addDays(today, 1);

  // Bad rules are refused.
  assert.equal((await call(mom, 'POST', `${t}/appointments`, { title: 'x', startsAt: `${first}T09:00`, repeat: { every: 0, unit: 'week' } })).status, 400);
  assert.equal((await call(mom, 'POST', `${t}/appointments`, { title: 'x', startsAt: `${first}T09:00`, repeat: { every: 1, unit: 'year' } })).status, 400);
  assert.equal((await call(mom, 'POST', `${t}/appointments`, { title: 'x', startsAt: `${first}T09:00`, repeat: { every: 1, unit: 'week', endDate: today } })).status, 400);

  // Every 2 weeks, 5 visits.
  const { body: a } = await call(mom, 'POST', `${t}/appointments`, {
    kind: 'speech', title: 'Speech with Ms. Lee', startsAt: `${first}T09:00`, durationMinutes: 45, questions: ['Is she on track?'],
    repeat: { every: 2, unit: 'week', count: 5 },
  });
  assert.equal(a.repeat.every, 2);
  assert.equal(a.repeat.index, 0);
  let all = await list();
  assert.deepEqual(all.map((x) => x.startsAt), [0, 1, 2, 3, 4].map((i) => `${addDays(first, 14 * i)}T09:00`));
  assert.equal(all[0].questions.length, 1, 'prep questions go on the first visit');
  assert.equal(all[1].questions.length, 0);

  // They show on the calendar and on the parents' home screen.
  const agenda = (await call(mom, 'GET', `${base}/agenda?start=${addDays(first, 14)}&days=1`)).body;
  assert.equal(agenda.days[0].appointments[0].title, 'Speech with Ms. Lee');
  assert.equal(agenda.days[0].appointments[0].repeat.index, 1);
  assert.equal((await call(mom, 'GET', `${base}/therapy/upcoming`)).body.length, 5);

  // Just this one: move the 2nd visit; the others stay.
  await call(mom, 'PATCH', `${base}/therapy/appointments/${all[1].id}`, { startsAt: `${addDays(first, 15)}T10:00`, scope: 'one' });
  all = await list();
  assert.equal(all[1].startsAt, `${addDays(first, 15)}T10:00`);
  assert.equal(all[2].startsAt, `${addDays(first, 28)}T09:00`);

  // Deleting one visit doesn't bring it back on top-up.
  await call(mom, 'DELETE', `${base}/therapy/appointments/${all[4].id}`);
  topUpSeries(db);
  assert.equal((await list()).length, 4);

  // This and following: from the 3rd visit on it's weekly at 11:00 with a new title; earlier visits keep theirs.
  all = await list();
  const { body: moved } = await call(mom, 'PATCH', `${base}/therapy/appointments/${all[2].id}`, {
    title: 'Speech (new clinic)', startsAt: `${addDays(first, 28)}T11:00`, scope: 'following', repeat: { every: 1, unit: 'week', count: 3 },
  });
  assert.equal(moved.repeat.unit, 'week');
  assert.equal(moved.repeat.every, 1);
  all = await list();
  assert.deepEqual(all.map((x) => `${x.title}|${x.startsAt}`), [
    `Speech with Ms. Lee|${first}T09:00`,
    `Speech with Ms. Lee|${addDays(first, 15)}T10:00`,
    `Speech (new clinic)|${addDays(first, 28)}T11:00`,
    `Speech (new clinic)|${addDays(first, 35)}T11:00`,
    `Speech (new clinic)|${addDays(first, 42)}T11:00`,
  ]);
  assert.equal(all[0].repeat!.count, 2, 'the old run ends before the change');

  // Following without a new rule keeps the rule (and how many are left), just changing details.
  await call(mom, 'PATCH', `${base}/therapy/appointments/${all[3].id}`, { provider: 'Dr. Kay', scope: 'following' });
  all = await list();
  assert.equal(all.length, 5);
  assert.equal(all[4].repeat!.count, 2);
  assert.equal(all[4].repeat!.index, 1);

  // Delete this and following.
  await call(mom, 'DELETE', `${base}/therapy/appointments/${all[3].id}?scope=following`);
  assert.equal((await list()).length, 3);

  // A one-off can start repeating; an open-ended monthly one is made a year ahead and topped up later.
  const { body: one } = await call(mom, 'POST', `${t}/appointments`, { kind: 'doctor', title: 'Allergy shots', startsAt: `${today}T15:00` });
  assert.equal(one.repeat, null);
  await call(mom, 'PATCH', `${base}/therapy/appointments/${one.id}`, { repeat: { every: 1, unit: 'month' } });
  const shots = (await list()).filter((x) => x.title === 'Allergy shots');
  assert.ok(shots.length >= 12 && shots.length <= 13, `about a year of monthly visits, got ${shots.length}`);
  assert.equal(shots[shots.length - 1].startsAt, `${addMonths(today, shots.length - 1)}T15:00`);
  const series = db.prepare('SELECT * FROM appointment_series WHERE id = ?').get(shots[0].repeat!.seriesId) as { finished: number };
  assert.equal(series.finished, 0, 'open-ended series keep going');

  // Stop repeating from a visit: it stays, the later ones go.
  await call(mom, 'PATCH', `${base}/therapy/appointments/${shots[2].id}`, { scope: 'following', repeat: null });
  const left = (await list()).filter((x) => x.title === 'Allergy shots');
  assert.equal(left.length, 3);
  assert.equal(left[2].repeat, null);

  // Booking from a reminder can repeat too.
  const { body: r } = await call(mom, 'POST', `${base}/reminders`, { title: 'Book dentist', kidId: ava.id, apptKind: 'dental' });
  await call(mom, 'POST', `${base}/reminders/${r.id}/appointment`, { title: 'Dentist', startsAt: `${first}T08:00`, repeat: { every: 6, unit: 'month', count: 2 } });
  const dentist = (await list()).filter((x) => x.title === 'Dentist');
  assert.deepEqual(dentist.map((x) => x.startsAt), [`${first}T08:00`, `${addMonths(first, 6)}T08:00`]);
});
