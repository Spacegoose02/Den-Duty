import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { expireImmichCache, setImmichFetch } from './routes/photoframe.ts';

const ALBUM = '11111111-2222-3333-4444-555555555555';
const PIC = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const VID = 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee';
// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('photo frame: an Immich album and photo-proof highlights on the wall, pictures only through this server', async () => {
  const { call, mom, base, ava, tablet, asKid } = await family();
  expireImmichCache();
  const seen: { url: string; key: string | null }[] = [];
  setImmichFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = new Headers(init?.headers).get('x-api-key');
    seen.push({ url, key });
    if (key !== 'imm-key') return new Response('{}', { status: 401 });
    if (url === `http://immich.lan:2283/api/albums/${ALBUM}`) {
      return Response.json({ assets: [{ id: PIC, type: 'IMAGE', exifInfo: { description: 'Beach day' } }, { id: VID, type: 'VIDEO' }] });
    }
    if (url === `http://immich.lan:2283/api/assets/${PIC}/thumbnail?size=preview`) return new Response(PNG, { headers: { 'content-type': 'image/jpeg' } });
    return new Response('{}', { status: 404 });
  }) as typeof fetch);

  // Off by default: nothing on the wall.
  assert.equal((await call(tablet, 'GET', '/api/kiosk/wall')).body.photoFrame, null);

  // A wrong key says so; the album link is trimmed to its id.
  const bad = (await call(mom, 'PUT', `${base}/photo-frame`, { on: true, immichUrl: 'http://immich.lan:2283/api', albumId: `http://immich.lan:2283/albums/${ALBUM}`, key: 'nope' })).body;
  assert.equal(bad.albumId, ALBUM);
  assert.equal(bad.immichUrl, 'http://immich.lan:2283');
  assert.match(bad.album.error, /API key/);
  const ok = (await call(mom, 'PUT', `${base}/photo-frame`, { key: 'imm-key', seconds: 8 })).body;
  assert.equal(ok.album.count, 1, 'videos are left out');
  assert.equal(ok.hasKey, true);
  assert.equal((await call(mom, 'PUT', `${base}/photo-frame`, { albumId: 'not-an-album' })).status, 400);

  // A photo-proof chore, approved with a cheer.
  const chore = (await call(mom, 'POST', `${base}/chores`, { title: 'Clean room', icon: '🧹', points: 2, schedule: 'daily', memberIds: [ava.id], photo: true })).body;
  void chore;
  await asKid(ava);
  const item = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.todayItems[0];
  await call(tablet, 'POST', `${base}/instances/${item.id}/photo`, { image: `data:image/png;base64,${PNG.toString('base64')}` });
  await call(tablet, 'POST', `${base}/instances/${item.id}/done`);
  await call(mom, 'POST', `${base}/instances/${item.id}/approve`, { cheer: 'star' });
  await call(tablet, 'POST', '/api/kiosk/kid/logout', {});

  const wall = (await call(tablet, 'GET', '/api/kiosk/wall')).body.photoFrame;
  assert.equal(wall.seconds, 8);
  assert.equal(wall.photos.length, 2);
  const proof = wall.photos.find((p: { kind: string }) => p.kind === 'proof');
  assert.match(proof.caption, /Avaleigh: Clean room/);
  const immich = wall.photos.find((p: { kind: string }) => p.kind === 'immich');
  assert.equal(immich.caption, 'Beach day');

  // The tablet loads both through this server; the key never reaches it.
  const pic = await call(tablet, 'GET', immich.url);
  assert.equal(pic.status, 200);
  assert.equal(pic.headers['content-type'], 'image/jpeg');
  assert.equal((await call(tablet, 'GET', proof.url)).status, 200);
  assert.ok(!JSON.stringify(wall).includes('imm-key'));
  // Only pictures in the album, and proof only while the switch is on.
  assert.equal((await call(tablet, 'GET', `${base}/photo-frame/immich/${VID}`)).status, 404);
  await call(mom, 'PUT', `${base}/photo-frame`, { proof: false });
  assert.equal((await call(tablet, 'GET', proof.url)).status, 404);
  assert.equal((await call(tablet, 'GET', `${base}/photo-frame`)).status, 403, 'settings are for parents');
});
