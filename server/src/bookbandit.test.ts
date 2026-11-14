import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { addDays } from '../../shared/schedule.ts';

type KidOut = { kidId: string; minutes: number; habitPaid: number; finishedPaid: number };

async function setup() {
  const f = await family();
  const { call, mom, base } = f;
  const homeId = base.split('/').pop();
  const read = (await call(mom, 'POST', `${base}/tokens`, { name: 'BookBandit look' })).body.token as string;
  const control = (await call(mom, 'POST', `${base}/tokens`, { name: 'BookBandit', scope: 'control' })).body.token as string;
  const v1 = `/api/v1/homes/${homeId}`;
  const api = (method: string, url: string, token: string, body?: unknown) => call({}, method, url, body, { authorization: `Bearer ${token}` });
  const report = async (kids: unknown[]) => {
    const r = await api('POST', `${v1}/reading/report`, control, { kids });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body as { ok: boolean; kids: KidOut[] };
  };
  const balance = async (id: string) => (await call(mom, 'GET', `${base}`)).body.kids.find((k: { id: string }) => k.id === id).balance as number;
  return { ...f, read, control, v1, api, report, balance };
}

test('BookBandit: kid habits are on the v1 API', async () => {
  const { call, mom, base, ava, ben, read, v1, api } = await setup();
  const reading = (await call(mom, 'POST', `${base}/kids/${ava.id}/habits`, { title: 'Reading', icon: '📚', minutes: 20, points: 2 })).body;
  const list = await api('GET', `${v1}/kids/${ava.id}/habits`, read);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((h: { id: string; title: string; needsOk: boolean }) => [h.id, h.title, h.needsOk]), [[reading.id, 'Reading', true]]);
  assert.deepEqual((await api('GET', `${v1}/kids/${ben.id}/habits`, read)).body, []);
  // In the OpenAPI description too.
  const spec = (await call({}, 'GET', '/api/v1/openapi.json')).body;
  assert.ok(spec.paths['/homes/{homeId}/kids/{kidId}/habits'].get);
  assert.equal(spec.paths['/homes/{homeId}/reading/report'].post['x-scope'], 'control');
});

test('BookBandit: reading minutes log into the practice without double counting', async () => {
  const { call, mom, base, ava, ben, tablet, asKid, today, read, v1, api, report, balance } = await setup();
  const reading = (await call(mom, 'POST', `${base}/kids/${ava.id}/habits`, { title: 'Reading', icon: '📚', minutes: 20, points: 3, needsOk: false })).body;

  // Read tokens can't report.
  assert.equal((await api('POST', `${v1}/reading/report`, read, { kids: [] })).status, 403);

  // First report: 12 minutes, trusted practice counts and pays once.
  let r = await report([{ kidId: ava.id, habitId: reading.id, date: today, minutes: 12 }]);
  assert.deepEqual(r, { ok: true, kids: [{ kidId: ava.id, minutes: 12, habitPaid: 3, finishedPaid: 0 }] });
  assert.equal(await balance(ava.id), 3);

  // The running total is re-sent: only the difference is added, no more points.
  r = await report([{ kidId: ava.id, habitId: reading.id, date: today, minutes: 12 }]);
  assert.deepEqual(r.kids[0], { kidId: ava.id, minutes: 12, habitPaid: 0, finishedPaid: 0 });
  r = await report([{ kidId: ava.id, habitId: reading.id, date: today, minutes: 30 }]);
  assert.equal(r.kids[0].habitPaid, 0);
  // A lower total (another device restarted its count) never takes minutes away.
  r = await report([{ kidId: ava.id, habitId: reading.id, date: today, minutes: 5 }]);
  assert.equal(r.kids[0].minutes, 30);
  let h = (await call(mom, 'GET', `${base}/kids/${ava.id}/habits`)).body[0];
  assert.equal(h.todayMinutes, 30);
  assert.equal(h.today, 'approved');

  // Ava's own "I did it!" adds to BookBandit's, and BookBandit's next report still only adds its own difference.
  await asKid(ava);
  await call(tablet, 'POST', `${base}/habits/${reading.id}/log`, { minutes: 10 });
  await report([{ kidId: ava.id, habitId: reading.id, date: today, minutes: 35 }]);
  h = (await call(mom, 'GET', `${base}/kids/${ava.id}/habits`)).body[0];
  assert.equal(h.todayMinutes, 45);
  assert.equal(await balance(ava.id), 3, 'still paid once that day');

  // Yesterday can be caught up on (and pays for that day); a week ago, the future and bad dates are skipped.
  r = await report([
    { kidId: ava.id, habitId: reading.id, date: addDays(today, -1), minutes: 15 },
    { kidId: ava.id, habitId: reading.id, date: addDays(today, -7), minutes: 15 },
    { kidId: ava.id, habitId: reading.id, date: addDays(today, 1), minutes: 15 },
    { kidId: ava.id, habitId: reading.id, date: 'yesterday', minutes: 15 },
  ]);
  assert.deepEqual(r.kids.map((k) => [k.minutes, k.habitPaid]), [[15, 3]]);
  const ledger = (await call(mom, 'GET', `${base}/kids/${ava.id}/ledger`)).body;
  assert.equal(ledger.entries[0].date, addDays(today, -1));
  assert.equal(ledger.entries[0].by, '🔑 BookBandit');

  // Unknown kids and habits, and a habit that isn't that kid's, are skipped, not errors.
  r = await report([
    { kidId: 'nope', habitId: reading.id, date: today, minutes: 5 },
    { kidId: ben.id, habitId: reading.id, date: today, minutes: 5 },
    { kidId: ava.id, habitId: 'nope', date: today, minutes: 5 },
    null,
  ]);
  assert.deepEqual(r.kids, []);

  // Practice switched off for Ava: BookBandit can't log into it either.
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { pagesOff: ['habits'] });
  assert.deepEqual((await report([{ kidId: ava.id, habitId: reading.id, date: today, minutes: 60 }])).kids, []);
});

test('BookBandit: a practice that needs an OK waits, once, and pays when a grown-up approves', async () => {
  const { call, mom, base, ben, db, today: day, report, balance } = await setup();
  const reading = (await call(mom, 'POST', `${base}/kids/${ben.id}/habits`, { title: 'Reading', icon: '📚', minutes: 20, points: 2 })).body;
  let r = await report([{ kidId: ben.id, habitId: reading.id, date: day, minutes: 10 }]);
  assert.equal(r.kids[0].habitPaid, 0);
  await report([{ kidId: ben.id, habitId: reading.id, date: day, minutes: 25 }]);
  const waiting = (await call(mom, 'GET', `${base}/habit-logs`)).body;
  assert.deepEqual(waiting.map((w: { kind: string; title: string; minutes: number }) => [w.kind, w.title, w.minutes]), [['practice', 'Reading', 25]]);
  // Parents get one "practiced" event, not one per report.
  const events = db.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'habit_logged' AND member_id = ?").get(ben.id) as { n: number };
  assert.equal(events.n, 1);
  assert.equal((await call(mom, 'POST', `${base}/habit-logs/${waiting[0].id}/approve`)).body.paid, 2);
  // More reading after the OK stays approved and pays nothing more.
  r = await report([{ kidId: ben.id, habitId: reading.id, date: day, minutes: 40 }]);
  assert.equal(r.kids[0].habitPaid, 0);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ben.id}/habits`)).body[0].today, 'approved');
  assert.equal(await balance(ben.id), 2);
});

test('BookBandit: finished books pay the bonus once per book, with or without an OK', async () => {
  const { call, mom, base, ava, ben, tablet, asKid, today, report, balance } = await setup();
  const reading = (await call(mom, 'POST', `${base}/kids/${ava.id}/habits`, { title: 'Reading', icon: '📚', points: 0, needsOk: false })).body;
  const benReading = (await call(mom, 'POST', `${base}/kids/${ben.id}/habits`, { title: 'Reading', icon: '📚', points: 0, needsOk: false })).body;
  const book = { id: 'bb-1', title: 'The Hobbit' };

  // Off by default (0 points): nothing is paid or remembered.
  assert.deepEqual((await call(mom, 'GET', `${base}/bookbandit`)).body, { points: 0, needsOk: true });
  let r = await report([{ kidId: ava.id, habitId: reading.id, date: today, minutes: 0, finished: [book] }]);
  assert.equal(r.kids[0].finishedPaid, 0);

  // Kids can't change it; parents can.
  await asKid(ava);
  assert.equal((await call(tablet, 'PUT', `${base}/bookbandit`, { points: 50 })).status, 403);
  assert.equal((await call(mom, 'PUT', `${base}/bookbandit`, { points: -1 })).status, 400);
  assert.deepEqual((await call(mom, 'PUT', `${base}/bookbandit`, { points: 10, needsOk: false })).body, { points: 10, needsOk: false });

  // Trusted: pays straight away, once per book id, even when reported again (or twice in one report).
  r = await report([{ kidId: ava.id, habitId: reading.id, date: today, minutes: 5, finished: [book, book, { id: '' }] }]);
  assert.equal(r.kids[0].finishedPaid, 10);
  r = await report([{ kidId: ava.id, habitId: reading.id, date: today, minutes: 5, finished: [book] }]);
  assert.equal(r.kids[0].finishedPaid, 0);
  assert.equal(await balance(ava.id), 10);
  const ledger = (await call(mom, 'GET', `${base}/kids/${ava.id}/ledger`)).body;
  assert.equal(ledger.entries[0].reason, '📕 Finished “The Hobbit”');

  // Needs an OK: waits on the parent home's practice card, then pays on approve. "Not yet" never pays.
  await call(mom, 'PUT', `${base}/bookbandit`, { needsOk: true });
  r = await report([{ kidId: ben.id, habitId: benReading.id, date: today, minutes: 0, finished: [book, { id: 'bb-2' }] }]);
  assert.equal(r.kids[0].finishedPaid, 0);
  const waiting = (await call(mom, 'GET', `${base}/habit-logs`)).body as { kind: string; id: string; title: string; points: number }[];
  assert.deepEqual(waiting.map((w) => [w.kind, w.title, w.points]), [['book', 'Finished “The Hobbit”', 10], ['book', 'Finished a book', 10]]);
  assert.equal((await call(tablet, 'POST', `${base}/finished-books/${waiting[0].id}/approve`)).status, 403);
  assert.equal((await call(mom, 'POST', `${base}/finished-books/${waiting[0].id}/approve`)).body.paid, 10);
  assert.equal((await call(mom, 'POST', `${base}/finished-books/${waiting[0].id}/approve`)).status, 404);
  assert.deepEqual((await call(mom, 'POST', `${base}/finished-books/${waiting[1].id}/reject`)).body, { ok: true });
  await report([{ kidId: ben.id, habitId: benReading.id, date: today, minutes: 0, finished: [{ id: 'bb-2' }] }]);
  assert.deepEqual((await call(mom, 'GET', `${base}/habit-logs`)).body, []);
  assert.equal(await balance(ben.id), 10);
});
