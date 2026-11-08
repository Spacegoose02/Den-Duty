import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';

test('shared lists: parents make them, kids and the wall add to the ones that allow it', async () => {
  const { db, call, mom, base, ava, ben, tablet, asKid } = await family();
  const groceries = (await call(mom, 'POST', `${base}/lists`, { name: 'Groceries', icon: '🛒' })).body;
  const todo = (await call(mom, 'POST', `${base}/lists`, { name: 'To-do', icon: '✅', kidsCanAdd: false, onWall: false })).body;
  assert.equal(groceries.kidsCanAdd, true);

  // The wall tablet (no kid signed in) adds milk; adding it again doesn't double it.
  const milk = (await call(tablet, 'POST', `${base}/lists/${groceries.id}/items`, { text: 'Milk' })).body;
  assert.equal(milk.duplicate, false);
  assert.equal((await call(tablet, 'POST', `${base}/lists/${groceries.id}/items`, { text: 'milk' })).body.duplicate, true);
  assert.equal((await call(tablet, 'POST', `${base}/lists/${todo.id}/items`, { text: 'Taxes' })).status, 403);
  assert.equal((await call(tablet, 'POST', `${base}/lists`, { name: 'Mine' })).status, 403);

  // Ava adds cereal; parents get told; she can take back her own thing but not Milk.
  await asKid(ava);
  const cereal = (await call(tablet, 'POST', `${base}/lists/${groceries.id}/items`, { text: 'Cereal 🥣' })).body;
  const ev = db.prepare("SELECT * FROM events WHERE type = 'list_item_added' ORDER BY rowid DESC LIMIT 1").get() as { member_id: string; data: string };
  assert.equal(ev.member_id, ava.id);
  assert.equal(JSON.parse(ev.data).by_kid, true);
  assert.equal((await call(tablet, 'DELETE', `${base}/list-items/${milk.id}`)).status, 403);
  // Ticking off is fine on a kid list.
  let list = (await call(tablet, 'PATCH', `${base}/list-items/${milk.id}`, { done: true })).body;
  assert.deepEqual(list.items.map((i: { text: string; done: boolean }) => `${i.text}:${i.done}`), ['Cereal 🥣:false', 'Milk:true']);
  await asKid(ben);
  assert.equal((await call(tablet, 'DELETE', `${base}/list-items/${cereal.id}`)).status, 403, "Ben can't remove Ava's");
  await asKid(ava);
  assert.equal((await call(tablet, 'DELETE', `${base}/list-items/${cereal.id}`)).status, 200);

  // The wall shows lists marked for it, open items only.
  await call(tablet, 'POST', '/api/kiosk/kid/logout', {});
  await call(mom, 'POST', `${base}/lists/${groceries.id}/items`, { text: 'Eggs' });
  const wall = (await call(tablet, 'GET', '/api/kiosk/wall')).body;
  assert.deepEqual(wall.lists.map((l: { name: string; items: { text: string }[] }) => `${l.name}:${l.items.map((i) => i.text).join(',')}`), ['Groceries:Eggs']);

  // Clearing ticked items.
  list = (await call(mom, 'POST', `${base}/lists/${groceries.id}/clear-done`)).body;
  assert.deepEqual(list.items.map((i: { text: string }) => i.text), ['Eggs']);

  // Voice: "add bananas to the shopping list" and "what's on the shopping list".
  const tok = (await call(mom, 'POST', `${base}/tokens`, { name: 'HA', scope: 'control' })).body.token as string;
  const auth = { authorization: `Bearer ${tok}` };
  const said = (await call({}, 'POST', `${base}/ha/lists/add`, { list: 'shopping', item: 'some bananas' }, auth)).body;
  assert.equal(said.speech, 'Added bananas to the Groceries list.');
  const read = (await call({}, 'GET', `${base}/ha/say?about=list&list=shopping`, undefined, auth)).body;
  assert.equal(read.speech, 'On the Groceries list: Eggs and Bananas.');

  await call(mom, 'DELETE', `${base}/lists/${todo.id}`);
  assert.equal((await call(mom, 'GET', `${base}/lists`)).body.length, 1);
});
