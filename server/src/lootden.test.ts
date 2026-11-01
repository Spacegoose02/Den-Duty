import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { setLootDenFetch } from './routes/lootden.ts';

test('LootDen on the family wall: now playing, game night and screenshots through this server', async () => {
  const { db, call, mom, base, tablet } = await family();
  const seen: string[] = [];
  setLootDenFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push(url);
    if ((init?.headers as Record<string, string>).authorization !== 'Bearer ld_kid') return new Response('{}', { status: 401 });
    if (url === 'http://lootden.lan:8080/api/family/wall') {
      return Response.json({
        nowPlaying: [{ name: 'Ava', avatar: 'x', title: 'Minecraft', device: 'DEN-PC', startedAt: new Date().toISOString(), playedFor: '12 min' }],
        nextGameNight: { id: 1, title: '🎮 Family game night', date: '2026-11-06', time: '19:00', game: { title: 'Overcooked 2' }, players: [{ name: 'Ava' }], goal: null },
        screenshots: [{ id: 7, imageUrl: '/api/screenshots/7/image', by: 'Ava', game: 'Minecraft', caption: 'My house', createdAt: new Date().toISOString() }],
      });
    }
    if (url === 'http://lootden.lan:8080/api/screenshots/7/image') return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { headers: { 'content-type': 'image/jpeg' } });
    return new Response('{}', { status: 404 });
  }) as typeof fetch);

  assert.equal((await call(tablet, 'PUT', `${base}/lootden`, { url: 'http://x' })).status, 403, 'parents only');
  const bad = await call(mom, 'PUT', `${base}/lootden`, { url: 'http://lootden.lan:8080/library', token: 'ld_wrong' });
  assert.equal(bad.body.url, 'http://lootden.lan:8080');
  assert.equal(bad.body.reachable, false);
  const ok = await call(mom, 'PUT', `${base}/lootden`, { url: 'http://lootden.lan:8080', token: 'ld_kid' });
  assert.equal(ok.body.reachable, true);
  assert.equal(ok.body.hasToken, true);
  assert.equal(ok.body.token, undefined);
  const raw = (db.prepare('SELECT lootden_token FROM homes').get() as { lootden_token: string }).lootden_token;
  assert.ok(!raw.includes('ld_kid'), 'the token is sealed at rest');

  const wall = (await call(tablet, 'GET', '/api/kiosk/wall')).body;
  assert.equal(wall.lootden.nowPlaying[0].title, 'Minecraft');
  assert.equal(wall.lootden.nextGameNight.game.title, 'Overcooked 2');
  const shot = wall.lootden.screenshots[0];
  assert.equal(shot.imageUrl, `${base}/lootden/shots/7`);
  const img = await call(tablet, 'GET', shot.imageUrl);
  assert.equal(img.status, 200);
  assert.equal((await call(tablet, 'GET', `${base}/lootden/shots/8`)).status, 404, 'only pictures LootDen listed');
  assert.equal((await call({}, 'GET', shot.imageUrl)).status, 401, 'not for strangers');

  // Unlinking takes it off the wall.
  await call(mom, 'PUT', `${base}/lootden`, { url: '' });
  assert.equal((await call(tablet, 'GET', '/api/kiosk/wall')).body.lootden, null);
  assert.ok(seen.every((u) => u.startsWith('http://lootden.lan:8080/')));
});
