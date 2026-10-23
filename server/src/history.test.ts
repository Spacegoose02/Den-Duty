// Parent Duty history (closing and reopening cards) and the weekly chore archive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-hist-'));
const { family } = await import('./test-helpers.ts');
const { addDays, startOfWeek } = await import('../../shared/schedule.ts');

test('closing a Parent Duty card moves it to history, where it can be found and reopened', async () => {
  const { call, mom, base, ava, tablet, today } = await family();
  const form = (await call(mom, 'POST', `${base}/parent-duty`, { kidId: ava.id, title: 'Sign the field trip form', dueDate: today })).body;
  const shoes = (await call(mom, 'POST', `${base}/parent-duty`, { kidId: ava.id, title: 'Buy new shoes', notes: 'Size 12' })).body;
  await call(mom, 'POST', `${base}/parent-duty`, { title: 'Fix the closet door' });

  // Close one as done (from To do), and one unfinished.
  const closed = (await call(mom, 'POST', `${base}/parent-duty/${form.id}/close`, { note: 'Handed it in' })).body;
  assert.equal(closed.status, 'done');
  assert.ok(closed.closedAt && closed.doneAt);
  assert.equal(closed.closeNote, 'Handed it in');
  const dropped = (await call(mom, 'POST', `${base}/parent-duty/${shoes.id}/close`, { done: false })).body;
  assert.equal(dropped.status, 'todo', 'closing unfinished keeps where it was');
  assert.equal((await call(mom, 'POST', `${base}/parent-duty/${shoes.id}/close`, {})).status, 400, 'already closed');

  // Off the board and the calendar, into history (newest first, with who closed it).
  assert.equal((await call(mom, 'GET', `${base}/parent-duty?kid=${ava.id}`)).body.length, 0);
  const agenda = (await call(mom, 'GET', `${base}/agenda`)).body;
  assert.ok(agenda.days.every((d: { duty?: unknown[] }) => !d.duty?.length), 'closed cards leave the calendar');
  const hist = (await call(mom, 'GET', `${base}/parent-duty/history?kid=${ava.id}`)).body;
  assert.deepEqual(hist.map((c: { title: string }) => c.title).sort(), ['Buy new shoes', 'Sign the field trip form']);
  assert.equal(hist[0].closedBy, 'Mom');
  assert.equal((await call(mom, 'GET', `${base}/parent-duty/history?kid=general`)).body.length, 0);
  assert.deepEqual((await call(mom, 'GET', `${base}/parent-duty/history?q=size%2012`)).body.map((c: { id: string }) => c.id), [shoes.id], 'search looks in notes');
  assert.equal((await call(mom, 'GET', `${base}/parent-duty/history?q=%25`)).body.length, 0, 'wildcards are taken literally');
  assert.equal((await call(tablet, 'GET', `${base}/parent-duty/history`)).status, 403, 'parents only');

  // Reopen: back on the board where it was.
  const back = (await call(mom, 'POST', `${base}/parent-duty/${shoes.id}/reopen`, {})).body;
  assert.equal(back.closedAt, null);
  assert.deepEqual((await call(mom, 'GET', `${base}/parent-duty?kid=${ava.id}`)).body.map((c: { title: string }) => c.title), ['Buy new shoes']);
  assert.equal((await call(mom, 'POST', `${base}/parent-duty/${shoes.id}/reopen`, {})).status, 400);
});

test('done cards close themselves after 30 days', async () => {
  const { db, call, mom, base } = await family();
  const card = (await call(mom, 'POST', `${base}/parent-duty`, { title: 'Paint the fence', status: 'done' })).body;
  db.prepare("UPDATE honeydo SET done_at = datetime('now', '-31 days') WHERE id = ?").run(card.id);
  assert.equal((await call(mom, 'GET', `${base}/parent-duty?kid=general`)).body.length, 0);
  assert.equal((await call(mom, 'GET', `${base}/parent-duty/history?kid=general`)).body[0].id, card.id);
});

test('the weekly archive writes down each finished week per kid and keeps it after chores change', async () => {
  const { db, call, mom, base, ava, ben, tablet, today } = await family();
  const home = (await call(mom, 'GET', base)).body;
  const weekStart = startOfWeek(today, home.weekStart ?? 0);
  const twoAgo = addDays(weekStart, -14);
  const bed = (await call(mom, 'POST', `${base}/chores`, { title: 'Make bed', icon: '🛏️', points: 2, memberIds: [ava.id, ben.id] })).body;
  db.prepare('UPDATE chores SET start_date = ? WHERE id = ?').run(twoAgo, bed.id);
  assert.equal((await call(tablet, 'GET', `${base}/archive`)).status, 403, 'parents only');

  let { body } = await call(mom, 'GET', `${base}/archive`);
  assert.deepEqual(body.weeks.map((w: { weekStart: string }) => w.weekStart), [addDays(weekStart, -7), twoAgo], 'finished weeks only, newest first');
  assert.equal(body.weeks[1].final, true, 'two weeks back is past the grace days');
  assert.equal(body.weeks[0].final, false, 'last week still takes late approvals');
  assert.deepEqual(body.weeks[0].kids.map((k: { memberId: string; due: number; done: number }) => [k.memberId, k.due, k.done]), [[ava.id, 7, 0], [ben.id, 7, 0]]);

  // Late approval of a chore from last week lands in last week's (still open) row, not the frozen one.
  const lastWeekDay = addDays(weekStart, -3);
  const inst = db.prepare('SELECT id FROM chore_instances WHERE member_id = ? AND date = ?').get(ava.id, lastWeekDay) as { id: string };
  await call(mom, 'POST', `${base}/instances/${inst.id}/approve`, {});
  const old = db.prepare('SELECT id FROM chore_instances WHERE member_id = ? AND date = ?').get(ava.id, twoAgo) as { id: string };
  await call(mom, 'POST', `${base}/instances/${old.id}/approve`, {});
  body = (await call(mom, 'GET', `${base}/archive?kid=${ava.id}`)).body;
  const [last, before] = body.weeks.map((w: { kids: { done: number; points: number; chores: { title: string; done: number }[]; days: unknown[] }[] }) => w.kids[0]);
  assert.deepEqual([last.done, last.points, last.chores[0].title, last.chores[0].done, last.days.length], [1, 2, 'Make bed', 1, 7]);
  assert.equal(before.done, 0, 'a final week never changes');

  // Deleting the chore doesn't touch the archive; a kid's Stats page switched off hides their rows.
  await call(mom, 'DELETE', `${base}/chores/${bed.id}`);
  await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { pagesOff: ['stats'] });
  body = (await call(mom, 'GET', `${base}/archive`)).body;
  assert.equal(body.weeks[0].kids.length, 1);
  assert.equal(body.weeks[0].kids[0].chores[0].title, 'Make bed');
});
