import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family, fakeClaude, type Sent } from './test-helpers.ts';
import { setAiFetch } from './ai.ts';
import { addDays, weekdayOf } from '../../shared/schedule.ts';

type Day = { date: string; practices: { goalId: string; title: string; done: boolean; time: string | null }[]; appointments: { title: string; time: string }[] };

test('scheduled Doctors practices and appointments show on calendars and can be ticked off with points', async () => {
  const { call, mom, base, ava, tablet, asKid, today } = await family();
  const t = `${base}/kids/${ava.id}/therapy`;
  const bad = await call(mom, 'POST', `${t}/goals`, { area: 'speech', title: 'x', practiceSchedule: 'weekly', practiceWeekdays: [] });
  assert.equal(bad.status, 400);
  const { body: g } = await call(mom, 'POST', `${t}/goals`, {
    area: 'speech', title: 'Say "s" sounds', rewardStep: 3, practiceSchedule: 'weekly', practiceWeekdays: [0, 1, 2, 3, 4, 5, 6], practiceTime: '16:30',
  });
  assert.deepEqual(g.practice, { schedule: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6], date: null, time: '16:30' });
  const tomorrow = addDays(today, 1);
  await call(mom, 'POST', `${t}/goals`, { area: 'dental', title: 'Floss', practiceSchedule: 'once', practiceDate: tomorrow });
  await call(mom, 'POST', `${t}/appointments`, { kind: 'speech', title: 'Speech with Ms. Lee', startsAt: `${tomorrow}T09:00` });

  const agenda = (await call(mom, 'GET', `${base}/agenda?start=${today}&days=42`)).body;
  assert.equal(agenda.days.length, 42, 'a month grid fits');
  const d0 = agenda.days[0] as Day;
  const d1 = agenda.days[1] as Day;
  assert.equal(d0.practices.length, 1);
  assert.equal(d0.practices[0].time, '16:30');
  assert.deepEqual(d1.practices.map((p) => p.title).sort(), ['Floss', 'Say "s" sounds']);
  assert.equal(d1.appointments[0].title, 'Speech with Ms. Lee');

  // Ticking off: today yes (with points), tomorrow no, twice no; unticking takes the points back.
  assert.equal((await call(mom, 'POST', `${base}/therapy/goals/${g.id}/practice`, { date: tomorrow })).status, 400);
  assert.equal((await call(mom, 'POST', `${base}/therapy/goals/${g.id}/practice`, { date: today })).body.awarded, 3);
  assert.equal((await call(mom, 'POST', `${base}/therapy/goals/${g.id}/practice`, { date: today })).status, 400);
  assert.equal(((await call(mom, 'GET', `${base}/agenda?start=${today}&days=1`)).body.days[0] as Day).practices[0].done, true);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/board`)).body.stats.balance, 3);
  await call(mom, 'DELETE', `${base}/therapy/goals/${g.id}/practice?date=${today}`);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/board`)).body.stats.balance, 0);

  // Kids only see them when Doctors is shared, and can't tick them off.
  await asKid(ava);
  const hidden = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.week as Day[];
  assert.ok(hidden.every((d) => !d.practices.length && !d.appointments.length));
  await call(mom, 'PATCH', t, { kidVisible: true });
  const shared = (await call(tablet, 'GET', `${base}/agenda?start=${today}&days=2`)).body.days as Day[];
  assert.equal(shared[1].appointments.length, 1);
  assert.equal(shared[1].practices.length, 2);
  assert.equal((await call(tablet, 'POST', `${base}/therapy/goals/${g.id}/practice`, { date: today })).status, 403);

  // Sections off hide their items; the appointments section hides all appointments.
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { doctorAreasOff: ['dental', 'appointments'] });
  const less = (await call(mom, 'GET', `${base}/agenda?start=${tomorrow}&days=1`)).body.days[0] as Day;
  assert.deepEqual(less.practices.map((p) => p.title), ['Say "s" sounds']);
  assert.equal(less.appointments.length, 0);
  // Doctors page off: nothing.
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { pagesOff: ['doctors'] });
  assert.equal(((await call(mom, 'GET', `${base}/agenda?start=${tomorrow}&days=1`)).body.days[0] as Day).practices.length, 0);
  assert.ok(weekdayOf(today) >= 0);
});

test('practice ideas: speech/OT/anger switch per kid; anger is off by default and needs Behavioral', async () => {
  const { call, mom, base, ava, ben } = await family();
  assert.deepEqual((await call(mom, 'GET', `${base}/kids`)).body.find((k: { id: string }) => k.id === ava.id).ideasOff, ['anger']);
  const sent: Sent[] = [];
  fakeClaude(sent, () => ({ tip: { title: 'Volcano breaths', activity: 'Breathe in, then let the volcano out slowly.', minutes: 5, why: 'Calms the body.' }, goals: [] }));
  await call(mom, 'PATCH', `${base}/ai`, { apiKey: 'sk-ant-api03-test-key-abcdefghijklmnop', enabled: true });
  const anger = `${base}/kids/${ava.id}/therapy/helper/anger`;
  assert.equal((await call(mom, 'GET', anger)).status, 403, 'off by default');
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { ideasOff: [] });
  const tip = (await call(mom, 'GET', anger)).body;
  assert.equal(tip.tip.title, 'Volcano breaths');
  assert.match(tip.disclaimer, /not medical advice/i);
  const body = JSON.stringify(sent[0].body);
  assert.ok(body.includes('anger') && body.includes('4 years old') && !body.includes('Avaleigh'));
  await call(mom, 'GET', anger);
  assert.equal(sent.length, 1, 'cached per kid per day');
  await call(mom, 'GET', `${anger}?refresh=1`);
  assert.equal(sent.length, 2, 'another idea');

  // On the parent home for Ava (anger on), not for Ben (default off).
  const tips = (await call(mom, 'GET', `${base}/therapy/tips`)).body as { kidId: string; area: string }[];
  assert.ok(tips.some((x) => x.kidId === ava.id && x.area === 'anger'));
  assert.ok(!tips.some((x) => x.kidId === ben.id));

  // Needs the Behavioral section; speech can be switched off on its own.
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { doctorAreasOff: ['behavioral'] });
  assert.equal((await call(mom, 'GET', anger)).status, 403);
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { doctorAreasOff: [], ideasOff: ['speech'] });
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/therapy/helper/speech`)).status, 403);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/therapy/helper/ot`)).status, 200);
  setAiFetch(undefined);
});

test('Stats has a Doctors panel and a Goals panel, respecting page and section switches', async () => {
  const { call, mom, base, ava, today } = await family();
  const t = `${base}/kids/${ava.id}/therapy`;
  const { body: g } = await call(mom, 'POST', `${t}/goals`, { area: 'speech', title: 'S sounds', practiceSchedule: 'weekly', practiceWeekdays: [0, 1, 2, 3, 4, 5, 6] });
  await call(mom, 'POST', `${t}/goals`, { area: 'dental', title: 'Floss' });
  await call(mom, 'POST', `${base}/therapy/goals/${g.id}/practice`, { date: today });
  await call(mom, 'POST', `${t}/notes`, { goalId: g.id, body: 'Did great', progress: 40, date: addDays(today, -1) });
  const { body: done } = await call(mom, 'POST', `${t}/appointments`, { kind: 'speech', title: 'Speech', startsAt: `${today}T08:00` });
  await call(mom, 'PATCH', `${base}/therapy/appointments/${done.id}`, { status: 'done' });
  await call(mom, 'POST', `${t}/appointments`, { kind: 'dental', title: 'Dentist', startsAt: `${addDays(today, 3)}T08:00` });
  const { body: goal } = await call(mom, 'POST', `${base}/kids/${ava.id}/goals`, { title: 'Ice cream', targetPoints: 10 });
  await call(mom, 'POST', `${base}/kids/${ava.id}/points`, { amount: 12, reason: 'Gift' });
  await call(mom, 'POST', `${base}/goals/${goal.id}/redeem`);

  let kid = (await call(mom, 'GET', `${base}/stats?weeks=4`)).body.kids[0];
  assert.equal(kid.doctors.streak, 2);
  assert.equal(kid.doctors.practicesInRange, 2);
  assert.equal(kid.doctors.perWeek[0].area, 'speech');
  assert.deepEqual(kid.doctors.appointments, { attended: 1, missed: 0, upcoming: 1 });
  assert.equal(kid.doctors.goals.length, 2);
  assert.equal(kid.goalStats.reachedTotal, 1);
  assert.equal(kid.goalStats.redeemedTotal, 1);
  assert.equal(kid.goalStats.averageDays, 0);
  assert.equal(kid.goalStats.redeemedPerWeek.reduce((a: number, b: number) => a + b, 0), 1);

  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { doctorAreasOff: ['dental'] });
  kid = (await call(mom, 'GET', `${base}/stats?weeks=4`)).body.kids[0];
  assert.equal(kid.doctors.goals.length, 1);
  assert.equal(kid.doctors.appointments.upcoming, 0);
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { pagesOff: ['doctors', 'goals'] });
  kid = (await call(mom, 'GET', `${base}/stats?weeks=4`)).body.kids[0];
  assert.equal(kid.doctors, null);
  assert.equal(kid.goalStats, null);
});

test('per-kid AI switch: on by default; off means no AI requests about that kid (built-ins instead)', async () => {
  const { call, mom, base, ava, ben } = await family();
  const sent: Sent[] = [];
  fakeClaude(sent, (body) => (JSON.stringify(body).includes('tidy') ? { message: 'Hi {name}!' }
    : { tip: { title: 'T', activity: 'A', minutes: 5, why: 'W' }, goals: [], ideas: [], answer: 'ok', urgent: false }));
  await call(mom, 'PATCH', `${base}/ai`, { apiKey: 'sk-ant-api03-test-key-abcdefghijklmnop', enabled: true });
  const kid = async () => (await call(mom, 'GET', `${base}/kids`)).body.find((k: { id: string }) => k.id === ava.id);
  assert.equal((await kid()).aiOn, true);
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { aiOn: false });
  assert.equal((await kid()).aiOn, false);

  const before = sent.length;
  assert.match((await call(mom, 'GET', `${base}/kids/${ava.id}/therapy/helper/speech`)).body.error, /turned off for Avaleigh/);
  assert.equal((await call(mom, 'POST', `${base}/ai/ideas`, { kind: 'goal', kidId: ava.id })).status, 403);
  assert.equal((await call(mom, 'POST', `${base}/kids/${ava.id}/doctors/ask`, { question: 'hi' })).status, 403);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/doctors/ask`)).body.aiOn, false);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/room-message`)).body.source, 'builtin');
  assert.ok(!(await call(mom, 'GET', `${base}/therapy/tips`)).body.some((t: { kidId: string }) => t.kidId === ava.id));
  assert.equal(sent.length, before, 'nothing was sent for Ava');
  // Ben is unaffected.
  assert.equal((await call(mom, 'GET', `${base}/kids/${ben.id}/room-message`)).body.source, 'ai');
  setAiFetch(undefined);
});

test('editing from the calendar: appointments (kids see no notes), practice dates, Parent Duty due dates, all in the feed', async () => {
  const { call, mom, base, ava, tablet, asKid, today } = await family();
  const t = `${base}/kids/${ava.id}/therapy`;
  const day = addDays(today, 2);
  const { body: appt } = await call(mom, 'POST', `${t}/appointments`, { kind: 'speech', title: 'Speech', startsAt: `${day}T09:00`, notes: 'Ask about lisp', location: 'Clinic' });
  const parentDay = (await call(mom, 'GET', `${base}/agenda?start=${day}&days=1`)).body.days[0];
  assert.equal(parentDay.appointments[0].notes, 'Ask about lisp');
  assert.equal(parentDay.appointments[0].location, 'Clinic');
  await call(mom, 'PATCH', t, { kidVisible: true });
  await asKid(ava);
  const kidDay = (await call(tablet, 'GET', `${base}/agenda?start=${day}&days=1`)).body.days[0];
  assert.equal(kidDay.appointments[0].title, 'Speech');
  assert.ok(!('notes' in kidDay.appointments[0]), 'kids never get notes');
  assert.equal((await call(tablet, 'PATCH', `${base}/therapy/appointments/${appt.id}`, { title: 'x' })).status, 403, 'kids cannot edit');

  // Move it and rename it: the feed follows.
  const later = addDays(today, 4);
  await call(mom, 'PATCH', `${base}/therapy/appointments/${appt.id}`, { title: 'Speech with Ms. Lee', startsAt: `${later}T10:30` });
  const cals = (await call(mom, 'GET', `${base}/calendars`)).body;
  let ics = String((await call({}, 'GET', cals.home)).body);
  assert.ok(ics.includes('Speech with Ms. Lee') && ics.includes(`${later.replace(/-/g, '')}T103000`));
  await call(mom, 'PATCH', `${base}/therapy/appointments/${appt.id}`, { status: 'cancelled' });
  ics = String((await call({}, 'GET', cals.home)).body);
  assert.ok(!ics.includes('Speech with Ms. Lee'), 'cancelled ones leave the feed');

  // A one-off practice date moves; the goal can be read back for the editor.
  const { body: g } = await call(mom, 'POST', `${t}/goals`, { area: 'speech', title: 'S sounds', practiceSchedule: 'once', practiceDate: day });
  await call(mom, 'PATCH', `${base}/therapy/goals/${g.id}`, { practiceSchedule: 'once', practiceDate: later });
  assert.equal((await call(mom, 'GET', `${base}/therapy/goals/${g.id}`)).body.practice.date, later);
  assert.equal((await call(mom, 'GET', `${base}/agenda?start=${later}&days=1`)).body.days[0].practices[0].title, 'S sounds');

  // Parent Duty due date moves on the calendar and in the feed.
  const { body: card } = await call(mom, 'POST', `${base}/parent-duty`, { title: 'Sign permission slip', kidId: ava.id, dueDate: day });
  await call(mom, 'PATCH', `${base}/parent-duty/${card.id}`, { dueDate: later });
  assert.equal((await call(mom, 'GET', `${base}/agenda?start=${later}&days=1`)).body.days[0].duty[0].title, 'Sign permission slip');
  ics = String((await call({}, 'GET', cals.home)).body);
  assert.ok(ics.includes('Sign permission slip'));
});

test('just this day: skip or move one practice; calendar, ticking, feeds and the practice streak follow', async () => {
  const { db, call, mom, base, ava, tablet, asKid, today } = await family();
  const t = `${base}/kids/${ava.id}/therapy`;
  const { body: g } = await call(mom, 'POST', `${t}/goals`, { area: 'speech', title: 'S sounds', rewardStep: 1, practiceSchedule: 'weekly', practiceWeekdays: [0, 1, 2, 3, 4, 5, 6], practiceTime: '16:00' });
  // Pretend the goal started a week ago so past days were scheduled.
  db.prepare("UPDATE therapy_goals SET created_at = datetime('now', '-7 days') WHERE id = ?").run(g.id);
  const ex = `${base}/therapy/goals/${g.id}/practice-exception`;
  const d1 = addDays(today, 1);
  const d2 = addDays(today, 2);
  const d5 = addDays(today, 5);

  // Move tomorrow's to the day after at 10:00; skip the day after that... (d2 now has the moved one plus its own)
  assert.equal((await call(mom, 'POST', ex, { date: d1, action: 'move', newDate: d5, newTime: '10:00' })).status, 200);
  await call(mom, 'POST', ex, { date: d2, action: 'skip' });
  assert.equal((await call(mom, 'POST', ex, { date: d1, action: 'bogus' })).status, 400);
  const days = (await call(mom, 'GET', `${base}/agenda?start=${today}&days=7`)).body.days as { date: string; practices: { occurrence: string; moved: boolean; skipped: boolean; time: string }[] }[];
  const on = (d: string) => days.find((x) => x.date === d)!.practices;
  assert.equal(on(d1).length, 0, 'moved away');
  assert.deepEqual(on(d2).map((p) => p.skipped), [true], 'parents see the skip (to undo it)');
  assert.deepEqual(on(d5).map((p) => [p.occurrence, p.moved, p.time]).sort(), [[d1, true, '10:00'], [d5, false, '16:00']].sort());

  // Kids don't see skipped ones; the feed has the move and not the skip.
  await call(mom, 'PATCH', t, { kidVisible: true });
  await asKid(ava);
  const kidDays = (await call(tablet, 'GET', `${base}/agenda?start=${today}&days=7`)).body.days as { date: string; practices: unknown[] }[];
  assert.equal(kidDays.find((x) => x.date === d2)!.practices.length, 0);
  const cals = (await call(mom, 'GET', `${base}/calendars`)).body;
  const ics = String((await call({}, 'GET', cals.home)).body);
  assert.ok(ics.includes(`practice-${g.id}-${d1}@den-duty`) && ics.includes(`${d5.replace(/-/g, '')}T100000`), 'moved practice in the feed at its new time');
  assert.ok(!ics.includes(`practice-${g.id}-${d2}@den-duty`), 'skipped practice not in the feed');

  // Undo the skip.
  await call(mom, 'DELETE', `${ex}?date=${d2}`);
  assert.equal((await call(mom, 'GET', `${base}/agenda?start=${d2}&days=1`)).body.days[0].practices[0].skipped, false);

  // Streak: practiced today and 3 days ago, skipped the two days between: still a 2-day streak; a missed day breaks it.
  const y1 = addDays(today, -1);
  const y2 = addDays(today, -2);
  const y3 = addDays(today, -3);
  await call(mom, 'POST', ex, { date: y1, action: 'skip' });
  await call(mom, 'POST', ex, { date: y2, action: 'skip' });
  await call(mom, 'POST', `${base}/therapy/goals/${g.id}/practice`, { date: today });
  await call(mom, 'POST', `${base}/therapy/goals/${g.id}/practice`, { date: y3 });
  assert.equal((await call(mom, 'POST', `${base}/therapy/goals/${g.id}/practice`, { date: y1 })).status, 400, "can't tick a skipped day");
  let s = (await call(mom, 'GET', `${base}/stats?weeks=4`)).body.kids[0].doctors;
  assert.equal(s.streak, 2);
  await call(mom, 'DELETE', `${ex}?date=${y2}`);
  s = (await call(mom, 'GET', `${base}/stats?weeks=4`)).body.kids[0].doctors;
  assert.equal(s.streak, 1, 'an un-skipped, missed day breaks it');
});
