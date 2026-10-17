import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, cleanWeekdays, dateRange, describeSchedule, isIsoDate, isScheduledOn, startOfWeek, todayIn, weekdayOf,
  type Schedule,
} from './schedule.ts';
import { isAvatar, isKidColor, KID_COLORS } from './catalog.ts';

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
