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
