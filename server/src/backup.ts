// Backups: a copy of the whole database (every home, the points and money ledgers, Doctors, settings) in the data
// folder's "backups" folder. One is made every night, the newest few are kept, and an admin can make one, download
// one, upload one, or restore one. A restore is staged and swapped in when the server next starts, so the running
// server never has its database pulled out from under it. The database being replaced is kept as a backup too.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { getSetting, requireAdmin, setSetting } from './auth.ts';
import { MIGRATIONS, type Row } from './db.ts';
import { HttpError } from './util.ts';

export const BACKUP_KEEP_DEFAULT = 14;
/** The hour (server time) the nightly backup runs, if one hasn't been made that day. */
export const BACKUP_HOUR = 3;
const NAME = /^den-duty-[\w-]{1,80}\.db$/;
const PENDING = 'restore-pending.db';
/** Uploads can be big: years of history and photos' metadata. Photos themselves live outside the database. */
export const UPLOAD_LIMIT = 512 * 1024 * 1024;

export const backupDir = (dataDir: string): string => path.join(dataDir, 'backups');

export interface BackupSettings { on: boolean; keep: number }

export function backupSettings(db: DatabaseSync): BackupSettings {
  const keep = Number(getSetting(db, 'backup_keep'));
  return { on: getSetting(db, 'backup_on') !== '0', keep: Number.isInteger(keep) && keep >= 1 && keep <= 365 ? keep : BACKUP_KEEP_DEFAULT };
}

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace(/[:T]/g, '-');

export interface BackupFile { name: string; bytes: number; createdAt: string; kind: 'nightly' | 'manual' | 'before-restore' | 'uploaded' }

const kindOf = (name: string): BackupFile['kind'] =>
  name.includes('-before-restore') ? 'before-restore' : name.includes('-uploaded') ? 'uploaded' : name.includes('-manual') ? 'manual' : 'nightly';

export function listBackups(dataDir: string): BackupFile[] {
  const dir = backupDir(dataDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => NAME.test(n)).map((name) => {
    const st = fs.statSync(path.join(dir, name));
    return { name, bytes: st.size, createdAt: st.mtime.toISOString(), kind: kindOf(name) };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

/** Writes a consistent copy of the live database (VACUUM INTO works while others read and write). */
export function makeBackup(db: DatabaseSync, dataDir: string, kind: 'nightly' | 'manual' = 'manual', now = new Date()): BackupFile {
  const dir = backupDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  let name = `den-duty-${stamp(now)}${kind === 'manual' ? '-manual' : ''}.db`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `den-duty-${stamp(now)}${kind === 'manual' ? '-manual' : ''}-${i}.db`;
  const file = path.join(dir, name);
  db.prepare('VACUUM INTO ?').run(file);
  prune(dataDir, backupSettings(db).keep);
  return listBackups(dataDir).find((b) => b.name === name)!;
}

/** Keeps the newest `keep` nightly and manual backups. Uploaded and before-restore copies stay until deleted by hand. */
export function prune(dataDir: string, keep: number): void {
  const old = listBackups(dataDir).filter((b) => b.kind === 'nightly' || b.kind === 'manual').slice(keep);
  for (const b of old) fs.rmSync(path.join(backupDir(dataDir), b.name), { force: true });
}

/** Run from the minute timer: one nightly backup a day, after BACKUP_HOUR. Returns the file when it made one. */
export function nightlyBackup(db: DatabaseSync, dataDir: string, now = new Date()): BackupFile | null {
  if (!backupSettings(db).on || now.getHours() < BACKUP_HOUR) return null;
  const day = now.toISOString().slice(0, 10);
  if (getSetting(db, 'backup_last_day') === day) return null;
  setSetting(db, 'backup_last_day', day);
  return makeBackup(db, dataDir, 'nightly', now);
}

/** Checks a file is a Den Duty database this server can open (not newer than this version). */
export function checkDatabase(file: string): { version: number; homes: number } {
  let other: DatabaseSync | null = null;
  try {
    other = new DatabaseSync(file, { readOnly: true });
    const version = Number((other.prepare('PRAGMA user_version').get() as Row).user_version);
    if (!version) throw new Error('empty');
    if (version > MIGRATIONS.length) throw new HttpError(400, 'That backup is from a newer version of Den Duty. Update the server first.');
    const homes = Number((other.prepare('SELECT COUNT(*) AS n FROM homes').get() as Row).n);
    const ok = (other.prepare('PRAGMA quick_check').get() as Row).quick_check;
    if (ok !== 'ok') throw new HttpError(400, 'That backup is damaged');
    return { version, homes };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "That isn't a Den Duty backup");
  } finally {
    other?.close();
  }
}

/** Stages a backup to replace the database at the next start. */
export function stageRestore(dataDir: string, name: string): { version: number; homes: number } {
  if (!NAME.test(name)) throw new HttpError(400, 'Unknown backup');
  const src = path.join(backupDir(dataDir), name);
  if (!fs.existsSync(src)) throw new HttpError(404, 'That backup is gone');
  const info = checkDatabase(src);
  fs.copyFileSync(src, path.join(dataDir, PENDING));
  return info;
}

export const restorePending = (dataDir: string): boolean => fs.existsSync(path.join(dataDir, PENDING));

export function cancelRestore(dataDir: string): void {
  fs.rmSync(path.join(dataDir, PENDING), { force: true });
}

/**
 * Called before the database opens: swaps a staged restore in. The current database is copied to the backups
 * folder first (as "before-restore"), so a restore can always be undone.
 */
export function applyPendingRestore(dataDir: string, now = new Date()): boolean {
  const pending = path.join(dataDir, PENDING);
  if (!fs.existsSync(pending)) return false;
  const file = path.join(dataDir, 'den-duty.db');
  try { checkDatabase(pending); } catch { fs.rmSync(pending, { force: true }); return false; }
  fs.mkdirSync(backupDir(dataDir), { recursive: true });
  if (fs.existsSync(file)) {
    // Fold the write-ahead log in first so the copy is whole.
    const cur = new DatabaseSync(file);
    try { cur.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { cur.close(); }
    fs.copyFileSync(file, path.join(backupDir(dataDir), `den-duty-${stamp(now)}-before-restore.db`));
  }
  for (const ext of ['-wal', '-shm']) fs.rmSync(file + ext, { force: true });
  fs.renameSync(pending, file);
  return true;
}

export function backupRoutes(app: FastifyInstance, db: DatabaseSync, dataDir: string): void {
  const view = () => ({ ...backupSettings(db), dir: backupDir(dataDir), backups: listBackups(dataDir), restorePending: restorePending(dataDir) });

  app.get('/api/admin/backups', async (req) => { requireAdmin(req); return view(); });

  app.patch('/api/admin/backups', async (req) => {
    requireAdmin(req);
    const b = (req.body ?? {}) as { on?: unknown; keep?: unknown };
    if (b.on != null) setSetting(db, 'backup_on', b.on ? '1' : '0');
    if (b.keep != null) {
      const keep = Number(b.keep);
      if (!Number.isInteger(keep) || keep < 1 || keep > 365) throw new HttpError(400, 'Keep 1 to 365 backups');
      setSetting(db, 'backup_keep', String(keep));
      prune(dataDir, keep);
    }
    return view();
  });

  app.post('/api/admin/backups', async (req) => { requireAdmin(req); makeBackup(db, dataDir, 'manual'); return view(); });

  app.get('/api/admin/backups/:name', async (req, reply) => {
    requireAdmin(req);
    const name = (req.params as { name: string }).name;
    if (!NAME.test(name) || !fs.existsSync(path.join(backupDir(dataDir), name))) throw new HttpError(404, 'That backup is gone');
    return reply.header('content-type', 'application/vnd.sqlite3').header('content-disposition', `attachment; filename="${name}"`)
      .send(fs.createReadStream(path.join(backupDir(dataDir), name)));
  });

  app.delete('/api/admin/backups/:name', async (req) => {
    requireAdmin(req);
    const name = (req.params as { name: string }).name;
    if (!NAME.test(name)) throw new HttpError(400, 'Unknown backup');
    fs.rmSync(path.join(backupDir(dataDir), name), { force: true });
    return view();
  });

  app.post('/api/admin/backups/:name/restore', async (req) => {
    requireAdmin(req);
    const info = stageRestore(dataDir, (req.params as { name: string }).name);
    return { ...view(), staged: info };
  });

  app.delete('/api/admin/restore', async (req) => { requireAdmin(req); cancelRestore(dataDir); return view(); });

  // Upload a backup file (the raw .db as the body). It's checked, then kept with the other backups.
  app.register(async (scope) => {
    scope.addContentTypeParser(['application/octet-stream', 'application/vnd.sqlite3', 'application/x-sqlite3'],
      { parseAs: 'buffer', bodyLimit: UPLOAD_LIMIT }, (_req, body, done) => done(null, body));
    scope.post('/api/admin/backups/upload', { bodyLimit: UPLOAD_LIMIT }, async (req) => {
      requireAdmin(req);
      const body = req.body as Buffer | undefined;
      if (!Buffer.isBuffer(body) || body.length < 512) throw new HttpError(400, 'Send the backup file as the body');
      const dir = backupDir(dataDir);
      fs.mkdirSync(dir, { recursive: true });
      const name = `den-duty-${stamp(new Date())}-uploaded.db`;
      const tmp = path.join(dir, `.${name}.part`);
      fs.writeFileSync(tmp, body);
      try { checkDatabase(tmp); } catch (err) { fs.rmSync(tmp, { force: true }); throw err; }
      fs.renameSync(tmp, path.join(dir, name));
      return { ...view(), uploaded: name };
    });
  });
}
