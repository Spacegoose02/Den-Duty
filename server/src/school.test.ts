import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family, fakeClaude, type Sent } from './test-helpers.ts';
import { addDays } from '../../shared/schedule.ts';
import { nextBox, nextDue, pickReview, trickFor, splitFor, storyFor, familySentences, parseFact, factsFor, DEFAULT_PLAN } from '../../shared/mathfacts.ts';
import { dueState, schoolKindOf, subjectOf } from '../../shared/school.ts';

test('school work: parents add homework, tests and projects; kids tick them off; points wait for a grown-up', async () => {
  const { call, mom, base, ava, ben, tablet, asKid, today, db } = await family();
  const hw = (await call(mom, 'POST', `${base}/kids/${ben.id}/school`, { kind: 'homework', title: 'Math worksheet', subject: 'Math', dueDate: addDays(today, 1), points: 3 })).body;
  assert.equal(hw.state, 'tomorrow');
  assert.equal((await call(mom, 'POST', `${base}/kids/${ben.id}/school`, { kind: 'essay', title: 'x', dueDate: today })).status, 400);
  assert.equal((await call(mom, 'POST', `${base}/kids/${ben.id}/school`, { kind: 'test', title: 'x' })).status, 400);
  const proj = (await call(mom, 'POST', `${base}/kids/${ben.id}/school`, { kind: 'project', title: 'Volcano', dueDate: addDays(today, 10), steps: ['Pick a volcano', 'Build it', 'Poster'] })).body;
  assert.equal(proj.steps.length, 3);
  const quiz = (await call(mom, 'POST', `${base}/kids/${ben.id}/school`, { kind: 'test', title: 'Spelling quiz', dueDate: today })).body;

  // Kids can't add or see someone else's.
  await asKid(ava);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ben.id}/school`, { kind: 'homework', title: 'x', dueDate: today })).status, 403);
  assert.equal((await call(tablet, 'POST', `${base}/school/${hw.id}/done`)).status, 403);

  await asKid(ben);
  const mine = (await call(tablet, 'GET', `${base}/kids/${ben.id}/school`)).body;
  assert.deepEqual(mine.items.map((i: { title: string }) => i.title), ['Spelling quiz', 'Math worksheet', 'Volcano']);
  // Homework with points waits; a step and a study day are the kid's own.
  const d = (await call(tablet, 'POST', `${base}/school/${hw.id}/done`)).body;
  assert.equal(d.item.status, 'waiting');
  assert.equal(d.paid, 0);
  assert.equal((await call(tablet, 'POST', `${base}/school/${proj.id}/steps/1`, { done: true })).body.stepsDone, 1);
  assert.deepEqual((await call(tablet, 'POST', `${base}/school/${quiz.id}/studied`)).body.studied, [today]);
  // A project with no points is done straight away.
  assert.equal((await call(tablet, 'POST', `${base}/school/${proj.id}/done`)).body.item.status, 'done');
  assert.equal((await call(tablet, 'POST', `${base}/school/${proj.id}/undo`)).status, 403, 'only a grown-up reopens finished work');

  // The parent home lists what's waiting; approving pays once.
  const home = (await call(mom, 'GET', `${base}/school`)).body;
  assert.ok(home.some((s: { id: string; status: string }) => s.id === hw.id && s.status === 'waiting'));
  assert.equal((await call(tablet, 'POST', `${base}/school/${hw.id}/approve`)).status, 403);
  assert.equal((await call(mom, 'POST', `${base}/school/${hw.id}/approve`)).body.paid, 3);
  assert.equal((await call(mom, 'POST', `${base}/school/${hw.id}/approve`)).status, 400);
  const bal = () => (db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM points_ledger WHERE member_id = ?').get(ben.id) as { n: number }).n;
  assert.equal(bal(), 3);
  // A parent's undo takes the points back.
  await call(mom, 'POST', `${base}/school/${hw.id}/undo`);
  assert.equal(bal(), 0);
  // Score after a test.
  assert.equal((await call(mom, 'PATCH', `${base}/school/${quiz.id}`, { score: '18/20' })).body.score, '18/20');

  // On the calendar on its due day, for the kid and the parents.
  const cal = (await call(tablet, 'GET', `${base}/agenda?start=${today}&days=2`)).body;
  assert.deepEqual(cal.days[1].school.map((s: { title: string }) => s.title), ['Math worksheet']);
  // Switched off: the kid's board and calendar show none.
  await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { pagesOff: ['school'] });
  assert.deepEqual((await call(tablet, 'GET', `${base}/kids/${ben.id}/school`)).body.items, []);
  assert.deepEqual((await call(tablet, 'GET', `${base}/agenda?start=${today}&days=2`)).body.days[1].school, []);
  assert.equal((await call(mom, 'GET', `${base}/agenda?start=${today}&days=2`)).body.days[1].school.length, 1);
});

test('school work: a "Math Test" on the calendar becomes a test and shows once', async () => {
  const { call, mom, base, ben, today } = await family();
  const ev = (await call(mom, 'POST', `${base}/events`, { title: 'Science SOL', date: addDays(today, 3), memberIds: [ben.id] })).body;
  await call(mom, 'POST', `${base}/events`, { title: 'Soccer practice', date: addDays(today, 3), memberIds: [ben.id] });
  const s = (await call(mom, 'GET', `${base}/kids/${ben.id}/school`)).body.suggestions;
  assert.deepEqual(s.map((x: { title: string; kind: string; subject: string }) => [x.title, x.kind, x.subject]), [['Science SOL', 'test', 'Science']]);
  const made = (await call(mom, 'POST', `${base}/kids/${ben.id}/school`, { eventId: ev.id ?? ev.event?.id })).body;
  assert.equal(made.kind, 'test');
  assert.equal(made.dueDate, addDays(today, 3));
  assert.deepEqual((await call(mom, 'GET', `${base}/kids/${ben.id}/school`)).body.suggestions, []);
  const day = (await call(mom, 'GET', `${base}/agenda?start=${addDays(today, 3)}&days=1&kid=${ben.id}`)).body.days[0];
  assert.deepEqual(day.events.map((e: { title: string }) => e.title), ['Soccer practice']);
  assert.deepEqual(day.school.map((e: { title: string }) => e.title), ['Science SOL']);
});

test('math facts: spaced review, exploring, points once a day, and Rocky', async () => {
  const { call, mom, base, ben, ava, tablet, asKid, db } = await family();
  // No plan: nothing to review.
  await asKid(ben);
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ben.id}/math`)).body.plan, null);
  assert.equal((await call(tablet, 'PUT', `${base}/kids/${ben.id}/math/plan`, { tables: [6] })).status, 403);
  const v = (await call(mom, 'PUT', `${base}/kids/${ben.id}/math/plan`, { tables: [6, 7], ops: ['x', '/'], perDay: 5, points: 2 })).body;
  assert.equal(v.total, 40);
  assert.equal(v.review.length, 4, 'four new facts a day at most');

  const card = v.review[0];
  const key = `${card.a}${card.op}${card.b}`;
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ben.id}/math/answer`, { fact: key, result: 'wrong' })).body.right, false);
  // A second try the same day doesn't move the box.
  await call(tablet, 'POST', `${base}/kids/${ben.id}/math/answer`, { fact: key, result: 'right' });
  const st = db.prepare('SELECT box, wrong_count, right_count FROM math_facts WHERE member_id = ? AND fact = ?').get(ben.id, key) as { box: number; wrong_count: number };
  assert.equal(st.box, 0);
  assert.equal(st.wrong_count, 1);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ben.id}/math/answer`, { fact: '7x99', result: 'right' })).status, 400);

  // Not enough yet for points; two more cards and it pays, once.
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ben.id}/math/finish`)).body.paid, 0);
  for (const f of v.review.slice(1, 3)) await call(tablet, 'POST', `${base}/kids/${ben.id}/math/answer`, { fact: `${f.a}${f.op}${f.b}`, result: 'right' });
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ben.id}/math/finish`)).body.paid, 2);
  const after = (await call(tablet, 'POST', `${base}/kids/${ben.id}/math/finish`)).body;
  assert.equal(after.paid, 0);
  assert.equal(after.view.answeredToday, 3);
  assert.equal(after.view.review.length, 1, 'answered cards drop off today\'s list');
  assert.equal(after.view.tricky[0].fact, key);

  // Exploring: which way helped is counted for the parent.
  await call(tablet, 'POST', `${base}/kids/${ben.id}/math/explore`, { fact: '6x8', way: 'array', feel: 'got' });
  await call(tablet, 'POST', `${base}/kids/${ben.id}/math/explore`, { fact: '7x8', way: 'trick', feel: 'tricky' });
  const pv = (await call(mom, 'GET', `${base}/kids/${ben.id}/math`)).body;
  assert.deepEqual(pv.helped.map((h: { way: string }) => h.way).sort(), ['array', 'trick']);
  assert.equal(pv.week.explored, 2);

  // Ava can't use Ben's; switched off for Ben, he can't either.
  await asKid(ava);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ben.id}/math/answer`, { fact: key, result: 'right' })).status, 403);
  await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { pagesOff: ['math'] });
  await asKid(ben);
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ben.id}/math`)).body, null);
  await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { pagesOff: [] });

  // Rocky: only the fact, the age and the ways tried go out, never the name.
  const sent: Sent[] = [];
  fakeClaude(sent, () => ({ explanation: ['Think of 8 spiders.', 'Each has 6... no wait, 8 legs!'], picture: '🕷️🕷️', memoryHook: '7 × 8 = 56' }));
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ben.id}/math/explain`, { fact: '7x8' })).status, 403, 'AI is off by default');
  await call(mom, 'PATCH', `${base}/ai`, { apiKey: 'sk-ant-test-key-123456', enabled: true });
  const r = await call(tablet, 'POST', `${base}/kids/${ben.id}/math/explain`, { fact: '7x8', tried: ['array', 'bogus'] });
  assert.equal(r.status, 200);
  assert.equal(r.body.explanation.length, 2);
  const prompt = JSON.stringify(sent.at(-1)!.body.messages);
  assert.ok(prompt.includes('7 × 8 = 56') && prompt.includes('array') && !prompt.includes('bogus') && !prompt.includes('Benedict'));
});

test('math facts: tricks, splits, stories and review order', () => {
  assert.deepEqual(parseFact('24/6'), { a: 24, op: '/', b: 6 });
  assert.equal(parseFact('25/6'), null);
  assert.equal(parseFact('13x2'), null);
  assert.deepEqual(familySentences({ op: 'x', a: 6, b: 4 }), ['6 × 4 = 24', '4 × 6 = 24', '24 ÷ 6 = 4', '24 ÷ 4 = 6']);
  assert.ok(trickFor({ op: 'x', a: 9, b: 7 }).some((t) => t.title.includes('9s') && t.lines.join(' ').includes('63')));
  assert.ok(trickFor({ op: 'x', a: 8, b: 6 }).some((t) => t.lines[0].includes('48')), 'the 6 × 8 rhyme');
  assert.equal(trickFor({ op: '/', a: 56, b: 8 })[0].title, 'Think times');
  assert.deepEqual(splitFor({ op: 'x', a: 7, b: 6 }).parts, [5, 2]);
  assert.equal(splitFor({ op: 'x', a: 9, b: 4 }).minus, true);
  assert.ok(storyFor({ op: '/', a: 24, b: 6 }, 'Tyler').answer.includes('= 4'));
  assert.equal(nextBox(2, 'right'), 3);
  assert.equal(nextBox(3, 'wrong'), 0);
  assert.equal(nextDue('2026-11-16', 3, 'right'), '2026-11-23');
  assert.equal(nextDue('2026-11-16', 0, 'wrong'), '2026-11-17');
  const plan = { ...DEFAULT_PLAN, tables: [6], ops: ['x' as const], perDay: 3 };
  const due = pickReview(plan, [{ fact: '6x8', box: 2, due: '2026-11-16', right: 1, wrong: 1 }, { fact: '6x7', box: 0, due: '2026-11-15', right: 0, wrong: 2 },
    { fact: '6x9', box: 3, due: '2026-12-01', right: 3, wrong: 0 }], '2026-11-16');
  assert.deepEqual(due.slice(0, 2).map((f) => `${f.a}x${f.b}`), ['6x7', '6x8'], 'shakiest due facts first');
  assert.equal(due.length, 3);
  assert.equal(factsFor([6], ['x', '/']).length, 20);
  assert.equal(dueState('2026-11-15', '2026-11-16', false), 'overdue');
  assert.equal(schoolKindOf('Colonial Virginia Test'), 'test');
  assert.equal(subjectOf('Colonial Virginia Test'), 'Social Studies');
  assert.equal(subjectOf('Language Arts Test'), 'Language Arts');
});
