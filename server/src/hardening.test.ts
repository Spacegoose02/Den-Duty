// Holes closed in the security check: tokens writing outside the HA actions, a bare family tablet acting for a kid,
// join-code guessing, and oversized calendar feeds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { family } from './test-helpers.ts';

const { fetchText } = await import('./calendar.ts');

test('tokens only write through the Home Assistant actions, and only control tokens', async () => {
  const { call, mom, base, ava } = await family();
  const read = (await call(mom, 'POST', `${base}/tokens`, { name: 'Look', scope: 'read' })).body.token as string;
  const control = (await call(mom, 'POST', `${base}/tokens`, { name: 'Act', scope: 'control' })).body.token as string;
  const as = (t: string) => ({ authorization: `Bearer ${t}` });
  await call(mom, 'POST', `${base}/kids/${ava.id}/points`, { amount: 50, reason: 'Start' });
  const t = (await call(mom, 'POST', `${base}/kids/${ava.id}/timeouts`, { what: 'No TV', length: 1, unit: 'days', buyUnit: 'hour', buyPrice: 1, buyMaxUnits: 4 })).body;

  assert.equal((await call({}, 'GET', `${base}/ha/summary`, undefined, as(read))).status, 200, 'reading still works');
  for (const tok of [read, control]) {
    assert.equal((await call({}, 'POST', `${base}/timeouts/${t.id}/requests`, { units: 1 }, as(tok))).status, 403);
  }
  const asked = (await call(mom, 'POST', `${base}/timeouts/${t.id}/requests`, { units: 1 })).body;
  assert.equal((await call({}, 'DELETE', `${base}/timeout-requests/${asked.pending.id}`, undefined, as(read))).status, 403, 'a read token used to cancel these');
  assert.equal((await call({}, 'POST', `${base}/ha/points`, { kid: 'Avaleigh', amount: 2, reason: 'HA' }, as(read))).status, 403);
  assert.equal((await call({}, 'POST', `${base}/ha/points`, { kid: 'Avaleigh', amount: 2, reason: 'HA' }, as(control))).status, 200);
});

test("a family tablet nobody has tapped into can't ask for or cancel a kid's time-out buy-back", async () => {
  const { call, mom, base, ava, tablet } = await family();
  await call(mom, 'POST', `${base}/kids/${ava.id}/points`, { amount: 50, reason: 'Start' });
  await call(mom, 'PATCH', `${base}/kids/${ava.id}`, { pin: '4321' });
  const t = (await call(mom, 'POST', `${base}/kids/${ava.id}/timeouts`, { what: 'No TV', length: 1, unit: 'days', buyUnit: 'hour', buyPrice: 1, buyMaxUnits: 4 })).body;
  await call(tablet, 'POST', '/api/kiosk/kid/logout', {});
  assert.equal((await call(tablet, 'POST', `${base}/timeouts/${t.id}/requests`, { units: 1 })).status, 403);

  const asked = (await call(mom, 'POST', `${base}/timeouts/${t.id}/requests`, { units: 1 })).body;
  assert.equal((await call(tablet, 'DELETE', `${base}/timeout-requests/${asked.pending.id}`)).status, 403);
});

test('guessing join codes is rate limited', async () => {
  const { call } = await family();
  const eve: Record<string, string> = {};
  await call(eve, 'POST', '/api/auth/local', { name: 'Eve' });
  const codes = await Promise.all(Array.from({ length: 10 }, () => call(eve, 'POST', '/api/homes/join', { code: 'AAAAAAAA' })));
  assert.ok(codes.some((r) => r.status === 429));
});

test('calendar feeds stop downloading past 2 MB', async () => {
  const server = http.createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/calendar' });
    res.write('BEGIN:VCALENDAR\r\n');
    const chunk = Buffer.alloc(64 * 1024, 'x');
    let sent = 0;
    const pump = () => { while (sent < 50 * 1024 * 1024 && res.write(chunk)) sent += chunk.length; if (sent < 50 * 1024 * 1024) res.once('drain', pump); else res.end(); };
    pump();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  await assert.rejects(fetchText(`http://127.0.0.1:${port}/big.ics`), /too big/);
  server.closeAllConnections();
  server.close();
});
