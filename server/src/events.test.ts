import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family, fakeClaude, type Sent } from './test-helpers.ts';
import { addDays } from '../../shared/schedule.ts';
import { setAdapterOverride, syncAccount, setSyncFetch, caldavCalendars, adapterFor, type Adapter, type RemoteEvent } from './calsync.ts';
import { sealKey } from './ai.ts';
import type { Row } from './db.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('family events: parents add them, kids see theirs, the wall and ICS feed show them', async () => {
  const { call, mom, base, ava, ben, tablet, asKid, today } = await family();
  const party = (await call(mom, 'POST', `${base}/events`, { title: 'Birthday party', date: addDays(today, 1), time: '14:00', endTime: '16:00', location: 'Jump park', memberIds: [ava.id] })).body;
  await call(mom, 'POST', `${base}/events`, { title: 'Grandma visits', date: today, endDate: addDays(today, 2) });
  await call(mom, 'POST', `${base}/events`, { title: 'Parent-teacher night', date: today, time: '18:00', kidsSee: false });
  assert.equal((await call(mom, 'POST', `${base}/events`, { title: 'Bad', date: 'soon' })).status, 400);
  assert.equal((await call(mom, 'POST', `${base}/events`, { title: 'Bad', date: today, endDate: addDays(today, -1) })).status, 400);

  assert.equal((await call(mom, 'GET', `${base}/events`)).body.length, 3);
  await asKid(ben);
  assert.deepEqual((await call(tablet, 'GET', `${base}/events`)).body.map((e: { title: string }) => e.title), ['Grandma visits']);
  assert.equal((await call(tablet, 'POST', `${base}/events`, { title: 'Mine', date: today })).status, 403);
  await asKid(ava);
  const board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  const tomorrow = board.week.find((d: { date: string }) => d.date === addDays(today, 1));
  if (tomorrow) assert.deepEqual(tomorrow.events.map((e: { title: string }) => e.title).sort(), ['Birthday party', 'Grandma visits']);

  await call(tablet, 'POST', '/api/kiosk/kid/logout', {});
  const wall = (await call(tablet, 'GET', '/api/kiosk/wall')).body;
  assert.deepEqual(wall.family[0].events.map((e: { title: string }) => e.title), ['Grandma visits']);

  const cal = (await call(mom, 'GET', `${base}/calendars`)).body;
  const ics = (await call({}, 'GET', cal.home)).body as string;
  assert.match(ics, /SUMMARY:Birthday party/);
  assert.match(ics, /LOCATION:Jump park/);

  const moved = (await call(mom, 'PATCH', `${base}/events/${party.id}`, { time: '15:00' })).body;
  assert.equal(moved.time, '15:00');
  assert.equal(moved.endTime, '16:00');
  await call(mom, 'DELETE', `${base}/events/${party.id}`);
  assert.equal((await call(mom, 'GET', `${base}/events`)).body.length, 2);
});

test('snap to calendar: a flyer photo becomes drafts to check, without the kids', async () => {
  const { call, mom, base, today } = await family();
  const sent: Sent[] = [];
  fakeClaude(sent, () => ({ events: [
    { title: 'Picture day', date: addDays(today, 3), endDate: null, time: null, endTime: null, location: null, notes: 'Wear the uniform', forWhom: 'Grade 3' },
    { title: 'Field trip', date: addDays(today, 10), endDate: null, time: '8:00', endTime: null, location: 'Science museum', notes: null, forWhom: null },
    { title: 'Nonsense', date: 'next week', endDate: null, time: null, endTime: null, location: null, notes: null, forWhom: null },
  ] }));
  assert.equal((await call(mom, 'POST', `${base}/events/snap`, { image: PNG })).status, 403, 'AI off');
  await call(mom, 'PATCH', `${base}/ai`, { enabled: true, apiKey: 'sk-ant-test-key-123456' });
  const r = (await call(mom, 'POST', `${base}/events/snap`, { image: PNG })).body;
  assert.equal(r.drafts.length, 2, 'undated rows are dropped');
  assert.equal(r.drafts[1].time, null, 'bad times are dropped, not guessed');
  const body = JSON.stringify(sent[0].body);
  assert.ok(body.includes('"type":"image"'));
  assert.ok(!body.includes('Avaleigh') && !body.includes('Benedict'), 'no kid names sent');
  const saved = (await call(mom, 'POST', `${base}/events/bulk`, { events: r.drafts })).body;
  assert.equal(saved.length, 2);
  assert.equal(saved[0].source, 'snap');
  fakeClaude([], () => ({ events: [] }));
  assert.deepEqual((await call(mom, 'POST', `${base}/events/snap`, { text: 'Bake sale on Friday!' })).body.drafts, []);
});

test('two-way sync: our events go out and stay in step, theirs come in as a mirror', async () => {
  const { db, call, mom, base, ava, today } = await family();
  // A fake remote calendar.
  const remote = new Map<string, RemoteEvent>();
  let n = 0;
  const fake: Adapter = {
    async calendars() { return [{ id: 'cal1', name: 'Family' }]; },
    async list() { return [...remote.values()]; },
    async create(e) { const id = `r${++n}`; remote.set(id, { id, etag: '1', title: e.title, date: e.date, endDate: e.endDate, time: e.time, endTime: e.endTime, location: e.location, notes: 'Added in Den Duty' }); return { id, etag: '1' }; },
    async update(id, e) { const r = remote.get(id)!; remote.set(id, { ...r, title: e.title, etag: String(Number(r.etag) + 1) }); return { etag: remote.get(id)!.etag }; },
    async remove(id) { remote.delete(id); },
  };
  setAdapterOverride(() => fake);
  remote.set('g1', { id: 'g1', etag: 'a', title: 'Dentist', date: addDays(today, 2), endDate: null, time: '09:00', endTime: '09:30', location: null, notes: null });

  const id = 'acct1';
  db.prepare("INSERT INTO calendar_accounts (id, home_id, kind, name, calendar_id, member_ids) VALUES (?, ?, 'google', 'Google', 'cal1', ?)").run(id, base.split('/').pop()!, JSON.stringify([ava.id]));
  const ours = (await call(mom, 'POST', `${base}/events`, { title: 'Swim lesson', date: addDays(today, 1), time: '17:00' })).body;

  let r = await syncAccount(db, id);
  assert.deepEqual([r.pushed, r.pulled], [1, 1]);
  assert.ok([...remote.values()].some((e) => e.title === 'Swim lesson'));
  const events = (await call(mom, 'GET', `${base}/events`)).body as { title: string; source: string; memberIds: string[]; id: string }[];
  const dentist = events.find((e) => e.title === 'Dentist')!;
  assert.equal(dentist.source, 'google');
  assert.deepEqual(dentist.memberIds, [ava.id], "a kid's calendar mirrors as theirs");
  assert.match((await call(mom, 'PATCH', `${base}/events/${dentist.id}`, { title: 'X' })).body.error, /comes from Google/);

  // Again: nothing new, and our own event isn't mirrored back.
  r = await syncAccount(db, id);
  assert.deepEqual(r, { pushed: 0, pulled: 0, updated: 0, removed: 0, deleted: 0 });
  assert.equal((await call(mom, 'GET', `${base}/events`)).body.length, 2);

  // Edit here → updated there. Changed there → updated here. Gone there → gone here. Deleted here → deleted there.
  db.prepare("UPDATE event_links SET synced_at = datetime('now', '-1 minute')").run();
  await call(mom, 'PATCH', `${base}/events/${ours.id}`, { title: 'Swimming' });
  remote.set('g1', { ...remote.get('g1')!, etag: 'b', title: 'Dentist (moved)' });
  r = await syncAccount(db, id);
  assert.equal(r.updated, 1);
  assert.ok([...remote.values()].some((e) => e.title === 'Swimming'));
  assert.ok((await call(mom, 'GET', `${base}/events`)).body.some((e: { title: string }) => e.title === 'Dentist (moved)'));
  remote.delete('g1');
  await call(mom, 'DELETE', `${base}/events/${ours.id}`);
  assert.deepEqual((await call(mom, 'GET', `${base}/events`)).body.map((e: { title: string }) => e.title), ['Dentist (moved)'], 'ours is gone here right away');
  r = await syncAccount(db, id);
  assert.deepEqual([r.removed, r.deleted], [1, 1]);
  assert.equal((await call(mom, 'GET', `${base}/events`)).body.length, 0);
  assert.equal(remote.size, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM family_events').get() as Row).n, 0, 'tombstone cleared');

  // Errors are kept for Settings.
  setAdapterOverride(() => ({ ...fake, async list() { throw new Error('The calendar refused the sign-in (401)'); } }));
  await assert.rejects(syncAccount(db, id));
  assert.match((await call(mom, 'GET', `${base}/calendar-sync`)).body.accounts[0].error, /401/);
  setAdapterOverride(null);
});

test('CalDAV: finds calendars and reads expanded events; Google: reads and writes', async () => {
  const calls: { url: string; method: string; body?: string }[] = [];
  setSyncFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
    const ms = (xml: string) => new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">${xml}</d:multistatus>`, { status: 207 });
    if (url === 'https://dav.example/' && init?.method === 'PROPFIND') return ms('<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/p/mom/</d:href></d:current-user-principal><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>');
    if (url === 'https://dav.example/p/mom/') return ms('<d:response><d:href>/p/mom/</d:href><d:propstat><d:prop><cal:calendar-home-set><d:href>/cals/mom/</d:href></cal:calendar-home-set></d:prop></d:propstat></d:response>');
    if (url === 'https://dav.example/cals/mom/' && init?.method === 'PROPFIND') return ms(`
      <d:response><d:href>/cals/mom/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
      <d:response><d:href>/cals/mom/family/</d:href><d:propstat><d:prop><d:displayname>Family &amp; kids</d:displayname><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set></d:prop></d:propstat></d:response>
      <d:response><d:href>/cals/mom/tasks/</d:href><d:propstat><d:prop><d:displayname>Tasks</d:displayname><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><cal:supported-calendar-component-set><cal:comp name="VTODO"/></cal:supported-calendar-component-set></d:prop></d:propstat></d:response>`);
    if (init?.method === 'REPORT') return ms(`<d:response><d:href>/cals/mom/family/abc.ics</d:href><d:propstat><d:prop><d:getetag>"e1"</d:getetag><cal:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
UID:abc
RECURRENCE-ID:20261110T170000Z
DTSTART:20261110T170000Z
DTEND:20261110T180000Z
SUMMARY:Soccer &amp; snacks
LOCATION:Field 2
END:VEVENT
END:VCALENDAR</cal:calendar-data></d:prop></d:propstat></d:response>`);
    if (url.includes('googleapis.com/calendar/v3/calendars/primary/events?')) return Response.json({ items: [
      { id: 'g1', etag: '"1"', summary: 'Camp', start: { date: '2026-11-20' }, end: { date: '2026-11-23' } },
      { id: 'g2', etag: '"1"', status: 'cancelled', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } },
      { id: 'g3', etag: '"1"', summary: 'Piano', start: { dateTime: '2026-11-12T16:30:00-05:00' }, end: { dateTime: '2026-11-12T17:15:00-05:00' } },
    ] });
    if (url.endsWith('/calendars/primary/events') && init?.method === 'POST') return Response.json({ id: 'new1', etag: '"9"' });
    if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'at', expires_in: 3600 });
    return new Response('nope', { status: 404 });
  }) as typeof fetch);
  try {
    const cals = await caldavCalendars('https://dav.example/', 'mom', 'pw');
    assert.deepEqual(cals, [{ id: 'https://dav.example/cals/mom/family/', name: 'Family & kids' }]);
    const dav = adapterFor(null as never, { kind: 'caldav', url: 'https://dav.example/', calendar_id: cals[0].id, username: 'mom', secret: sealKey('pw') } as Row, 'UTC');
    const evs = await dav.list('2026-11-01', '2026-11-30');
    assert.equal(evs.length, 1);
    assert.equal(evs[0].id, '/cals/mom/family/abc.ics#20261110T170000Z');
    assert.deepEqual([evs[0].title, evs[0].time, evs[0].endTime, evs[0].location], ['Soccer & snacks', '17:00', '18:00', 'Field 2']);
    assert.match(calls.find((c) => c.method === 'REPORT')!.body!, /<c:expand start="20261101T000000Z"/);

    const g = adapterFor({ prepare: () => ({ run: () => undefined }) } as never, { id: 'a', kind: 'google', calendar_id: 'primary', secret: sealKey(JSON.stringify({ refresh: 'rt', access: 'at', expires: Date.now() + 3600e3 })) } as Row, 'America/New_York');
    const gl = await g.list('2026-11-01', '2026-11-30');
    assert.deepEqual(gl.map((e) => [e.title, e.date, e.endDate, e.time, e.endTime]), [['Camp', '2026-11-20', '2026-11-22', null, null], ['Piano', '2026-11-12', null, '16:30', '17:15']]);
    const made = await g.create({ id: 'e1', title: 'Swim', date: '2026-11-15', endDate: null, time: '10:00', endTime: null, location: null, notes: null, memberIds: [], kidsSee: true, source: 'manual', accountId: null });
    assert.equal(made.id, 'new1');
    const sentBody = JSON.parse(calls.find((c) => c.method === 'POST' && c.url.endsWith('/events'))!.body!);
    assert.deepEqual(sentBody.start, { dateTime: '2026-11-15T10:00:00', timeZone: 'America/New_York' });
    assert.deepEqual(sentBody.end, { dateTime: '2026-11-15T11:00:00', timeZone: 'America/New_York' });
  } finally { setSyncFetch(null); }
});
