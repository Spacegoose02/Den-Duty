import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';

test('rewards shop: parents stock it, kids spend points, parents hand rewards over or refund them', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  await call(mom, 'POST', `${base}/kids/${ava.id}/points`, { amount: 30, reason: 'Start' });

  // Only parents stock the shop; everyone can look.
  await asKid(ava);
  assert.equal((await call(tablet, 'POST', `${base}/shop`, { title: 'Free candy', price: 1 })).status, 403);
  assert.equal((await call(mom, 'POST', `${base}/shop`, { title: 'Ice cream', price: 0 })).status, 400);
  const icecream = (await call(mom, 'POST', `${base}/shop`, { title: 'Ice cream', icon: '🍦', price: 20 })).body;
  const movie = (await call(mom, 'POST', `${base}/shop`, { title: 'Pick the movie', icon: '🎬', price: 5, stock: 1 })).body;
  assert.equal(movie.stock, 1);
  assert.equal((await call(tablet, 'GET', `${base}/shop`)).body.length, 2);

  // Buying takes the points straight away and leaves an order waiting for a grown-up.
  const bought = await call(tablet, 'POST', `${base}/kids/${ava.id}/shop/${icecream.id}/buy`);
  assert.equal(bought.status, 200);
  assert.equal(bought.body.balance, 10);
  assert.equal(bought.body.order.status, 'waiting');
  const short = await call(tablet, 'POST', `${base}/kids/${ava.id}/shop/${icecream.id}/buy`);
  assert.equal(short.status, 400);
  assert.match(short.body.error ?? short.body.message, /10 more/);
  // Not for someone else, and not when Goals & rewards is off.
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ben.id}/shop/${movie.id}/buy`)).status, 403);

  // Limited stock runs out, and comes back with a refund.
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/shop/${movie.id}/buy`)).status, 200);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/shop/${movie.id}/buy`)).status, 400, 'sold out');

  const orders = (await call(mom, 'GET', `${base}/shop/orders`)).body as { id: string; title: string; status: string; kidName: string }[];
  assert.equal(orders.length, 2);
  assert.equal(orders[0].kidName, 'Avaleigh');
  assert.equal((await call(tablet, 'GET', `${base}/shop/orders`)).body.length, 2, 'kids see their own');
  assert.equal((await call(tablet, 'POST', `${base}/shop/orders/${orders[0].id}/given`)).status, 403);

  const ice = orders.find((o) => o.title === 'Ice cream')!;
  const film = orders.find((o) => o.title === 'Pick the movie')!;
  assert.equal((await call(mom, 'POST', `${base}/shop/orders/${ice.id}/given`)).body.status, 'given');
  assert.equal((await call(mom, 'POST', `${base}/shop/orders/${ice.id}/refund`)).status, 400, 'already handed over');
  assert.equal((await call(mom, 'POST', `${base}/shop/orders/${film.id}/refund`)).body.status, 'refunded');
  const ledger = (await call(mom, 'GET', `${base}/kids/${ava.id}/ledger`)).body;
  assert.equal(ledger.balance, 10);
  assert.equal(ledger.entries[0].reason, 'Refund: 🎬 Pick the movie');
  assert.equal((await call(mom, 'GET', `${base}/shop`)).body.find((i: { id: string }) => i.id === movie.id).stock, 1);

  // Spending and refunds don't count as points earned this week.
  const summary = (await call(mom, 'GET', `${base}/summary`)).body;
  assert.equal(summary.kids.find((k: { id: string }) => k.id === ava.id).pointsThisWeek, 30);

  const events = (await call(mom, 'GET', `${base}/ha/events`)).body as { event: string }[];
  for (const e of ['reward_bought', 'reward_given', 'reward_refunded']) assert.ok(events.some((x) => x.event === e), e);

  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { pagesOff: ['goals'] });
  assert.equal((await call(mom, 'POST', `${base}/kids/${ava.id}/shop/${icecream.id}/buy`)).status, 403);
});
