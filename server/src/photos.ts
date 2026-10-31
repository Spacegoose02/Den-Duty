// Photo proof for chores: one small picture per chore instance, stored as a file in the data folder and kept 30 days.
// Pictures are resized on the kid's device before upload; here we only check they really are images and not too big.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Row } from './db.ts';
import { config } from './config.ts';
import { HttpError } from './util.ts';

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const PHOTO_KEEP_DAYS = 30;

const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};
const MIME_BY_EXT: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const homeDir = (homeId: string) => path.join(config.dataDir, 'photos', homeId.replace(/[^a-zA-Z0-9-]/g, ''));

/** Accepts a data: URL (what the browser's canvas gives us). */
export function decodePhoto(v: unknown): { bytes: Buffer; ext: string } {
  const m = typeof v === 'string' ? /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(v) : null;
  const type = m && TYPES[m[1]];
  if (!m || !type) throw new HttpError(400, 'Send a JPEG, PNG or WebP photo');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > PHOTO_MAX_BYTES) throw new HttpError(413, 'That photo is too big');
  if (!type.magic(bytes)) throw new HttpError(400, "That doesn't look like a photo");
  return { bytes, ext: type.ext };
}

/** Saves the photo for a chore instance, replacing any earlier one. Returns the stored file name. */
export function savePhoto(db: DatabaseSync, homeId: string, instanceId: string, photo: { bytes: Buffer; ext: string }): string {
  const dir = homeDir(homeId);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${instanceId}-${crypto.randomBytes(6).toString('hex')}.${photo.ext}`;
  fs.writeFileSync(path.join(dir, name), photo.bytes);
  const old = (db.prepare('SELECT photo FROM chore_instances WHERE id = ?').get(instanceId) as Row | undefined)?.photo as string | null;
  db.prepare('UPDATE chore_instances SET photo = ? WHERE id = ?').run(name, instanceId);
  if (old) fs.rmSync(path.join(dir, path.basename(old)), { force: true });
  return name;
}

export function readPhoto(homeId: string, name: string): { bytes: Buffer; type: string } | null {
  const file = path.join(homeDir(homeId), path.basename(name));
  if (!fs.existsSync(file)) return null;
  return { bytes: fs.readFileSync(file), type: MIME_BY_EXT[path.extname(file).slice(1)] ?? 'application/octet-stream' };
}

/** Drops photos for chores older than PHOTO_KEEP_DAYS. Cheap enough to run on every upload. */
export function prunePhotos(db: DatabaseSync, homeId: string, today: string): void {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - PHOTO_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const old = db.prepare('SELECT id, photo FROM chore_instances WHERE home_id = ? AND photo IS NOT NULL AND date < ?').all(homeId, cutoff) as Row[];
  for (const r of old) {
    fs.rmSync(path.join(homeDir(homeId), path.basename(r.photo as string)), { force: true });
    db.prepare('UPDATE chore_instances SET photo = NULL WHERE id = ?').run(r.id as string);
  }
}
