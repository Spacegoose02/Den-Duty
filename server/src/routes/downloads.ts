// The /download page's files: the Windows and Android apps (and anything else app-shaped) from the downloads folder,
// so anyone can grab the app straight from the server. Public on purpose: the apps are thin wrappers that still need
// a sign-in or pairing code, and only files in that one folder with an app extension are ever served.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { config } from '../config.ts';
import { HttpError } from '../util.ts';

export type DownloadKind = 'windows-installer' | 'windows-portable' | 'android' | 'linux' | 'mac';

const KINDS: { kind: DownloadKind; test: RegExp; label: string; type: string }[] = [
  { kind: 'android', test: /\.apk$/i, label: 'Android (phones and tablets)', type: 'application/vnd.android.package-archive' },
  { kind: 'windows-portable', test: /portable.*\.exe$/i, label: 'Windows, portable (no install)', type: 'application/vnd.microsoft.portable-executable' },
  { kind: 'windows-installer', test: /\.(exe|msi)$/i, label: 'Windows installer', type: 'application/vnd.microsoft.portable-executable' },
  { kind: 'linux', test: /\.appimage$/i, label: 'Linux (AppImage)', type: 'application/octet-stream' },
  { kind: 'mac', test: /\.dmg$/i, label: 'Mac', type: 'application/x-apple-diskimage' },
];

/** The fixed-name copies each GitHub release carries (see .github/workflows/release.yml). */
const FALLBACK: { kind: DownloadKind; file: string }[] = [
  { kind: 'windows-installer', file: 'DenDuty-Setup.exe' },
  { kind: 'windows-portable', file: 'DenDuty-Portable.exe' },
  { kind: 'android', file: 'DenDuty.apk' },
];

const SAFE_NAME = /^[\w][\w.\- ()]{0,150}$/;

export const kindOf = (name: string) => KINDS.find((k) => k.test.test(name));

export interface DownloadFile { name: string; kind: DownloadKind; label: string; size: number; version: string | null; updatedAt: string; url: string }

/** App files in the downloads folder, newest first. Anything that isn't an app, hidden or oddly named is ignored. */
export function listDownloads(dir = config.downloadsDir): DownloadFile[] {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out: DownloadFile[] = [];
  for (const name of names) {
    const k = kindOf(name);
    if (!k || !SAFE_NAME.test(name)) continue;
    let st: fs.Stats;
    try { st = fs.statSync(path.join(dir, name)); } catch { continue; }
    if (!st.isFile()) continue;
    out.push({
      name, kind: k.kind, label: k.label, size: st.size, version: /(\d+\.\d+\.\d+)/.exec(name)?.[1] ?? null,
      updatedAt: st.mtime.toISOString(), url: `/downloads/${encodeURIComponent(name)}`,
    });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function downloadRoutes(app: FastifyInstance): void {
  app.get('/api/downloads', async (req) => {
    const files = listDownloads();
    const have = new Set(files.map((f) => f.kind));
    const fallback = config.downloadsFallback
      ? FALLBACK.filter((f) => !have.has(f.kind)).map((f) => ({ kind: f.kind, label: kindOf(f.file)!.label, url: `${config.downloadsFallback}/${f.file}` }))
      : [];
    // The address people type into the apps, and a QR code of this page for phones.
    const server = process.env.PUBLIC_URL ? config.publicUrl : `${req.protocol}://${req.host}`;
    const qrSvg = await QRCode.toString(`${server}/download`, { type: 'svg', margin: 1, width: 112 });
    return { server, files, fallback, qrSvg };
  });

  app.get('/downloads/:file', async (req, reply) => {
    const name = (req.params as { file: string }).file;
    // Only a plain file name that the listing would show; no paths, no dot files.
    const k = kindOf(name);
    if (!k || !SAFE_NAME.test(name) || path.basename(name) !== name) throw new HttpError(404, 'Not found');
    const file = path.join(config.downloadsDir, name);
    let st: fs.Stats;
    try { st = fs.statSync(file); } catch { throw new HttpError(404, 'Not found'); }
    if (!st.isFile()) throw new HttpError(404, 'Not found');
    return reply
      .header('content-type', k.type)
      .header('content-length', st.size)
      .header('content-disposition', `attachment; filename="${name.replace(/"/g, '')}"`)
      .header('cache-control', 'no-cache')
      .send(fs.createReadStream(file));
  });
}
