import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { matchChore, spokenList } from './routes/voice.ts';

test('voice: spoken lists and loose chore matching', () => {
  assert.equal(spokenList(['a']), 'a');
  assert.equal(spokenList(['a', 'b', 'c']), 'a, b and c');
  const items = [{ title: '🍽️ Unload the dishwasher' }, { title: 'Feed the cat' }] as never[];
  assert.equal((matchChore(items, 'the dishwasher') as { title: string } | null)?.title, '🍽️ Unload the dishwasher');
  assert.equal((matchChore(items, 'feed the cat') as { title: string } | null)?.title, 'Feed the cat');
  assert.equal(matchChore(items, 'mow the lawn'), null);
});

test('voice: Home Assistant asks what is left and marks chores done by voice', async () => {
  const { call, mom, base, ava, ben } = await family();
  void ben;
  await call(mom, 'POST', `${base}/chores`, { title: 'Dishes', icon: '🍽️', points: 2, schedule: 'daily', memberIds: [ava.id] });
  await call(mom, 'POST', `${base}/chores`, { title: 'Feed the cat', icon: '🐱', points: 1, schedule: 'daily', memberIds: [ava.id] });
  const read = (await call(mom, 'POST', `${base}/tokens`, { name: 'Assist' })).body.token as string;
  const control = (await call(mom, 'POST', `${base}/tokens`, { name: 'Assist', scope: 'control' })).body.token as string;
  const say = async (q: string, token = read) => (await call({}, 'GET', `${base}/ha/say?${q}`, undefined, { authorization: `Bearer ${token}` })).body;

  assert.equal((await say('kid=ava')).speech, 'Avaleigh has 2 chores left: Dishes and Feed the cat.');
  assert.equal((await say('kid=Avaleigh&about=points')).speech, 'Avaleigh has 0 Shinies, and earned 0 this week.');
  assert.match((await say('about=everyone')).speech, /Avaleigh has 2 chores left\. Benedict/);
  assert.equal((await say('kid=Zed')).speech, "I don't know anyone called Zed.");

  // Marking done needs a control token, and reads the result back.
  const done = async (body: object, token: string) => (await call({}, 'POST', `${base}/ha/say/done`, body, { authorization: `Bearer ${token}` }));
  assert.equal((await done({ kid: 'ava', chore: 'dishes' }, read)).status, 403);
  const r = (await done({ kid: 'ava', chore: 'the dishes' }, control)).body;
  assert.equal(r.speech, 'Nice work! Dishes is waiting for a grown-up. 1 chore to go.');
  assert.match((await done({ kid: 'ava', chore: 'laundry' }, control)).body.speech, /couldn't find laundry.*Feed the cat/);
  assert.match((await say('kid=ava&about=next')).speech, /Next up for Avaleigh: Feed the cat/);
});
