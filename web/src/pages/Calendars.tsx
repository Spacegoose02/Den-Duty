import { useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';

interface Feed { id: string; name: string; url: string; kind: string; showKids: boolean; events: number; fetchedAt: string | null; error: string | null }
interface CalendarData { home: string; kids: { id: string; name: string; avatar: string; url: string }[]; feeds: Feed[] }

export const FEED_ICONS: Record<string, string> = { lunch: '🍎', meals: '🍽️', school: '🏫', other: '📅' };

/** Settings card: subscribe to the chore calendars in Google Calendar, and add feeds to show on the agenda. */
export function CalendarsCard() {
  const { base, toast } = useApp();
  const [data, reload] = useLoad<CalendarData>(`${base}/calendars`);
  const [feed, setFeed] = useState({ name: '', url: '', kind: 'lunch' });
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const full = (path: string) => `${location.origin}${path}`;
  const copy = (path: string) => { void navigator.clipboard?.writeText(full(path)); toast('Link copied'); };
  const reset = async (kidId?: string) => {
    if (!confirm('Make a new link? The old one stops working, so you will need to re-add it in Google Calendar.')) return;
    await api(`${base}/calendars/reset`, { body: kidId ? { kidId } : {} });
    await reload();
  };

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Calendars</h2>
      <h3 style={{ margin: 0 }}>Chores in Google Calendar</h3>
      <p className="small muted" style={{ margin: 0 }}>
        In Google Calendar choose <strong>Other calendars → ＋ → From URL</strong> and paste a link. Google refreshes it every few hours.
        The home calendar has everyone's chores and appointments; each kid's has only theirs. Keep the links private.
      </p>
      <div className="row">
        <span style={{ flex: 1, minWidth: 160 }}>🏡 Whole home</span>
        <button onClick={() => copy(data.home)}>Copy link</button>
        <button className="ghost" onClick={() => void reset()}>New link</button>
      </div>
      {data.kids.map((k) => (
        <div key={k.id} className="row">
          <span style={{ flex: 1, minWidth: 160, display: 'inline-flex', alignItems: 'center', gap: 6 }}><RaccoonAvatar variant={k.avatar} size={26} /> {k.name}</span>
          <button onClick={() => copy(k.url)}>Copy link</button>
          <button className="ghost" onClick={() => void reset(k.id)}>New link</button>
        </div>
      ))}

      <h3 style={{ margin: 0 }}>Show other calendars on the week</h3>
      <p className="small muted" style={{ margin: 0 }}>
        Paste an ICS link: a school lunch menu, Nighttime Ninja's meal plan (Settings → Home → Google Calendar there), a school calendar…
        If the school only posts a web page or PDF there's no feed to add yet; look for an “iCal”, “ICS” or “Subscribe” link.
      </p>
      {data.feeds.map((f) => (
        <div key={f.id} className="list-item">
          <span style={{ fontSize: '1.4rem' }}>{FEED_ICONS[f.kind] ?? '📅'}</span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <strong>{f.name}</strong> <span className="small muted">{f.events} upcoming</span>
            <div className="small muted" style={{ wordBreak: 'break-all' }}>{f.url}</div>
            {f.error && <div className="small" style={{ color: 'var(--danger)' }}>Last refresh failed: {f.error}</div>}
          </div>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={f.showKids} style={{ width: 20, minHeight: 20 }}
              onChange={async (e) => { await api(`${base}/calendar-feeds/${f.id}`, { method: 'PATCH', body: { showKids: e.target.checked } }); await reload(); }} />
            Kids see it
          </label>
          <button className="ghost" onClick={async () => { await api(`${base}/calendar-feeds/${f.id}/refresh`, { body: {} }); await reload(); }}>Refresh</button>
          <button className="ghost danger" onClick={async () => { if (confirm(`Remove ${f.name}?`)) { await api(`${base}/calendar-feeds/${f.id}`, { method: 'DELETE' }); await reload(); } }}>Remove</button>
        </div>
      ))}
      <form className="row" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const r = await api<Feed>(`${base}/calendar-feeds`, { body: feed });
          toast(r.error ? `Added, but: ${r.error}` : `Added ${r.name}: ${r.events} upcoming`);
          setFeed({ name: '', url: '', kind: 'lunch' });
          await reload();
        } catch (err) { toast((err as Error).message); } finally { setBusy(false); }
      }}>
        <select value={feed.kind} onChange={(e) => setFeed({ ...feed, kind: e.target.value })} style={{ width: 'auto' }} aria-label="Kind">
          <option value="lunch">🍎 School lunch</option>
          <option value="meals">🍽️ Meal plan</option>
          <option value="school">🏫 School</option>
          <option value="other">📅 Other</option>
        </select>
        <input placeholder="Name (optional)" value={feed.name} onChange={(e) => setFeed({ ...feed, name: e.target.value })} style={{ width: 160 }} />
        <input placeholder="https://… .ics or webcal://…" value={feed.url} onChange={(e) => setFeed({ ...feed, url: e.target.value })} style={{ flex: 1, minWidth: 240 }} />
        <button disabled={busy || !feed.url.trim()}>{busy ? 'Checking…' : 'Add'}</button>
      </form>
    </div>
  );
}
