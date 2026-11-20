import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOLIDAY_DEFAULTS, bigDayDate, camClips, camPeriod, cleanHoliday, countdown, elfFor, holidayActive, niceLevel, niceScore,
  routePath, sleighAt, sleighRoute, splitJoke, zonedTime,
} from './holiday.ts';
import { HOLIDAY_TEXT } from './holiday-data.ts';

test('holiday settings are cleaned and default to off', () => {
  const s = cleanHoliday(undefined);
  assert.equal(s.mode, 'off');
  assert.deepEqual(s, HOLIDAY_DEFAULTS);
  const t = cleanHoliday({ mode: 'dates', from: '2026-12-01', to: 'nope', day: '13-40', elfPoints: 500, camUrl: 'javascript:alert(1)', place: { lat: 95, lon: 0 } });
  assert.equal(t.mode, 'dates');
  assert.equal(t.from, '2026-12-01');
  assert.equal(t.to, null);
  assert.equal(t.day, '12-25');
  assert.equal(t.elfPoints, 5);
  assert.equal(t.camUrl, '/holiday-cams');
  assert.equal(t.place, null);
  assert.equal(cleanHoliday({ camUrl: 'https://nas.local/cams/' }).camUrl, 'https://nas.local/cams');
});

test('holiday mode turns itself on and off between dates', () => {
  const s = { mode: 'dates' as const, from: '2026-12-01', to: '2027-01-01' };
  assert.equal(holidayActive(s, '2026-11-30'), false);
  assert.equal(holidayActive(s, '2026-12-01'), true);
  assert.equal(holidayActive(s, '2027-01-01'), true);
  assert.equal(holidayActive(s, '2027-01-02'), false);
  assert.equal(holidayActive({ mode: 'on', from: null, to: null }, '2026-06-01'), true);
  assert.equal(holidayActive({ mode: 'off', from: '2026-01-01', to: null }, '2026-06-01'), false);
  assert.equal(holidayActive({ mode: 'dates', from: null, to: null }, '2026-06-01'), false, 'dates mode with no dates stays off');
});

test('countdown to the big day in the home time zone', () => {
  const at = zonedTime('2026-12-25', '07:00', 'America/New_York');
  assert.equal(at.toISOString(), '2026-12-25T12:00:00.000Z');
  const c = countdown({ day: '12-25', time: '07:00' }, 'America/New_York', '2026-11-20', new Date('2026-11-20T12:00:00Z'));
  assert.equal(c.date, '2026-12-25');
  assert.equal(c.days, 35);
  assert.equal(c.sleeps, 35);
  assert.equal(c.party, false);
  const party = countdown({ day: '12-25', time: '07:00' }, 'America/New_York', '2026-12-25', new Date('2026-12-25T15:00:00Z'));
  assert.equal(party.party, true);
  assert.equal(party.msLeft, 0);
  // A week after, it counts to next year.
  assert.equal(bigDayDate({ day: '12-25' }, '2027-01-02'), '2027-12-25');
  assert.equal(bigDayDate({ day: '12-25' }, '2026-12-30'), '2026-12-25');
});

test('elf of the day', () => {
  const e = elfFor({ day: '12-25' }, '2026-12-01');
  assert.equal(e.trial, false);
  assert.equal(e.name, 'Elf Pip');
  assert.equal(e.joke.question, 'What do elves learn in school?');
  assert.equal(e.joke.answer, 'The elf-abet!');
  assert.equal(elfFor({ day: '12-25' }, '2026-12-31').index, 0, 'day 31 starts over');
  assert.equal(elfFor({ day: '12-25' }, '2026-11-20').trial, true);
  assert.equal(elfFor({ day: '12-25' }, '2026-12-02', 'es').name, HOLIDAY_TEXT.es.elves[1][0]);
  for (const lang of ['en', 'es', 'fr'] as const) assert.equal(HOLIDAY_TEXT[lang].elves.length, 30);
  assert.deepEqual(splitJoke('No question here'), { question: 'No question here', answer: '' });
});

test('nice meter', () => {
  assert.equal(niceScore({ done: 0, due: 0, kind: 0, penalties: 0 }), 75);
  assert.equal(niceScore({ done: 10, due: 10, kind: 0, penalties: 0 }), 100);
  assert.equal(niceScore({ done: 5, due: 10, kind: 0, penalties: 0 }), 70);
  assert.equal(niceScore({ done: 0, due: 10, kind: 0, penalties: 20 }), 0);
  assert.equal(niceScore({ done: 5, due: 10, kind: 2, penalties: 1 }), 71);
  assert.equal(niceLevel(100), 4);
  assert.equal(niceLevel(75), 3);
  assert.equal(niceLevel(0), 0);
});

test('the sleigh flies east to west and reaches home at the ETA', () => {
  const home = { name: 'Springfield', lat: 39.8, lon: -89.6 };
  const r = sleighRoute({ day: '12-25', eta: '23:59', place: home }, 'America/Chicago', '2026-12-10');
  assert.equal(r.night, '2026-12-24');
  for (let i = 1; i < r.stops.length; i++) assert.ok(r.stops[i].t >= r.stops[i - 1].t, 'stops in time order');
  assert.equal(r.stops[0].northPole, true);
  assert.equal(r.stops.at(-1)!.northPole, true);
  const h = r.stops.find((s) => s.home)!;
  // 23:59 in Chicago (UTC-6) is 05:59 UTC the next day: 1799 minutes after 00:00 UTC on the 24th.
  assert.equal(h.t, 1799);
  assert.equal(r.homeT, 1799);
  assert.equal(sleighAt(r, 0).state, 'parked');
  assert.equal(sleighAt(r, r.stops[0].t - 60).state, 'pre');
  const at = sleighAt(r, r.homeT);
  assert.equal(at.state, 'fly');
  assert.ok(Math.abs(at.lat - home.lat) < 0.01 && Math.abs(at.lon - home.lon) < 0.01);
  assert.equal(sleighAt(r, r.stops.at(-1)!.t + 60).state, 'after');
  assert.ok(!routePath(r.stops.map((s) => [s.lat, s.lon])).includes('NaN'));
});

test('cams pick a scene by the time of day', () => {
  assert.equal(camPeriod(4 * 60), 'evening');
  assert.equal(camPeriod(6 * 60), 'morning');
  assert.equal(camPeriod(12 * 60), 'day');
  assert.equal(camPeriod(20 * 60), 'evening');
  assert.equal(camClips({ cams: 'off', camUrl: '' }, 'day').length, 0);
  assert.equal(camClips({ cams: 'local', camUrl: '/holiday-cams' }, 'day')[0], '/holiday-cams/cam1_day.mp4');
  assert.match(camClips({ cams: 'hosted', camUrl: '' }, 'morning')[3], /^https:\/\/github\.com\/DKAnord\/nordpol-card\/releases\/download\/media\/cam4_morning\.mp4$/);
});
