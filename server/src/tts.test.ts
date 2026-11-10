import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { cleanVoices, sayable, setTtsFetch, voiceFor } from './routes/tts.ts';

const VOICES = ['af_bella', 'af_heart', 'am_adam', 'bf_emma', 'ef_dora', 'em_alex', 'jf_alpha'];

test('kokoro: voice lists are cleaned and each language gets a voice that speaks it', () => {
  assert.deepEqual(cleanVoices({ voices: ['af_heart', 'af_heart', 'nope', '<b>', 7, 'bf_emma'] }), ['af_heart', 'bf_emma']);
  assert.deepEqual(cleanVoices({ data: [{ id: 'am_adam' }, { name: 'ef_dora' }] }), ['am_adam', 'ef_dora']);
  assert.deepEqual(cleanVoices(null), []);

  assert.equal(voiceFor('en', 'bf_emma', VOICES), 'bf_emma', 'British English reads English');
  assert.equal(voiceFor('es', 'af_bella', VOICES), 'ef_dora', 'Spanish gets a Spanish voice');
  assert.equal(voiceFor('es', 'em_alex', VOICES), 'em_alex', 'a chosen Spanish voice is kept');
  assert.equal(voiceFor('fr', 'af_bella', VOICES), null, 'no French voice: the device reads French');
  assert.equal(voiceFor('fr', 'af_bella', null), 'ff_siwis', 'voice list unknown: try the usual one');
  assert.equal(sayable('🍽️ Unload   the dishwasher '), 'Unload the dishwasher');
});

test('kokoro: a parent links Kokoro, picks a voice, and everyone in the home hears it', async () => {
  const { call, mom, base, tablet, asKid, ava } = await family();
  const asked: { url: string; body: Record<string, unknown> | null; auth: string | undefined }[] = [];
  let down = false;
  setTtsFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string>)?.authorization;
    asked.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, auth });
    if (down) throw new Error('ECONNREFUSED');
    if (url === 'http://kokoro.lan:8880/v1/audio/voices') return Response.json({ voices: VOICES });
    if (url === 'http://kokoro.lan:8880/v1/audio/speech') return new Response(new Uint8Array([0xff, 0xf3, 1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
    return new Response('nope', { status: 404 });
  }) as typeof fetch);

  // Not set up: the home reads with the device's voice.
  assert.equal((await call(mom, 'GET', base)).body.kokoroVoice, null);
  assert.equal((await call(tablet, 'GET', `${base}/tts/say?text=hi`)).status, 404);

  // Parents only, and only a real address and voice name.
  assert.equal((await call(tablet, 'PUT', `${base}/tts-link`, { url: 'http://kokoro.lan:8880' })).status, 403);
  assert.equal((await call(mom, 'PUT', `${base}/tts-link`, { url: 'kokoro.lan' })).status, 400);
  assert.equal((await call(mom, 'PUT', `${base}/tts-link`, { url: 'http://kokoro.lan:8880', voice: '../etc' })).status, 400);

  const linked = (await call(mom, 'PUT', `${base}/tts-link`, { url: 'http://kokoro.lan:8880/v1/', voice: 'bf_emma', key: 'sekret' })).body;
  assert.equal(linked.url, 'http://kokoro.lan:8880', 'a pasted /v1 is dropped');
  assert.equal(linked.voice, 'bf_emma');
  assert.equal(linked.hasKey, true);
  assert.deepEqual(linked.check, { ok: true, voices: VOICES, voiceFound: true });
  assert.deepEqual((await call(mom, 'GET', `${base}/tts-link`)).body, { url: 'http://kokoro.lan:8880', hasKey: true, voice: 'bf_emma' });
  assert.equal((await call(tablet, 'GET', base)).body.kokoroVoice, 'bf_emma', 'the tablet knows to use Kokoro');
  assert.deepEqual((await call(mom, 'GET', `${base}/tts/voices`)).body.voices, VOICES);

  // The tablet asks for audio; Kokoro gets the text without emoji, the chosen voice and the key.
  await asKid(ava);
  const said = await call(tablet, 'GET', `${base}/tts/say?text=${encodeURIComponent('🍽️ Dishes')}&lang=en&v=bf_emma`);
  assert.equal(said.status, 200);
  assert.equal(said.headers['content-type'], 'audio/mpeg');
  const speech = asked.filter((a) => a.url.endsWith('/speech'));
  assert.equal(speech.length, 1);
  assert.equal(speech[0].body!.input, 'Dishes');
  assert.equal(speech[0].body!.voice, 'bf_emma');
  assert.equal(speech[0].auth, 'Bearer sekret');

  // Said again: from the cache, Kokoro isn't asked.
  await call(tablet, 'GET', `${base}/tts/say?text=Dishes&lang=en`);
  assert.equal(asked.filter((a) => a.url.endsWith('/speech')).length, 1);

  // A Spanish board gets a Spanish voice; French has none, so the app falls back to the device voice.
  await call(tablet, 'GET', `${base}/tts/say?text=Platos&lang=es`);
  assert.equal(asked.filter((a) => a.url.endsWith('/speech')).at(-1)!.body!.voice, 'ef_dora');
  assert.equal((await call(tablet, 'GET', `${base}/tts/say?text=Assiettes&lang=fr`)).status, 404);

  // Only parents can try another voice.
  await call(tablet, 'GET', `${base}/tts/say?text=Trash&voice=am_adam`);
  assert.equal(asked.filter((a) => a.url.endsWith('/speech')).at(-1)!.body!.voice, 'bf_emma');
  await call(mom, 'GET', `${base}/tts/say?text=Trash&voice=am_adam`);
  assert.equal(asked.filter((a) => a.url.endsWith('/speech')).at(-1)!.body!.voice, 'am_adam');

  // Kokoro down: a clear error, so the app reads with the device's voice instead.
  down = true;
  assert.equal((await call(tablet, 'GET', `${base}/tts/say?text=Something+new`)).status, 502);
  assert.equal((await call(mom, 'PUT', `${base}/tts-link`, { url: 'http://kokoro.lan:8880' })).body.check.ok, false);
  down = false;

  // Unlinking goes back to the device's voice.
  assert.equal((await call(mom, 'PUT', `${base}/tts-link`, { url: '' })).body.url, '');
  assert.equal((await call(tablet, 'GET', base)).body.kokoroVoice, null);
  assert.equal((await call(tablet, 'GET', `${base}/tts/say?text=hi`)).status, 404);
});
