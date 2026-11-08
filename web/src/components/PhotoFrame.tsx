import { useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';

interface FrameSettings {
  on: boolean; immichUrl: string; albumId: string; proof: boolean; seconds: number; shuffle: boolean; hasKey: boolean;
  album: { count: number | null; error: string | null };
}

/** Settings: the family wall's photo frame (an Immich album and photo-proof highlights). */
export function PhotoFrameCard() {
  const { base, toast } = useApp();
  const [s, reload] = useLoad<FrameSettings>(`${base}/photo-frame`);
  const [url, setUrl] = useState<string | null>(null);
  const [album, setAlbum] = useState<string | null>(null);
  const [key, setKey] = useState('');
  if (!s) return null;
  const save = async (body: Record<string, unknown>, done = 'Photo frame saved') => {
    try {
      const r = await api<FrameSettings>(`${base}/photo-frame`, { method: 'PUT', body });
      toast(r.album.error ? `Saved, but: ${r.album.error}` : r.album.count != null ? `${done} · ${r.album.count} pictures in the album` : done);
      setUrl(null); setAlbum(null); setKey('');
      await reload();
    } catch (e) { toast((e as Error).message); }
  };
  const Switch = ({ on, label, hint, onFlip }: { on: boolean; label: string; hint: string; onFlip: () => void }) => (
    <button type="button" className={`switch${on ? ' on' : ''}`} aria-pressed={on} onClick={onFlip}>
      <span className="switch-knob" aria-hidden />
      <span><strong>{label}</strong><br /><span className="small muted">{hint}</span></span>
    </button>
  );
  return (
    <div className="card stack" id="photo-frame">
      <h2 style={{ margin: 0 }}>🖼️ Photo frame</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Turn the family wall into a photo frame too: a slideshow of an <strong>Immich</strong> album and this week's photo-proof chores.
        In Immich, make an album for the wall, then <strong>Account settings → API keys</strong> → New API key (with <code>album.read</code> and <code>asset.view</code>).
        Pictures come through this server, so the tablet never holds the key.
      </p>
      <div className="switch-grid">
        <Switch on={s.on} label="🖼️ Show photos on the wall" hint="One at a time, next to today and tomorrow" onFlip={() => void save({ on: !s.on }, s.on ? 'Photo frame off' : 'Photo frame on')} />
        <Switch on={s.proof} label="📸 Photo-proof highlights" hint="Approved chores with a picture, from the last 7 days" onFlip={() => void save({ proof: !s.proof })} />
        <Switch on={s.shuffle} label="🔀 Shuffle" hint="A new order every hour" onFlip={() => void save({ shuffle: !s.shuffle })} />
      </div>
      <div className="row">
        <input placeholder="Immich address, e.g. http://192.168.1.10:2283" value={url ?? s.immichUrl} onChange={(e) => setUrl(e.target.value)} style={{ flex: 2, minWidth: 220 }} aria-label="Immich's address" />
        <input placeholder="Album link or id" value={album ?? s.albumId} onChange={(e) => setAlbum(e.target.value)} style={{ flex: 2, minWidth: 200 }} aria-label="Immich album" />
        <input type="password" placeholder={s.hasKey ? 'Key saved' : 'Immich API key'} value={key} onChange={(e) => setKey(e.target.value)} style={{ flex: 1, minWidth: 150 }} aria-label="Immich API key" autoComplete="off" />
        <button className="primary" onClick={() => void save({ immichUrl: (url ?? s.immichUrl).trim(), albumId: (album ?? s.albumId).trim(), ...(key.trim() ? { key: key.trim() } : {}) })}>Save</button>
        {s.immichUrl && <button className="ghost" onClick={() => void save({ immichUrl: '', albumId: '' }, 'Immich unlinked')}>Unlink</button>}
      </div>
      <label className="row small">Each picture shows for
        <select value={s.seconds} onChange={(e) => void save({ seconds: Number(e.target.value) })} style={{ width: 'auto' }}>
          {[8, 12, 20, 30, 60].map((n) => <option key={n} value={n}>{n} seconds</option>)}
        </select>
      </label>
      {s.immichUrl && <p className="small" style={{ margin: 0 }}>{s.album.error ? `⚠️ ${s.album.error}` : s.album.count != null ? `✅ ${s.album.count} pictures in the album` : '⚠️ Add the album and API key'}</p>}
    </div>
  );
}
