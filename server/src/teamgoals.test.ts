import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';

test('family team goals: everyone’s earned points fill one shared goal, without spending any', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  // Points from before the goal was set don't count.
  await call(mom, 'POST', `${base}/kids/${ava.id}/points`, { amount: 50, reason: 'Before' });
  await new Promise((r) => setTimeout(r, 1100));

  await asKid(ava);
  assert.equal((await call(tablet, 'POST', `${base}/team-goals`, { title: 'Zoo', target: 10 })).status, 403);
  const zoo = (await call(mom, 'POST', `${base}/team-goals`, { title: 'Trip to the zoo', icon: '🦁', target: 30, reward: 'Saturday at the zoo' })).body;
  assert.equal(zoo.progress, 0);
  assert.equal(zoo.contributions.length, 2);

  await call(mom, 'POST', `${base}/kids/${ava.id}/points`, { amount: 12, reason: 'Dishes' });
  await call(mom, 'POST', `${base}/kids/${ben.id}/points`, { amount: 8, reason: 'Trash' });
  // A take-away doesn't set the family back.
  await call(mom, 'POST', `${base}/kids/${ben.id}/points`, { amount: -5, reason: 'Teasing' });
  let [g] = (await call(tablet, 'GET', `${base}/team-goals`)).body;
  assert.equal(g.progress, 20);
  assert.deepEqual(g.contributions.map((c: { name: string; points: number }) => [c.name, c.points]), [['Avaleigh', 12], ['Benedict', 8]]);
  assert.equal(g.reached, false);
  assert.equal((await call(mom, 'POST', `${base}/team-goals/${zoo.id}/done`)).status, 400, 'not there yet');

  await call(mom, 'POST', `${base}/kids/${ben.id}/points`, { amount: 10, reason: 'Yard' });
  [g] = (await call(mom, 'GET', `${base}/team-goals`)).body;
  assert.equal(g.reached, true);
  assert.ok(g.reachedAt);
  assert.equal(g.percent, 100);
  // Nobody's balance was spent.
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/ledger`)).body.balance, 62);
  const events = (await call(mom, 'GET', `${base}/ha/events`)).body as { event: string }[];
  assert.equal(events.filter((e) => e.event === 'team_goal_reached').length, 1);

  const done = (await call(mom, 'POST', `${base}/team-goals/${zoo.id}/done`)).body;
  assert.equal(done.status, 'done');
  for (let i = 0; i < 3; i++) assert.equal((await call(mom, 'POST', `${base}/team-goals`, { title: `G${i}`, target: 5 })).status, 200);
  assert.equal((await call(mom, 'POST', `${base}/team-goals`, { title: 'Too many', target: 5 })).status, 400);
});
