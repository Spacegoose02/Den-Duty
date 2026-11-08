// Family events on the calendar: the add/edit form, "snap a flyer" (AI reads the dates, a parent checks them),
// and linking Google, Outlook and iCloud/CalDAV calendars for two-way sync (Settings).
import { useEffect, useState } from 'react';
import { api, type Kid } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { Modal, dayName, shortDate } from './Bits.tsx';
import { RaccoonAvatar } from './Raccoon.tsx';

export interface FamilyEvent {
  id: string; title: string; date: string; endDate: string | null; time: string | null; endTime: string | null;
  location: string | null; notes: string | null; memberIds: string[]; kidsSee: boolean; source: string; accountId: string | null;
}
interface Draft { title: string; date: string; endDate: string | null; time: string | null; endTime: string | null; location: string | null; notes: string | null; forWhom?: string | null; memberIds?: string[]; keep?: boolean }

const SOURCE: Record<string, string> = { google: 'Google Calendar', microsoft: 'Outlook', caldav: 'a linked calendar' };

export function eventIcon(e: FamilyEvent): string { return e.accountId ? '🔗' : e.source === 'snap' ? '📸' : '📌'; }

function KidChips({ kids, value, onChange }: { kids: Kid[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="chips">
      <button type="button" className={`chip${!value.length ? ' on' : ''}`} onClick={() => onChange([])}>👨‍👩‍👧 Everyone</button>
      {kids.map((k) => (
        <button key={k.id} type="button" className={`chip${value.includes(k.id) ? ' on' : ''}`}
          onClick={() => onChange(value.includes(k.id) ? value.filter((x) => x !== k.id) : [...value, k.id])}>
          <RaccoonAvatar variant={k.avatar} size={20} /> {k.name}
        </button>
      ))}
    </div>
  );
}

/** Add or edit one event. Events from a linked calendar are only shown (they're edited there). */
export function EventForm({ event, date, onClose, onSaved }: { event?: FamilyEvent | null; date?: string; onClose: () => void; onSaved: () => void }) {
  const { base, toast, home } = useApp();
  const [f, setF] = useState<Draft & { kidsSee: boolean; memberIds: string[] }>(() => ({
    title: event?.title ?? '', date: event?.date ?? date ?? new Date().toISOString().slice(0, 10), endDate: event?.endDate ?? null,
    time: event?.time ?? null, endTime: event?.endTime ?? null, location: event?.location ?? null, notes: event?.notes ?? null,
    memberIds: event?.memberIds ?? [], kidsSee: event?.kidsSee ?? true,
  }));
  const readOnly = !!event?.accountId;
  const save = async () => {
    try {
      await api(event ? `${base}/events/${event.id}` : `${base}/events`, { method: event ? 'PATCH' : 'POST', body: f });
      toast('Saved');
      onSaved();
    } catch (e) { toast((e as Error).message); }
  };
  const remove = async () => {
    if (!event || !confirm(`Delete ${event.title}?`)) return;
    try { await api(`${base}/events/${event.id}`, { method: 'DELETE' }); onSaved(); } catch (e) { toast((e as Error).message); }
  };
  if (readOnly) return (
    <Modal onClose={onClose}>
      <div className="stack">
        <h2 style={{ margin: 0 }}>🔗 {event!.title}</h2>
        <p style={{ margin: 0 }}>{dayName(event!.date)} {shortDate(event!.date)}{event!.endDate ? ` to ${shortDate(event!.endDate)}` : ''}{event!.time ? ` · ${event!.time}${event!.endTime ? `–${event!.endTime}` : ''}` : ''}</p>
        {event!.location && <p style={{ margin: 0 }}>📍 {event!.location}</p>}
        {event!.notes && <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{event!.notes}</p>}
        <p className="small muted" style={{ margin: 0 }}>From {SOURCE[event!.source] ?? 'a linked calendar'}. Change it there and it updates here.</p>
      </div>
    </Modal>
  );
  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2 style={{ margin: 0 }}>{event ? 'Edit event' : 'New event'}</h2>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Like Soccer practice" maxLength={120} required aria-label="What" />
        <div className="row">
          <label className="field">Date<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></label>
          <label className="field">Until (optional)<input type="date" value={f.endDate ?? ''} min={f.date} onChange={(e) => setF({ ...f, endDate: e.target.value || null })} /></label>
        </div>
        <div className="row">
          <label className="field">Starts<input type="time" value={f.time ?? ''} onChange={(e) => setF({ ...f, time: e.target.value || null })} /></label>
          <label className="field">Ends<input type="time" value={f.endTime ?? ''} disabled={!f.time} onChange={(e) => setF({ ...f, endTime: e.target.value || null })} /></label>
          {!f.time && <span className="small muted">No time = all day</span>}
        </div>
        <input value={f.location ?? ''} onChange={(e) => setF({ ...f, location: e.target.value || null })} placeholder="Where (optional)" maxLength={200} aria-label="Where" />
        <textarea value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value || null })} placeholder="Notes: what to bring, costs (optional)" maxLength={1000} rows={2} aria-label="Notes" />
        <div className="field"><span>Who's it for</span><KidChips kids={home?.kids ?? []} value={f.memberIds} onChange={(v) => setF({ ...f, memberIds: v })} /></div>
        <label className="row check-row"><input type="checkbox" checked={f.kidsSee} onChange={(e) => setF({ ...f, kidsSee: e.target.checked })} /> Kids can see it (their boards and the family wall)</label>
        <div className="row">
          {event && <button type="button" className="ghost danger" onClick={() => void remove()}>Delete</button>}
          <span style={{ flex: 1 }} />
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!f.title.trim()}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

/** A bigger picture than chore photos, so the small print on a flyer stays readable. */
function pickFlyer(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return resolve(null);
      try {
        const bmp = await createImageBitmap(f);
        const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * scale);
        c.height = Math.round(bmp.height * scale);
        c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close();
        resolve(c.toDataURL('image/jpeg', 0.85));
      } catch { reject(new Error("That picture couldn't be read. Try a JPEG or PNG.")); }
    });
    input.addEventListener('cancel', () => { input.remove(); resolve(null); });
    input.click();
  });
}

/** Snap a flyer (or paste an email): AI finds the dates, the parent checks and picks who each is for. */
export function SnapFlyer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { base, toast, home } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const read = async (body: object) => {
    setBusy(true);
    try {
      const r = await api<{ drafts: Draft[] }>(`${base}/events/snap`, { body });
      setDrafts(r.drafts.map((d) => ({ ...d, memberIds: [], keep: true })));
      if (!r.drafts.length) toast("Couldn't find any dates in that");
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const photo = async () => {
    try { const image = await pickFlyer(); if (image) await read({ image }); } catch (e) { toast((e as Error).message); }
  };
  const save = async () => {
    const keep = drafts!.filter((d) => d.keep).map(({ keep: _k, forWhom: _w, ...d }) => d);
    if (!keep.length) return onClose();
    try { await api(`${base}/events/bulk`, { body: { events: keep } }); toast(`Added ${keep.length} to the calendar`); onSaved(); } catch (e) { toast((e as Error).message); }
  };
  const set = (i: number, patch: Partial<Draft>) => setDrafts(drafts!.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  return (
    <Modal onClose={onClose} wide>
      <div className="stack">
        <h2 style={{ margin: 0 }}>📸 Snap to calendar</h2>
        {!drafts ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>Take a photo of a school flyer, team schedule or invitation, or paste an email. Claude reads the dates; you check them before anything is saved. Only the picture or text is sent, never your kids' names.</p>
            <button className="primary" style={{ minHeight: 64 }} disabled={busy} onClick={() => void photo()}>{busy ? 'Reading…' : '📷 Take or pick a photo'}</button>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="…or paste the email or text here" aria-label="Text with dates" />
            <button disabled={busy || !text.trim()} onClick={() => void read({ text })}>{busy ? 'Reading…' : 'Find the dates'}</button>
          </>
        ) : (
          <>
            {!drafts.length && <p>No dates found. Try a closer photo, or type it in with ＋ Event.</p>}
            {drafts.map((d, i) => (
              <div key={i} className={`card stack snap-draft${d.keep ? '' : ' off'}`} style={{ gap: 6 }}>
                <div className="row">
                  <input type="checkbox" checked={!!d.keep} onChange={(e) => set(i, { keep: e.target.checked })} aria-label="Add this one" />
                  <input value={d.title} onChange={(e) => set(i, { title: e.target.value })} style={{ flex: 1 }} aria-label="Title" />
                </div>
                <div className="row">
                  <input type="date" value={d.date} onChange={(e) => set(i, { date: e.target.value })} aria-label="Date" />
                  <input type="time" value={d.time ?? ''} onChange={(e) => set(i, { time: e.target.value || null })} aria-label="Time" />
                  {d.location && <span className="small">📍 {d.location}</span>}
                  {d.forWhom && <span className="pill">For: {d.forWhom}</span>}
                </div>
                {d.notes && <span className="small muted">{d.notes}</span>}
                <KidChips kids={home?.kids ?? []} value={d.memberIds ?? []} onChange={(v) => set(i, { memberIds: v })} />
              </div>
            ))}
            <div className="row">
              <button className="ghost" onClick={() => setDrafts(null)}>Try another</button>
              <span style={{ flex: 1 }} />
              <button className="primary" disabled={!drafts.some((d) => d.keep)} onClick={() => void save()}>Add {drafts.filter((d) => d.keep).length} to the calendar</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------- Settings: two-way calendar sync ----------

interface Account {
  id: string; kind: 'google' | 'microsoft' | 'caldav'; name: string; calendarId: string | null; calendarName: string | null;
  pull: boolean; push: boolean; memberIds: string[]; syncedAt: string | null; error: string | null; username: string | null;
}
const KIND_LABEL = { google: '🟦 Google Calendar', microsoft: '🟧 Outlook', caldav: '🍎 iCloud / CalDAV' };

function AccountRow({ a, onChange }: { a: Account; onChange: () => void }) {
  const { base, toast, home } = useApp();
  const [cals, setCals] = useState<{ id: string; name: string; primary?: boolean }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await fn(); if (done) toast(done); onChange(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (a.calendarId) return;
    void api<{ id: string; name: string; primary?: boolean }[]>(`${base}/calendar-sync/${a.id}/calendars`).then(setCals, (e: Error) => toast(e.message));
  }, [a.id, a.calendarId, base, toast]);
  const patch = (body: object) => run(() => api(`${base}/calendar-sync/${a.id}`, { method: 'PATCH', body }));
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row">
        <strong style={{ flex: 1 }}>{KIND_LABEL[a.kind]}{a.calendarName ? `: ${a.calendarName}` : ''}{a.username ? <span className="small muted"> ({a.username})</span> : null}</strong>
        {a.calendarId && <button disabled={busy} onClick={() => void run(() => api(`${base}/calendar-sync/${a.id}/sync`, { body: {} }), 'Synced')}>🔄 Sync now</button>}
        <button className="ghost danger" disabled={busy} onClick={() => { if (confirm('Unlink this calendar? Events from it leave the family calendar.')) void run(() => api(`${base}/calendar-sync/${a.id}`, { method: 'DELETE' })); }}>Unlink</button>
      </div>
      {!a.calendarId ? (
        <label className="field">Which calendar?
          <select defaultValue="" onChange={(e) => { const c = cals?.find((x) => x.id === e.target.value); if (c) void patch({ calendarId: c.id, calendarName: c.name }); }}>
            <option value="" disabled>{cals ? 'Pick one' : 'Loading…'}</option>
            {cals?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.primary ? ' (main)' : ''}</option>)}
          </select>
        </label>
      ) : (
        <>
          <div className="row">
            <label className="row check-row"><input type="checkbox" checked={a.pull} onChange={(e) => void patch({ pull: e.target.checked })} /> Bring its events in</label>
            <label className="row check-row"><input type="checkbox" checked={a.push} onChange={(e) => void patch({ push: e.target.checked })} /> Send Den Duty events to it</label>
          </div>
          <div className="field"><span className="small">It's for</span><KidChips kids={home?.kids ?? []} value={a.memberIds} onChange={(v) => void patch({ memberIds: v })} /></div>
          <span className="small muted">{a.error ? `⚠️ ${a.error}` : a.syncedAt ? `Last synced ${new Date(`${a.syncedAt.replace(' ', 'T')}Z`).toLocaleString()}` : 'Not synced yet'}</span>
        </>
      )}
    </div>
  );
}

export function CalendarSyncCard() {
  const { base, toast } = useApp();
  const [data, reload] = useLoad<{ providers: { google: boolean; microsoft: boolean; caldav: boolean }; accounts: Account[] }>(`${base}/calendar-sync`);
  const [dav, setDav] = useState<{ url: string; username: string; password: string } | null>(null);
  if (!data) return null;
  const addDav = async () => {
    try { await api(`${base}/calendar-sync/caldav`, { body: dav }); setDav(null); await reload(); } catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="card stack" id="calendar-sync">
      <h2 style={{ margin: 0 }}>🔄 Two-way calendar sync</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Link a family calendar: its events show up here, and events you add in Den Duty (or snap from a flyer) show up there. Synced every 15 minutes and right after a change.
      </p>
      {data.accounts.map((a) => <AccountRow key={a.id} a={a} onChange={() => void reload()} />)}
      <div className="row">
        {data.providers.google && <a className="btn" href={`${base}/calendar-sync/google/start`}>{KIND_LABEL.google}</a>}
        {data.providers.microsoft && <a className="btn" href={`${base}/calendar-sync/microsoft/start`}>{KIND_LABEL.microsoft}</a>}
        <button onClick={() => setDav(dav ? null : { url: 'https://caldav.icloud.com/', username: '', password: '' })}>{KIND_LABEL.caldav}</button>
      </div>
      {!data.providers.google && !data.providers.microsoft && <p className="small muted" style={{ margin: 0 }}>Google and Outlook need a small setup on the server first (docs/calendar-sync.md). iCloud, Nextcloud and Fastmail work right away.</p>}
      {dav && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void addDav(); }}>
          <input value={dav.url} onChange={(e) => setDav({ ...dav, url: e.target.value })} placeholder="Server, like https://caldav.icloud.com/" aria-label="CalDAV server" />
          <div className="row">
            <input value={dav.username} onChange={(e) => setDav({ ...dav, username: e.target.value })} placeholder="Username or Apple ID email" autoComplete="off" style={{ flex: 1 }} aria-label="Username" />
            <input type="password" value={dav.password} onChange={(e) => setDav({ ...dav, password: e.target.value })} placeholder="App-specific password" autoComplete="new-password" style={{ flex: 1 }} aria-label="Password" />
          </div>
          <p className="small muted" style={{ margin: 0 }}>For iCloud, make an app-specific password at appleid.apple.com (Sign-In and Security). It's stored encrypted.</p>
          <div className="row"><button className="primary" disabled={!dav.url || !dav.username || !dav.password}>Link</button></div>
        </form>
      )}
    </div>
  );
}
