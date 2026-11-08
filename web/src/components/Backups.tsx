import { useRef, useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';

interface BackupFile { name: string; bytes: number; createdAt: string; kind: 'nightly' | 'manual' | 'before-restore' | 'uploaded' }
interface Backups { on: boolean; keep: number; dir: string; backups: BackupFile[]; restorePending: boolean }

const KIND: Record<BackupFile['kind'], string> = { nightly: '🌙 Nightly', manual: '✋ Made by hand', 'before-restore': '↩️ Before a restore', uploaded: '⬆️ Uploaded' };
const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Server admins: nightly backups of the whole database, plus make, download, upload and restore. */
export function BackupsCard() {
  const { toast } = useApp();
  const [s, reload] = useLoad<Backups>('/api/admin/backups');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  if (!s) return null;
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); await reload(); toast(done); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const upload = async (f: File) => run(async () => {
    const res = await fetch('/api/admin/backups/upload', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: f, credentials: 'same-origin' });
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Upload failed');
  }, 'Backup uploaded. Restore it from the list.');
  return (
    <div className="card stack" id="backups">
      <h2 style={{ margin: 0 }}>💾 Backups</h2>
      <p className="small muted" style={{ margin: 0 }}>
        A copy of everything on this server (every home's chores, points, money, Doctors and settings) is saved each night after 3 am
        to <code>{s.dir}</code>. Photos stay in the data folder, so back that whole folder up too if you can.
      </p>
      {s.restorePending && (
        <div className="row" style={{ background: 'color-mix(in srgb, var(--warn) 16%, var(--surface))', padding: 10, borderRadius: 10 }}>
          <span style={{ flex: 1 }}>⚠️ A restore is waiting. <strong>Restart the server</strong> (or the Docker container) to finish it. The current data is saved as a backup first.</span>
          <button className="ghost" disabled={busy} onClick={() => void run(() => api('/api/admin/restore', { method: 'DELETE' }), 'Restore cancelled')}>Cancel</button>
        </div>
      )}
      <div className="row">
        <button type="button" className={`switch${s.on ? ' on' : ''}`} aria-pressed={s.on} onClick={() => void run(() => api('/api/admin/backups', { method: 'PATCH', body: { on: !s.on } }), s.on ? 'Nightly backups off' : 'Nightly backups on')}>
          <span className="switch-knob" aria-hidden />
          <span><strong>🌙 Nightly backup</strong></span>
        </button>
        <label className="row small">Keep the newest
          <input type="number" min={1} max={365} defaultValue={s.keep} style={{ width: 80 }}
            onBlur={(e) => Number(e.target.value) !== s.keep && void run(() => api('/api/admin/backups', { method: 'PATCH', body: { keep: Number(e.target.value) } }), 'Saved')} />
        </label>
        <span style={{ flex: 1 }} />
        <button className="primary" disabled={busy} onClick={() => void run(() => api('/api/admin/backups', { body: {} }), 'Backup saved')}>Back up now</button>
        <button disabled={busy} onClick={() => file.current?.click()}>Upload a backup</button>
        <input ref={file} type="file" accept=".db,.sqlite,application/octet-stream" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
      </div>
      {s.backups.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>When</th><th>Kind</th><th>Size</th><th /></tr></thead>
            <tbody>
              {s.backups.map((b) => (
                <tr key={b.name}>
                  <td>{new Date(b.createdAt).toLocaleString()}</td>
                  <td className="small">{KIND[b.kind]}</td>
                  <td className="small">{size(b.bytes)}</td>
                  <td>
                    <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                      <a className="btn ghost" href={`/api/admin/backups/${encodeURIComponent(b.name)}`} download>Download</a>
                      <button className="ghost" disabled={busy} onClick={() => confirm('Restore this backup? Everything since it was made is replaced when the server restarts. The current data is saved as a backup first.')
                        && void run(() => api(`/api/admin/backups/${encodeURIComponent(b.name)}/restore`, { body: {} }), 'Restore staged: restart the server to finish')}>Restore</button>
                      <button className="ghost danger" disabled={busy} onClick={() => confirm('Delete this backup?') && void run(() => api(`/api/admin/backups/${encodeURIComponent(b.name)}`, { method: 'DELETE' }), 'Deleted')}>Delete</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="small muted" style={{ margin: 0 }}>No backups yet. The first one is made tonight, or tap Back up now.</p>}
    </div>
  );
}
