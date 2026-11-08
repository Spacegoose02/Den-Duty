import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { endFinishedSessions } from './screentime.ts';

test('screen-time bank: chores earn minutes, swap points, timed sessions tell Home Assistant', async () => {
  const { db, call, mom, base, ava, ben, tablet, asKid, today } = await family();
  await call(mom, 'POST', `${base}/chores`, { title: 'Dishes', icon: '🍽️', points: 4, schedule: 'daily', memberIds: [ava.id] });
  await asKid(ava);
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/screen-time`)).body, null, 'off by default');
  await call(mom, 'PUT', `${base}/screen-time`, { on: true, perChorePoint: 5, perPoint: 3, dailyMax: 30, bankMax: 100 });

  // Dishes approved: 4 points × 5 = 20 minutes. Undo takes them back.
  const item = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.todayItems[0];
  await call(tablet, 'POST', `${base}/instances/${item.id}/done`);
  await call(mom, 'POST', `${base}/instances/${item.id}/approve`);
  let v = (await call(tablet, 'GET', `${base}/kids/${ava.id}/screen-time`)).body;
  assert.equal(v.bank, 20);
  await call(mom, 'POST', `${base}/instances/${item.id}/undo`);
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/screen-time`)).body.bank, 0);
  await call(mom, 'POST', `${base}/instances/${item.id}/approve`);

  // Swap 2 points for 6 minutes.
  v = (await call(tablet, 'POST', `${base}/kids/${ava.id}/screen-time/swap`, { points: 2 })).body;
  assert.equal(v.bank, 26);
  assert.equal(v.points, 2);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/screen-time/swap`, { points: 99 })).status, 400);

  // Start 20 minutes; can't start twice or go past the bank; Ben can't stop Ava's.
  v = (await call(tablet, 'POST', `${base}/kids/${ava.id}/screen-time/start`, { minutes: 20 })).body;
  assert.equal(v.bank, 6);
  assert.ok(v.session);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/screen-time/start`, { minutes: 5 })).status, 400);
  const started = db.prepare("SELECT data FROM events WHERE type = 'screen_time_started'").get() as { data: string };
  assert.equal(JSON.parse(started.data).minutes, 20);
  await asKid(ben);
  assert.equal((await call(tablet, 'POST', `${base}/screen-time/${v.session.id}/stop`)).status, 403);
  await asKid(ava);

  // Stopping straight away gives back the whole minutes left (19 or 20, depending on the clock).
  v = (await call(tablet, 'POST', `${base}/screen-time/${v.session.id}/stop`)).body;
  assert.ok(v.bank >= 25, `refunded, bank ${v.bank}`);
  assert.equal(v.session, null);
  const ended = db.prepare("SELECT data FROM events WHERE type = 'screen_time_ended'").get() as { data: string };
  assert.equal(JSON.parse(ended.data).reason, 'stopped');

  // The daily limit (30) counts what was really used.
  const used = v.usedToday as number;
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/screen-time/start`, { minutes: 30 - used + 1 })).status, 400);

  // Time's up: the timer ends it with nothing refunded.
  v = (await call(tablet, 'POST', `${base}/kids/${ava.id}/screen-time/start`, { minutes: 5 })).body;
  db.prepare("UPDATE screen_sessions SET ends_at = datetime('now', '-1 second') WHERE id = ?").run(v.session.id);
  assert.equal(endFinishedSessions(db, () => today), 1);
  const after = (await call(tablet, 'GET', `${base}/kids/${ava.id}/screen-time`)).body;
  assert.equal(after.bank, v.bank);
  assert.equal(after.session, null);

  // Parents grant minutes; HA sees the bank and can stop a session.
  await call(mom, 'POST', `${base}/kids/${ava.id}/screen-time/grant`, { minutes: 15, reason: 'Rainy day' });
  const tok = (await call(mom, 'POST', `${base}/tokens`, { name: 'HA', scope: 'control' })).body.token as string;
  const auth = { authorization: `Bearer ${tok}` };
  const sum = (await call({}, 'GET', `${base}/ha/summary`, undefined, auth)).body;
  assert.equal(sum.kids.find((k: { name: string }) => k.name === 'Avaleigh').screen_minutes, after.bank + 15);
  await call(tablet, 'POST', `${base}/kids/${ava.id}/screen-time/start`, { minutes: 1 });
  assert.equal((await call({}, 'POST', `${base}/ha/screen-time/stop`, { kid: 'ava' }, auth)).body.stopped, true);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/screen-time/grant`, { minutes: 50 })).status, 403);
});
