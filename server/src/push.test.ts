import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { checkPush, setSendPush, type PushMessage } from './push.ts';

const sub = (n: string) => ({ endpoint: `https://push.example.com/${n}`, keys: { p256dh: 'BKey', auth: 'auth' } });
const tick = () => new Promise((r) => setTimeout(r, 20));

test('push: parents hear about chores waiting; the tablet gets due-soon nudges; gone subscriptions are dropped', async () => {
  const sent: { endpoint: string; msg: PushMessage }[] = [];
  setSendPush(async (_db, s, msg) => { sent.push({ endpoint: s.endpoint, msg }); return s.endpoint.endsWith('gone') ? 410 : 201; });
  const { db, call, mom, base, ava, tablet, asKid } = await family();
  assert.ok((await call(mom, 'GET', '/api/push/key')).body.publicKey.length > 40);
  assert.equal((await call(mom, 'POST', `${base}/push`, { subscription: { endpoint: 'http://nope' } })).status, 400);
  assert.equal((await call(mom, 'POST', `${base}/push`, { subscription: sub('mom') })).body.audience, 'parents');
  assert.equal((await call(tablet, 'POST', `${base}/push`, { subscription: sub('tablet') })).body.audience, 'tablet');
  await call(mom, 'POST', `${base}/push`, { subscription: sub('gone') });

  const chore = (await call(mom, 'POST', `${base}/chores`, { title: 'Feed the fish', icon: '🐟', memberIds: [ava.id] })).body;
  await asKid(ava);
  const inst = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body.todayItems.find((i: { choreId: string }) => i.choreId === chore.id);
  await call(tablet, 'POST', `${base}/instances/${inst.id}/done`);
  await tick();
  const toMom = sent.filter((s) => s.endpoint.endsWith('mom'));
  assert.equal(toMom.length, 1);
  assert.match(toMom[0].msg.title, /Avaleigh finished Feed the fish/);
  assert.ok(!sent.some((s) => s.endpoint.endsWith('tablet')), 'kid stuff for parents stays off the tablet');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint LIKE '%gone'").get() as { n: number }).n, 0);

  // Due in 10 minutes: one nudge to the tablet, only once.
  const now = new Date();
  const soon = new Date(now.getTime() + 10 * 60e3).toISOString().slice(11, 16);
  if (soon > now.toISOString().slice(11, 16)) {
    const dog = (await call(mom, 'POST', `${base}/chores`, { title: 'Walk the dog', icon: '🐕', memberIds: [ava.id], dueTime: soon })).body;
    await call(mom, 'GET', `${base}/kids/${ava.id}/board`);
    sent.length = 0;
    checkPush(db, now);
    checkPush(db, now);
    await tick();
    const nudges = sent.filter((s) => s.msg.title.includes('Walk the dog'));
    assert.equal(nudges.length, 1);
    assert.ok(nudges[0].endpoint.endsWith('tablet'));
    assert.ok(dog.id);
  }
  // Test button and turning off.
  sent.length = 0;
  await call(mom, 'POST', `${base}/push/test`, { endpoint: sub('mom').endpoint });
  await tick();
  assert.equal(sent.length, 1);
  await call(mom, 'POST', `${base}/push/remove`, { endpoint: sub('mom').endpoint });
  assert.equal((await call(mom, 'POST', `${base}/push/test`, { endpoint: sub('mom').endpoint })).status, 404);
});
