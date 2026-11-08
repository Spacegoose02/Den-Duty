import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { setNinjaFetch } from './routes/ninja.ts';

/** A stand-in for Nighttime Ninja's requests API: one home, nn-home, token nnk_ok. */
function fakeNinja() {
  const asks = new Map<string, { name: string; requestedBy: string | null; status: string; listName: string | null }>();
  let down = false;
  setNinjaFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    if (down) throw new Error('ECONNREFUSED');
    const u = new URL(String(input));
    if ((init?.headers as Record<string, string>).authorization !== 'Bearer nnk_ok') return new Response('{}', { status: 401 });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const p = u.pathname;
    if (p === '/api/token/home') return Response.json({ homeId: 'nn-home', name: 'Kitchen' });
    if (p === '/api/homes/nn-home/shopping/requests' && init?.method === 'POST') {
      assert.equal(body.source, 'den-duty');
      if (!asks.has(body.externalId)) asks.set(body.externalId, { name: body.name, requestedBy: body.requestedBy, status: 'waiting', listName: null });
      return Response.json({ ...asks.get(body.externalId), externalId: body.externalId });
    }
    if (p === '/api/homes/nn-home/shopping/requests') {
      const ids = (u.searchParams.get('ids') ?? '').split(',');
      return Response.json(ids.filter((id) => asks.has(id)).map((id) => ({ ...asks.get(id), externalId: id })));
    }
    if (p === '/api/homes/nn-home/shopping/requests/withdraw') return Response.json({ ok: true, withdrawn: asks.delete(body.externalId) });
    if (p === '/api/homes/nn-home/shopping/requests/picks') return Response.json([{ name: 'Goldfish', icon: '🐟' }, { name: 'Apples', icon: '🍎' }, { name: 'Milk', icon: '🥛' }, { name: 'Bread', icon: '🍞' }]);
    return new Response('{}', { status: 404 });
  }) as typeof fetch);
  return { asks, setDown: (d: boolean) => { down = d; } };
}

test('Nighttime Ninja grocery requests: kids ask, a parent answers there, the kid sees it here', async () => {
  const { db, call, mom, base, ava, ben, tablet, asKid } = await family();
  const nn = fakeNinja();
  const groceries = (await call(mom, 'POST', `${base}/lists`, { name: 'Groceries', icon: '🛒' })).body;

  // Kids get everyday picks before Nighttime Ninja is linked, and the list can't send asks yet.
  assert.equal((await call(tablet, 'GET', `${base}/lists/${groceries.id}/picks`)).body[0].name, 'Milk');
  assert.equal((await call(mom, 'PATCH', `${base}/lists/${groceries.id}`, { ninjaRequests: true })).status, 400);

  // Linking: a bad token is turned away; a good one finds Nighttime Ninja's home.
  assert.equal((await call(mom, 'PUT', `${base}/ninja`, { url: 'http://ninja.lan:8080', token: 'nnk_bad' })).status, 400);
  assert.equal((await call(tablet, 'PUT', `${base}/ninja`, { url: 'http://ninja.lan:8080', token: 'nnk_ok' })).status, 403);
  const linked = (await call(mom, 'PUT', `${base}/ninja`, { url: 'http://ninja.lan:8080/shopping', token: 'nnk_ok' })).body;
  assert.deepEqual(linked, { url: 'http://ninja.lan:8080', hasToken: true, linked: true, home: 'Kitchen' });
  assert.ok(!(db.prepare('SELECT ninja_token FROM homes').get() as { ninja_token: string }).ninja_token.includes('nnk_ok'), 'sealed at rest');
  assert.equal((await call(mom, 'PATCH', `${base}/lists/${groceries.id}`, { ninjaRequests: true })).body.ninjaRequests, true);
  assert.deepEqual((await call(tablet, 'GET', `${base}/lists/${groceries.id}/picks`)).body.map((p: { name: string }) => p.name), ['Goldfish', 'Apples', 'Milk', 'Bread']);

  // Ava asks for Goldfish: it goes to Nighttime Ninja with her name, waiting.
  await asKid(ava);
  const fish = (await call(tablet, 'POST', `${base}/lists/${groceries.id}/items`, { text: 'Goldfish' })).body;
  assert.equal(fish.request, true);
  assert.deepEqual(nn.asks.get(fish.id), { name: 'Goldfish', requestedBy: 'Avaleigh', status: 'waiting', listName: null });
  const item = (id: string) => (fish.list as { items: { id: string }[] }).items.find((i) => i.id === id);
  assert.deepEqual((item(fish.id) as unknown as { request: unknown }).request, { status: 'waiting', list: null });
  // She can't tick it off herself while it waits.
  assert.equal((await call(tablet, 'PATCH', `${base}/list-items/${fish.id}`, { done: true })).status, 403);

  // Ben asks while Nighttime Ninja is down: it waits here and goes on the next sync.
  await asKid(ben);
  nn.setDown(true);
  const gum = (await call(tablet, 'POST', `${base}/lists/${groceries.id}/items`, { text: 'Gum' })).body;
  assert.equal((db.prepare('SELECT request_status FROM list_items WHERE id = ?').get(gum.id) as { request_status: string }).request_status, 'sending');
  nn.setDown(false);
  const chips = (await call(tablet, 'POST', `${base}/lists/${groceries.id}/items`, { text: 'Chips' })).body;

  // A parent adding on the same list just adds; no ask.
  const eggs = (await call(mom, 'POST', `${base}/lists/${groceries.id}/items`, { text: 'Eggs' })).body;
  assert.equal(eggs.request, false);

  // Mom says yes to Goldfish (onto Weekly) and no to Chips in Nighttime Ninja; Ben takes back Gum.
  nn.asks.get(fish.id)!.status = 'approved';
  nn.asks.get(fish.id)!.listName = 'Weekly';
  nn.asks.get(chips.id)!.status = 'declined';
  // (Gum goes out on this sync, before Ben changes his mind.)
  const synced = async () => {
    const { syncRequests } = await import('./routes/ninja.ts');
    await syncRequests(db, (db.prepare('SELECT id FROM homes').get() as { id: string }).id, true);
    return ((await call(tablet, 'GET', `${base}/lists`)).body[0]) as { items: { text: string; done: boolean; request: { status: string; list: string | null } | null }[] };
  };
  let list = await synced();
  assert.ok(nn.asks.has(gum.id));
  const show = () => list.items.map((i) => `${i.text}:${i.done}:${i.request ? `${i.request.status}${i.request.list ? `@${i.request.list}` : ''}` : '-'}`).sort();
  assert.deepEqual(show(), ['Chips:true:declined', 'Eggs:false:-', 'Goldfish:true:approved@Weekly', 'Gum:false:waiting']);
  assert.equal((await call(tablet, 'DELETE', `${base}/list-items/${gum.id}`)).status, 200);
  assert.ok(!nn.asks.has(gum.id), 'taking it back withdraws the ask');

  // The wall shows only what's still open.
  await call(tablet, 'POST', '/api/kiosk/kid/logout', {});
  const wall = (await call(tablet, 'GET', '/api/kiosk/wall')).body;
  assert.deepEqual(wall.lists[0].items.map((i: { text: string }) => i.text), ['Eggs']);

  // A parent ticking off a waiting ask handles it here and takes it back there.
  await asKid(ava);
  const popcorn = (await call(tablet, 'POST', `${base}/lists/${groceries.id}/items`, { text: 'Popcorn' })).body;
  await call(mom, 'PATCH', `${base}/list-items/${popcorn.id}`, { done: true });
  assert.ok(!nn.asks.has(popcorn.id));
  list = await synced();
  assert.ok(show().includes('Popcorn:true:-'));

  // Unlinking stops new asks.
  await call(mom, 'PUT', `${base}/ninja`, { url: '' });
  assert.equal((await call(tablet, 'POST', `${base}/lists/${groceries.id}/items`, { text: 'Candy' })).body.request, false);
});
