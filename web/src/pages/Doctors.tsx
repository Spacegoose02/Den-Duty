import { useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { Modal, ProgressBar, shortDate } from '../components/Bits.tsx';
import { LineChart } from '../components/Charts.tsx';
import { seriesColor } from '../../../shared/catalog.ts';
import { TherapyHelperCard } from '../components/TherapyHelper.tsx';
import { AskDoctorCard } from '../components/AskDoctor.tsx';
import { appointmentOn, goalAreaOn, type DoctorArea } from '../../../shared/pages.ts';
import { WEEKDAY_SHORT } from '../../../shared/schedule.ts';

interface Appointment { id: string; kind: string; title: string; provider: string | null; location: string | null; startsAt: string; durationMinutes: number | null; status: string; notes: string | null }
interface TGoal { id: string; area: string; title: string; description: string | null; targetDate: string | null; status: string; progress: number; metAt: string | null; history: { date: string; progress: number }[]; rewardStep: number; rewardMet: number; rewardMetPaid: boolean;
  practice: { schedule: 'weekly' | 'once'; weekdays: number[]; date: string | null; time: string | null } | null }
interface TNote { id: string; goalId: string | null; goalTitle: string | null; body: string; progress: number | null; date: string; by: string | null }
interface TherapyData { kidVisible: boolean; appointments: Appointment[]; goals: TGoal[]; notes: TNote[] }

export const KIND_ICONS: Record<string, string> = {
  doctor: '🩺', speech: '🗣️', feeding: '🥄', occupational: '✋', physical: '🏃', behavioral: '🧩', dental: '🦷', other: '📌',
};
const KIND_LABELS: Record<string, string> = {
  doctor: 'Doctor', speech: 'Speech', feeding: 'Feeding', occupational: 'Occupational therapy', physical: 'Physical therapy', behavioral: 'Behavioral', dental: 'Dentist', other: 'Other',
};
export const AREA_ICONS: Record<string, string> = {
  development: '🌱', speech: '🗣️', feeding: '🥄', doctor: '🩺', motor: '✋', sensory: '🌀', selfcare: '🪥', physical: '🏃', behavioral: '🧩', dental: '🦷', social: '🤝', other: '📌',
};
export const AREA_LABELS: Record<string, string> = {
  development: 'Development', speech: 'Speech', feeding: 'Feeding', doctor: 'Doctor / health', motor: 'Fine / gross motor', sensory: 'Sensory',
  selfcare: 'Self-care', physical: 'Physical therapy', behavioral: 'Behavioral', dental: 'Dental', social: 'Social', other: 'Other',
};

export const whenText = (local: string) => {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? local : d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

function nowLocal(): string {
  const d = new Date(Date.now() + 864e5);
  d.setMinutes(0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export interface AppointmentDraft { kind: string; title: string; provider: string; location: string; startsAt: string; durationMinutes: number; notes: string; status?: string }

/** New appointment, or edit one (with status and delete) when `initial` is given. Also used from the calendar. */
export function AppointmentForm({ onSave, onClose, areasOff, initial, onDelete }: {
  onSave: (a: AppointmentDraft) => Promise<void>; onClose: () => void; areasOff: DoctorArea[]; initial?: AppointmentDraft; onDelete?: () => Promise<void>;
}) {
  const [a, setA] = useState<AppointmentDraft>(initial ?? { kind: 'speech', title: '', provider: '', location: '', startsAt: nowLocal(), durationMinutes: 45, notes: '' });
  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void onSave(a); }}>
        <h2 style={{ margin: 0 }}>{initial ? 'Edit appointment' : 'New appointment'}</h2>
        <div className="chips">
          {Object.keys(KIND_ICONS).filter((k) => appointmentOn(k, areasOff.filter((a) => a !== 'appointments'))).map((k) => (
            <button key={k} type="button" className={`chip${a.kind === k ? ' on' : ''}`} onClick={() => setA({ ...a, kind: k, title: a.title || KIND_LABELS[k] })}>{KIND_ICONS[k]} {KIND_LABELS[k]}</button>
          ))}
        </div>
        <input placeholder="What is it? e.g. Speech therapy" value={a.title} onChange={(e) => setA({ ...a, title: e.target.value })} />
        <div className="row">
          <input type="datetime-local" value={a.startsAt} onChange={(e) => setA({ ...a, startsAt: e.target.value })} style={{ flex: 1, minWidth: 220 }} />
          <input type="number" min={5} step={5} value={a.durationMinutes} onChange={(e) => setA({ ...a, durationMinutes: Number(e.target.value) })} style={{ width: 110 }} aria-label="Minutes" />
          <span className="small muted">min</span>
        </div>
        <input placeholder="Provider (optional), e.g. Ms. Lee" value={a.provider} onChange={(e) => setA({ ...a, provider: e.target.value })} />
        <input placeholder="Where (optional)" value={a.location} onChange={(e) => setA({ ...a, location: e.target.value })} />
        <textarea placeholder="Notes or questions to ask (optional)" value={a.notes} onChange={(e) => setA({ ...a, notes: e.target.value })} style={{ minHeight: 80 }} />
        {initial && (
          <div className="chips">
            {(['scheduled', 'done', 'missed', 'cancelled'] as const).map((s) => (
              <button key={s} type="button" className={`chip${a.status === s ? ' on' : ''}`} onClick={() => setA({ ...a, status: s })}>
                {{ scheduled: '📅 Scheduled', done: '✓ Done', missed: '⚠️ Missed', cancelled: '✕ Cancelled' }[s]}
              </button>
            ))}
          </div>
        )}
        <div className="row">
          {onDelete && <button type="button" className="ghost danger" onClick={() => { if (confirm('Delete this appointment?')) void onDelete(); }}>Delete</button>}
          <span className="spacer" /><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={!a.title.trim() || !a.startsAt}>Save</button></div>
      </form>
    </Modal>
  );
}

function GoalCard({ goal, color, onChange, base }: { goal: TGoal; color: string; onChange: () => Promise<void>; base: string }) {
  const { toast, home } = useApp();
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState(goal.progress);
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); await onChange(); } catch (e) { toast((e as Error).message); } };
  const history = goal.history.length ? goal.history : [{ date: goal.metAt?.slice(0, 10) ?? '', progress: goal.progress }];
  return (
    <div className="card stack" style={{ opacity: goal.status === 'paused' ? 0.7 : 1 }}>
      <div className="row">
        <span style={{ fontSize: '1.6rem' }}>{AREA_ICONS[goal.area] ?? '📌'}</span>
        <div style={{ flex: 1 }}>
          <strong>{goal.title}</strong>
          <div className="small muted">{AREA_LABELS[goal.area] ?? goal.area}{goal.targetDate && ` · aiming for ${shortDate(goal.targetDate)}`}
            {goal.status === 'met' && ' · 🎉 met'}{goal.status === 'paused' && ' · paused'}</div>
        </div>
        <span style={{ fontWeight: 800, fontSize: '1.3rem' }}>{goal.progress}%</span>
      </div>
      {goal.description && <p className="small" style={{ margin: 0 }}>{goal.description}</p>}
      <RewardEditor goal={goal} onSaved={onChange} goalUrl={goalUrl(base, goal.id)} />
      <PracticeEditor goal={goal} onSaved={onChange} goalUrl={goalUrl(base, goal.id)} />
      <ProgressBar percent={goal.progress} color={goal.status === 'met' ? 'var(--ok)' : color} />
      {goal.history.length >= 2 && (
        <LineChart height={150} unit="%" labels={history.map((h) => shortDate(h.date))} series={[{ id: goal.id, name: 'Progress', color, values: history.map((h) => h.progress) }]} />
      )}
      {goal.status !== 'met' && (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const r = await api<{ awarded: number }>(`${base}/notes`, { body: { goalId: goal.id, body: note, progress } });
            setNote('');
            toast(r.awarded ? `Progress saved, +${r.awarded} ${home?.pointsIcon ?? ''} for practicing` : 'Progress saved');
          });
        }}>
          <div className="row">
            <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} style={{ flex: 1, minHeight: 0 }} aria-label="Progress" />
            <strong style={{ width: 48, textAlign: 'right' }}>{progress}%</strong>
          </div>
          <div className="row">
            <input placeholder="What happened? e.g. 7 of 10 correct today" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
            <button disabled={!note.trim()}>Add progress</button>
          </div>
        </form>
      )}
      <div className="row">
        {goal.status !== 'met' && <button className="ghost" onClick={() => void run(() => api(goalUrl(base, goal.id), { method: 'PATCH', body: { status: 'met' } }))}>🎉 Mark met</button>}
        {goal.status === 'active' && <button className="ghost" onClick={() => void run(() => api(goalUrl(base, goal.id), { method: 'PATCH', body: { status: 'paused' } }))}>Pause</button>}
        {goal.status !== 'active' && <button className="ghost" onClick={() => void run(() => api(goalUrl(base, goal.id), { method: 'PATCH', body: { status: 'active' } }))}>Make active</button>}
        <span className="spacer" />
        <button className="ghost danger" onClick={() => { if (confirm(`Delete “${goal.title}” and its notes?`)) void run(() => api(goalUrl(base, goal.id), { method: 'DELETE' })); }}>Delete</button>
      </div>
    </div>
  );
}

export interface PracticeForm { practiceSchedule: 'none' | 'weekly' | 'once'; practiceWeekdays: number[]; practiceDate: string; practiceTime: string }
export const NO_PRACTICE: PracticeForm = { practiceSchedule: 'none', practiceWeekdays: [], practiceDate: '', practiceTime: '' };

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
export const timeText = (t: string) => TIME_FMT.format(new Date(`2000-01-01T${t}:00Z`));

export function practiceText(p: TGoal['practice']): string {
  if (!p) return '';
  const at = p.time ? ` at ${timeText(p.time)}` : '';
  if (p.schedule === 'once') return `${p.date ? shortDate(p.date) : ''}${at}`;
  return `${p.weekdays.length === 7 ? 'Every day' : p.weekdays.map((d) => WEEKDAY_SHORT[d]).join(', ')}${at}`;
}

/** Practice schedule fields: none, some weekdays (with an optional time), or one date. */
export function PracticeFields({ value, onChange }: { value: PracticeForm; onChange: (v: PracticeForm) => void }) {
  const set = (p: Partial<PracticeForm>) => onChange({ ...value, ...p });
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="chips">
        {([['none', 'No schedule'], ['weekly', 'On some days'], ['once', 'One day']] as const).map(([k, l]) => (
          <button key={k} type="button" className={`chip${value.practiceSchedule === k ? ' on' : ''}`} onClick={() => set({ practiceSchedule: k })}>{l}</button>
        ))}
      </div>
      {value.practiceSchedule === 'weekly' && (
        <div className="chips">
          {WEEKDAY_SHORT.map((d, i) => {
            const on = value.practiceWeekdays.includes(i);
            return <button key={d} type="button" className={`chip${on ? ' on' : ''}`} onClick={() => set({ practiceWeekdays: on ? value.practiceWeekdays.filter((x) => x !== i) : [...value.practiceWeekdays, i].sort() })}>{d}</button>;
          })}
          <button type="button" className="chip" onClick={() => set({ practiceWeekdays: [0, 1, 2, 3, 4, 5, 6] })}>Every day</button>
        </div>
      )}
      {value.practiceSchedule === 'once' && <input type="date" value={value.practiceDate} onChange={(e) => set({ practiceDate: e.target.value })} style={{ maxWidth: 220 }} />}
      {value.practiceSchedule !== 'none' && (
        <label className="row small">At (optional) <input type="time" value={value.practiceTime} onChange={(e) => set({ practiceTime: e.target.value })} style={{ maxWidth: 160 }} /></label>
      )}
    </div>
  );
}

export const practiceReady = (p: PracticeForm) => p.practiceSchedule === 'none' || (p.practiceSchedule === 'weekly' ? p.practiceWeekdays.length > 0 : !!p.practiceDate);

function PracticeEditor({ goal, goalUrl, onSaved }: { goal: TGoal; goalUrl: string; onSaved: () => Promise<void> }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const p = goal.practice;
  const [f, setF] = useState<PracticeForm>(p ? { practiceSchedule: p.schedule, practiceWeekdays: p.weekdays, practiceDate: p.date ?? '', practiceTime: p.time ?? '' } : NO_PRACTICE);
  if (!open) {
    return <button className="ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>📅 {p ? `Practice: ${practiceText(p)}` : 'Add a practice schedule'}</button>;
  }
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      try { await api(goalUrl, { method: 'PATCH', body: f }); toast('Practice schedule saved'); setOpen(false); await onSaved(); } catch (err) { toast((err as Error).message); }
    }}>
      <PracticeFields value={f} onChange={setF} />
      <p className="small muted" style={{ margin: 0 }}>Scheduled practices show on the calendar; tick them off there.</p>
      <div className="row"><span className="spacer" /><button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button><button className="primary" disabled={!practiceReady(f)}>Save</button></div>
    </form>
  );
}

function RewardEditor({ goal, goalUrl, onSaved }: { goal: TGoal; goalUrl: string; onSaved: () => Promise<void> }) {
  const { home, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [r, setR] = useState({ rewardStep: goal.rewardStep, rewardMet: goal.rewardMet });
  const icon = home?.pointsIcon ?? '✨';
  if (!open) {
    return (
      <button type="button" className="ghost small" style={{ alignSelf: 'flex-start', minHeight: 36 }} onClick={() => setOpen(true)}>
        🎁 {goal.rewardStep || goal.rewardMet ? `+${goal.rewardStep} ${icon} per practice · +${goal.rewardMet} ${icon} when reached${goal.rewardMetPaid ? ' (paid)' : ''}` : 'Add a reward'}
      </button>
    );
  }
  return (
    <form className="row" onSubmit={async (e) => {
      e.preventDefault();
      try { await api(goalUrl, { method: 'PATCH', body: r }); toast('Rewards saved'); setOpen(false); await onSaved(); } catch (err) { toast((err as Error).message); }
    }}>
      <label className="small">{icon} per practice <input type="number" min={0} value={r.rewardStep} onChange={(e) => setR({ ...r, rewardStep: Math.max(0, Math.round(Number(e.target.value) || 0)) })} style={{ width: 90 }} /></label>
      <label className="small">{icon} when reached <input type="number" min={0} value={r.rewardMet} onChange={(e) => setR({ ...r, rewardMet: Math.max(0, Math.round(Number(e.target.value) || 0)) })} style={{ width: 90 }} /></label>
      <button>Save</button>
      <button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

/** base is /api/homes/:id/kids/:kid/therapy; goal edits live at /api/homes/:id/therapy/goals/:goal. */
const goalUrl = (base: string, id: string) => base.replace(/\/kids\/[^/]+\/therapy$/, `/therapy/goals/${id}`);

export function Doctors() {
  const { base, home, toast, dark } = useApp();
  const [picked, setPicked] = useState<string | null>(null);
  const docKids = home?.kids.filter((k) => !k.pagesOff.includes('doctors')) ?? [];
  const kid = docKids.find((k) => k.id === picked) ?? docKids[0];
  const areasOff = kid?.doctorAreasOff ?? [];
  const tBase = kid ? `${base}/kids/${kid.id}/therapy` : null;
  const [data, reload] = useLoad<TherapyData>(tBase, [tBase]);
  const [adding, setAdding] = useState<'appointment' | 'goal' | null>(null);
  const [goal, setGoal] = useState({ area: 'speech', title: '', description: '', targetDate: '', rewardStep: 0, rewardMet: 0, ...NO_PRACTICE });
  const [note, setNote] = useState('');
  const [showPast, setShowPast] = useState(false);
  if (!home) return null;
  const run = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); if (msg) toast(msg); await reload(); } catch (e) { toast((e as Error).message); } };
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const upcoming = (data?.appointments ?? []).filter((a) => a.startsAt >= now && a.status === 'scheduled').reverse();
  const past = (data?.appointments ?? []).filter((a) => !(a.startsAt >= now && a.status === 'scheduled'));
  const color = kid ? seriesColor(kid.color, dark) : 'var(--primary)';
  const apptUrl = (id: string) => `${base}/therapy/appointments/${id}`;

  return (
    <div className="stack">
      <div className="topbar">
        <h1>Doctors</h1>
        <span className="pill">🔒 Parents only</span>
      </div>
      {!home.kids.length && <div className="card">Add a kid first in Kids.</div>}
      {home.kids.length > 0 && !docKids.length && <div className="card">Doctors is turned off for every kid. Turn it on in Kids → Edit.</div>}
      <div className="chips">
        {docKids.map((k) => (
          <button key={k.id} className={`chip${kid?.id === k.id ? ' on' : ''}`} onClick={() => setPicked(k.id)}>
            <RaccoonAvatar variant={k.avatar} size={28} /> {k.name}
          </button>
        ))}
      </div>

      {kid && data && (
        <>
          <label className="row card" style={{ fontWeight: 600 }}>
            <input type="checkbox" checked={data.kidVisible} style={{ width: 24, minHeight: 24 }}
              onChange={(e) => void run(() => api(tBase!, { method: 'PATCH', body: { kidVisible: e.target.checked } }), e.target.checked ? `${kid.name} can see their goals and appointments` : 'Hidden again')} />
            <span style={{ flex: 1 }}>Show {kid.name} their active goals and next appointments on the tablet <span className="small muted">(notes always stay private)</span></span>
          </label>

          <section className="card stack" hidden={areasOff.includes('appointments')}>
            <div className="row">
              <h2 style={{ margin: 0, flex: 1 }}>Appointments</h2>
              <button className="primary" onClick={() => setAdding('appointment')}>＋ Appointment</button>
            </div>
            {upcoming.map((a) => (
              <div key={a.id} className="list-item">
                <span style={{ fontSize: '1.6rem' }}>{KIND_ICONS[a.kind] ?? '📌'}</span>
                <div style={{ flex: 1 }}>
                  <strong>{a.title}</strong>{a.provider && <span className="muted"> with {a.provider}</span>}
                  <div className="small muted">{whenText(a.startsAt)}{a.durationMinutes ? ` · ${a.durationMinutes} min` : ''}{a.location && ` · ${a.location}`}</div>
                  {a.notes && <div className="small">{a.notes}</div>}
                </div>
                <button className="ghost" onClick={() => void run(() => api(apptUrl(a.id), { method: 'PATCH', body: { status: 'done' } }), 'Marked done')}>✓ Done</button>
                <button className="ghost danger" onClick={() => void run(() => api(apptUrl(a.id), { method: 'PATCH', body: { status: 'cancelled' } }), 'Cancelled')}>Cancel</button>
              </div>
            ))}
            {!upcoming.length && <p className="muted" style={{ margin: 0 }}>Nothing coming up.</p>}
            {past.length > 0 && <button className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowPast(!showPast)}>{showPast ? '▾' : '▸'} Past and cancelled ({past.length})</button>}
            {showPast && past.map((a) => (
              <div key={a.id} className="list-item small">
                <span>{KIND_ICONS[a.kind] ?? '📌'}</span>
                <span style={{ flex: 1 }}>{a.title} · {whenText(a.startsAt)}</span>
                <span className={`pill${a.status === 'done' ? ' ok' : a.status === 'scheduled' ? ' warn' : ''}`}>{a.status === 'scheduled' ? 'not marked' : a.status}</span>
                {a.status === 'scheduled' && <button className="ghost" onClick={() => void run(() => api(apptUrl(a.id), { method: 'PATCH', body: { status: 'done' } }))}>Done</button>}
                {a.status === 'scheduled' && <button className="ghost" onClick={() => void run(() => api(apptUrl(a.id), { method: 'PATCH', body: { status: 'missed' } }))}>Missed</button>}
                <button className="ghost danger" onClick={() => { if (confirm('Delete this appointment?')) void run(() => api(apptUrl(a.id), { method: 'DELETE' })); }}>✕</button>
              </div>
            ))}
          </section>

          <div className="grid-2">
            {!areasOff.includes('speech') && !kid.ideasOff.includes('speech') && <TherapyHelperCard key={`speech-${kid.id}`} kidId={kid.id} area="speech" goals={data.goals} onChange={reload} />}
            {['ot', 'sensory', 'selfcare'].some((a) => !areasOff.includes(a as DoctorArea)) && !kid.ideasOff.includes('ot') && <TherapyHelperCard key={`ot-${kid.id}`} kidId={kid.id} area="ot" goals={data.goals} onChange={reload} />}
            {!areasOff.includes('behavioral') && !kid.ideasOff.includes('anger') && <TherapyHelperCard key={`anger-${kid.id}`} kidId={kid.id} area="anger" goals={data.goals} onChange={reload} />}
          </div>

          <AskDoctorCard key={`ask-${kid.id}`} kidId={kid.id} kidName={kid.name} />

          <section className="stack">
            <div className="row">
              <h2 style={{ margin: 0, flex: 1 }}>Goals and progress</h2>
              <button className="primary" onClick={() => setAdding('goal')}>＋ Goal</button>
            </div>
            <div className="grid-2">
              {data.goals.map((g) => <GoalCard key={g.id} goal={g} color={color} base={tBase!} onChange={reload} />)}
            </div>
            {!data.goals.length && <div className="card muted">No goals yet. Add speech, feeding, development or doctor goals and track progress over time.</div>}
          </section>

          <section className="card stack">
            <h2 style={{ margin: 0 }}>Notes</h2>
            <form className="row" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`${tBase}/notes`, { body: { body: note } }); setNote(''); }, 'Note saved'); }}>
              <input placeholder={`A quick note about ${kid.name}…`} value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
              <button disabled={!note.trim()}>Save note</button>
            </form>
            {data.notes.map((n) => (
              <div key={n.id} className="list-item">
                <div style={{ flex: 1 }}>
                  <div>{n.body}</div>
                  <div className="small muted">{shortDate(n.date)}{n.by && ` · ${n.by}`}{n.goalTitle && ` · ${n.goalTitle}`}{n.progress != null && ` · ${n.progress}%`}</div>
                </div>
                <button className="ghost danger" onClick={() => { if (confirm('Delete this note?')) void run(() => api(`${base}/therapy/notes/${n.id}`, { method: 'DELETE' })); }}>✕</button>
              </div>
            ))}
          </section>
        </>
      )}

      {adding === 'appointment' && tBase && (
        <AppointmentForm areasOff={areasOff} onClose={() => setAdding(null)} onSave={(a) => run(async () => { await api(`${tBase}/appointments`, { body: a }); setAdding(null); }, 'Appointment added')} />
      )}
      {adding === 'goal' && tBase && (
        <Modal onClose={() => setAdding(null)}>
          <form className="stack" onSubmit={(e) => {
            e.preventDefault();
            void run(async () => { await api(`${tBase}/goals`, { body: goal }); setAdding(null); setGoal({ area: 'speech', title: '', description: '', targetDate: '', rewardStep: 0, rewardMet: 0, ...NO_PRACTICE }); }, 'Goal added');
          }}>
            <h2 style={{ margin: 0 }}>New goal for {kid?.name}</h2>
            <div className="chips">
              {Object.keys(AREA_ICONS).filter((a) => goalAreaOn(a, areasOff)).map((a) => <button key={a} type="button" className={`chip${goal.area === a ? ' on' : ''}`} onClick={() => setGoal({ ...goal, area: a })}>{AREA_ICONS[a]} {AREA_LABELS[a]}</button>)}
            </div>
            <input placeholder="Goal, e.g. Use 3-word sentences" value={goal.title} onChange={(e) => setGoal({ ...goal, title: e.target.value })} autoFocus />
            <textarea placeholder="Details from the therapist or doctor (optional)" value={goal.description} onChange={(e) => setGoal({ ...goal, description: e.target.value })} style={{ minHeight: 80 }} />
            <div className="row">
              <label className="field">{home?.pointsIcon} per practice
                <input type="number" min={0} value={goal.rewardStep} onChange={(e) => setGoal({ ...goal, rewardStep: Math.max(0, Math.round(Number(e.target.value) || 0)) })} style={{ width: 120 }} />
              </label>
              <label className="field">{home?.pointsIcon} when reached
                <input type="number" min={0} value={goal.rewardMet} onChange={(e) => setGoal({ ...goal, rewardMet: Math.max(0, Math.round(Number(e.target.value) || 0)) })} style={{ width: 120 }} />
              </label>
            </div>
            <p className="small muted" style={{ margin: 0 }}>Optional. Each progress note pays the practice {home?.pointsName}; reaching the goal pays the bonus once. Kids see “Great practice!” (with the goal's name only if you share Doctors with them).</p>
            <strong className="small">📅 Practice schedule (shows on the calendar)</strong>
            <PracticeFields value={goal} onChange={(p) => setGoal({ ...goal, ...p })} />
            <label className="field">Aiming for (optional)
              <input type="date" value={goal.targetDate} onChange={(e) => setGoal({ ...goal, targetDate: e.target.value })} style={{ maxWidth: 220 }} />
            </label>
            <div className="row"><span className="spacer" /><button type="button" className="ghost" onClick={() => setAdding(null)}>Cancel</button><button className="primary" disabled={!goal.title.trim() || !practiceReady(goal)}>Save</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
