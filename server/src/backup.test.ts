import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { family } from './test-helpers.ts';
import { applyPendingRestore, backupDir, listBackups, makeBackup, nightlyBackup, prune } from './backup.ts';
import { openDb, type Row } from './db.ts';

test('backups: make, list, download, keep the newest, nightly once a day, admins only', async () => {
  const { db, call, mom, tablet } = await family();
  const dataDir = process.env.DATA_DIR!;
  fs.rmSync(backupDir(dataDir), { recursive: true, force: true });

  assert.equal((await call(tablet, 'GET', '/api/admin/backups')).status, 401);
  const made = (await call(mom, 'POST', '/api/admin/backups')).body;
  assert.equal(made.backups.length, 1);
  assert.equal(made.backups[0].kind, 'manual');
  const name = made.backups[0].name as string;

  // The copy is a whole, readable database with the home in it.
  const copy = new DatabaseSync(path.join(backupDir(dataDir), name), { readOnly: true });
  assert.equal((copy.prepare('SELECT name FROM homes').get() as Row).name, 'Den');
  copy.close();

  const dl = await call(mom, 'GET', `/api/admin/backups/${name}`);
  assert.equal(dl.status, 200);
  assert.match(String(dl.headers['content-disposition']), /attachment/);
  assert.equal((await call(mom, 'GET', '/api/admin/backups/../../etc.db')).status, 404);

  // Nightly: only after 3 am, and only once that day.
  assert.equal(nightlyBackup(db, dataDir, new Date(2026, 10, 8, 2, 0)), null);
  assert.ok(nightlyBackup(db, dataDir, new Date(2026, 10, 8, 3, 5)));
  assert.equal(nightlyBackup(db, dataDir, new Date(2026, 10, 8, 23, 0)), null);

  // Keep: pruning leaves the newest.
  for (let i = 0; i < 4; i++) makeBackup(db, dataDir, 'manual', new Date(Date.UTC(2026, 0, 1 + i)));
  prune(dataDir, 2);
  assert.equal(listBackups(dataDir).length, 2);
  const s = (await call(mom, 'PATCH', '/api/admin/backups', { keep: 1, on: false })).body;
  assert.equal(s.keep, 1);
  assert.equal(s.on, false);
  assert.equal(s.backups.length, 1);
  assert.equal(nightlyBackup(db, dataDir, new Date(2026, 10, 9, 4, 0)), null, 'off means no nightly backup');
});

test('restore: staged, swapped in at start, the old database kept; uploads are checked', async () => {
  const { call, mom } = await family();
  const dataDir = process.env.DATA_DIR!;
  fs.rmSync(backupDir(dataDir), { recursive: true, force: true });
  const name = (await call(mom, 'POST', '/api/admin/backups')).body.backups[0].name as string;

  // Junk uploads are refused; a real backup is accepted.
  const junk = await call(mom, 'POST', '/api/admin/backups/upload', Buffer.alloc(4096, 1), { 'content-type': 'application/octet-stream' });
  assert.equal(junk.status, 400);
  const up = await call(mom, 'POST', '/api/admin/backups/upload', fs.readFileSync(path.join(backupDir(dataDir), name)), { 'content-type': 'application/octet-stream' });
  assert.equal(up.status, 200);
  assert.ok(up.body.backups.some((b: { kind: string }) => b.kind === 'uploaded'));

  const staged = (await call(mom, 'POST', `/api/admin/backups/${name}/restore`)).body;
  assert.equal(staged.restorePending, true);
  assert.equal(staged.staged.homes, 1);
  assert.equal((await call(mom, 'DELETE', '/api/admin/restore')).body.restorePending, false);

  // The swap itself, in a separate data folder: the live database is replaced and the old one kept.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-restore-'));
  const live = openDb(dir);
  live.prepare("INSERT INTO homes (id, name, join_code) VALUES ('h-live', 'Live', 'LIVE1234')").run();
  live.close();
  fs.copyFileSync(path.join(backupDir(dataDir), name), path.join(dir, 'restore-pending.db'));
  assert.equal(applyPendingRestore(dir), true);
  const after = openDb(dir);
  assert.deepEqual((after.prepare('SELECT name FROM homes').all() as Row[]).map((h) => h.name), ['Den']);
  after.close();
  assert.equal(listBackups(dir).filter((b) => b.kind === 'before-restore').length, 1);
  assert.equal(applyPendingRestore(dir), false, 'nothing staged any more');
});
