import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { runMoney, splitCents } from './money.ts';
import { addDays, weekdayOf } from '../../shared/schedule.ts';

test('money jars: cash out points, split into Spend, Save and Give', async () => {
  const { call, mom, base, ava, tablet, asKid } = await family();
  // Off until a parent turns it on.
  assert.equal((await call(mom, 'POST', `${base}/money/kids/${ava.id}/cashout`, { points: 1 })).status, 400);
  const s = (await call(mom, 'PATCH', `${base}/money/settings`, { enabled: true, centsPerPoint: 10, split: { spend: 50, save: 40, give: 10 } })).body;
  assert.equal(s.enabled, true);
  assert.equal((await call(mom, 'PATCH', `${base}/money/settings`, { split: { spend: 50, save: 40, give: 20 } })).status, 400, 'must add up to 100');

  const chore = (await call(mom, 'POST', `${base}/chores`, { title: 'Rake leaves', points: 25, memberIds: [ava.id] })).body;
  const inst = (await call(mom, 'GET', `${base}/kids/${ava.id}/board`)).body.todayItems.find((i: { choreId: string }) => i.choreId === chore.id);
  await call(mom, 'POST', `${base}/instances/${inst.id}/approve`);
  assert.equal((await call(mom, 'POST', `${base}/money/kids/${ava.id}/cashout`, { points: 30 })).status, 400, 'not enough points');
  const out = (await call(mom, 'POST', `${base}/money/kids/${ava.id}/cashout`, { points: 25 })).body;
  assert.equal(out.cents, 250);
  assert.deepEqual(out.jars, { spend: 125, save: 100, give: 25 });

  // Spending, moving and never below zero.
  assert.equal((await call(mom, 'POST', `${base}/money/kids/${ava.id}/withdraw`, { jar: 'give', cents: 30, reason: 'Food bank' })).status, 400);
  assert.deepEqual((await call(mom, 'POST', `${base}/money/kids/${ava.id}/withdraw`, { jar: 'give', cents: 25, reason: 'Food bank' })).body.jars, { spend: 125, save: 100, give: 0 });
  assert.deepEqual((await call(mom, 'POST', `${base}/money/kids/${ava.id}/move`, { from: 'spend', to: 'save', cents: 25 })).body.jars, { spend: 100, save: 125, give: 0 });
  assert.deepEqual((await call(mom, 'POST', `${base}/money/kids/${ava.id}/deposit`, { cents: 1000, reason: 'Birthday money' })).body.jars, { spend: 600, save: 525, give: 100 });

  // Kids see their jars on their board, but can't move money.
  await asKid(ava);
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(board.money.total, 1225);
  assert.equal(board.kid.balance, 0, 'the points were spent');
  assert.equal((await call(tablet, 'POST', `${base}/money/kids/${ava.id}/withdraw`, { jar: 'spend', cents: 1, reason: 'Candy' })).status, 403);
  const page = (await call(mom, 'GET', `${base}/money`)).body;
  assert.equal(page.kids.find((k: { id: string }) => k.id === ava.id).history.length > 0, true);
});

test('weekly allowance and monthly interest pay once', async () => {
  const { db, call, mom, base, ava, today } = await family();
  await call(mom, 'PATCH', `${base}/money/settings`, { enabled: true, split: { spend: 100, save: 0, give: 0 } });
  await call(mom, 'PATCH', `${base}/money/kids/${ava.id}`, { allowanceCents: 500, allowanceDay: weekdayOf(today) });
  const homeId = base.split('/').pop()!;
  runMoney(db, homeId, today);
  runMoney(db, homeId, today);
  const jars = () => (db.prepare("SELECT jar, SUM(cents) AS n FROM money_ledger WHERE member_id = ? GROUP BY jar").all(ava.id) as { jar: string; n: number }[]);
  assert.deepEqual(jars().map((r) => ({ ...r })), [{ jar: 'spend', n: 500 }], 'paid once, today');
  // Next week too, even when the server only looks a few days late.
  runMoney(db, homeId, addDays(today, 9));
  assert.equal(jars()[0].n, 1000);

  // Interest: none for the month it was turned on, then a percent of Save each month.
  await call(mom, 'POST', `${base}/money/kids/${ava.id}/move`, { from: 'spend', to: 'save', cents: 1000 });
  await call(mom, 'PATCH', `${base}/money/settings`, { interest: 50 });
  runMoney(db, homeId, today);
  const save = () => Number((db.prepare("SELECT SUM(cents) AS n FROM money_ledger WHERE member_id = ? AND jar = 'save'").get(ava.id) as { n: number }).n);
  assert.equal(save(), 1000);
  const nextMonth = `${new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1)).toISOString().slice(0, 10)}`;
  runMoney(db, homeId, nextMonth);
  runMoney(db, homeId, nextMonth);
  assert.equal(save(), 1050, '5% once');
});

test('splitCents never loses a cent', () => {
  assert.deepEqual(splitCents(99, { spend: 70, save: 20, give: 10 }), { spend: 71, save: 19, give: 9 });
});
