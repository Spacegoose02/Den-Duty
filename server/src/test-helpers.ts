// Shared setup for the server tests: a home with a parent, two kids with birthdays and a paired family tablet,
// plus a local stand-in for the Claude API. Not a test file itself.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'dn-test-'));
process.env.ALLOW_LOCAL_LOGIN = 'true';

const { openMemoryDb } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { setAiFetch } = await import('./ai.ts');
const { todayIn, addDays } = await import('../../shared/schedule.ts');

type Jar = Record<string, string>;
export type Sent = { url: string; body: Record<string, unknown> };

export async function family() {
  const db = openMemoryDb();
  const app = await buildApp(db, { serveWeb: false });
  const call = async (jar: Jar, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await app.inject({ method: method as 'GET', url, payload: payload as object, headers: { ...headers, ...(cookie ? { cookie } : {}) } });
    for (const ck of res.cookies) { if (ck.value) jar[ck.name] = ck.value; else delete jar[ck.name]; }
    const json = String(res.headers['content-type'] ?? '').includes('json');
    return { status: res.statusCode, body: res.body ? (json ? JSON.parse(res.body) : res.body) : null };
  };
  const mom: Jar = {};
  await call(mom, 'POST', '/api/auth/local', { name: 'Mom' });
  const { body: home } = await call(mom, 'POST', '/api/homes', { name: 'Den', timezone: 'UTC' });
  const base = `/api/homes/${home.id}`;
  const today = todayIn('UTC');
  const ava = (await call(mom, 'POST', `${base}/kids`, { name: 'Avaleigh', birthdate: addDays(today, -365 * 4 - 30) })).body;
  const ben = (await call(mom, 'POST', `${base}/kids`, { name: 'Benedict', birthdate: addDays(today, -365 * 9 - 30) })).body;
  const tablet: Jar = {};
  const { body: code } = await call(mom, 'POST', '/api/auth/pair-code', { kind: 'device', homeId: home.id });
  await call(tablet, 'POST', '/api/auth/pair', { code: code.code });
  const asKid = async (kid: { id: string }) => {
    await call(tablet, 'POST', '/api/kiosk/kid/logout', {});
    await call(tablet, 'POST', '/api/kiosk/kid', { memberId: kid.id });
  };
  return { db, call, mom, base, ava, ben, tablet, asKid, today };
}

/** A local stand-in for the Claude API that answers with `reply` and records each request body. */
export function fakeClaude(sent: Sent[], reply: (body: Record<string, unknown>) => object) {
  setAiFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push({ url: String(input), body });
    return new Response(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify(reply(body)) }], usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);
}

