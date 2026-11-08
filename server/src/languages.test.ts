import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';

test('languages: the home picks one for kid screens, a kid can have their own, the tablet sees both', async () => {
  const { call, mom, base, ava, ben, tablet } = await family();
  assert.equal((await call(mom, 'GET', base)).body.language, 'en', 'English to start');
  assert.equal((await call(mom, 'PATCH', base, { language: 'de' })).status, 400, 'only languages we have');
  assert.equal((await call(mom, 'PATCH', base, { language: 'es' })).status, 200);
  assert.equal((await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { language: 'xx' })).status, 400);
  assert.equal((await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { language: 'fr' })).status, 200);

  const home = (await call(mom, 'GET', base)).body;
  assert.equal(home.language, 'es');
  assert.equal(home.kids.find((k: { id: string }) => k.id === ava.id).language, 'fr');
  assert.equal(home.kids.find((k: { id: string }) => k.id === ben.id).language, null, "Ben goes with the family's");

  assert.equal((await call(tablet, 'GET', '/api/kiosk')).body.home.language, 'es', 'the kid picker greets in Spanish');
  assert.equal((await call(tablet, 'GET', '/api/kiosk/wall')).body.home.language, 'es');

  // Back to the family's language.
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { language: '' });
  assert.equal((await call(mom, 'GET', base)).body.kids.find((k: { id: string }) => k.id === ava.id).language, null);
});
