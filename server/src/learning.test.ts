import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';
import { schoolYear } from '../../shared/learning.ts';

test('learning time: grade per kid, today\'s cards, answers by skill, points once a day', async () => {
  const { call, mom, base, ben, ava, tablet, asKid, today, db } = await family();
  // Ben is 9: by age he's in 3rd or 4th grade. Nothing is set up yet, so his board shows nothing.
  const kids = (await call(mom, 'GET', `${base}/kids`)).body as { id: string; grade: string | null; gradeSetting: string | null }[];
  const b0 = kids.find((k) => k.id === ben.id)!;
  assert.equal(b0.gradeSetting, null);
  assert.ok(['3', '4'].includes(b0.grade!), String(b0.grade));
  await asKid(ben);
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ben.id}/learn`)).body.plan, null);
  assert.equal((await call(tablet, 'PUT', `${base}/kids/${ben.id}/learn/plan`, { perDay: 3 })).status, 403);

  // A parent picks 4th grade and three questions a day.
  const v = (await call(mom, 'PUT', `${base}/kids/${ben.id}/learn/plan`, { grade: '4', perDay: 3, points: 5 })).body;
  assert.equal(v.level, '4');
  assert.equal(v.auto, false);
  assert.equal(v.cards.length, 3);
  assert.ok(v.subjects.includes('social'));
  assert.equal((db.prepare('SELECT grade_year FROM members WHERE id = ?').get(ben.id) as { grade_year: number }).grade_year, schoolYear(today));
  assert.equal((await call(mom, 'PUT', `${base}/kids/${ben.id}/learn/plan`, { grade: '9' })).status, 400);

  // The kid sees the same cards; a made-up card or skill is refused.
  const mine = (await call(tablet, 'GET', `${base}/kids/${ben.id}/learn`)).body;
  assert.deepEqual(mine.cards.map((c: { skill: string }) => c.skill), v.cards.map((c: { skill: string }) => c.skill));
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ben.id}/learn/answer`, { card: 0, skill: 'talk-find', result: 'right' })).status, 400);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ben.id}/learn/answer`, { card: 0, skill: mine.cards[0].skill, result: 'maybe' })).status, 400);

  const answer = async (card: number, result: string) => (await call(tablet, 'POST', `${base}/kids/${ben.id}/learn/answer`, { card, skill: mine.cards[card].skill, result })).body;
  assert.equal((await answer(0, 'right')).paid, 0);
  // Answering the same card again doesn't change the first answer.
  await answer(0, 'wrong');
  assert.equal((await answer(1, 'wrong')).paid, 0);
  assert.equal((await answer(2, 'second')).paid, 5, 'the last of today\'s cards pays');
  const bal = () => (db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM points_ledger WHERE member_id = ?').get(ben.id) as { n: number }).n;
  assert.equal(bal(), 5);

  // Extra practice is there for the asking and never pays twice.
  const more = (await call(tablet, 'GET', `${base}/kids/${ben.id}/learn?extra=3`)).body;
  assert.equal(more.cards.length, 6);
  assert.equal(more.left, 0);
  assert.equal(more.rightToday, 1);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ben.id}/learn/answer`, { card: 3, skill: more.cards[3].skill, result: 'right' })).body.paid, 0);
  assert.equal(bal(), 5);
  // Answered extra cards stay on the list after a reload.
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ben.id}/learn`)).body.cards.length, 4);

  // The parent sees the week and each skill.
  const stats = (await call(mom, 'GET', `${base}/kids/${ben.id}/learn`)).body;
  assert.equal(stats.week.answered, 4);
  assert.equal(stats.week.days, 1);
  assert.ok(stats.skills.find((s: { id: string }) => s.id === mine.cards[0].skill).total >= 1);
  assert.ok(stats.bySubject.length >= 1);

  // Talk & play for a kid in speech therapy: picture questions, never a school subject.
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { grade: 'talk' });
  const a = (await call(mom, 'PUT', `${base}/kids/${ava.id}/learn/plan`, { perDay: 4 })).body;
  assert.equal(a.level, 'talk');
  assert.equal(a.pictures, true);
  assert.ok(a.cards.every((c: { skill: string }) => c.skill.startsWith('talk-')));
  // Back to "by age" with an empty grade.
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { grade: '' });
  assert.equal((await call(mom, 'GET', `${base}/kids/${ava.id}/learn`)).body.auto, true);

  // Switched off for a kid: nothing on their board, and answers are refused.
  await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { pagesOff: ['learning'] });
  assert.equal((await call(tablet, 'GET', `${base}/kids/${ben.id}/learn`)).body, null);
  assert.equal((await call(tablet, 'POST', `${base}/kids/${ben.id}/learn/answer`, { card: 1, skill: mine.cards[1].skill, result: 'right' })).status, 403);
  // A grade picked last school year has moved up; saving the kid again doesn't knock it back.
  db.prepare('UPDATE members SET grade_year = ? WHERE id = ?').run(schoolYear(today) - 1, ben.id);
  assert.equal((await call(mom, 'GET', `${base}/kids`)).body.find((k: { id: string }) => k.id === ben.id).grade, '5');
  await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { grade: '5' });
  assert.equal((db.prepare('SELECT grade, grade_year FROM members WHERE id = ?').get(ben.id) as { grade: string }).grade, '4');
  await call(mom, 'PATCH', `${base}/kids/${ben.id}`, { grade: '4' });
  assert.equal((await call(mom, 'GET', `${base}/kids`)).body.find((k: { id: string }) => k.id === ben.id).grade, '4', 'picking a grade again starts this year');
  // Turning the plan off keeps the grade.
  await call(mom, 'PUT', `${base}/kids/${ben.id}/learn/plan`, { off: true });
  assert.equal((await call(mom, 'GET', `${base}/kids/${ben.id}/learn`)).body.plan, null);
  assert.equal((await call(mom, 'GET', `${base}/kids`)).body.find((k: { id: string }) => k.id === ben.id).gradeSetting, '4');
});
