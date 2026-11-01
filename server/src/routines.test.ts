import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { addDays } from '../../shared/schedule.ts';

type Item = { id: string | null; choreId: string; memberId: string; date: string; points: number; status: string; late: boolean; auto: boolean; routine: string | null; routinePos: number; minutes: number | null; dueTime: string | null };
type Day = { date: string; items: Item[] };

test('kids take turns: daily rotation follows the order kids were picked', async () => {
  const { call, mom, base, ava, ben, today } = await family();
  const dishes = (await call(mom, 'POST', `${base}/chores`, { title: 'Dishes', icon: '🍽️', points: 2, memberIds: [ben.id, ava.id], rotate: 'daily' })).body;
  assert.equal(dishes.rotate, 'daily');
  assert.deepEqual(dishes.memberIds, [ben.id, ava.id], 'order is kept');
  const days = (await call(mom, 'GET', `${base}/agenda?start=${today}&days=4`)).body.days as Day[];
  const whose = days.map((d) => d.items.filter((i) => i.choreId === dishes.id).map((i) => i.memberId));
  assert.deepEqual(whose, [[ben.id], [ava.id], [ben.id], [ava.id]]);

  // Weekly turns: the same kid all week.
  await call(mom, 'PATCH', `${base}/chores/${dishes.id}`, { rotate: 'weekly' });
  const week = (await call(mom, 'GET', `${base}/agenda?start=${today}&days=14`)).body.days as Day[];
  const kids = new Set(week.slice(0, 1).flatMap((d) => d.items.filter((i) => i.choreId === dishes.id).map((i) => i.memberId)));
  assert.equal(kids.size, 1);
  assert.ok(week.every((d) => d.items.filter((i) => i.choreId === dishes.id).length === 1), 'exactly one kid per day');

  // Not for bonus or one-time chores.
  assert.equal((await call(mom, 'POST', `${base}/chores`, { title: 'X', memberIds: [ava.id, ben.id], rotate: 'daily', schedule: 'once' })).status, 400);
  assert.equal((await call(mom, 'POST', `${base}/chores`, { title: 'X', memberIds: [], bonus: true, rotate: 'daily' })).status, 400);
});

test('every N days and monthly schedules', async () => {
  const { call, mom, base, ava, today } = await family();
  const sheets = (await call(mom, 'POST', `${base}/chores`, { title: 'Change sheets', memberIds: [ava.id], schedule: 'interval', everyDays: 3 })).body;
  assert.equal(sheets.schedule, 'interval');
  assert.equal(sheets.describe, 'Every 3 days');
  const days = (await call(mom, 'GET', `${base}/agenda?start=${today}&days=7&kid=${ava.id}`)).body.days as Day[];
  assert.deepEqual(days.filter((d) => d.items.some((i) => i.choreId === sheets.id)).map((d) => d.date), [today, addDays(today, 3), addDays(today, 6)]);
  assert.equal((await call(mom, 'POST', `${base}/chores`, { title: 'X', memberIds: [ava.id], schedule: 'interval', everyDays: 1 })).status, 400);

  const day = Number(today.slice(8));
  const monthly = (await call(mom, 'POST', `${base}/chores`, { title: 'Clean the fridge', memberIds: [ava.id], schedule: 'monthly', monthDay: day })).body;
  assert.equal(monthly.describe.startsWith('Monthly on the'), true);
  const board = (await call(mom, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.ok(board.todayItems.some((i: Item) => i.choreId === monthly.id), 'due today');
  assert.equal((await call(mom, 'POST', `${base}/chores`, { title: 'X', memberIds: [ava.id], schedule: 'monthly', monthDay: 32 })).status, 400);
});

test('due times: finishing late is worth the late points', async () => {
  const { call, mom, base, ava, tablet, asKid } = await family();
  const early = (await call(mom, 'POST', `${base}/chores`, { title: 'Feed the cat', points: 5, memberIds: [ava.id], dueTime: '00:00', latePoints: 2 })).body;
  assert.equal(early.dueTime, '00:00');
  assert.ok(early.describe.includes('by 12:00 am'));
  assert.equal((await call(mom, 'POST', `${base}/chores`, { title: 'X', points: 2, memberIds: [ava.id], dueTime: '7pm' })).status, 400);
  assert.equal((await call(mom, 'POST', `${base}/chores`, { title: 'X', points: 2, memberIds: [ava.id], dueTime: '19:00', latePoints: 3 })).status, 400, 'late points never more than the chore');
  await asKid(ava);
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  const item = board.todayItems.find((i: Item) => i.choreId === early.id) as Item;
  assert.equal(item.dueTime, '00:00');
  const done = (await call(tablet, 'POST', `${base}/instances/${item.id}/done`)).body.item as Item;
  assert.equal(done.late, true);
  assert.equal(done.points, 2);
  // "Not yet" and again: still late, still 2 (never knocked down twice).
  await call(tablet, 'POST', `${base}/instances/${item.id}/undo`);
  const again = (await call(tablet, 'POST', `${base}/instances/${item.id}/done`)).body.item as Item;
  assert.equal(again.points, 2);
  assert.equal((await call(mom, 'POST', `${base}/instances/${item.id}/approve`)).body.awarded, 2);
});

test('auto-approve and routines', async () => {
  const { call, mom, base, ava, tablet, asKid } = await family();
  const teeth = (await call(mom, 'POST', `${base}/chores`, { title: 'Brush teeth', icon: '🪥', points: 1, memberIds: [ava.id], autoApprove: true, routine: 'bedtime', routinePos: 2, minutes: 2 })).body;
  const pjs = (await call(mom, 'POST', `${base}/chores`, { title: 'Pajamas', icon: '🩳', points: 1, memberIds: [ava.id], routine: 'bedtime', routinePos: 1, minutes: 3 })).body;
  assert.equal(teeth.autoApprove, true);
  assert.equal(teeth.routine, 'bedtime');
  assert.equal((await call(mom, 'POST', `${base}/chores`, { title: 'X', memberIds: [ava.id], routine: 'lunch' })).status, 400);
  await asKid(ava);
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  const steps = (board.todayItems as Item[]).filter((i) => i.routine === 'bedtime');
  assert.deepEqual(steps.map((i) => i.choreId), [pjs.id, teeth.id], 'in step order');
  assert.equal(steps[1].minutes, 2);
  const r = (await call(tablet, 'POST', `${base}/instances/${steps[1].id}/done`)).body;
  assert.equal(r.item.status, 'approved');
  assert.equal(r.item.auto, true);
  assert.equal(r.awarded, 1);
  assert.equal((await call(mom, 'GET', `${base}/review`)).body.length, 0, 'nothing for a parent to review');
  const ledger = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.recent;
  assert.equal(ledger[0].by, '✨ Auto-approved');
});
