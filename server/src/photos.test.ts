import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';

// A 1×1 PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('photo proof and cheers: a photo chore needs a picture before it goes to a grown-up, who can cheer the approval', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  const room = (await call(mom, 'POST', `${base}/chores`, { title: 'Clean your room', icon: '🧹', points: 5, memberIds: [ava.id, ben.id], photo: true })).body;
  assert.equal(room.photo, true);
  await asKid(ava);
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  const item = board.todayItems.find((i: { choreId: string }) => i.choreId === room.id);
  assert.equal(item.needsPhoto, true);
  assert.equal(item.hasPhoto, false);

  const noPhoto = await call(tablet, 'POST', `${base}/instances/${item.id}/done`);
  assert.equal(noPhoto.status, 400);
  // Not a picture, or not ours.
  assert.equal((await call(tablet, 'POST', `${base}/instances/${item.id}/photo`, { image: 'data:image/png;base64,aGVsbG8=' })).status, 400);
  assert.equal((await call(tablet, 'POST', `${base}/instances/${item.id}/photo`, { image: 'data:text/html;base64,PGI+aGk8L2I+' })).status, 400);
  const bensItem = (await call(mom, 'GET', `${base}/kids/${ben.id}/board`)).body.todayItems.find((i: { choreId: string }) => i.choreId === room.id);
  assert.equal((await call(tablet, 'POST', `${base}/instances/${bensItem.id}/photo`, { image: PNG })).status, 403);

  const up = await call(tablet, 'POST', `${base}/instances/${item.id}/photo`, { image: PNG });
  assert.equal(up.status, 200);
  assert.equal(up.body.item.hasPhoto, true);
  assert.equal((await call(tablet, 'POST', `${base}/instances/${item.id}/done`)).body.item.status, 'submitted');

  // Parents see it in the review queue and can load the picture; a sibling can't.
  const queue = (await call(mom, 'GET', `${base}/review`)).body;
  assert.equal(queue[0].hasPhoto, true);
  const pic = await call(mom, 'GET', `${base}/instances/${item.id}/photo`);
  assert.equal(pic.status, 200);
  await asKid(ben);
  assert.equal((await call(tablet, 'GET', `${base}/instances/${item.id}/photo`)).status, 403);

  // Approve with a cheer; the kid sees it.
  assert.equal((await call(mom, 'POST', `${base}/instances/${item.id}/approve`, { cheer: 'nope' })).status, 400);
  const ok = (await call(mom, 'POST', `${base}/instances/${item.id}/approve`, { cheer: 'star' })).body;
  assert.equal(ok.awarded, 5);
  assert.equal(ok.item.cheer, 'star');
  // Cheering again changes the cheer without paying twice.
  const again = (await call(mom, 'POST', `${base}/instances/${item.id}/approve`, { cheer: 'love' })).body;
  assert.equal(again.awarded, 0);
  assert.equal(again.item.cheer, 'love');
  await asKid(ava);
  const after = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.todayItems.find((i: { id: string }) => i.id === item.id);
  assert.equal(after.cheer, 'love');
});
