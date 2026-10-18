import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { checkDueReminders, nextDate } from './routes/reminders.ts';
import { addDays } from '../../shared/schedule.ts';

test('repeat dates: days, weeks, months (end of month safe), years', () => {
  assert.equal(nextDate('2026-01-31', 1, 'month'), '2026-02-28');
  assert.equal(nextDate('2026-04-15', 6, 'month'), '2026-10-15');
  assert.equal(nextDate('2026-10-18', 2, 'week'), '2026-11-01');
  assert.equal(nextDate('2024-02-29', 1, 'year'), '2025-02-28');
});

test('reminders: parents only, repeat, overdue/today on the home, calendar, feed, Home Assistant, and booking an appointment', async () => {
  const { db, call, mom, base, ava, tablet, asKid, today } = await family();
  const yesterday = addDays(today, -1);
  const dentist = (await call(mom, 'POST', `${base}/reminders`, {
    title: "Call to book Ava's dentist", kidId: ava.id, dueDate: yesterday, repeat: { every: 6, unit: 'month' }, apptKind: 'dental',
  })).body;
  assert.equal(dentist.state, 'overdue');
  assert.equal(dentist.kidName, 'Avaleigh');
  const library = (await call(mom, 'POST', `${base}/reminders`, { title: 'Renew library books', dueDate: today })).body;
  assert.equal(library.state, 'today');
  await call(mom, 'POST', `${base}/reminders`, { title: 'Someday: fix the gate' });
  assert.equal((await call(mom, 'POST', `${base}/reminders`, { title: 'x', repeat: { every: 1, unit: 'week' } })).status, 400, 'repeat needs a date');

  // Hidden from kids and the family wall.
  await asKid(ava);
  assert.equal((await call(tablet, 'GET', `${base}/reminders`)).status, 403);
  assert.ok(!JSON.stringify((await call(tablet, 'GET', '/api/kiosk/wall')).body).includes('dentist'));
  assert.ok(!JSON.stringify((await call(tablet, 'GET', `${base}/agenda?start=${yesterday}&days=3`)).body).includes('dentist'));

  // Parent home, calendar and feed.
  const summary = (await call(mom, 'GET', `${base}/summary`)).body;
  assert.deepEqual(summary.reminders.map((r: { title: string }) => r.title), ["Call to book Ava's dentist", 'Renew library books']);
  assert.equal((await call(mom, 'GET', `${base}/agenda?start=${today}&days=1`)).body.days[0].reminders[0].title, 'Renew library books');
  const cals = (await call(mom, 'GET', `${base}/calendars`)).body;
  assert.ok(String((await call({}, 'GET', cals.home)).body).includes('Renew library books'));

  // Home Assistant: counts, and a reminder_due event once per due date.
  const ha = (await call(mom, 'GET', `${base}/ha/summary`)).body;
  assert.equal(ha.reminders_due, 2);
  assert.equal(ha.reminders_overdue, 1);
  assert.equal(checkDueReminders(db), 2);
  assert.equal(checkDueReminders(db), 0, 'only once per due date');
  const events = (await call(mom, 'GET', `${base}/ha/events`)).body as { event: string; reminder?: string }[];
  assert.ok(events.some((e) => e.event === 'reminder_due' && e.reminder === 'Renew library books'));

  // Ticking a one-off finishes it (and it can be reopened); a repeating one moves to its next date.
  assert.equal((await call(mom, 'POST', `${base}/reminders/${library.id}/done`)).body.state, 'done');
  assert.equal((await call(mom, 'POST', `${base}/reminders/${library.id}/reopen`)).body.state, 'today');

  // "Make an appointment" → book it: a Doctors appointment for Ava, and the reminder moves 6 months on.
  const booked = (await call(mom, 'POST', `${base}/reminders/${dentist.id}/appointment`, { title: 'Dentist checkup', startsAt: `${addDays(today, 10)}T09:00`, provider: 'Dr. Molar' })).body;
  assert.equal(booked.reminder.dueDate, nextDate(yesterday, 6, 'month'));
  assert.equal(booked.reminder.timesDone, 1);
  const appts = (await call(mom, 'GET', `${base}/kids/${ava.id}/therapy`)).body.appointments as { title: string; kind: string; provider: string }[];
  assert.deepEqual(appts.map((a) => [a.title, a.kind, a.provider]), [['Dentist checkup', 'dental', 'Dr. Molar']]);

  // Edit and delete.
  const edited = (await call(mom, 'PATCH', `${base}/reminders/${library.id}`, { title: 'Return library books', dueDate: addDays(today, 3), dueTime: '17:00' })).body;
  assert.deepEqual([edited.title, edited.state, edited.dueTime], ['Return library books', 'upcoming', '17:00']);
  await call(mom, 'DELETE', `${base}/reminders/${library.id}`);
  assert.ok(!(await call(mom, 'GET', `${base}/reminders`)).body.some((r: { id: string }) => r.id === library.id));
});
