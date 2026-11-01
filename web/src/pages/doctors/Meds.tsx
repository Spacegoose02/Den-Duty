// Medicines: a list per kid with today's doses to tick off, refills, and how the last 30 days went.
// Also the "Medicine today" card on the parents' home.
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api, type Adherence, type HomeMedicine, type MedDay, type Medicine } from '../../api.ts';
import { useApp, useLoad } from '../../state.tsx';
import { Modal, shortDate } from '../../components/Bits.tsx';
import { RaccoonAvatar } from '../../components/Raccoon.tsx';
import { timeText } from '../Doctors.tsx';

export type MedRow = Medicine & { today: MedDay; onToday: boolean; last30: Adherence };

interface MedDraft {
  name: string; dose: string; instructions: string; times: string[]; asNeeded: boolean; startDate: string; endDate: string;
  supply: string; refillAt: string; kidCanMark: boolean;
}
const EMPTY: MedDraft = { name: '', dose: '', instructions: '', times: ['08:00'], asNeeded: false, startDate: '', endDate: '', supply: '', refillAt: '', kidCanMark: false };

function MedForm({ initial, kidName, onSave, onClose, onDelete, onStop }: {
  initial?: MedRow; kidName: string; onSave: (d: MedDraft) => Promise<void>; onClose: () => void; onDelete?: () => Promise<void>; onStop?: () => Promise<void>;
}) {
  const [d, setD] = useState<MedDraft>(initial ? {
    name: initial.name, dose: initial.dose ?? '', instructions: initial.instructions ?? '', times: initial.times, asNeeded: initial.asNeeded,
    startDate: initial.startDate ?? '', endDate: initial.endDate ?? '', supply: initial.supply?.toString() ?? '', refillAt: initial.refillAt?.toString() ?? '', kidCanMark: initial.kidCanMark,
  } : EMPTY);
  const set = (p: Partial<MedDraft>) => setD({ ...d, ...p });
  const ready = d.name.trim() && (d.times.length > 0 || d.asNeeded);
  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void onSave(d); }}>
        <h2 style={{ margin: 0 }}>{initial ? `Edit ${initial.name}` : `New medicine for ${kidName}`}</h2>
        <input placeholder="Medicine, e.g. Amoxicillin" value={d.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
        <input placeholder="Dose, e.g. 5 ml or 1 tablet (optional)" value={d.dose} onChange={(e) => set({ dose: e.target.value })} />
        <textarea placeholder="How to give it, e.g. with food (optional)" value={d.instructions} onChange={(e) => set({ instructions: e.target.value })} style={{ minHeight: 60 }} />
        <strong className="small">⏰ Dose times each day</strong>
        <div className="chips">
          {d.times.map((t, i) => (
            <span key={i} className="row" style={{ gap: 4 }}>
              <input type="time" value={t} onChange={(e) => set({ times: d.times.map((x, j) => (j === i ? e.target.value : x)) })} style={{ width: 130 }} aria-label={`Dose time ${i + 1}`} />
              <button type="button" className="ghost" aria-label="Remove this time" onClick={() => set({ times: d.times.filter((_, j) => j !== i) })}>✕</button>
            </span>
          ))}
          {d.times.length < 8 && <button type="button" className="chip" onClick={() => set({ times: [...d.times, '20:00'] })}>＋ Time</button>}
        </div>
        <label className="row small"><input type="checkbox" checked={d.asNeeded} onChange={(e) => set({ asNeeded: e.target.checked })} style={{ width: 22, minHeight: 22 }} /> Also (or only) when needed, like a fever reducer</label>
        <div className="row">
          <label className="field">Starts (optional)<input type="date" value={d.startDate} onChange={(e) => set({ startDate: e.target.value })} /></label>
          <label className="field">Ends (optional)<input type="date" value={d.endDate} onChange={(e) => set({ endDate: e.target.value })} /></label>
        </div>
        <div className="row">
          <label className="field">Doses left (optional)<input type="number" min={0} value={d.supply} onChange={(e) => set({ supply: e.target.value })} style={{ width: 140 }} /></label>
          <label className="field">Remind me to refill at<input type="number" min={0} value={d.refillAt} onChange={(e) => set({ refillAt: e.target.value })} style={{ width: 140 }} /></label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Each dose you mark given counts the supply down. At the refill point you get a reminder once.</p>
        <label className="row small"><input type="checkbox" checked={d.kidCanMark} onChange={(e) => set({ kidCanMark: e.target.checked })} style={{ width: 22, minHeight: 22 }} /> {kidName} can tick off their own doses on the tablet</label>
        <div className="row">
          {onDelete && <button type="button" className="ghost danger" onClick={() => { if (confirm('Delete this medicine and its dose history?')) void onDelete(); }}>Delete</button>}
          {onStop && <button type="button" className="ghost" onClick={() => { if (confirm(`Stop ${initial?.name}? Its history stays.`)) void onStop(); }}>Stop taking it</button>}
          <span className="spacer" /><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={!ready}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

const body = (d: MedDraft) => ({
  name: d.name, dose: d.dose, instructions: d.instructions, times: d.times, asNeeded: d.asNeeded, startDate: d.startDate, endDate: d.endDate,
  supply: d.supply === '' ? null : Number(d.supply), refillAt: d.refillAt === '' ? null : Number(d.refillAt), kidCanMark: d.kidCanMark,
});

/** Today's dose buttons for one medicine: tap a due dose to give it, a given one to undo. */
export function DoseButtons({ med, day, date, onChange }: { med: Medicine; day: MedDay; date: string; onChange: () => Promise<void> }) {
  const { base, toast } = useApp();
  const run = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); if (msg) toast(msg); await onChange(); } catch (e) { toast((e as Error).message); } };
  const url = `${base}/meds/${med.id}/doses`;
  return (
    <div className="chips">
      {day.slots.map((s) => {
        const done = s.status === 'given' || s.status === 'skipped';
        const label = `${timeText(s.time)} ${s.status === 'given' ? '✓' : s.status === 'skipped' ? '⤼ skipped' : s.status === 'late' ? '⚠️' : ''}`;
        return (
          <span key={s.slot} className="row" style={{ gap: 2 }}>
            <button className={`chip${s.status === 'given' ? ' on' : ''}`} title={s.by ? `${s.status} by ${s.by}${s.byKid ? ' on the tablet' : ''}` : undefined}
              style={s.status === 'late' ? { borderColor: 'var(--warn)' } : undefined}
              onClick={() => void run(() => done
                ? api(`${url}?date=${date}&slot=${encodeURIComponent(s.slot)}`, { method: 'DELETE' })
                : api(url, { body: { slot: s.slot, date, status: 'given' } }), done ? 'Undone' : `${med.name} given`)}>
              💊 {label}{s.byKid && ' 🦝'}
            </button>
            {!done && <button className="ghost small" aria-label={`Skip the ${timeText(s.time)} dose`} onClick={() => void run(() => api(url, { body: { slot: s.slot, date, status: 'skipped' } }), 'Skipped')}>Skip</button>}
          </span>
        );
      })}
      {med.asNeeded && (
        <button className="chip" onClick={() => void run(() => api(url, { body: { slot: 'prn', date } }), `${med.name} given`)}>
          ＋ Gave a dose{day.extra.length ? ` (${day.extra.length} today)` : ''}
        </button>
      )}
    </div>
  );
}

export function MedsTab({ kid, data, today, reload }: { kid: { id: string; name: string }; data: MedRow[]; today: string; reload: () => Promise<void> }) {
  const { base, toast } = useApp();
  const [editing, setEditing] = useState<MedRow | 'new' | null>(null);
  const [showOld, setShowOld] = useState(false);
  const run = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); if (msg) toast(msg); setEditing(null); await reload(); } catch (e) { toast((e as Error).message); } };
  const active = data.filter((m) => m.active);
  const old = data.filter((m) => !m.active);
  return (
    <section className="stack">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>Medicines</h2>
        <button className="primary" onClick={() => setEditing('new')}>＋ Medicine</button>
      </div>
      {!active.length && <div className="card muted">No medicines. Add one to tick off doses each day, count down the supply and get a refill reminder.</div>}
      <div className="grid-2">
        {active.map((m) => (
          <div key={m.id} className="card stack">
            <div className="row">
              <span style={{ fontSize: '1.6rem' }} aria-hidden>💊</span>
              <div style={{ flex: 1 }}>
                <strong>{m.name}</strong>{m.dose && <span className="muted"> · {m.dose}</span>}
                <div className="small muted">
                  {m.times.length ? m.times.map(timeText).join(', ') : ''}{m.times.length && m.asNeeded ? ' · ' : ''}{m.asNeeded ? 'when needed' : ''}
                  {m.endDate && ` · until ${shortDate(m.endDate)}`}{m.kidCanMark && ` · ${kid.name} can tick it off`}
                </div>
              </div>
              <button className="ghost" onClick={() => setEditing(m)}>Edit</button>
            </div>
            {m.instructions && <p className="small" style={{ margin: 0 }}>{m.instructions}</p>}
            {m.onToday ? <DoseButtons med={m} day={m.today} date={today} onChange={reload} /> : <p className="small muted" style={{ margin: 0 }}>Not scheduled today.</p>}
            <div className="row small">
              {m.supply != null && <span className={`pill${m.low ? ' warn' : ''}`}>{m.low ? '⚠️ ' : ''}{m.supply} dose{m.supply === 1 ? '' : 's'} left</span>}
              {m.last30.percent != null && <span className="pill">{m.last30.percent}% on time, last 30 days</span>}
              {m.last30.missed > 0 && <span className="pill warn">{m.last30.missed} missed</span>}
              {m.last30.asNeeded > 0 && <span className="pill">{m.last30.asNeeded} as-needed</span>}
              {m.low && <button className="ghost small" onClick={() => {
                const n = prompt('How many doses do you have now?', '30');
                if (n != null && n.trim()) void run(() => api(`${base}/meds/${m.id}`, { method: 'PATCH', body: { supply: Number(n) } }), 'Refilled');
              }}>Refilled</button>}
            </div>
          </div>
        ))}
      </div>
      {old.length > 0 && <button className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowOld(!showOld)}>{showOld ? '▾' : '▸'} Stopped ({old.length})</button>}
      {showOld && old.map((m) => (
        <div key={m.id} className="list-item small">
          <span style={{ flex: 1 }}>💊 {m.name}{m.dose && ` · ${m.dose}`}</span>
          <button className="ghost" onClick={() => void run(() => api(`${base}/meds/${m.id}`, { method: 'PATCH', body: { active: true } }), 'Started again')}>Start again</button>
          <button className="ghost" onClick={() => setEditing(m)}>Edit</button>
        </div>
      ))}
      {editing && (
        <MedForm kidName={kid.name} initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)}
          onSave={(d) => run(() => editing === 'new' ? api(`${base}/kids/${kid.id}/meds`, { body: body(d) }) : api(`${base}/meds/${editing.id}`, { method: 'PATCH', body: body(d) }), 'Medicine saved')}
          onDelete={editing === 'new' ? undefined : () => run(() => api(`${base}/meds/${editing.id}`, { method: 'DELETE' }), 'Deleted')}
          onStop={editing === 'new' || !editing.active ? undefined : () => run(() => api(`${base}/meds/${editing.id}`, { method: 'PATCH', body: { active: false } }), 'Stopped')} />
      )}
    </section>
  );
}

/** The parents' home: everyone's medicines for today, with the doses still to give first. */
export function MedsTodayCard() {
  const { base } = useApp();
  const [data, reload] = useLoad<{ today: string; meds: HomeMedicine[] }>(`${base}/meds/today`, [base]);
  if (!data?.meds.length) return null;
  const { today, meds } = data;
  const left = meds.reduce((n, m) => n + m.today.slots.filter((s) => s.status === 'due' || s.status === 'late').length, 0);
  return (
    <section className="card stack">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>💊 Medicine today</h2>
        <span className={`pill${left ? ' warn' : ' ok'}`}>{left ? `${left} to give` : 'All given'}</span>
        <NavLink to="/doctors?tab=meds" className="small">All medicines</NavLink>
      </div>
      {meds.map((m) => (
        <div key={m.id} className="list-item" style={{ flexWrap: 'wrap' }}>
          <RaccoonAvatar variant={m.kidAvatar} size={32} />
          <div style={{ flex: 1, minWidth: 160 }}>
            <strong>{m.name}</strong>{m.dose && <span className="muted"> · {m.dose}</span>}
            <div className="small muted">{m.kidName}{m.low && ` · ⚠️ ${m.supply} left, time to refill`}</div>
          </div>
          <DoseButtons med={m} day={m.today} date={today} onChange={reload} />
        </div>
      ))}
    </section>
  );
}
