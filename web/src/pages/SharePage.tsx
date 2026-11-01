// /share/:token — what a therapist or doctor sees on a link a parent shared: read-only progress for the goals the
// family chose, and (if allowed) a box to leave a progress note. No account needed.
import { useEffect, useState } from 'react';
import { api, type VisitSummary } from '../api.ts';
import { DoctorRaccoon } from '../components/Raccoon.tsx';
import { SummaryView } from './doctors/Summary.tsx';
import { yearDate } from './doctors/Health.tsx';

function NoteBox({ token, goalId, current, onSaved }: { token: string; goalId: string; current: number; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState({ name: localStorage.getItem('dd-share-name') ?? '', body: '', progress: current });
  const [msg, setMsg] = useState<string | null>(null);
  if (!open) return <button className="ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>✍️ Leave a progress note</button>;
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      try {
        await api(`/api/share/${token}/notes`, { body: { ...n, goalId } });
        localStorage.setItem('dd-share-name', n.name);
        setMsg('Thanks! The family will see your note.');
        setN({ ...n, body: '' });
        setOpen(false);
        onSaved();
      } catch (err) { setMsg((err as Error).message); }
    }}>
      <input placeholder="Your name" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} maxLength={60} />
      <textarea placeholder="How did it go? e.g. 8 of 10 correct in session" value={n.body} onChange={(e) => setN({ ...n, body: e.target.value })} style={{ minHeight: 70 }} />
      <div className="row">
        <input type="range" min={0} max={100} step={5} value={n.progress} onChange={(e) => setN({ ...n, progress: Number(e.target.value) })} style={{ flex: 1, minHeight: 0 }} aria-label="Progress" />
        <strong style={{ width: 48, textAlign: 'right' }}>{n.progress}%</strong>
      </div>
      {msg && <p className="small" style={{ margin: 0 }}>{msg}</p>}
      <div className="row"><span className="spacer" /><button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button><button className="primary" disabled={!n.name.trim() || !n.body.trim()}>Send</button></div>
    </form>
  );
}

export function SharePage({ token }: { token: string }) {
  const [s, setS] = useState<VisitSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(90);
  const load = () => api<VisitSummary>(`/api/share/${token}?days=${days}`).then((r) => { setS(r); setError(null); }, (e: Error) => setError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [token, days]);
  return (
    <div className="main" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="stack">
        <div className="topbar">
          <DoctorRaccoon size={48} />
          <h1 style={{ flex: 1 }}>Shared progress</h1>
          <div className="seg no-print">{[30, 90, 180].map((d) => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d} days</button>)}</div>
          <button className="ghost no-print" onClick={() => window.print()}>🖨️ Print</button>
        </div>
        {error && <div className="card">{error}</div>}
        {s?.link && <p className="small muted" style={{ margin: 0 }}>Shared with {s.link.label} by the family, through Den Duty. Works until {yearDate(s.link.expiresAt)}. Please keep it private.</p>}
        {s && (
          <SummaryView s={s} color="var(--primary)" extra={s.link?.allowNotes ? (goalId) => (
            <NoteBox token={token} goalId={goalId} current={s.goals.find((g) => g.id === goalId)?.progress ?? 0} onSaved={() => void load()} />
          ) : undefined} />
        )}
      </div>
    </div>
  );
}
