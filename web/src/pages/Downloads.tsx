import { Link } from 'react-router-dom';
import { useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';

type Kind = 'windows-installer' | 'windows-portable' | 'android' | 'linux' | 'mac';
interface DownloadFile { name: string; kind: Kind; label: string; size: number; version: string | null; updatedAt: string; url: string }
interface Downloads { server: string; files: DownloadFile[]; fallback: { kind: Kind; label: string; url: string }[]; qrSvg: string }

const ICON: Record<Kind, string> = { 'windows-installer': '🪟', 'windows-portable': '🪟', android: '🤖', linux: '🐧', mac: '🍎' };

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/** Which kinds suit the device this page is open on, best first. */
function suggested(): Kind[] {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return ['android'];
  if (/windows/i.test(ua)) return ['windows-installer', 'windows-portable'];
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return [];
  if (/mac os/i.test(ua)) return ['mac'];
  if (/linux/i.test(ua)) return ['linux'];
  return [];
}

/** Public page anyone can open to get the apps, signed in or not. */
export function DownloadsPage() {
  const [data] = useLoad<Downloads>('/api/downloads');
  const mine = suggested();
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  // Newest file per kind up top; older versions tucked away.
  const newest = new Map<Kind, DownloadFile>();
  for (const f of data?.files ?? []) if (!newest.has(f.kind)) newest.set(f.kind, f);
  const older = (data?.files ?? []).filter((f) => newest.get(f.kind) !== f);
  const rows = [
    ...[...newest.values()].map((f) => ({ kind: f.kind, label: f.label, url: f.url, note: `${f.version ? `v${f.version} · ` : ''}${mb(f.size)}`, external: false })),
    ...(data?.fallback ?? []).map((f) => ({ kind: f.kind, label: f.label, url: f.url, note: 'Latest release on GitHub', external: true })),
  ].sort((a, b) => Number(mine.includes(b.kind)) - Number(mine.includes(a.kind)));

  return (
    <div className="center-screen" style={{ alignItems: 'flex-start', padding: '24px 16px' }}>
      <div className="stack" style={{ maxWidth: 640, width: '100%', margin: '0 auto' }}>
        <div className="row" style={{ gap: 12 }}>
          <RaccoonAvatar variant="ninja" size={64} />
          <div>
            <h1 style={{ margin: 0 }}>Get Den Duty</h1>
            <p className="muted" style={{ margin: 0 }}>The apps for this server. Install one, then type the server address below.</p>
          </div>
        </div>

        {data && (
          <section className="card stack">
            <span className="small muted">Server address</span>
            <div className="row" style={{ gap: 8 }}>
              <code style={{ fontSize: '1.1rem', flex: 1, wordBreak: 'break-all' }}>{data.server}</code>
              <button className="ghost" onClick={() => void navigator.clipboard?.writeText(data.server)}>Copy</button>
            </div>
          </section>
        )}

        {rows.map((r) => (
          <a key={r.url} href={r.url} className="card row" style={{ textDecoration: 'none', color: 'inherit', gap: 12, ...(mine.includes(r.kind) ? { borderColor: 'var(--primary)', borderWidth: 2 } : {}) }}
            {...(r.external ? { rel: 'noreferrer' } : { download: true })}>
            <span style={{ fontSize: '2rem' }} aria-hidden>{ICON[r.kind]}</span>
            <span style={{ flex: 1 }}>
              <strong>{r.label}</strong>{mine.includes(r.kind) && <span className="pill ok" style={{ marginLeft: 8 }}>For this device</span>}
              <br /><span className="small muted">{r.note}</span>
            </span>
            <span className="btn primary">⬇ Download</span>
          </a>
        ))}
        {data && !rows.length && <div className="card">No app files on this server yet. Use it in your browser, or ask whoever runs it to add them.</div>}

        <section className="card stack">
          <strong>{ios ? '📱 iPhone and iPad' : '🌐 Any phone or browser'}</strong>
          <p className="small muted" style={{ margin: 0 }}>
            Open <a href="/">{data?.server ?? 'this server'}</a> in {ios ? 'Safari, tap Share, then Add to Home Screen' : 'your browser and choose “Add to Home screen” or “Install app”'}. It works like an app, with no download.
          </p>
        </section>

        {older.length > 0 && (
          <details className="card">
            <summary>Older versions</summary>
            <ul>{older.map((f) => <li key={f.name}><a href={f.url} download>{f.name}</a> <span className="small muted">{mb(f.size)}</span></li>)}</ul>
          </details>
        )}

        {data && !/android|iphone|ipad/i.test(navigator.userAgent) && (
          <section className="card row" style={{ gap: 16 }}>
            <span style={{ width: 120, height: 120, background: '#fff', borderRadius: 8, padding: 4 }} dangerouslySetInnerHTML={{ __html: data.qrSvg }} />
            <span className="small muted">On a phone? Scan this to open this page there.</span>
          </section>
        )}

        <Link to="/" className="small">← Back to Den Duty</Link>
      </div>
    </div>
  );
}
