import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { addDays } from '../../shared/schedule.ts';
import { elfFor } from '../../shared/holiday.ts';

test('holiday mode: off by default, on now or between dates, parents only', async () => {
  const { call, mom, base, tablet, ava, today } = await family();
  // Off until a parent turns it on: boards and the wall get nothing.
  assert.equal((await call(mom, 'GET', `${base}/holiday-settings`)).body.settings.mode, 'off');
  assert.equal((await call(tablet, 'GET', `${base}/holiday`)).body.holiday, null);
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/holiday`)).body.holiday, null);
  assert.equal((await call(tablet, 'GET', '/api/kiosk/wall')).body.holiday, null);
  // The tablet can't change it.
  assert.equal((await call(tablet, 'PUT', `${base}/holiday-settings`, { mode: 'on' })).status, 403);

  // Between dates: not yet, then today.
  assert.equal((await call(mom, 'PUT', `${base}/holiday-settings`, { mode: 'dates' })).status, 400, 'needs a date');
  assert.equal((await call(mom, 'PUT', `${base}/holiday-settings`, { mode: 'dates', from: addDays(today, 3), to: today })).status, 400);
  let r = (await call(mom, 'PUT', `${base}/holiday-settings`, { mode: 'dates', from: addDays(today, 1), to: addDays(today, 30) })).body;
  assert.equal(r.activeToday, false);
  assert.equal((await call(tablet, 'GET', `${base}/holiday`)).body.holiday, null);
  r = (await call(mom, 'PUT', `${base}/holiday-settings`, { from: today })).body;
  assert.equal(r.activeToday, true);
  assert.equal(r.settings.to, addDays(today, 30), 'a partial save keeps the other settings');
  const h = (await call(tablet, 'GET', `${base}/holiday`)).body.holiday;
  assert.equal(h.today, today);
  assert.equal(h.settings.cams, 'hosted');
  const wall = (await call(tablet, 'GET', '/api/kiosk/wall')).body;
  assert.equal(wall.holiday.settings.day, '12-25');
  assert.equal(wall.kids[0].nice.score, 75, 'nothing due yet: the starting score');
});

test('holiday mode: the elf task waits for a grown-up, then pays through the ledger', async () => {
  const { call, mom, base, tablet, ava, ben, asKid, today } = await family();
  await call(mom, 'PUT', `${base}/holiday-settings`, { mode: 'on', elfPoints: 4 });
  await asKid(ava);
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/holiday`)).body.holiday;
  assert.equal(board.elf.name, elfFor({ day: '12-25' }, today).name);
  assert.equal(board.elf.points, 4);
  assert.equal(board.elf.done, null);
  assert.equal(board.nice.score, 75);

  // Ava can't tick Ben's.
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ben.id}/holiday/elf`, {})).status, 403);
  const done = (await call(tablet, 'POST', `${base}/kids/${ava.id}/holiday/elf`, {})).body;
  assert.equal(done.task.status, 'waiting');
  assert.equal(done.paid, 0);
  // Once a day.
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/holiday/elf`, {})).body.task.id, done.task.id);

  // Parents see it and say not yet; she tries again; they approve.
  assert.equal((await call(tablet, 'GET', `${base}/holiday/waiting`)).status, 403);
  let waiting = (await call(mom, 'GET', `${base}/holiday/waiting`)).body;
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].kid.name, 'Avaleigh');
  await call(mom, 'POST', `${base}/holiday/elf/${waiting[0].id}/reject`, { note: 'Let me see the star first' });
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/holiday`)).body.holiday.elf.done.note, 'Let me see the star first');
  await call(tablet, 'POST', `${base}/kids/${ava.id}/holiday/elf`, {});
  waiting = (await call(mom, 'GET', `${base}/holiday/waiting`)).body;
  assert.equal((await call(mom, 'POST', `${base}/holiday/elf/${waiting[0].id}/approve`)).body.paid, 4);
  assert.equal((await call(mom, 'POST', `${base}/holiday/elf/${waiting[0].id}/approve`)).status, 400);
  const kids = (await call(mom, 'GET', base)).body.kids as { id: string; balance: number }[];
  assert.equal(kids.find((k) => k.id === ava.id)!.balance, 4);

  // The elf log and the nice meter read the ledger: a kind extra pushes it up.
  const after = (await call(tablet, 'GET', `${base}/kids/${ava.id}/holiday`)).body.holiday;
  assert.equal(after.elf.done.status, 'done');
  assert.match(after.nice.log[0].reason, /^🧝 /);
  assert.equal(after.nice.score, 78);

  // Trusted elf tasks count straight away; a parent's always do.
  await call(mom, 'PUT', `${base}/holiday-settings`, { elfNeedsOk: false });
  await asKid(ben);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ben.id}/holiday/elf`, {})).body.paid, 4);
});

test('holiday mode: naughty points lower the nice list only, with a reason', async () => {
  const { call, mom, base, tablet, ava, ben, asKid } = await family();
  const give = (who: typeof mom, kid: { id: string }, body: object) => call(who, 'POST', `${base}/kids/${kid.id}/holiday/naughty`, body);
  // Not while Holiday mode is off.
  assert.equal((await give(mom, ava, { points: 3 })).status, 400);
  await call(mom, 'PUT', `${base}/holiday-settings`, { mode: 'on' });
  const before = (await call(mom, 'GET', `${base}/kids/${ava.id}/stats`)).body;

  // Only grown-ups, and 1 to 25 at a time.
  await asKid(ava);
  assert.equal((await give(tablet, ava, { points: 3 })).status, 403);
  assert.equal((await give(mom, ava, { points: 0 })).status, 400);
  assert.equal((await give(mom, ava, { points: 26 })).status, 400);
  assert.equal((await give(mom, ava, { points: 2.5 })).status, 400);

  const r = (await give(mom, ava, { points: 6, reason: '  Hit her brother  ' })).body;
  assert.equal(r.nice.score, 69);
  assert.equal(r.nice.naughty, 6);
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/holiday`)).body.holiday;
  assert.equal(board.nice.score, 69);
  assert.equal(board.nice.log[0].id, r.id);
  assert.equal(board.nice.log[0].amount, -6);
  assert.equal(board.nice.log[0].reason, 'Hit her brother');
  assert.equal(board.nice.log[0].naughty, true);
  // The parent home's family Nice list: every kid, one shared elf log with names.
  assert.equal((await call(tablet, 'GET', `${base}/holiday/nice`)).status, 403);
  const fam = (await call(mom, 'GET', `${base}/holiday/nice`)).body.nice;
  assert.deepEqual(fam.kids.map((k: { score: number }) => k.score), [69, 75]);
  assert.equal(fam.log[0].kid, 'Avaleigh');
  assert.equal(fam.log[0].reason, 'Hit her brother');
  assert.equal((await call(tablet, 'GET', '/api/kiosk/wall')).body.kids.find((k: { id: string }) => k.id === ava.id).nice.score, 69);
  // Ben's meter doesn't move.
  assert.equal((await call(mom, 'GET', `${base}/kids/${ben.id}/holiday`)).body.holiday.nice.score, 75);

  // Points, the ledger and stats don't change.
  const kids = (await call(mom, 'GET', base)).body.kids as { id: string; balance: number }[];
  assert.equal(kids.find((k) => k.id === ava.id)!.balance, 0);
  const led = (await call(mom, 'GET', `${base}/kids/${ava.id}/ledger`)).body;
  assert.equal(led.balance, 0);
  assert.equal(led.entries.length, 0);
  assert.deepEqual((await call(mom, 'GET', `${base}/kids/${ava.id}/stats`)).body, before);

  // A grown-up can take them back.
  assert.equal((await call(tablet, 'DELETE', `${base}/holiday/naughty/${r.id}`)).status, 403);
  assert.equal((await call(mom, 'DELETE', `${base}/holiday/naughty/${r.id}`)).body.nice.score, 75);
  assert.equal((await call(mom, 'DELETE', `${base}/holiday/naughty/${r.id}`)).status, 404);
});

test('holiday mode: nice points raise the nice list only, with a reason', async () => {
  const { call, mom, base, tablet, ava, ben, asKid } = await family();
  const give = (who: typeof mom, kid: { id: string }, body: object) => call(who, 'POST', `${base}/kids/${kid.id}/holiday/nice`, body);
  // Not while Holiday mode is off.
  assert.equal((await give(mom, ava, { points: 3 })).status, 400);
  await call(mom, 'PUT', `${base}/holiday-settings`, { mode: 'on' });
  const before = (await call(mom, 'GET', `${base}/kids/${ava.id}/stats`)).body;

  // Only grown-ups, and 1 to 25 at a time.
  await asKid(ava);
  assert.equal((await give(tablet, ava, { points: 3 })).status, 403);
  assert.equal((await give(mom, ava, { points: 0 })).status, 400);
  assert.equal((await give(mom, ava, { points: 26 })).status, 400);
  assert.equal((await give(mom, ava, { points: 1.5 })).status, 400);

  const r = (await give(mom, ava, { points: 5, reason: '  Shared her toys  ' })).body;
  assert.equal(r.nice.score, 80);
  assert.equal(r.nice.nicePoints, 5);
  assert.equal(r.nice.naughty, 0);
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/holiday`)).body.holiday;
  assert.equal(board.nice.score, 80);
  assert.equal(board.nice.log[0].id, r.id);
  assert.equal(board.nice.log[0].amount, 5);
  assert.equal(board.nice.log[0].reason, 'Shared her toys');
  assert.equal(board.nice.log[0].nicePoints, true);
  assert.equal(board.nice.log[0].naughty, false);

  // Naughty and nice points add up on the same meter.
  const n = (await call(mom, 'POST', `${base}/kids/${ava.id}/holiday/naughty`, { points: 2 })).body;
  assert.equal(n.nice.score, 78);

  // The family Nice list shows them too.
  const fam = (await call(mom, 'GET', `${base}/holiday/nice`)).body.nice;
  assert.deepEqual(fam.kids.map((k: { score: number }) => k.score), [78, 75]);
  assert.equal(fam.kids[0].nicePoints, 5);
  assert.equal(fam.log.find((e: { id: string }) => e.id === r.id).kid, 'Avaleigh');
  assert.equal(fam.naughtyBelow, 35);
  assert.deepEqual(fam.kids.map((k: { onNaughty: boolean }) => k.onNaughty), [false, false]);
  // A parent sets where the naughty list starts: Ava's 78 is under 80.
  await call(mom, 'PUT', `${base}/holiday-settings`, { naughtyBelow: 80 });
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/holiday`)).body.holiday.nice.onNaughty, true);
  assert.deepEqual((await call(mom, 'GET', `${base}/holiday/nice`)).body.nice.kids.map((k: { onNaughty: boolean }) => k.onNaughty), [true, true]);
  assert.equal((await call(tablet, 'GET', '/api/kiosk/wall')).body.kids.find((k: { id: string }) => k.id === ava.id).nice.onNaughty, true);
  await call(mom, 'PUT', `${base}/holiday-settings`, { naughtyBelow: 0 });
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/holiday`)).body.holiday.nice.onNaughty, false, '0: no naughty list');
  assert.equal((await call(tablet, 'GET', '/api/kiosk/wall')).body.kids.find((k: { id: string }) => k.id === ava.id).nice.score, 78);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ben.id}/holiday`)).body.holiday.nice.score, 75);

  // Points, the ledger and stats don't change.
  const kids = (await call(mom, 'GET', base)).body.kids as { id: string; balance: number }[];
  assert.equal(kids.find((k) => k.id === ava.id)!.balance, 0);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/ledger`)).body.entries.length, 0);
  assert.deepEqual((await call(mom, 'GET', `${base}/kids/${ava.id}/stats`)).body, before);

  // A grown-up can take them back, and each kind only through its own route.
  assert.equal((await call(tablet, 'DELETE', `${base}/holiday/nice/${r.id}`)).status, 403);
  assert.equal((await call(mom, 'DELETE', `${base}/holiday/naughty/${r.id}`)).status, 404);
  assert.equal((await call(mom, 'DELETE', `${base}/holiday/nice/${n.id}`)).status, 404);
  assert.equal((await call(mom, 'DELETE', `${base}/holiday/nice/${r.id}`)).body.nice.score, 73);
  assert.equal((await call(mom, 'DELETE', `${base}/holiday/nice/${r.id}`)).status, 404);
});
