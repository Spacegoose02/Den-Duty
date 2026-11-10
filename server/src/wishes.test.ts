import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { setWishesFetch, syncWishes } from './routes/wishes.ts';

/** A stand-in for Wishes' v1 API: key wsh_ok, a kid "Ava" (2) with a list, and "Ben" (3) with no list yet. */
function fakeWishes() {
  const wishes: { profile_id?: number; kid?: string; title: string; notes: string; approved: boolean }[] = [];
  let down = false;
  setWishesFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    if (down) throw new Error('ECONNREFUSED');
    const u = new URL(String(input));
    if ((init?.headers as Record<string, string>).authorization !== 'Bearer wsh_ok') return Response.json({ error: 'Bad key' }, { status: 401 });
    if (u.pathname === '/api/v1/kids') {
      return Response.json({ user: { id: 1, name: 'Mom' }, kids: [
        { profile_id: 1, name: 'Mom', is_kid: false, default_list_id: 5, lists: [] },
        { profile_id: 2, name: 'Ava', is_kid: true, default_list_id: 7, lists: [] },
        { profile_id: 3, name: 'Benny', is_kid: true, default_list_id: null, lists: [] },
      ] });
    }
    if (u.pathname === '/api/v1/wishes' && init?.method === 'POST') {
      const b = JSON.parse(String(init.body));
      if (b.profile_id === 3) return Response.json({ error: 'Benny has no list yet' }, { status: 409 });
      if (b.profile_id !== 2) return Response.json({ error: 'No such kid' }, { status: 404 });
      const dup = wishes.some((w) => w.title.toLowerCase() === String(b.title).toLowerCase());
      if (!dup) wishes.push(b);
      return Response.json({ duplicate: dup, wish: { id: 42, title: b.title, list_id: 7, list_title: "Ava's birthday", profile_id: 2, needs_approval: true, link: 'https://w/lists/7#item-42' } }, { status: dup ? 200 : 201 });
    }
    return Response.json({ error: 'Not found' }, { status: 404 });
  }) as typeof fetch);
  return { wishes, setDown: (d: boolean) => { down = d; } };
}

test('Helpdesk "Add to my wishlist" goes onto the kid\'s Wishes list', async () => {
  const { db, call, mom, base, ava, ben, tablet, asKid } = await family();
  const w = fakeWishes();
  const homeId = (db.prepare('SELECT id FROM homes').get() as { id: string }).id;
  await asKid(ava);

  // Needs words. Before Wishes is linked it's an ordinary ask.
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/helpdesk`, { kind: 'wish' })).status, 400);
  const sneakers = (await call(tablet, 'POST', `${base}/kids/${ava.id}/helpdesk`, { kind: 'wish', text: 'Light-up sneakers' })).body;
  assert.equal(sneakers.status, 'waiting');

  // Linking: a bad key is turned away; a good one matches kids by name where it can (Avaleigh → Ava; Benedict and Benny aren't sure enough) and sends waiting asks.
  assert.equal((await call(mom, 'PUT', `${base}/wishes`, { url: 'http://wishes.lan:3000', token: 'wsh_bad' })).status, 400);
  assert.equal((await call(tablet, 'PUT', `${base}/wishes`, { url: 'http://wishes.lan:3000', token: 'wsh_ok' })).status, 403);
  const linked = (await call(mom, 'PUT', `${base}/wishes`, { url: 'http://wishes.lan:3000/x', token: 'wsh_ok' })).body;
  assert.deepEqual(linked, { url: 'http://wishes.lan:3000', hasToken: true, linked: true, user: 'Mom' });
  assert.ok(!(db.prepare('SELECT wishes_token FROM homes').get() as { wishes_token: string }).wishes_token.includes('wsh_ok'), 'sealed at rest');
  const settings = (await call(mom, 'GET', `${base}/wishes`)).body;
  assert.deepEqual(settings.kids.map((k: { name: string; profileId: number | null }) => `${k.name}:${k.profileId}`), ['Avaleigh:2', 'Benedict:null']);
  assert.deepEqual(w.wishes.map((x) => x.title), ['Light-up sneakers']);
  assert.equal(w.wishes[0].approved, false);

  // The kid sees it went to their wishlist; asking again says it's already there.
  let mine = (await call(tablet, 'GET', `${base}/kids/${ava.id}/helpdesk`)).body as { id: string; status: string; closeNote: string | null }[];
  assert.equal(mine.find((r) => r.id === sneakers.id)!.status, 'wishlist');
  assert.equal(mine.find((r) => r.id === sneakers.id)!.closeNote, "On Ava's birthday");
  const again = (await call(tablet, 'POST', `${base}/kids/${ava.id}/helpdesk`, { kind: 'wish', text: 'light-up SNEAKERS' })).body;
  assert.equal(again.status, 'already');

  // Wishes is down: it waits here and goes on the next sync.
  w.setDown(true);
  const lego = (await call(tablet, 'POST', `${base}/kids/${ava.id}/helpdesk`, { kind: 'wish', text: 'Lego set' })).body;
  assert.equal(lego.status, 'waiting');
  assert.equal(lego.toWishes, true);
  w.setDown(false);
  await syncWishes(db, homeId, true);
  mine = (await call(tablet, 'GET', `${base}/kids/${ava.id}/helpdesk`)).body;
  assert.equal(mine.find((r) => r.id === lego.id)!.status, 'wishlist');

  // Ben isn't matched, and Wishes doesn't know a Benedict: it stays on the Helpdesk and a grown-up sees why.
  await asKid(ben);
  const bike = (await call(tablet, 'POST', `${base}/kids/${ben.id}/helpdesk`, { kind: 'wish', text: 'Bike' })).body;
  assert.equal(bike.status, 'waiting');
  const why = async () => ((await call(mom, 'GET', `${base}/helpdesk`)).body as { id: string; wishesError: string | null }[]).find((r) => r.id === bike.id)!.wishesError;
  assert.equal(await why(), 'No such kid');
  // Matched to Benny, who has no list yet: tried again, still a reason to show.
  await call(mom, 'PUT', `${base}/kids/${ben.id}/wishes`, { profileId: 3 });
  assert.equal(await why(), 'Benny has no list yet');
  // Matching Ben to Ava's profile (say that's right) sends it again.
  assert.equal((await call(mom, 'PUT', `${base}/kids/${ben.id}/wishes`, { profileId: 2 })).status, 200);
  assert.equal(w.wishes.at(-1)!.title, 'Bike');
  assert.deepEqual((await call(mom, 'GET', `${base}/helpdesk`)).body, []);

  // Other picks never go to Wishes.
  await call(tablet, 'POST', `${base}/kids/${ben.id}/helpdesk`, { kind: 'clothes', text: 'Shoes' });
  assert.ok(!w.wishes.some((x) => x.title === 'Shoes'));
});
