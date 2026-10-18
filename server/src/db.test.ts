import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const { openDb } = await import('./db.ts');

test('a database from before the rename (daytime-ninja.db) is carried over to den-duty.db', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-db-'));
  const old = new DatabaseSync(path.join(dir, 'daytime-ninja.db'));
  old.exec("CREATE TABLE keepme (v TEXT); INSERT INTO keepme VALUES ('still here');");
  old.close();
  const db = openDb(dir);
  assert.equal((db.prepare('SELECT v FROM keepme').get() as { v: string }).v, 'still here');
  db.close();
  assert.ok(fs.existsSync(path.join(dir, 'den-duty.db')));
  assert.ok(!fs.existsSync(path.join(dir, 'daytime-ninja.db')));
});
