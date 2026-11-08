import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { setSendPush } from './push.ts';

test('feelings: a kid checks in once a day, parents see it, hard feelings buzz once, off means off', async () => {
  const { db, call, mom, base, ava, ben, tablet, asKid } = await family();
  void db;
  setSendPush(async () => 201);

  await asKid(ava);
  assert.equal((await call(tablet, 'PUT', `${base}/kids/${ava.id}/feelings`, { feeling: 'grumpy' })).status, 400);
  assert.equal((await call(tablet, 'PUT', `${base}/kids/${ben.id}/feelings`, { feeling: 'happy' })).status, 403, 'only your own');
  const f = (await call(tablet, 'PUT', `${base}/kids/${ava.id}/feelings`, { feeling: 'sad', reasons: ['friends', 'nope'], note: 'Nobody played with me' })).body;
  assert.deepEqual(f.reasons, ['friends']);
  // Changing her mind replaces today's check-in.
  await call(tablet, 'PUT', `${base}/kids/${ava.id}/feelings`, { feeling: 'sad', reasons: ['friends'] });
  await call(tablet, 'PUT', `${base}/kids/${ava.id}/feelings`, { feeling: 'calm' });
  const mine = (await call(tablet, 'GET', `${base}/kids/${ava.id}/feelings`)).body;
  assert.equal(mine.today.feeling, 'calm');
  assert.equal(mine.days.length, 1);

  // One alert event for moving to sad (not for the repeat, not for calm).
  const events = (await call(mom, 'GET', `${base}/ha/events`)).body as { event: string; alert?: boolean }[];
  assert.equal(events.filter((e) => e.event === 'feeling_shared' && e.alert).length, 1);

  // Parents see everyone; kids can't see the overview; the wall never shows it.
  const all = (await call(mom, 'GET', `${base}/feelings`)).body;
  assert.equal(all.kids.find((k: { id: string }) => k.id === ava.id).days[0].feeling, 'calm');
  assert.equal((await call(tablet, 'GET', `${base}/feelings`)).status, 403);
  assert.ok(!JSON.stringify((await call(tablet, 'GET', '/api/kiosk/wall')).body).includes('calm'));

  // Alert switch, and the page switch.
  assert.equal((await call(mom, 'PATCH', `${base}/feelings`, { alert: false })).body.alert, false);
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { pagesOff: ['feelings'] });
  assert.equal((await call(tablet, 'PUT', `${base}/kids/${ava.id}/feelings`, { feeling: 'happy' })).status, 403);
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/feelings`)).body.on, false);
});
