// The public app download page: files from the downloads folder, GitHub fallbacks, and nothing outside that folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-dl-'));
process.env.DATA_DIR = dataDir;
const dir = path.join(dataDir, 'downloads');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'DenDuty-Setup-0.2.0.exe'), 'installer');
fs.writeFileSync(path.join(dir, 'DenDuty-Portable-0.2.0.exe'), 'portable!');
fs.writeFileSync(path.join(dir, 'notes.txt'), 'not an app');
fs.writeFileSync(path.join(dir, '.hidden.apk'), 'hidden');
fs.writeFileSync(path.join(dataDir, 'secret.exe'), 'outside the folder');

const { family } = await import('./test-helpers.ts');

test('anyone can list and download the apps in the downloads folder, and nothing else', async () => {
  const { call } = await family();
  const anon = {};
  const { status, body } = await call(anon, 'GET', '/api/downloads');
  assert.equal(status, 200, 'no sign-in needed');
  assert.deepEqual(body.files.map((f: { name: string }) => f.name).sort(), ['DenDuty-Portable-0.2.0.exe', 'DenDuty-Setup-0.2.0.exe']);
  const setup = body.files.find((f: { kind: string }) => f.kind === 'windows-installer');
  assert.deepEqual([setup.version, setup.size, setup.url], ['0.2.0', 9, '/downloads/DenDuty-Setup-0.2.0.exe']);
  assert.deepEqual(body.fallback.map((f: { kind: string }) => f.kind), ['android'], 'GitHub fills in only what the folder lacks');
  assert.match(body.fallback[0].url, /releases\/latest\/download\/DenDuty\.apk$/);
  assert.match(body.qrSvg, /^<svg/);

  const dl = await call(anon, 'GET', setup.url);
  assert.equal(dl.status, 200);
  assert.equal(dl.body, 'installer');

  for (const bad of ['notes.txt', '.hidden.apk', '..%2Fsecret.exe', '..%5Csecret.exe', 'missing.apk']) {
    assert.equal((await call(anon, 'GET', `/downloads/${bad}`)).status, 404, bad);
  }
});
