// Calendars out (secret ICS links per home and kid) and in (feeds shown on the agenda), with a real local feed server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-cal-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { parseIcs } = await import('../../shared/ics.ts');
const { todayIn, addDays } = await import('../../shared/schedule.ts');

type Jar = Record<string, string>;

async function family() {
  const app = await buildApp(openMemoryDb(), { serveWeb: false });
  const call = async (jar: Jar, method: string, url: string, payload?: unknown) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: cookie ? { cookie } : {} });
    for (const ck of res.cookies) { if (ck.value) jar[ck.name] = ck.value; else delete jar[ck.name]; }
    return { status: res.statusCode, body: res.headers['content-type']?.toString().includes('json') && res.body ? JSON.parse(res.body) : res.body, type: res.headers['content-type'] };
  };
  const mom: Jar = {};
  await call(mom, 'POST', '/api/auth/local', { name: 'Mom' });
  const { body: home } = await call(mom, 'POST', '/api/homes', { name: 'Den', timezone: 'UTC' });
  const base = `/api/homes/${home.id}`;
  const ava = (await call(mom, 'POST', `${base}/kids`, { name: 'Ava' })).body;
  const ben = (await call(mom, 'POST', `${base}/kids`, { name: 'Ben' })).body;
  await call(mom, 'POST', `${base}/chores`, { title: 'Make bed', icon: '🛏️', points: 2, memberIds: [ava.id, ben.id] });
  await call(mom, 'POST', `${base}/kids/${ava.id}/therapy/appointments`, { kind: 'speech', title: 'Speech', startsAt: `${addDays(todayIn('UTC'), 2)}T15:30` });
  return { call, mom, base, ava, ben };
}

test('ICS links out: whole home for parents, one kid each, resettable', async () => {
  const { call, mom, base, ava } = await family();
  const links = (await call(mom, 'GET', `${base}/calendars`)).body;
  const homeIcs = await call({}, 'GET', links.home);
  assert.equal(homeIcs.status, 200);
  assert.match(String(homeIcs.type), /text\/calendar/);
  const homeEvents = parseIcs(homeIcs.body, 'UTC');
  const today = todayIn('UTC');
  assert.ok(homeEvents.some((e) => e.date === today && e.summary === 'Ava has 1 chore (0 done)'));
  assert.ok(homeEvents.some((e) => e.date === addDays(today, 3) && e.summary === 'Ben has 1 chore'), 'future days show what is planned');
  assert.ok(homeEvents.some((e) => e.summary === 'Ava: Speech' && e.time === '15:30'), 'parents see appointments');

  const avaLink = links.kids.find((k: { id: string }) => k.id === ava.id).url;
  let avaEvents = parseIcs((await call({}, 'GET', avaLink)).body, 'UTC');
  assert.ok(avaEvents.every((e) => !e.summary.includes('Ben')), "a kid's calendar is only theirs");
  assert.ok(!avaEvents.some((e) => e.summary.includes('Speech')), 'appointments stay private until a parent shares them');
  await call(mom, 'PATCH', `${base}/kids/${ava.id}/therapy`, { kidVisible: true });
  avaEvents = parseIcs((await call({}, 'GET', avaLink)).body, 'UTC');
  assert.ok(avaEvents.some((e) => e.summary === 'Speech'));

  const reset = (await call(mom, 'POST', `${base}/calendars/reset`, {})).body;
  assert.notEqual(reset.url, links.home);
  assert.equal((await call({}, 'GET', links.home)).status, 404, 'the old link stops working');
  assert.equal((await call({}, 'GET', reset.url)).status, 200);
  assert.equal((await call({}, 'GET', '/api/calendar/short.ics')).status, 404);
});

test('ICS feeds in: shown on the agenda, kid-visibility respected, errors kept with the last good copy', async () => {
  const { call, mom, base, ava } = await family();
  const today = todayIn('UTC');
  let body = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:1', `DTSTART;VALUE=DATE:${today.replace(/-/g, '')}`, 'SUMMARY:Chicken nuggets', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  let status = 200;
  const server = http.createServer((_req, res) => { res.writeHead(status, { 'content-type': 'text/calendar' }); res.end(body); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/lunch.ics`;
  try {
    assert.equal((await call(mom, 'POST', `${base}/calendar-feeds`, { url: 'file:///etc/passwd' })).status, 400);
    const feed = (await call(mom, 'POST', `${base}/calendar-feeds`, { name: 'School lunch', url, kind: 'lunch' })).body;
    assert.equal(feed.events, 1);
    assert.equal(feed.error, null);

    const agenda = (await call(mom, 'GET', `${base}/agenda`)).body;
    const day = agenda.days.find((d: { date: string }) => d.date === today);
    assert.deepEqual(day.external.map((e: { title: string; feed: string; kind: string }) => [e.title, e.feed, e.kind]), [['Chicken nuggets', 'School lunch', 'lunch']]);

    // Kids see it on their board too, unless a parent hides that feed from kids.
    const tablet: Jar = {};
    const { body: code } = await call(mom, 'POST', '/api/auth/pair-code', { kind: 'device', homeId: base.split('/')[3] });
    await call(tablet, 'POST', '/api/auth/pair', { code: code.code });
    await call(tablet, 'POST', '/api/kiosk/kid', { memberId: ava.id });
    const kidDay = () => call(tablet, 'GET', `${base}/kids/${ava.id}/board`).then((r) => r.body.week.find((d: { date: string }) => d.date === today));
    assert.equal((await kidDay()).external.length, 1);
    await call(mom, 'PATCH', `${base}/calendar-feeds/${feed.id}`, { showKids: false });
    assert.equal((await kidDay()).external.length, 0);

    // A broken refresh keeps the old events and shows the error.
    status = 500;
    body = 'oops';
    const broken = (await call(mom, 'POST', `${base}/calendar-feeds/${feed.id}/refresh`, {})).body;
    assert.match(broken.error, /answered 500/);
    assert.equal(broken.events, 1);
  } finally {
    server.close();
  }
});
