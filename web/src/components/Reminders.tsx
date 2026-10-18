import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Reminder } from '../api.ts';
import { useApp } from '../state.tsx';
import { Modal, dayName, shortDate } from './Bits.tsx';
import { AppointmentForm, KIND_ICONS, KIND_LABELS, timeText } from '../pages/Doctors.tsx';

const UNIT_WORD = { day: 'day', week: 'week', month: 'month', year: 'year' } as const;
const localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export function dueText(r: Pick<Reminder, 'dueDate' | 'dueTime'>): string {
  if (!r.dueDate) return 'No date';
  const t = localToday();
  const day = r.dueDate === t ? 'Today' : r.dueDate === addOne(t) ? 'Tomorrow' : `${dayName(r.dueDate)} ${shortDate(r.dueDate)}`;
  return r.dueTime ? `${day} at ${timeText(r.dueTime)}` : day;
}
function addOne(d: string) { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); }
export const repeatText = (r: Reminder) => (r.repeat ? `Every ${r.repeat.every === 1 ? '' : `${r.repeat.every} `}${UNIT_WORD[r.repeat.unit]}${r.repeat.every === 1 ? '' : 's'}` : '');

interface Draft { title: string; notes: string; kidId: string; dueDate: string; dueTime: string; repeatOn: boolean; every: number; unit: 'day' | 'week' | 'month' | 'year'; appt: boolean; apptKind: string }

/** Add or edit a reminder: title, optional date/time, kid, repeat, and whether it's about booking an appointment. */
export function ReminderForm({ initial, onClose, onDone }: { initial?: Reminder; onClose: () => void; onDone: () => void }) {
  const { base, home, toast } = useApp();
  const [d, setD] = useState<Draft>(initial ? {
    title: initial.title, notes: initial.notes ?? '', kidId: initial.kidId ?? '', dueDate: initial.dueDate ?? '', dueTime: initial.dueTime ?? '',
    repeatOn: !!initial.repeat, every: initial.repeat?.every ?? 6, unit: initial.repeat?.unit ?? 'month', appt: !!initial.apptKind, apptKind: initial.apptKind ?? 'doctor',
  } : { title: '', notes: '', kidId: '', dueDate: '', dueTime: '', repeatOn: false, every: 6, unit: 'month', appt: false, apptKind: 'doctor' });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Draft>) => setD({ ...d, ...p });
  const save = async () => {
    setBusy(true);
    try {
      const body = {
        title: d.title, notes: d.notes, kidId: d.kidId || null, dueDate: d.dueDate || null, dueTime: d.dueDate && d.dueTime ? d.dueTime : null,
        repeat: d.repeatOn ? { every: d.every, unit: d.unit } : null, apptKind: d.appt ? d.apptKind : null,
      };
      if (initial) await api(`${base}/reminders/${initial.id}`, { method: 'PATCH', body });
      else await api(`${base}/reminders`, { body });
      toast(initial ? 'Reminder saved' : 'Reminder added');
      onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2 style={{ margin: 0 }}>🔔 {initial ? 'Edit reminder' : 'New reminder'}</h2>
        <input placeholder="e.g. Call to book Ava's dentist" value={d.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} autoFocus />
        <div className="row">
          <label className="field">Due (optional)<input type="date" value={d.dueDate} onChange={(e) => set({ dueDate: e.target.value })} style={{ maxWidth: 200 }} /></label>
          {d.dueDate && <label className="field">At (optional)<input type="time" value={d.dueTime} onChange={(e) => set({ dueTime: e.target.value })} style={{ maxWidth: 150 }} /></label>}
          <label className="field">About<select value={d.kidId} onChange={(e) => set({ kidId: e.target.value })}>
            <option value="">Nobody in particular</option>
            {home?.kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select></label>
        </div>
        <label className="row"><input type="checkbox" checked={d.repeatOn} onChange={(e) => set({ repeatOn: e.target.checked })} /> Repeat</label>
        {d.repeatOn && (
          <div className="row">
            <span>Every</span>
            <input type="number" min={1} max={100} value={d.every} onChange={(e) => set({ every: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 80 }} />
            <select value={d.unit} onChange={(e) => set({ unit: e.target.value as Draft['unit'] })}>
              {(['day', 'week', 'month', 'year'] as const).map((u) => <option key={u} value={u}>{u}{d.every === 1 ? '' : 's'}</option>)}
            </select>
            <span className="small muted">Ticking it moves it to the next date.</span>
            {!d.dueDate && <span className="small chip-reason">Pick a first date</span>}
          </div>
        )}
        <label className="row"><input type="checkbox" checked={d.appt} onChange={(e) => set({ appt: e.target.checked })} /> This is about making an appointment</label>
        {d.appt && (
          <div className="chips">
            {Object.keys(KIND_ICONS).map((k) => <button key={k} type="button" className={`chip${d.apptKind === k ? ' on' : ''}`} onClick={() => set({ apptKind: k })}>{KIND_ICONS[k]} {KIND_LABELS[k]}</button>)}
          </div>
        )}
        <textarea placeholder="Notes (optional), e.g. phone number" value={d.notes} onChange={(e) => set({ notes: e.target.value })} style={{ minHeight: 60 }} />
        <div className="row">
          {initial && <button type="button" className="ghost danger" onClick={async () => {
            if (!confirm('Delete this reminder?')) return;
            try { await api(`${base}/reminders/${initial.id}`, { method: 'DELETE' }); toast('Reminder deleted'); onDone(); } catch (e) { toast((e as Error).message); }
          }}>Delete</button>}
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !d.title.trim() || (d.repeatOn && !d.dueDate)}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

/** One reminder: tick it, edit it, and (for "make an appointment" ones) book it straight into Doctors. */
export function ReminderRow({ r, onChange }: { r: Reminder; onChange: () => void }) {
  const { base, home, toast } = useApp();
  const [editing, setEditing] = useState(false);
  const [booking, setBooking] = useState(false);
  const kid = home?.kids.find((k) => k.id === r.kidId);
  const tick = async () => {
    try {
      const v = await api<Reminder>(`${base}/reminders/${r.id}/${r.state === 'done' ? 'reopen' : 'done'}`, { body: {} });
      if (r.state !== 'done') toast(v.state === 'done' ? 'Done!' : `Done! Next: ${dueText(v)}`);
      onChange();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <div className={`reminder ${r.state}`}>
      <button className="reminder-tick" aria-label={r.state === 'done' ? 'Mark not done' : 'Mark done'} onClick={() => void tick()}>{r.state === 'done' ? '✓' : ''}</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="reminder-title">{r.apptKind && <span aria-hidden>{KIND_ICONS[r.apptKind] ?? '📌'} </span>}{r.title}</div>
        <div className="small muted">
          <span className={`reminder-due ${r.state}`}>{r.state === 'overdue' ? '⚠️ ' : ''}{dueText(r)}</span>
          {r.repeat && ` · 🔁 ${repeatText(r)}`}{r.kidName && ` · ${r.kidName}`}
        </div>
      </div>
      {r.apptKind && r.state !== 'done' && (kid ? <button className="ghost" onClick={() => setBooking(true)}>📅 Book it</button>
        : <span className="small muted" title="Pick a kid on the reminder to book it">Pick a kid to book</span>)}
      <button className="icon edit-btn" aria-label="Edit reminder" onClick={() => setEditing(true)}>✏️</button>
      {editing && <ReminderForm initial={r} onClose={() => setEditing(false)} onDone={() => { setEditing(false); onChange(); }} />}
      {booking && kid && (
        <AppointmentForm
          areasOff={[]}
          initial={{ kind: r.apptKind ?? 'doctor', title: KIND_LABELS[r.apptKind ?? 'doctor'] ?? r.title, provider: '', location: '', startsAt: `${localToday()}T09:00`, durationMinutes: 45, notes: r.notes ?? '' }}
          onClose={() => setBooking(false)}
          onSave={async (a) => {
            try {
              await api(`${base}/reminders/${r.id}/appointment`, { body: { ...a, kidId: kid.id } });
              toast(`Booked for ${kid.name}; it's in Doctors and on the calendar`);
              setBooking(false);
              onChange();
            } catch (e) { toast((e as Error).message); }
          }}
        />
      )}
    </div>
  );
}

/** Parent home: overdue and due-today reminders highlighted, plus the next week. */
export function RemindersCard({ items, onChange }: { items: Reminder[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const urgent = items.filter((r) => r.state === 'overdue' || r.state === 'today').length;
  return (
    <section className="card stack">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>🔔 Reminders {urgent > 0 && <span className="pill warn">{urgent} due</span>}</h2>
        <button className="ghost" onClick={() => setAdding(true)}>＋ Add</button>
        <Link to="/reminders" className="btn ghost">All →</Link>
      </div>
      {items.map((r) => <ReminderRow key={r.id} r={r} onChange={onChange} />)}
      {!items.length && <p className="small muted" style={{ margin: 0 }}>Nothing due this week.</p>}
      {adding && <ReminderForm onClose={() => setAdding(false)} onDone={() => { setAdding(false); onChange(); }} />}
    </section>
  );
}
