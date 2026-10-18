import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageBand, ageOn, choresForAge, pictureMode } from './ages.ts';

test('ages count whole years and update on the birthday', () => {
  assert.equal(ageOn('2020-10-18', '2026-10-17'), 5);
  assert.equal(ageOn('2020-10-18', '2026-10-18'), 6);
  assert.equal(ageOn('2020-02-29', '2026-02-28'), 5, 'leap-day birthdays wait for March');
  assert.equal(ageOn('2020-02-29', '2026-03-01'), 6);
  assert.equal(ageOn(null, '2026-10-17'), null);
  assert.equal(ageOn('2030-01-01', '2026-10-17'), null, 'no ages from the future');
});

test('picture-first screens for young kids, unless a parent says otherwise', () => {
  assert.equal(pictureMode('auto', 4), true);
  assert.equal(pictureMode('auto', 7), false);
  assert.equal(pictureMode('auto', null), false);
  assert.equal(pictureMode('on', 10), true);
  assert.equal(pictureMode('off', 3), false);
  assert.equal(ageBand(4)?.label, 'Little helper');
});

test('chore ideas fit the age', () => {
  const four = choresForAge(4).map((c) => c.title);
  assert.ok(four.includes('Make your bed') && four.includes('Feed the pet (with help)'));
  assert.ok(!four.includes('Mow the lawn'));
  const ten = choresForAge(10).map((c) => c.title);
  assert.ok(ten.includes('Help cook dinner') && !ten.includes('Feed the pet (with help)'));
});
