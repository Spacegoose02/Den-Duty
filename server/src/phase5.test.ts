// Ages on kids, therapy rewards, the AI speech and OT helpers, and Parent Duty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-p5-'));

const { family, fakeClaude } = await import('./test-helpers.ts');
const { setAiFetch } = await import('./ai.ts');
type Sent = import('./test-helpers.ts').Sent;

test('kids have birthdays; age and picture mode follow, and AI ideas get the age but not the name', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  assert.equal(ava.age, 4);
  assert.equal(ava.pictureMode, true, 'four-year-olds get the picture-first board');
  assert.equal(ben.age, 9);
  assert.equal(ben.pictureMode, false);
  assert.equal((await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { birthdate: '2999-01-01' })).status, 400);
  assert.equal((await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { pictureMode: 'on' })).body.pictureMode, true, 'parents can override');
  assert.equal((await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { birthdate: '' })).body.age, null);
  await asKid(ava);
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(board.kid.pictureMode, true);

  const sent: Sent[] = [];
  fakeClaude(sent, () => ({ ideas: [{ title: 'Pick a bedtime story', points: 10, detail: 'You choose tonight' }] }));
  await call(mom, 'PATCH', `${base}/ai`, { apiKey: 'sk-ant-api03-test-key-abcdefghijklmnop', enabled: true });
  await call(mom, 'POST', `${base}/ai/ideas`, { kind: 'chore', kidId: ava.id });
  const text = JSON.stringify(sent[0].body);
  assert.ok(text.includes('about 4 years old'));
  assert.ok(!text.includes('Avaleigh'));
  setAiFetch(undefined);
});

test('therapy goals earn points through the ledger, worded kindly and privately', async () => {
  const { call, mom, base, ava, tablet, asKid } = await family();
  const t = `${base}/kids/${ava.id}/therapy`;
  assert.equal((await call(mom, 'POST', `${t}/goals`, { title: 'x', rewardStep: -1 })).status, 400);
  const goal = (await call(mom, 'POST', `${t}/goals`, { area: 'speech', title: 'Say "s" clearly', rewardStep: 2, rewardMet: 10 })).body;
  assert.deepEqual([goal.rewardStep, goal.rewardMet, goal.rewardMetPaid], [2, 10, false]);

  const practice = await call(mom, 'POST', `${t}/notes`, { goalId: goal.id, body: 'Practiced with flashcards', progress: 30 });
  assert.equal(practice.body.awarded, 2);
  assert.equal((await call(mom, 'POST', `${t}/notes`, { goalId: goal.id, body: 'Plan: try the snake game', noReward: true })).body.awarded, 0, 'saved plans are not paid');
  assert.equal((await call(mom, 'POST', `${t}/notes`, { body: 'General note' })).body.awarded, 0);

  await call(mom, 'PATCH', `${base}/therapy/goals/${goal.id}`, { status: 'met' });
  await call(mom, 'PATCH', `${base}/therapy/goals/${goal.id}`, { status: 'active' });
  const met = (await call(mom, 'PATCH', `${base}/therapy/goals/${goal.id}`, { status: 'met' })).body;
  assert.equal(met.rewardMetPaid, true);

  const ledger = (await call(mom, 'GET', `${base}/kids/${ava.id}/ledger`)).body;
  assert.equal(ledger.balance, 12, 'the met bonus is paid once');
  assert.deepEqual(ledger.entries.map((e: { reason: string }) => e.reason), ['🏆 You reached a big goal!', '🌈 Great practice!'], 'the goal stays private until shared');

  // Shared with the kid: the board shows what each practice earns, and new entries name the goal.
  const goal2 = (await call(mom, 'POST', `${t}/goals`, { area: 'feeding', title: 'Try a new food', rewardStep: 3 })).body;
  await call(mom, 'PATCH', t, { kidVisible: true });
  await call(mom, 'POST', `${t}/notes`, { goalId: goal2.id, body: 'Tried peas' });
  await asKid(ava);
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(board.therapy.goals[0].rewardStep, 3);
  assert.equal(board.recent[0].reason, '🌈 Great practice: Try a new food');
});

test('speech and OT helpers: off unless AI is on, cached per day, and only age, area and goal text are sent', async () => {
  const { call, mom, base, ava, ben, tablet, asKid } = await family();
  const t = `${base}/kids/${ava.id}/therapy`;
  await call(mom, 'POST', `${t}/goals`, { area: 'speech', title: 'Use 3-word sentences' });
  await call(mom, 'POST', `${t}/goals`, { area: 'motor', title: 'Hold a crayon with a tripod grip' });
  await call(mom, 'POST', `${t}/notes`, { body: 'Private: seemed tired after daycare' });
  await call(mom, 'POST', `${base}/kids/${ben.id}/therapy/goals`, { area: 'feeding', title: 'Try crunchy foods' });

  assert.equal((await call(mom, 'GET', `${t}/helper/speech`)).status, 403, 'off until AI is on');
  assert.deepEqual((await call(mom, 'GET', `${base}/therapy/tips`)).body, []);

  const sent: Sent[] = [];
  fakeClaude(sent, () => ({
    tip: { title: 'Bath-time narrating', activity: 'Talk about what you do in the bath. Pause so they can add a word.', minutes: 10, why: 'Builds longer phrases.' },
    goals: [{ title: 'Two-word requests at snack time', why: 'A small step toward three words' }],
  }));
  await call(mom, 'PATCH', `${base}/ai`, { apiKey: 'sk-ant-api03-test-key-abcdefghijklmnop', enabled: true });

  const tip = (await call(mom, 'GET', `${t}/helper/speech`)).body;
  assert.equal(tip.tip.title, 'Bath-time narrating');
  assert.match(tip.disclaimer, /not medical advice/i);
  assert.equal(tip.cached, false);
  const body = JSON.stringify(sent[0].body);
  assert.ok(body.includes('4 years old') && body.includes('Use 3-word sentences'));
  assert.ok(!body.includes('Avaleigh') && !body.includes('Private') && !body.includes('crayon'), 'no name, no notes, no other areas');
  assert.match(String(sent[0].body.system), /talk over with the child's speech therapist/);

  assert.equal((await call(mom, 'GET', `${t}/helper/speech`)).body.cached, true, 'the daily tip is cached');
  assert.equal(sent.length, 1);

  // The home screen gets a tip per kid per area with goals: Ava's OT (motor) tip is new, her speech tip is cached; Ben has neither.
  const tips = (await call(mom, 'GET', `${base}/therapy/tips`)).body as { kidName: string; area: string; cached: boolean }[];
  assert.deepEqual(tips.map((x) => `${x.kidName}:${x.area}:${x.cached}`).sort(), ['Avaleigh:ot:false', 'Avaleigh:speech:true']);
  assert.match(JSON.stringify(sent[1].body), /Hold a crayon/);
  assert.match(String(sent[1].body.system), /occupational therapist/);
  assert.equal((await call(mom, 'GET', `${t}/helper/speech?refresh=1`)).body.cached, false, 'parents can ask for a new one');

  await asKid(ava);
  assert.equal((await call(tablet, 'GET', `${t}/helper/speech`)).status, 403, 'kids never see the helper');
  setAiFetch(undefined);
});

test('Parent Duty: per-kid to-dos for parents, due dates on the parents\' week and calendar, never on kids\' screens', async () => {
  const { call, mom, base, ava, ben, tablet, asKid, today } = await family();
  const help = (await call(mom, 'POST', `${base}/parent-duty`, { kidId: ava.id, title: 'Help with the science project', dueDate: today })).body;
  assert.deepEqual([help.kidId, help.status, help.dueDate], [ava.id, 'todo', today]);
  await call(mom, 'POST', `${base}/parent-duty`, { kidId: ben.id, title: 'Buy new shoes' });
  await call(mom, 'POST', `${base}/parent-duty`, { title: 'Fix the closet door' });
  assert.equal((await call(mom, 'POST', `${base}/parent-duty`, { title: 'x', assigneeId: ava.id })).status, 400, 'only parents take cards');

  assert.deepEqual((await call(mom, 'GET', `${base}/parent-duty?kid=${ava.id}`)).body.map((c: { title: string }) => c.title), ['Help with the science project']);
  assert.deepEqual((await call(mom, 'GET', `${base}/parent-duty?kid=general`)).body.map((c: { title: string }) => c.title), ['Fix the closet door']);
  assert.deepEqual((await call(mom, 'GET', `${base}/honeydo`)).body.map((c: { title: string }) => c.title), ['Fix the closet door'], 'the old list still works');
  assert.equal((await call(mom, 'PATCH', `${base}/parent-duty/${help.id}`, { status: 'doing' })).body.status, 'doing');

  const week = (await call(mom, 'GET', `${base}/agenda`)).body;
  const day = week.days.find((d: { date: string }) => d.date === today);
  assert.equal(day.duty[0].title, 'Help with the science project');
  assert.equal(day.duty[0].kidName, 'Avaleigh');
  const links = (await call(mom, 'GET', `${base}/calendars`)).body;
  assert.match((await call({}, 'GET', links.home)).body, /For Avaleigh: Help with the science project/);
  assert.doesNotMatch((await call({}, 'GET', links.kids[0].url)).body, /science project/, "never in the kid's own feed");

  await asKid(ava);
  assert.equal((await call(tablet, 'GET', `${base}/parent-duty`)).status, 403, 'parents only');
  assert.equal((await call(tablet, 'GET', `${base}/agenda`)).body.days[0].duty, undefined);
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { pagesOff: ['parentduty'] });
  assert.equal((await call(mom, 'GET', `${base}/parent-duty`)).body.length, 2, "a kid's Parent Duty can be switched off too");
});

test('upgrading: kids\' room cards become Room chores, parents\' cards stay', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { MIGRATIONS } = await import('./db.ts');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const roomBoard = MIGRATIONS.findIndex((m) => m.includes('ALTER TABLE chores ADD COLUMN category'));
  for (const m of MIGRATIONS.slice(0, roomBoard)) db.exec(m);
  db.exec(`INSERT INTO homes (id, name, join_code) VALUES ('h', 'Den', 'J1');
    INSERT INTO members (id, home_id, role, name) VALUES ('k', 'h', 'kid', 'Ava');
    INSERT INTO honeydo (id, home_id, title, icon, kid_id, points, repeat_daily) VALUES ('c1', 'h', 'Make your bed', '🛏️', 'k', 2, 1);
    INSERT INTO honeydo (id, home_id, title, kid_id, points, repeat_daily) VALUES ('c2', 'h', 'Sort old toys', 'k', 0, 0);
    INSERT INTO honeydo (id, home_id, title) VALUES ('c3', 'h', 'Fix the closet door');`);
  for (const m of MIGRATIONS.slice(roomBoard)) db.exec(m);
  const chores = db.prepare('SELECT title, icon, points, schedule, category FROM chores ORDER BY title').all() as Record<string, unknown>[];
  assert.deepEqual(chores.map((c) => `${c.title}|${c.icon}|${c.points}|${c.schedule}|${c.category}`), ['Make your bed|🛏️|2|daily|room', 'Sort old toys|🧹|0|once|room']);
  assert.equal((db.prepare("SELECT member_id FROM chore_assignments WHERE chore_id = 'c1'").get() as { member_id: string }).member_id, 'k');
  assert.deepEqual((db.prepare('SELECT title FROM honeydo').all() as { title: string }[]).map((r) => r.title), ['Fix the closet door']);
});
