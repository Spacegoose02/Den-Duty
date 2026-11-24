import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRADE_ORDER, LEVEL_IDS, SKILLS, cleanLearnPlan, currentLevel, levelByAge, makeQuestion, mastered, pickCards, schoolYear, skillsFor, subjectsAt,
} from './learning.ts';

test('learning: every skill makes sound questions (one right answer, no repeats, 2 to 4 choices)', () => {
  for (const s of SKILLS) {
    for (let i = 0; i < 60; i++) {
      const q = makeQuestion(s.id, `t${i}`, { name: 'Nayomi' })!;
      const texts = q.choices.map((c) => c.text);
      assert.ok(q.choices.length >= 2 && q.choices.length <= 4, `${s.id}: ${texts}`);
      assert.equal(new Set(texts).size, texts.length, `${s.id} repeats a choice: ${texts}`);
      assert.ok(q.answer >= 0 && q.answer < q.choices.length, `${s.id}: answer out of range`);
      assert.ok(q.prompt && q.why, s.id);
      assert.ok(!texts.some((t) => /NaN|undefined|-\d/.test(t)), `${s.id}: odd choice ${texts}`);
    }
  }
  // Same seed, same question.
  assert.deepEqual(makeQuestion('1-add', 'x', { name: 'A' }), makeQuestion('1-add', 'x', { name: 'A' }));
  assert.equal(makeQuestion('nope', 'x', { name: 'A' }), null);
});

test('learning: the math in generated questions is right', () => {
  for (let i = 0; i < 200; i++) {
    const add = makeQuestion('1-add', `a${i}`, { name: 'A' })!;
    const [a, b] = add.prompt.match(/\d+/g)!.map(Number);
    assert.equal(Number(add.choices[add.answer].text), a + b);
    assert.ok(a + b <= 20);
    const mult = makeQuestion('4-mult', `m${i}`, { name: 'A' })!;
    const [x, y] = mult.prompt.match(/\d+/g)!.map(Number);
    assert.equal(Number(mult.choices[mult.answer].text), x * y);
    const div = makeQuestion('4-divide', `d${i}`, { name: 'A' })!;
    const [n, d] = div.prompt.match(/\d+/g)!.map(Number);
    const want = n % d ? `${Math.floor(n / d)} R${n % d}` : String(n / d);
    assert.equal(div.choices[div.answer].text, want);
  }
});

test('learning: every level has questions, and grades follow Virginia\'s kindergarten cutoff', () => {
  for (const l of LEVEL_IDS) assert.ok(skillsFor(l).length >= 6, l);
  assert.ok(subjectsAt('4').includes('social'), '4th grade has Virginia Studies');
  assert.deepEqual(subjectsAt('talk'), ['talk']);
  assert.equal(schoolYear('2026-11-23'), 2026);
  assert.equal(schoolYear('2027-03-01'), 2026);
  assert.equal(schoolYear('2027-07-01'), 2027);
  // Turned 6 by Sept 30, 2026: first grade this school year. Turned 6 on Oct 1: still kindergarten.
  assert.equal(levelByAge('2020-09-30', '2026-11-23'), '1');
  assert.equal(levelByAge('2020-10-01', '2026-11-23'), 'k');
  assert.equal(levelByAge('2016-09-01', '2026-11-23'), '5');
  assert.equal(levelByAge('2024-01-01', '2026-11-23'), null);
  // A picked grade moves up each July; Talk & play stays put.
  assert.deepEqual(currentLevel('1', 2026, null, '2026-11-23'), { level: '1', auto: false });
  assert.deepEqual(currentLevel('1', 2026, null, '2027-08-01'), { level: '2', auto: false });
  assert.deepEqual(currentLevel('4', 2026, null, '2029-08-01'), { level: '5', auto: false });
  assert.deepEqual(currentLevel('talk', 2020, null, '2029-08-01'), { level: 'talk', auto: false });
  assert.deepEqual(currentLevel(null, null, '2016-09-01', '2026-11-23'), { level: '5', auto: true });
  assert.equal(GRADE_ORDER.at(-1), '5');
});

test('learning: today\'s cards mix subjects and lean on what a kid finds hard', () => {
  const skills = skillsFor('1');
  const cards = pickCards(skills, [], 'kid|2026-11-23', 8);
  assert.equal(cards.length, 8);
  const subjects = new Set(cards.map((c) => skills.find((s) => s.id === c.skill)!.subject));
  assert.equal(subjects.size, 4, 'math, reading, science and social each come up');
  assert.deepEqual(pickCards(skills, [], 'kid|2026-11-23', 8), cards, 'the same all day');
  // A skill they keep missing comes up far more than one they've got.
  const stats = [{ skill: '1-add', right: 0, total: 10 }, { skill: '1-sub', right: 10, total: 10 }];
  let hard = 0, easy = 0;
  for (let i = 0; i < 300; i++) {
    for (const c of pickCards(skills, stats, `s${i}`, 6)) { if (c.skill === '1-add') hard++; if (c.skill === '1-sub') easy++; }
  }
  assert.ok(hard > easy * 3, `${hard} vs ${easy}`);
  assert.ok(mastered({ skill: 'x', right: 4, total: 5 }));
  assert.ok(!mastered({ skill: 'x', right: 3, total: 3 }));
  // Subjects switched off are left out (unless that would leave nothing).
  assert.ok(skillsFor('4', ['social', 'science']).every((s) => s.subject === 'math' || s.subject === 'reading'));
  assert.equal(skillsFor('talk', ['talk']).length, skillsFor('talk').length);
  assert.deepEqual(cleanLearnPlan({ perDay: 99, points: -3, subjectsOff: ['math', 'bogus'] }), { perDay: 15, points: 0, subjectsOff: ['math'] });
});
