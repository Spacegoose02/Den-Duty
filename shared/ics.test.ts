import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, parseIcs } from './ics.ts';

const LUNCH = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:1@school',
  'DTSTART;VALUE=DATE:20261019',
  'SUMMARY:Pizza\\, salad\\; apple',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:2@school',
  'DTSTART:20261020',
  'SUMMARY:Tacos with a very long description that a school website would definitely write out in full because',
  '  they love detail',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:3@school',
  'DTSTART:20261021T013000Z',
  'DTEND:20261021T023000Z',
  'SUMMARY:Late UTC event',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:4@school',
  'STATUS:CANCELLED',
  'DTSTART;VALUE=DATE:20261022',
  'SUMMARY:Cancelled',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:5@nn',
  'DTSTART;TZID=America/New_York:20261023T180000',
  'SUMMARY:Dinner: Tacos',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('reads school lunch and meal plan feeds', () => {
  const ev = parseIcs(LUNCH, 'America/New_York');
  assert.deepEqual(ev.map((e) => [e.date, e.time ?? null, e.summary]), [
    ['2026-10-19', null, 'Pizza, salad; apple'],
    ['2026-10-20', null, 'Tacos with a very long description that a school website would definitely write out in full because they love detail'],
    ['2026-10-20', '21:30', 'Late UTC event'],
    ['2026-10-23', '18:00', 'Dinner: Tacos'],
  ]);
  assert.equal(ev[2].durationMinutes, 60, 'UTC times move into the home time zone, even across midnight');
});

test('writes calendars Google Calendar accepts, and reads them back', () => {
  const ics = buildIcs('Ava, chores', 'America/Chicago', [
    { uid: 'a@dn', summary: 'Ava: 3 chores', description: 'Bed\nTeeth, floss', date: '2026-10-19' },
    { uid: 'b@dn', summary: 'Speech therapy with Ms. Lee and a very long name that will need folding for sure', date: '2026-10-20', time: '15:30', durationMinutes: 45 },
  ], new Date('2026-10-17T00:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('X-WR-CALNAME:Ava\\, chores'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261019\r\nDTEND;VALUE=DATE:20261020'));
  assert.ok(ics.includes('DTSTART;TZID=America/Chicago:20261020T153000\r\nDTEND;TZID=America/Chicago:20261020T161500'));
  assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75), 'long lines are folded');
  const back = parseIcs(ics, 'America/Chicago');
  assert.equal(back[0].description, 'Bed\nTeeth, floss');
  assert.equal(back[1].summary, 'Speech therapy with Ms. Lee and a very long name that will need folding for sure');
  assert.deepEqual([back[1].time, back[1].durationMinutes], ['15:30', 45]);
});
