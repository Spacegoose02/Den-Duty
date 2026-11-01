import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { recap } from './recap.ts';
import { homeInfo } from './chores.ts';
import { addDays, startOfWeek } from '../../shared/schedule.ts';

test('weekly recap: last week per kid with highlights, and read-aloud follows the picture board', async () => {
  const { db, call, mom, base, ava, ben, today } = await family();
  const homeId = base.split('/').pop()!;
  // A chore that started two weeks ago, so last week has history.
  const chore = (await call(mom, 'POST', `${base}/chores`, { title: 'Water plants', icon: '🪴', points: 2, memberIds: [ava.id, ben.id] })).body;
  const lastWeek = addDays(startOfWeek(today, 0), -7);
  db.prepare('UPDATE chores SET start_date = ? WHERE id = ?').run(addDays(lastWeek, -7), chore.id);
  // Ava did every day last week; Ben did none.
  await call(mom, 'GET', `${base}/agenda?start=${addDays(lastWeek, -7)}&days=14`);
  const avaDays = db.prepare('SELECT id FROM chore_instances WHERE member_id = ? AND date BETWEEN ? AND ?').all(ava.id, lastWeek, addDays(lastWeek, 6)) as { id: string }[];
  for (const i of avaDays) await call(mom, 'POST', `${base}/instances/${i.id}/approve`);

  const summary = (await call(mom, 'GET', `${base}/summary`)).body;
  assert.equal(summary.recapWeek, lastWeek);
  const r = (await call(mom, 'GET', `${base}/recap`)).body;
  assert.equal(r.weekStart, lastWeek);
  const a = r.kids.find((k: { id: string }) => k.id === ava.id);
  const b = r.kids.find((k: { id: string }) => k.id === ben.id);
  assert.equal(a.rate, 100);
  assert.equal(a.done, 7);
  assert.equal(b.rate, 0);
  assert.equal(b.missed.missed, 7);
  assert.ok(r.highlights.some((h: string) => h.includes('Avaleigh')));
  assert.ok(r.workOn.some((h: string) => h.includes('Benedict')));
  assert.equal(recap(db, homeInfo(db, homeId), today).total.done, 7);
  assert.equal((await call(mom, 'GET', `${base}/recap?week=${today}`)).status, 400, 'this week is not over');
  await call(mom, 'POST', `${base}/recap/seen`);
  assert.equal((await call(mom, 'GET', `${base}/summary`)).body.recapWeek, null);

  // Ava is 4 (picture board), so read-aloud is on by itself; Ben's 9.
  const kids = (await call(mom, 'GET', `${base}/kids`)).body;
  assert.equal(kids.find((k: { id: string }) => k.id === ava.id).readAloud, true);
  assert.equal(kids.find((k: { id: string }) => k.id === ben.id).readAloud, false);
  await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { readAloud: 'on' });
  assert.equal((await call(mom, 'GET', `${base}/kids`)).body.find((k: { id: string }) => k.id === ben.id).readAloud, true);
  assert.equal((await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { readAloud: 'loud' })).status, 400);
});
