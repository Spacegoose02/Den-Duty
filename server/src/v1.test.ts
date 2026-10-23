// The public API (/api/v1): tokens stand in for a parent as far as their scope reaches, and private things stay out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { family } from './test-helpers.ts';

const { V1_ROUTES } = await import('./routes/v1.ts');

test('the public API: read tokens look, control tokens act, and everything is credited to the token', async () => {
  const { call, mom, base, ava, ben, tablet, asKid, today } = await family();
  const v1 = base.replace('/api/', '/api/v1/');
  const mk = async (scope: string) => ({ authorization: `Bearer ${(await call(mom, 'POST', `${base}/tokens`, { name: scope === 'control' ? 'Dashboard' : 'Viewer', scope })).body.token}` });
  const read = await mk('read');
  const control = await mk('control');
  const as = (h: Record<string, string>, method: string, url: string, body?: unknown) => call({}, method, url, body, h);

  // No token, or another home: no.
  assert.equal((await call({}, 'GET', `${v1}/kids`)).status, 401);
  const other = (await call(mom, 'POST', '/api/homes', { name: 'Other', timezone: 'UTC' })).body;
  assert.equal((await as(read, 'GET', `/api/v1/homes/${other.id}/kids`)).status, 403);

  // Home info leaves the join code out.
  const home = (await as(read, 'GET', v1)).body;
  assert.equal(home.today, today);
  assert.equal(home.joinCode, undefined);

  // Read token: chores list (parents-only in the app) works, creating one doesn't.
  assert.deepEqual((await as(read, 'GET', `${v1}/kids`)).body.map((k: { name: string }) => k.name), ['Avaleigh', 'Benedict']);
  assert.equal((await as(read, 'POST', `${v1}/chores`, { title: 'Dishes', memberIds: [ava.id] })).status, 403);

  // Control token: create a chore, kid marks it done, the token approves it.
  const chore = (await as(control, 'POST', `${v1}/chores`, { title: 'Dishes', points: 3, memberIds: [ava.id, ben.id] })).body;
  assert.equal(chore.title, 'Dishes');
  assert.equal((await as(read, 'GET', `${v1}/chores`)).body.length, 1);
  const items = (await as(read, 'GET', `${v1}/instances?from=${today}&to=${today}&kid=${ava.id}`)).body;
  assert.deepEqual(items.map((i: { title: string; status: string }) => [i.title, i.status]), [['Dishes', 'pending']]);
  await asKid(ava);
  await call(tablet, 'POST', `${base}/instances/${items[0].id}/done`, {});
  assert.equal((await as(read, 'GET', `${v1}/review`)).body.length, 1);
  assert.equal((await as(read, 'POST', `${v1}/instances/${items[0].id}/approve`)).status, 403);
  assert.equal((await as(control, 'POST', `${v1}/instances/${items[0].id}/approve`)).body.awarded, 3);
  assert.equal((await as(read, 'GET', `${v1}/instances?from=${today}&to=${today}&status=approved`)).body.length, 1);

  // Points and the ledger credit the token by name.
  assert.equal((await as(control, 'POST', `${v1}/kids/${ben.id}/points`, { amount: 5, reason: 'Helped' })).status, 200);
  const ledger = (await as(read, 'GET', `${v1}/kids/${ben.id}/ledger`)).body;
  assert.equal(ledger.balance, 5);
  assert.equal(ledger.entries[0].by, '🔑 Dashboard');

  // Parent Duty and events.
  const card = (await as(control, 'POST', `${v1}/parent-duty`, { title: 'Sign the form', kidId: ava.id })).body;
  await as(control, 'POST', `${v1}/parent-duty/${card.id}/close`, { note: 'Done via API' });
  assert.equal((await as(read, 'GET', `${v1}/parent-duty/history`)).body[0].closeNote, 'Done via API');
  const events = (await as(read, 'GET', `${v1}/events`)).body;
  assert.ok(events.some((e: { event: string }) => e.event === 'chore_approved'));

  // Bad input says why.
  assert.equal((await as(read, 'GET', `${v1}/instances?from=2026-01-01&to=2026-12-31`)).status, 400);
});

test("private parts of the app aren't on the public API", async () => {
  const { call, mom, base, ava } = await family();
  const v1 = base.replace('/api/', '/api/v1/');
  const h = { authorization: `Bearer ${(await call(mom, 'POST', `${base}/tokens`, { name: 'x', scope: 'control' })).body.token}` };
  for (const path of [`/kids/${ava.id}/therapy`, `/kids/${ava.id}/helpdesk`, '/tokens', '/summary', '/agenda', `/kids/${ava.id}/stats`, '/reminders', '/ai']) {
    assert.equal((await call({}, 'GET', `${v1}${path}`, undefined, h)).status, 404, path);
  }
  // A control token still can't use the app's own (non-v1) routes.
  assert.equal((await call({}, 'POST', `${base}/chores`, { title: 'x', memberIds: [ava.id] }, h)).status, 403);
  // Every documented route exists, and the spec is public.
  const spec = (await call({}, 'GET', '/api/v1/openapi.json')).body;
  assert.equal(Object.values(spec.paths).reduce((n: number, p) => n + Object.keys(p as object).length, 0), V1_ROUTES.length);
});
