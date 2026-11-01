// Sharing and export: private read-only links for a therapist or doctor, the visit summary, and downloads of
// everything in Doctors (JSON) or the log, doses and goal notes (CSV, for a spreadsheet).
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../../api.ts';
import { useApp, useLoad } from '../../state.tsx';
import { shortDate } from '../../components/Bits.tsx';
import { AREA_ICONS } from '../Doctors.tsx';

interface ShareLink { id: string; label: string; goalIds: string[] | null; showLog: boolean; showMeds: boolean; allowNotes: boolean; expiresAt: string; lastSeenAt: string | null; createdAt: string }

export function ShareTab({ kid, goals }: { kid: { id: string; name: string }; goals: { id: string; title: string; area: string; status: string }[] }) {
  const { base, toast } = useApp();
  const url = `${base}/kids/${kid.id}/share-links`;
  const [links, reload] = useLoad<ShareLink[]>(url, [url]);
  const [f, setF] = useState({ label: '', all: true, goalIds: [] as string[], showLog: false, showMeds: false, allowNotes: true, days: 90 });
  const [made, setMade] = useState<string | null>(null);
  const exportUrl = `${base}/kids/${kid.id}/doctors/export`;
  const goalName = (id: string) => goals.find((g) => g.id === id)?.title ?? 'a removed goal';

  const create = async () => {
    try {
      const r = await api<ShareLink & { url: string }>(url, { body: { label: f.label, goalIds: f.all ? null : f.goalIds, showLog: f.showLog, showMeds: f.showMeds, allowNotes: f.allowNotes, days: f.days } });
      setMade(`${location.origin}${r.url}`);
      setF({ ...f, label: '' });
      await reload();
    } catch (e) { toast((e as Error).message); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast('Link copied'); } catch { toast('Copy the link by hand'); } };

  return (
    <div className="stack">
      <section className="card stack">
        <div className="row">
          <h2 style={{ margin: 0, flex: 1 }}>🧾 Visit summary</h2>
          <NavLink className="btn primary" to={`/doctors/summary/${kid.id}?days=30`}>Open the summary</NavLink>
        </div>
        <p className="small muted" style={{ margin: 0 }}>One page with {kid.name}'s health card, goal progress and practice, medicines, the log, visits and notes, ready to print or save as a PDF for the next appointment.</p>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>🔗 Share with a therapist or doctor</h2>
        <p className="small muted" style={{ margin: 0 }}>
          A private link they can open without an account. It shows {kid.name}'s first name, age, the goals you pick with their progress and practice, visits and notes on those goals.
          Never the health card, insurance, contacts or vaccines. You can turn a link off at any time.
        </p>
        <input placeholder="Who is it for? e.g. Ms. Lee (speech)" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} maxLength={80} />
        <div className="chips">
          <button type="button" className={`chip${f.all ? ' on' : ''}`} onClick={() => setF({ ...f, all: true })}>All goals</button>
          {goals.filter((g) => g.status !== 'met').map((g) => {
            const on = !f.all && f.goalIds.includes(g.id);
            return <button key={g.id} type="button" className={`chip${on ? ' on' : ''}`} onClick={() => setF({ ...f, all: false, goalIds: on ? f.goalIds.filter((x) => x !== g.id) : [...f.goalIds, g.id] })}>{AREA_ICONS[g.area] ?? '📌'} {g.title}</button>;
          })}
        </div>
        <label className="row small"><input type="checkbox" checked={f.allowNotes} onChange={(e) => setF({ ...f, allowNotes: e.target.checked })} style={{ width: 22, minHeight: 22 }} /> Let them leave a progress note on a goal</label>
        <label className="row small"><input type="checkbox" checked={f.showLog} onChange={(e) => setF({ ...f, showLog: e.target.checked })} style={{ width: 22, minHeight: 22 }} /> Include the mood, behavior and symptom log</label>
        <label className="row small"><input type="checkbox" checked={f.showMeds} onChange={(e) => setF({ ...f, showMeds: e.target.checked })} style={{ width: 22, minHeight: 22 }} /> Include medicines and how often they were given</label>
        <div className="row">
          <span className="small">Works for</span>
          <div className="seg">{[30, 90, 180, 365].map((d) => <button key={d} type="button" className={f.days === d ? 'on' : ''} onClick={() => setF({ ...f, days: d })}>{d === 365 ? '1 year' : `${d} days`}</button>)}</div>
          <span className="spacer" />
          <button className="primary" disabled={!f.label.trim() || (!f.all && !f.goalIds.length)} onClick={() => void create()}>Make the link</button>
        </div>
        {made && (
          <div className="card stack" style={{ background: 'var(--surface-2)' }}>
            <strong>Here's the link. It's only shown this once, so copy it now.</strong>
            <code style={{ wordBreak: 'break-all' }}>{made}</code>
            <div className="row"><button className="primary" onClick={() => void copy(made)}>📋 Copy</button><button className="ghost" onClick={() => setMade(null)}>Done</button></div>
          </div>
        )}
        {(links ?? []).map((l) => (
          <div key={l.id} className="list-item" style={{ flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong>{l.label}</strong>
              <div className="small muted">
                {l.goalIds ? l.goalIds.map(goalName).join(', ') : 'All goals'}{l.showLog && ' · log'}{l.showMeds && ' · medicines'}{l.allowNotes && ' · can leave notes'}
              </div>
              <div className="small muted">
                {l.expiresAt < new Date().toISOString().slice(0, 10) ? `Expired ${shortDate(l.expiresAt)}` : `Works until ${shortDate(l.expiresAt)}`}
                {' · '}{l.lastSeenAt ? `last opened ${shortDate(l.lastSeenAt.slice(0, 10))}` : 'not opened yet'}
              </div>
            </div>
            <button className="ghost danger" onClick={() => { if (confirm(`Turn off the link for ${l.label}?`)) void api(`${base}/share-links/${l.id}`, { method: 'DELETE' }).then(reload, (e: Error) => toast(e.message)); }}>Turn off</button>
          </div>
        ))}
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>💾 Export and backup</h2>
        <p className="small muted" style={{ margin: 0 }}>Download everything in Doctors for {kid.name} to keep your own copy, or open the log and doses in a spreadsheet.</p>
        <div className="chips">
          <a className="btn" href={exportUrl} download>⬇️ Everything (JSON)</a>
          <a className="btn" href={`${exportUrl}?format=csv&what=progress`} download>⬇️ Goal notes (CSV)</a>
          <a className="btn" href={`${exportUrl}?format=csv&what=doses`} download>⬇️ Medicine doses (CSV)</a>
          <a className="btn" href={`${exportUrl}?format=csv&what=log`} download>⬇️ Log (CSV)</a>
        </div>
      </section>
    </div>
  );
}
