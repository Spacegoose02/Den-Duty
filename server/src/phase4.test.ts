// Therapy section (parents only, optionally shared with the kid) and the parents' honey-do board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-p4-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');

type Jar = Record<string, string>;

async function family() {
  const app = await buildApp(openMemoryDb(), { serveWeb: false });
  const call = async (jar: Jar, method: string, url: string, payload?: unknown) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: cookie ? { cookie } : {} });
    for (const ck of res.cookies) { if (ck.value) jar[ck.name] = ck.value; else delete jar[ck.name]; }
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  const mom: Jar = {};
  await call(mom, 'POST', '/api/auth/local', { name: 'Mom' });
  const { body: home } = await call(mom, 'POST', '/api/homes', { name: 'Den', timezone: 'UTC' });
  const base = `/api/homes/${home.id}`;
  const ava = (await call(mom, 'POST', `${base}/kids`, { name: 'Ava' })).body;
  const ben = (await call(mom, 'POST', `${base}/kids`, { name: 'Ben' })).body;
  const tablet: Jar = {};
  const { body: code } = await call(mom, 'POST', '/api/auth/pair-code', { kind: 'device', homeId: home.id });
  await call(tablet, 'POST', '/api/auth/pair', { code: code.code });
  await call(tablet, 'POST', '/api/kiosk/kid', { memberId: ava.id });
  return { call, mom, home, base, ava, ben, tablet };
}

test('therapy: appointments, goals with progress history, notes; parents only', async () => {
  const { call, mom, base, ava, ben, tablet } = await family();
  const t = `${base}/kids/${ava.id}/therapy`;
  assert.equal((await call(tablet, 'GET', t)).status, 403, 'kids and tablets cannot open the therapy section');

  const appt = await call(mom, 'POST', `${t}/appointments`, { kind: 'speech', title: 'Speech therapy', provider: 'Ms. Lee', startsAt: '2099-01-05T15:30', durationMinutes: 45 });
  assert.equal(appt.status, 200, JSON.stringify(appt.body));
  assert.equal((await call(mom, 'POST', `${t}/appointments`, { title: 'x', startsAt: 'tomorrow' })).status, 400);
  assert.equal((await call(mom, 'POST', `${t}/appointments`, { title: 'x', kind: 'astrology', startsAt: '2099-01-05T15:30' })).status, 400);

  const goal = (await call(mom, 'POST', `${t}/goals`, { area: 'speech', title: 'Say "s" sounds clearly', targetDate: '2099-06-01' })).body;
  assert.equal(goal.progress, 0);
  await call(mom, 'POST', `${t}/notes`, { goalId: goal.id, appointmentId: appt.body.id, body: 'Good session, 6/10 correct', progress: 40, date: '2026-10-01' });
  await call(mom, 'POST', `${t}/notes`, { goalId: goal.id, body: 'Practiced at home', progress: 55, date: '2026-10-10' });
  await call(mom, 'POST', `${t}/notes`, { body: 'Ate peas without fuss!' });
  assert.equal((await call(mom, 'POST', `${t}/notes`, { body: 'x', progress: 50 })).status, 400, 'progress needs a goal');

  // Notes can't be filed on another kid's goal.
  assert.equal((await call(mom, 'POST', `${base}/kids/${ben.id}/therapy/notes`, { goalId: goal.id, body: 'x' })).status, 400);

  let data = (await call(mom, 'GET', t)).body;
  assert.equal(data.goals[0].progress, 55);
  assert.deepEqual(data.goals[0].history, [{ date: '2026-10-01', progress: 40 }, { date: '2026-10-10', progress: 55 }]);
  assert.equal(data.notes.length, 3);
  assert.equal(data.notes.find((n: { progress: number }) => n.progress === 40).goalTitle, 'Say "s" sounds clearly');
  assert.equal(data.kidVisible, false);

  // Mark met.
  const met = (await call(mom, 'PATCH', `${base}/therapy/goals/${goal.id}`, { status: 'met' })).body;
  assert.equal(met.status, 'met');
  assert.equal(met.progress, 100);
  assert.ok(met.metAt);
  await call(mom, 'PATCH', `${base}/therapy/appointments/${appt.body.id}`, { status: 'done' });
  data = (await call(mom, 'GET', t)).body;
  assert.equal(data.appointments[0].status, 'done');

  // Upcoming list for the parents' home screen.
  await call(mom, 'POST', `${t}/appointments`, { kind: 'doctor', title: 'Checkup', startsAt: '2099-02-01T09:00' });
  const upcoming = (await call(mom, 'GET', `${base}/therapy/upcoming`)).body;
  assert.deepEqual(upcoming.map((a: { title: string }) => a.title), ['Checkup']);
  assert.equal(upcoming[0].kidName, 'Ava');
});

test("therapy stays hidden from the kid until a parent shares it, and never shows notes", async () => {
  const { call, mom, base, ava, tablet } = await family();
  const t = `${base}/kids/${ava.id}/therapy`;
  await call(mom, 'POST', `${t}/goals`, { area: 'feeding', title: 'Try one new food a week', progress: 30 });
  await call(mom, 'POST', `${t}/appointments`, { kind: 'feeding', title: 'Feeding clinic', startsAt: '2099-03-03T10:00' });
  await call(mom, 'POST', `${t}/notes`, { body: 'Private note for parents' });
  let board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.equal(board.therapy, null);
  await call(mom, 'PATCH', t, { kidVisible: true });
  board = (await call(tablet, 'GET', `${base}/kids/${ava.id}/board`)).body;
  assert.deepEqual(board.therapy.goals.map((g: { title: string; progress: number }) => [g.title, g.progress]), [['Try one new food a week', 30]]);
  assert.equal(board.therapy.upcoming[0].title, 'Feeding clinic');
  assert.ok(!JSON.stringify(board).includes('Private note'), 'notes never reach the kid');
});

test('deleting a kid removes their therapy records', async () => {
  const { call, mom, base, ben } = await family();
  await call(mom, 'POST', `${base}/kids/${ben.id}/therapy/goals`, { title: 'Walk up stairs alternating feet', area: 'motor' });
  await call(mom, 'DELETE', `${base}/kids/${ben.id}`);
  assert.equal((await call(mom, 'GET', `${base}/kids/${ben.id}/therapy`)).status, 404);
});

test('honey-do board: cards move between columns and stay with the parents', async () => {
  const { call, mom, home, base, ava, tablet } = await family();
  const dad: Jar = {};
  await call(dad, 'POST', '/api/auth/local', { name: 'Dad' });
  const { body: detail } = await call(mom, 'GET', base);
  await call(dad, 'POST', '/api/homes/join', { code: detail.joinCode });
  const parents = (await call(mom, 'GET', base)).body.parents as { id: string; name: string }[];
  const dadMember = parents.find((p) => p.name === 'Dad')!;

  const card = (await call(mom, 'POST', `${base}/honeydo`, { title: 'Fix the squeaky door', assigneeId: dadMember.id, dueDate: '2026-10-25' })).body;
  assert.equal(card.status, 'todo');
  assert.equal((await call(mom, 'POST', `${base}/honeydo`, { title: 'x', assigneeId: ava.id })).status, 400, 'only parents get honey-do cards');
  await call(mom, 'POST', `${base}/honeydo`, { title: 'Plan date night' });
  const doing = (await call(dad, 'PATCH', `${base}/honeydo/${card.id}`, { status: 'doing' })).body;
  assert.equal(doing.status, 'doing');
  const done = (await call(dad, 'PATCH', `${base}/honeydo/${card.id}`, { status: 'done' })).body;
  assert.ok(done.doneAt);
  assert.equal((await call(dad, 'PATCH', `${base}/honeydo/${card.id}`, { status: 'todo' })).body.doneAt, null, 'reopening clears done');
  const list = (await call(dad, 'GET', `${base}/honeydo`)).body;
  assert.equal(list.length, 2);
  assert.equal((await call(tablet, 'GET', `${base}/honeydo`)).status, 403);
  assert.equal((await call(mom, 'PATCH', `${base}/honeydo/${card.id}`, { status: 'someday' })).status, 400);
  await call(mom, 'DELETE', `${base}/honeydo/${card.id}`);
  assert.equal((await call(mom, 'GET', `${base}/honeydo`)).body.length, 1);
  assert.ok(home.id);
});
