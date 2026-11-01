import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, cleanWeekdays, dateRange, describeSchedule, isIsoDate, isScheduledOn, startOfWeek, todayIn, weekdayOf,
  type Schedule,
} from './schedule.ts';
import { avatarId, avatarLabel, avatarUnlocked, isAvatar, isKidColor, KID_COLORS, parseAvatar } from './catalog.ts';
import { THEME_DEFS, THEME_IDS, themeCss } from './themes.ts';

test('date helpers', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(weekdayOf('2026-10-17'), 6, 'Oct 17 2026 is a Saturday');
  assert.equal(startOfWeek('2026-10-17', 0), '2026-10-11');
  assert.equal(startOfWeek('2026-10-17', 1), '2026-10-12');
  assert.equal(startOfWeek('2026-10-11', 0), '2026-10-11', 'Sunday starts its own week');
  assert.equal(startOfWeek('2026-10-11', 1), '2026-10-05', 'Sunday ends a Monday week');
  assert.deepEqual(dateRange('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.ok(isIsoDate('2026-02-28') && !isIsoDate('2026-02-30') && !isIsoDate('10/17/2026'));
});

test('today depends on the home time zone', () => {
  const lateFridayInNewYork = new Date('2026-10-17T02:30:00Z');
  assert.equal(todayIn('America/New_York', lateFridayInNewYork), '2026-10-16');
  assert.equal(todayIn('Europe/London', lateFridayInNewYork), '2026-10-17');
  assert.equal(todayIn('Not/AZone', lateFridayInNewYork), '2026-10-17', 'bad zones fall back to UTC');
});

test('chore schedules', () => {
  const base = { weekdays: [], dueDate: null, startDate: '2026-10-12' };
  const daily: Schedule = { ...base, schedule: 'daily' };
  assert.ok(isScheduledOn(daily, '2026-10-12'));
  assert.ok(!isScheduledOn(daily, '2026-10-11'), 'nothing before the start date');
  const mwf: Schedule = { ...base, schedule: 'weekly', weekdays: [1, 3, 5] };
  assert.deepEqual(dateRange('2026-10-12', '2026-10-18').filter((d) => isScheduledOn(mwf, d)), ['2026-10-12', '2026-10-14', '2026-10-16']);
  const once: Schedule = { ...base, schedule: 'once', dueDate: '2026-10-15' };
  assert.deepEqual(dateRange('2026-10-12', '2026-10-18').filter((d) => isScheduledOn(once, d)), ['2026-10-15']);
  assert.equal(describeSchedule(mwf), 'Mon, Wed, Fri');
  assert.equal(describeSchedule({ schedule: 'weekly', weekdays: [1, 2, 3, 4, 5], dueDate: null }), 'Weekdays');
  assert.deepEqual(cleanWeekdays([5, '1', 1, 9, -1, 'x', 3]), [1, 3, 5]);
});

test('catalog validation', () => {
  assert.ok(isAvatar('ninja') && !isAvatar('dragon'));
  assert.ok(isKidColor(KID_COLORS[0]) && !isKidColor('red'));
});

test('avatars are an animal in an outfit, and raccoon picks from before still work', () => {
  assert.deepEqual(parseAvatar('wizard'), { animal: 'raccoon', outfit: 'wizard' });
  assert.deepEqual(parseAvatar('fox-wizard'), { animal: 'fox', outfit: 'wizard' });
  assert.deepEqual(parseAvatar('panda'), { animal: 'panda', outfit: 'classic' });
  assert.equal(avatarId('raccoon', 'pirate'), 'pirate');
  assert.equal(avatarId('bunny', 'classic'), 'bunny');
  assert.ok(isAvatar('bunny-bow') && isAvatar('classic'));
  for (const bad of ['raccoon', 'raccoon-ninja', 'fox-classic', 'fox-dragon', 'fox-ninja-cap', 'dragon']) assert.ok(!isAvatar(bad), bad);
  assert.equal(avatarLabel('cat-pirate'), 'Pirate kitty');
  assert.ok(avatarUnlocked('tiger', 1) && !avatarUnlocked('tiger-golden', 6) && avatarUnlocked('tiger-golden', 7));
});

test('themes', () => {
  assert.ok(THEME_DEFS.length >= 15);
  assert.equal(new Set(THEME_IDS).size, THEME_IDS.length, 'theme ids are unique');
  assert.ok(THEME_DEFS.some((t) => t.dark) && THEME_IDS.includes('contrast'));
  const css = themeCss();
  for (const id of THEME_IDS) assert.ok(css.includes(`[data-theme='${id}']`), id);
});

test('interval, monthly and turn-taking schedules', async () => {
  const { isScheduledOn: on, occurrenceIndex, turnFor, describeSchedule: describe } = await import('./schedule.ts');
  const monthly = { schedule: 'monthly' as const, weekdays: [], dueDate: null, startDate: '2026-01-15', monthDay: 31 };
  assert.ok(on(monthly, '2026-01-31') && on(monthly, '2026-02-28') && !on(monthly, '2026-02-27') && on(monthly, '2024-02-29') === false);
  assert.equal(occurrenceIndex(monthly, '2026-01-31'), 0);
  assert.equal(occurrenceIndex(monthly, '2026-03-31'), 2);
  const late = { ...monthly, monthDay: 10 };
  assert.equal(occurrenceIndex(late, '2026-02-10'), 0, 'the 10th had passed when it started, so February is the first');
  assert.equal(describe(monthly), 'Monthly on the 31st');
  const every = { schedule: 'interval' as const, weekdays: [], dueDate: null, startDate: '2026-10-01', everyDays: 3 };
  assert.ok(on(every, '2026-10-01') && on(every, '2026-10-04') && !on(every, '2026-10-05') && !on(every, '2026-09-28'));
  assert.equal(occurrenceIndex(every, '2026-10-07'), 2);
  // Mon/Wed/Fri with two kids alternates by occurrence, not by date.
  const mwf = { schedule: 'weekly' as const, weekdays: [1, 3, 5], dueDate: null, startDate: '2026-10-19' };
  const order = ['2026-10-19', '2026-10-21', '2026-10-23', '2026-10-26', '2026-10-28'].map((d) => turnFor(mwf, 'daily', ['a', 'b'], d)[0]);
  assert.deepEqual(order, ['a', 'b', 'a', 'b', 'a']);
  assert.deepEqual(turnFor(mwf, null, ['a', 'b'], '2026-10-19'), ['a', 'b']);
  assert.deepEqual(turnFor(mwf, 'weekly', ['a', 'b'], '2026-10-28', 0), ['b']);
});
