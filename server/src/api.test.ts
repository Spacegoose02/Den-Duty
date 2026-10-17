import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-test-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');

type Jar = Record<string, string>;

async function setup() {
  const app = await buildApp(openMemoryDb(), { serveWeb: false });
  /** Calls the API as a browser with its own cookie jar. */
  const call = async (jar: Jar, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { ...headers, ...(cookie ? { cookie } : {}) } });
    for (const c of res.cookies) {
      if (c.value && (c.maxAge ?? 1) > 0) jar[c.name] = c.value;
      else delete jar[c.name];
    }
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  const login = async (name: string): Promise<Jar> => {
    const jar: Jar = {};
    const res = await call(jar, 'POST', '/api/auth/local', { name });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return jar;
  };
  return { app, call, login };
}

/** A home with a parent, two kids and a paired family tablet. */
async function family() {
  const t = await setup();
  const mom = await t.login('Mom');
  const { body: home } = await t.call(mom, 'POST', '/api/homes', { name: 'Raccoon Den', timezone: 'America/New_York' });
  const base = `/api/homes/${home.id}`;
  const ava = (await t.call(mom, 'POST', `${base}/kids`, { name: 'Ava', avatar: 'crown', pin: '1234' })).body;
  const ben = (await t.call(mom, 'POST', `${base}/kids`, { name: 'Ben' })).body;
  const tablet: Jar = {};
  const { body: pair } = await t.call(mom, 'POST', '/api/auth/pair-code', { kind: 'device', homeId: home.id });
  const paired = await t.call(tablet, 'POST', '/api/auth/pair', { code: pair.code, name: 'Kitchen tablet' });
  assert.equal(paired.status, 200, JSON.stringify(paired.body));
  return { ...t, mom, home, base, ava, ben, tablet };
}

test('homes, parents and joining', async () => {
  const { login, call } = await setup();
  const alice = await login('Alice');
  const bob = await login('Bob');
  const me = await call(alice, 'GET', '/api/me');
  assert.equal(me.body.user.isAdmin, true, 'first user is admin');
  const { body: home } = await call(alice, 'POST', '/api/homes', { name: 'Den' });
  const detail = await call(alice, 'GET', `/api/homes/${home.id}`);
  assert.equal(detail.body.viewer, 'parent');
  assert.equal(detail.body.pointsName, 'Shinies');
  assert.equal(detail.body.pointsIcon, '✨');
  assert.equal((await call(bob, 'GET', `/api/homes/${home.id}`)).status, 404);
  await call(bob, 'POST', '/api/homes/join', { code: detail.body.joinCode });
  assert.equal((await call(bob, 'GET', `/api/homes/${home.id}`)).body.parents.length, 2);
  // The last parent can't leave.
  const parents = (await call(alice, 'GET', `/api/homes/${home.id}`)).body.parents as { id: string }[];
  await call(bob, 'DELETE', `/api/homes/${home.id}/parents/${parents[1].id}`);
  assert.equal((await call(alice, 'DELETE', `/api/homes/${home.id}/parents/${parents[0].id}`)).status, 400);
  // Custom points.
  await call(alice, 'PATCH', `/api/homes/${home.id}`, { pointsName: 'Acorns', pointsIcon: '🌰', weekStart: 1 });
  const after = (await call(alice, 'GET', `/api/homes/${home.id}`)).body;
  assert.deepEqual([after.pointsName, after.pointsIcon, after.weekStart], ['Acorns', '🌰', 1]);
  assert.equal((await call(alice, 'PATCH', `/api/homes/${home.id}`, { timezone: 'Mars/Olympus' })).status, 400);
});

test('kids sign in on the family tablet by tapping their avatar', async () => {
  const { call, base, ava, ben, tablet, mom } = await family();
  assert.equal(ava.hasPin, true);
  assert.equal(ava.avatar, 'crown');
  const kiosk = await call(tablet, 'GET', '/api/kiosk');
  assert.equal(kiosk.status, 200);
  assert.deepEqual(kiosk.body.kids.map((k: { name: string }) => k.name), ['Ava', 'Ben']);
  assert.ok(!('pin_hash' in kiosk.body.kids[0]), 'PINs never leave the server');

  // The tablet alone can look but not act, and it's never a parent.
  assert.equal((await call(tablet, 'GET', `${base}/review`)).status, 403);
  assert.equal((await call(tablet, 'POST', `${base}/kids`, { name: 'Sneaky' })).status, 403);

  assert.equal((await call(tablet, 'POST', '/api/kiosk/kid', { memberId: ava.id, pin: '9999' })).status, 401);
  assert.equal((await call(tablet, 'POST', '/api/kiosk/kid', { memberId: ava.id, pin: '1234' })).status, 200);
  const who = await call(tablet, 'GET', '/api/whoami');
  assert.equal(who.body.kid.name, 'Ava');
  assert.equal(who.body.user, null);

  // Kids only see their own things.
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).status, 200);
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ben.id}/board`)).status, 403);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/points`, { amount: 1000 })).status, 403);

  await call(tablet, 'POST', '/api/kiosk/kid/logout', {});
  assert.equal((await call(tablet, 'GET', '/api/whoami')).body.kid, null);
  // Ben has no PIN, so a tap is enough.
  assert.equal((await call(tablet, 'POST', '/api/kiosk/kid', { memberId: ben.id })).status, 200);

  // A kid's sign-in only works on the tablet it happened on.
  const stolen: Record<string, string> = { dn_kid: tablet.dn_kid };
  assert.equal((await call(stolen, 'GET', '/api/whoami')).body.kid, null);

  // Revoking the tablet signs everyone on it out.
  const devices = (await call(mom, 'GET', `${base}/devices`)).body;
  assert.equal(devices[0].name, 'Kitchen tablet');
  await call(mom, 'DELETE', `${base}/devices/${devices[0].id}`);
  assert.equal((await call(tablet, 'GET', '/api/kiosk')).status, 401);
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ben.id}/board`)).status, 401);
});

test('wrong PINs get locked out', async () => {
  const { call, ava, tablet } = await family();
  let last = 0;
  for (let i = 0; i < 10; i++) last = (await call(tablet, 'POST', '/api/kiosk/kid', { memberId: ava.id, pin: String(1000 + i) })).status;
  assert.equal(last, 429);
});

test('the core loop: chore, done, review, approve, points, goal', async () => {
  const { call, base, ava, ben, tablet, mom } = await family();
  const chore = await call(mom, 'POST', `${base}/chores`, { title: 'Make your bed', icon: '🛏️', points: 5, schedule: 'daily', memberIds: [ava.id, ben.id] });
  assert.equal(chore.status, 200, JSON.stringify(chore.body));
  assert.equal(chore.body.describe, 'Every day');
  assert.equal((await call(mom, 'POST', `${base}/chores`, { title: 'Bad', schedule: 'weekly', weekdays: [], memberIds: [ava.id] })).status, 400);
  assert.equal((await call(mom, 'POST', `${base}/chores`, { title: 'Bad', memberIds: ['someone-else'] })).status, 400);
  const goal = await call(mom, 'POST', `${base}/kids/${ava.id}/goals`, { title: 'Ice cream trip', targetPoints: 10, reward: 'Two scoops' });
  assert.equal(goal.body.progress, 0);

  await call(tablet, 'POST', '/api/kiosk/kid', { memberId: ava.id, pin: '1234' });
  let board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(board.week.length, 7);
  assert.equal(board.todayItems.length, 1);
  const item = board.todayItems[0];
  assert.equal(item.status, 'pending');

  // Ava can't tick off Ben's chore.
  const bensItem = (await call(mom, 'GET', `${base}/kids/${ben.id}/board`)).body.todayItems[0];
  assert.equal((await call(tablet, 'POST', `${base}/instances/${bensItem.id}/done`, {})).status, 403);

  const done = await call(tablet, 'POST', `${base}/instances/${item.id}/done`, {});
  assert.equal(done.body.item.status, 'submitted');
  assert.equal(done.body.awarded, 0);
  assert.equal((await call(tablet, 'POST', `${base}/instances/${item.id}/approve`, {})).status, 403, 'kids cannot approve');

  const queue = (await call(mom, 'GET', `${base}/review`)).body;
  assert.equal(queue.length, 1);
  assert.equal(queue[0].kid.name, 'Ava');
  const approved = await call(mom, 'POST', `${base}/instances/${item.id}/approve`, {});
  assert.equal(approved.body.awarded, 5);
  assert.equal((await call(mom, 'GET', `${base}/review`)).body.length, 0);

  board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(board.kid.balance, 5);
  assert.equal(board.stats.pointsThisWeek, 5);
  assert.equal(board.stats.choresDone, 1);
  assert.equal(board.goals[0].progress, 5);
  assert.equal(board.goals[0].percent, 50);

  const ledger = (await call(tablet, 'GET', `${base}/kids/${ava.id}/ledger`)).body;
  assert.equal(ledger.balance, 5);
  assert.equal(ledger.entries[0].reason, 'Make your bed');
  assert.equal(ledger.entries[0].by, 'Mom');

  // A parent's own tick counts straight away; a bonus tops Ava up to her goal.
  const momDone = await call(mom, 'POST', `${base}/instances/${bensItem.id}/done`, {});
  assert.equal(momDone.body.item.status, 'approved');
  await call(mom, 'POST', `${base}/kids/${ava.id}/points`, { amount: 5, reason: 'Helped with groceries' });
  const summary = (await call(mom, 'GET', `${base}/summary`)).body;
  const avaSum = summary.kids.find((k: { name: string }) => k.name === 'Ava');
  assert.equal(avaSum.pointsThisWeek, 10);
  assert.equal(avaSum.goals[0].reached, true);
  assert.equal(summary.kids.find((k: { name: string }) => k.name === 'Ben').choresDone, 1);

  const redeemed = await call(mom, 'POST', `${base}/goals/${goal.body.id}/redeem`, {});
  assert.equal(redeemed.body.status, 'redeemed');
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/ledger`)).body.balance, 0);

  // Rejection sends it back with a note and no points.
  await call(mom, 'POST', `${base}/instances/${item.id}/undo`, {});
  const rejected = await call(mom, 'POST', `${base}/instances/${item.id}/reject`, { note: 'Try again please' });
  assert.equal(rejected.body.item.status, 'rejected');
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/ledger`)).body.balance, -5, 'the reversal shows the take-back honestly');
});

test('home assistant tokens can read the summary but not change anything', async () => {
  const { call, base, mom, ava } = await family();
  await call(mom, 'POST', `${base}/chores`, { title: 'Feed the cat', icon: '🐱', points: 2, schedule: 'daily', memberIds: [ava.id] });
  const { body: tok } = await call(mom, 'POST', `${base}/tokens`, { name: 'Home Assistant' });
  const ha = await call({}, 'GET', `${base}/ha/summary`, undefined, { authorization: `Bearer ${tok.token}` });
  assert.equal(ha.status, 200);
  assert.equal(ha.body.points_name, 'Shinies');
  assert.equal(ha.body.kids[0].left_today, 1);
  assert.equal((await call({}, 'POST', `${base}/kids`, { name: 'x' }, { authorization: `Bearer ${tok.token}` })).status, 403);
  assert.equal((await call({}, 'DELETE', base, undefined, { authorization: `Bearer ${tok.token}` })).status, 403);
});

test('pairing a parent device signs it in once', async () => {
  const { login, call } = await setup();
  const a = await login('Pairer');
  const { body } = await call(a, 'POST', '/api/auth/pair-code', {});
  const tablet: Jar = {};
  const res = await call(tablet, 'POST', '/api/auth/pair', { code: body.code.toLowerCase() });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await call(tablet, 'GET', '/api/me')).body.user.name, 'Pairer');
  assert.equal((await call({}, 'POST', '/api/auth/pair', { code: body.code })).status, 400);
});

test("only a home's parents can make a family tablet code for it", async () => {
  const { login, call } = await setup();
  const owner = await login('Owner');
  const stranger = await login('Stranger');
  const { body: home } = await call(owner, 'POST', '/api/homes', { name: 'Mine' });
  assert.equal((await call(stranger, 'POST', '/api/auth/pair-code', { kind: 'device', homeId: home.id })).status, 404);
  assert.equal((await call(owner, 'POST', '/api/auth/pair-code', { kind: 'device', homeId: home.id })).status, 200);
});
