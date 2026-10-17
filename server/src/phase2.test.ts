// Penalties, bonus chores, kanban, streaks, levels, achievements, quick rewards, reward votes and stats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-p2-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const c = await import('./chores.ts');
const p = await import('./progress.ts');
const { levelFor } = await import('../../shared/progress.ts');

const MOM = { userId: null, name: 'Mom' };

function unit() {
  const db = openMemoryDb();
  db.prepare("INSERT INTO homes (id, name, join_code, timezone) VALUES ('h', 'Den', 'JOIN1234', 'UTC')").run();
  for (const id of ['ava', 'ben']) db.prepare("INSERT INTO members (id, home_id, role, name) VALUES (?, 'h', 'kid', ?)").run(id, id.toUpperCase());
  const chore = (id: string, opts: { bonus?: boolean; limit?: 'each' | 'one'; kids?: string[]; points?: number; start?: string } = {}) => {
    db.prepare(`INSERT INTO chores (id, home_id, title, icon, points, schedule, start_date, bonus, claim_limit)
      VALUES (?, 'h', ?, '⭐', ?, 'daily', ?, ?, ?)`).run(id, id, opts.points ?? 5, opts.start ?? '2026-10-01', opts.bonus ? 1 : 0, opts.limit ?? 'each');
    for (const k of opts.kids ?? ['ava']) db.prepare('INSERT INTO chore_assignments (chore_id, member_id) VALUES (?, ?)').run(id, k);
  };
  return { db, chore };
}

test('penalties stop at zero unless the home allows going below', () => {
  const { db } = unit();
  const home = { id: 'h', allowNegative: false };
  assert.throws(() => c.penalize(db, home, 'ava', 3, 'Left bike in the rain', MOM, '2026-10-14'), /no points to take/);
  c.writeLedger(db, { homeId: 'h', memberId: 'ava', amount: 5, kind: 'bonus', reason: 'Bonus', date: '2026-10-14', by: MOM });
  const r = c.penalize(db, home, 'ava', 8, 'Left bike in the rain', MOM, '2026-10-14');
  assert.deepEqual(r, { taken: 5, balance: 0 }, 'only what was there');
  assert.equal(c.balance(db, 'ava'), 0);
  const neg = c.penalize(db, { id: 'h', allowNegative: true }, 'ava', 2, 'Again', MOM, '2026-10-14');
  assert.equal(neg.balance, -2);
  const last = c.ledger(db, 'ava', 1)[0];
  assert.equal(last.kind, 'adjust');
  assert.equal(last.reason, 'Again');
  assert.throws(() => c.penalize(db, home, 'ava', 0, 'x', MOM, '2026-10-14'), /at least 1/);
});

test('bonus chores are opt-in, can be first-come, and pay like any chore', () => {
  const { db, chore } = unit();
  const today = '2026-10-14';
  chore('car', { bonus: true, limit: 'one', kids: [], points: 10 }); // open to every kid, one spot a day
  chore('weeds', { bonus: true, kids: ['ben'], points: 4 });
  c.materialize(db, 'h', '2026-10-01', today, today);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM chore_instances').get() as { n: number }).n, 0, 'nothing is handed out');
  assert.deepEqual(c.bonusOffers(db, 'h', 'ava', today).map((o) => o.choreId), ['car']);
  assert.deepEqual(c.bonusOffers(db, 'h', 'ben', today).map((o) => o.choreId).sort(), ['car', 'weeds']);

  const claimed = c.claimBonus(db, 'h', 'car', 'ava', today);
  assert.equal(claimed.status, 'pending');
  assert.equal(c.claimBonus(db, 'h', 'car', 'ava', today).id, claimed.id, 'claiming twice is harmless');
  assert.throws(() => c.claimBonus(db, 'h', 'car', 'ben', today), /AVA already took/);
  assert.equal(c.bonusOffers(db, 'h', 'ben', today).find((o) => o.choreId === 'car')!.takenBy, 'AVA');
  assert.throws(() => c.claimBonus(db, 'h', 'weeds', 'ava', today), /isn't available/);
  assert.ok(c.todayList(db, 'h', 'ava', today).some((i) => i.id === claimed.id), 'claimed bonus shows up today');

  c.unclaimBonus(db, 'h', claimed.id!);
  assert.equal(c.bonusOffers(db, 'h', 'ben', today).find((o) => o.choreId === 'car')!.takenBy, null, 'the spot opens up again');
  const benCar = c.claimBonus(db, 'h', 'car', 'ben', today);
  c.submitInstance(db, 'h', benCar.id!, today);
  assert.throws(() => c.unclaimBonus(db, 'h', benCar.id!), /already marked done/);
  assert.equal(c.approveInstance(db, 'h', benCar.id!, MOM).awarded, 10);
  const bonusBadge = p.achievements(db, 'ben', today).find((a) => a.id === 'first-bonus')!;
  assert.equal(bonusBadge.earned, true);
  // Bonus chores never show up as "planned" on future days.
  const week = c.agenda(db, 'h', ['ava', 'ben'], today, 3, today);
  assert.ok(week.slice(1).every((d) => d.items.length === 0));
});

test('kanban: to do, doing, waiting, done', () => {
  const { db, chore } = unit();
  const today = '2026-10-14';
  chore('bed');
  const [item] = c.todayList(db, 'h', 'ava', today);
  assert.equal(item.started, false);
  assert.equal(c.setStarted(db, 'h', item.id!, true, today).started, true);
  assert.equal(c.setStarted(db, 'h', item.id!, false, today).started, false, 'back to to-do');
  c.setStarted(db, 'h', item.id!, true, today);
  c.submitInstance(db, 'h', item.id!, today);
  assert.throws(() => c.setStarted(db, 'h', item.id!, false, today), /already marked done/);
  assert.equal(c.unsubmitInstance(db, 'h', item.id!).started, true, 'taking back a tap returns it to Doing');
});

test('streaks count complete days, skip empty days and forgive an unfinished today', () => {
  const { db, chore } = unit();
  chore('bed', { start: '2026-10-08' });
  const today = '2026-10-14';
  c.materialize(db, 'h', '2026-10-08', today, today);
  const approve = (date: string) => {
    const r = db.prepare("SELECT id FROM chore_instances WHERE member_id = 'ava' AND date = ?").get(date) as { id: string };
    c.approveInstance(db, 'h', r.id, MOM);
  };
  for (const d of ['2026-10-08', '2026-10-09', '2026-10-10']) approve(d);
  // The 11th is missed. 12th and 13th done, today still to do.
  for (const d of ['2026-10-12', '2026-10-13']) approve(d);
  assert.deepEqual(p.streaks(db, 'ava', today), { current: 2, best: 3 });
  approve(today);
  assert.deepEqual(p.streaks(db, 'ava', today), { current: 3, best: 3 });
  // A day with nothing due doesn't break it.
  db.prepare("DELETE FROM chore_instances WHERE date = '2026-10-11'").run();
  assert.deepEqual(p.streaks(db, 'ava', today), { current: 6, best: 6 });
  assert.equal(p.achievements(db, 'ava', today).find((a) => a.id === 'streak-3')!.earned, true);
});

test('raccoon levels come from lifetime points and redeemed goals', () => {
  assert.equal(levelFor(0).name, 'Kit');
  assert.equal(levelFor(49).level, 1);
  assert.equal(levelFor(50).name, 'Scout');
  assert.equal(levelFor(100).percent, 50);
  assert.equal(levelFor(5000).name, 'Legend');
  assert.equal(levelFor(5000).next, null);
  const { db } = unit();
  c.writeLedger(db, { homeId: 'h', memberId: 'ava', amount: 40, kind: 'chore', reason: 'x', date: '2026-10-14', by: MOM });
  c.writeLedger(db, { homeId: 'h', memberId: 'ava', amount: -30, kind: 'adjust', reason: 'penalty', date: '2026-10-14', by: MOM });
  assert.equal(p.levelOf(db, 'ava').points, 40, 'penalties and spending never lower your level');
  db.prepare("INSERT INTO goals (id, home_id, member_id, title, target_points, status) VALUES ('g', 'h', 'ava', 'Zoo', 5, 'redeemed')").run();
  assert.equal(p.levelOf(db, 'ava').name, 'Scout', '40 + 20 for the goal');
});

// ---------- through the API ----------

type Jar = Record<string, string>;

async function family() {
  const app = await buildApp(openMemoryDb(), { serveWeb: false });
  const call = async (jar: Jar, method: string, url: string, payload?: unknown) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: cookie ? { cookie } : {} });
    for (const ck of res.cookies) { if (ck.value) jar[ck.name] = ck.value; else delete jar[ck.name]; }
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  const mom: Jar = {};
  await call(mom, 'POST', '/api/auth/local', { name: 'Mom' });
  const { body: home } = await call(mom, 'POST', '/api/homes', { name: 'Den', timezone: 'UTC' });
  const base = `/api/homes/${home.id}`;
  const ava = (await call(mom, 'POST', `${base}/kids`, { name: 'Ava' })).body;
  const ben = (await call(mom, 'POST', `${base}/kids`, { name: 'Ben' })).body;
  const tablet: Jar = {};
  const { body: code } = await call(mom, 'POST', '/api/auth/pair-code', { kind: 'device', homeId: home.id });
  await call(tablet, 'POST', '/api/auth/pair', { code: code.code });
  const asKid = async (kid: { id: string }) => {
    await call(tablet, 'POST', '/api/kiosk/kid/logout', {});
    await call(tablet, 'POST', '/api/kiosk/kid', { memberId: kid.id });
  };
  return { call, mom, base, ava, ben, tablet, asKid };
}

test('quick rewards, kindly penalties and the zero floor through the API', async () => {
  const { call, mom, base, ava, tablet, asKid } = await family();
  const quick = (await call(mom, 'GET', `${base}/quick-rewards`)).body;
  assert.equal(quick.length, 4, 'new homes start with a few');
  const give = await call(mom, 'POST', `${base}/quick-rewards/${quick[1].id}/give`, { memberId: ava.id });
  assert.equal(give.body.awarded, 3);
  assert.equal((await call(mom, 'POST', `${base}/kids/${ava.id}/penalty`, { points: 2 })).status, 400, 'a reason is required');
  const pen = await call(mom, 'POST', `${base}/kids/${ava.id}/penalty`, { points: 10, reason: 'Hit your brother' });
  assert.deepEqual(pen.body, { taken: 3, balance: 0 });
  assert.equal((await call(mom, 'POST', `${base}/kids/${ava.id}/points`, { amount: -1 })).status, 400, 'the old take-back follows the floor too');
  await call(mom, 'PATCH', base, { allowNegative: true });
  assert.equal((await call(mom, 'POST', `${base}/kids/${ava.id}/points`, { amount: -1, reason: 'Oops' })).body.balance, -1);

  await asKid(ava);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/penalty`, { points: 1, reason: 'x' })).status, 403);
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.deepEqual(board.recent.map((e: { reason: string }) => e.reason), ['Oops', 'Hit your brother', '🤝 Helped someone']);
});

test('bonus chores and kanban through the API, kid by kid', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  const bonus = (await call(mom, 'POST', `${base}/chores`, { title: 'Wash the car', icon: '🚗', points: 10, bonus: true, claimLimit: 'one', memberIds: [] })).body;
  assert.equal(bonus.bonus, true);
  await call(mom, 'POST', `${base}/chores`, { title: 'Bed', points: 1, memberIds: [ava.id, ben.id] });
  await asKid(ava);
  let board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(board.todayItems.length, 1);
  assert.equal(board.bonus[0].title, 'Wash the car');
  const claim = await call(tablet, 'POST', `${base}/chores/${bonus.id}/claim`, {});
  assert.equal(claim.status, 200);
  const bed = board.todayItems[0];
  assert.equal((await call(tablet, 'POST', `${base}/instances/${bed.id}/start`, {})).body.item.started, true);
  await asKid(ben);
  assert.equal((await call(tablet, 'POST', `${base}/chores/${bonus.id}/claim`, {})).status, 409);
  assert.equal((await call(tablet, 'POST', `${base}/instances/${bed.id}/start`, {})).status, 403, "can't move a sibling's card");
  // Parents can sign a kid up too.
  await call(mom, 'DELETE', `${base}/chores/${bonus.id}`);
  board = (await call(mom, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(board.bonus.length, 0);
});

test('reward votes: parents propose, kids vote in secret, parents pick', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  assert.equal((await call(mom, 'POST', `${base}/polls`, { title: 'Weekend treat?', options: [{ title: 'Pizza' }] })).status, 400);
  const poll = (await call(mom, 'POST', `${base}/polls`, { title: 'Weekend treat?', options: [{ title: 'Pizza', icon: '🍕' }, { title: 'Movie', icon: '🎬' }] })).body;
  const [pizza, movie] = poll.options;
  assert.equal((await call(tablet, 'POST', `${base}/polls/${poll.id}/vote`, { optionId: pizza.id })).status, 403, 'the tablet alone has no vote');
  await asKid(ava);
  const voted = (await call(tablet, 'POST', `${base}/polls/${poll.id}/vote`, { optionId: pizza.id })).body;
  assert.equal(voted.myVote, pizza.id);
  assert.equal(voted.options[0].votes, null, 'kids do not see counts while voting is open');
  await call(tablet, 'POST', `${base}/polls/${poll.id}/vote`, { optionId: movie.id });
  await asKid(ben);
  await call(tablet, 'POST', `${base}/polls/${poll.id}/vote`, { optionId: movie.id });
  const parentView = (await call(mom, 'GET', `${base}/polls`)).body[0];
  assert.deepEqual(parentView.options.map((o: { votes: number }) => o.votes), [0, 2], 'changing your vote replaces it');
  assert.deepEqual(parentView.options[1].voters.sort(), ['Ava', 'Ben']);
  await call(mom, 'POST', `${base}/polls/${poll.id}/pick`, { optionId: movie.id });
  assert.equal((await call(tablet, 'POST', `${base}/polls/${poll.id}/vote`, { optionId: pizza.id })).status, 400);
  const kidView = (await call(tablet, 'GET', `${base}/polls`)).body[0];
  assert.equal(kidView.winnerOptionId, movie.id);
  assert.equal(kidView.options[1].votes, 2, 'results are revealed once it is closed');
});

test('levels unlock avatars kids can pick themselves; stats add up', async () => {
  const { call, mom, base, ava, tablet, asKid } = await family();
  await asKid(ava);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/avatar`, { avatar: 'wizard' })).status, 403);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/avatar`, { avatar: 'crown' })).body.avatar, 'crown');
  assert.equal((await call(mom, 'POST', `${base}/kids/${ava.id}/avatar`, { avatar: 'wizard' })).body.avatar, 'wizard', 'parents can pick anything');
  await call(mom, 'POST', `${base}/kids/${ava.id}/points`, { amount: 160, reason: 'Big help' });
  let board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(board.level.name, 'Sneak');
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ava.id}/avatar`, { avatar: 'pirate' })).body.avatar, 'pirate', 'level 3 unlocks the pirate');

  const chore = (await call(mom, 'POST', `${base}/chores`, { title: 'Bed', points: 4, memberIds: [ava.id] })).body;
  board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  await call(mom, 'POST', `${base}/instances/${board.todayItems[0].id}/approve`, {});
  const stats = (await call(mom, 'GET', `${base}/stats?weeks=4`)).body;
  const s = stats.kids.find((k: { id: string }) => k.id === ava.id);
  assert.equal(s.weekly.length >= 4, true);
  const thisWeek = s.weekly.at(-1);
  assert.deepEqual([thisWeek.points, thisWeek.done, thisWeek.due], [164, 1, 1]);
  assert.equal(s.byChore[0].title, 'Bed');
  assert.equal(s.streak.current, 1);
  assert.equal(s.daily.at(-1).points, 164);
  assert.ok(chore.id);
  assert.equal((await call(tablet, 'GET', `${base}/stats`)).status, 403, 'the whole-family stats are for parents');
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ava.id}/stats`)).status, 200, 'kids can see their own');
});
