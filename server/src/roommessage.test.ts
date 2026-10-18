import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family, fakeClaude, type Sent } from './test-helpers.ts';
import { setAiFetch } from './ai.ts';
import { resetRoomRetry } from './roommessage.ts';

test('daily den message: built-in when AI is off, AI-written (age only, name filled in here) and cached per day when on', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  resetRoomRetry();
  await asKid(ava);
  const off = (await call(tablet, 'GET', `${base}/kids/${ava.id}/room-message`)).body;
  assert.equal(off.source, 'builtin');
  assert.ok(off.text.includes('Avaleigh') && !off.text.includes('{name}'));
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ben.id}/room-message`)).status, 403, 'only their own');

  const sent: Sent[] = [];
  fakeClaude(sent, () => ({ message: 'Hey {name}, raccoons love a tidy den! 🦝' }));
  await call(mom, 'PATCH', `${base}/ai`, { apiKey: 'sk-ant-api03-test-key-abcdefghijklmnop', enabled: true });
  const on = (await call(tablet, 'GET', `${base}/kids/${ava.id}/room-message`)).body;
  assert.deepEqual(on, { text: 'Hey Avaleigh, raccoons love a tidy den! 🦝', source: 'ai' });
  const body = JSON.stringify(sent[0].body);
  assert.ok(body.includes('4 years old') && !body.includes('Avaleigh'), 'only the age is sent');
  await call(tablet, 'GET', `${base}/kids/${ava.id}/room-message`);
  assert.equal(sent.length, 1, 'once per kid per day');

  // AI down: falls back to the built-in set without breaking the screen.
  setAiFetch((async () => new Response('{}', { status: 500 })) as typeof fetch);
  const fallback = (await call(mom, 'GET', `${base}/kids/${ben.id}/room-message`)).body;
  assert.equal(fallback.source, 'builtin');
  assert.ok(fallback.text.includes('Benedict'));

  // Off with the Chores page.
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { pagesOff: ['chores'] });
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/room-message`)).body, null);
  setAiFetch(undefined);
});
