import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { Modal, ProgressBar, shortDate } from '../components/Bits.tsx';
import { LineChart } from '../components/Charts.tsx';
import { seriesColor } from '../../../shared/catalog.ts';
import { TherapyHelperCard } from '../components/TherapyHelper.tsx';
import { AskDoctorCard } from '../components/AskDoctor.tsx';
import { appointmentOn, goalAreaOn, type DoctorArea } from '../../../shared/pages.ts';
import { describeRepeat, WEEKDAY_SHORT, type RepeatRule, type RepeatUnit } from '../../../shared/schedule.ts';
import type { PracticeStep, PracticeWaiting } from '../api.ts';
import { MedsTab } from './doctors/Meds.tsx';
import { HealthTab, type HealthData } from './doctors/Health.tsx';
import { LogTab } from './doctors/HealthLog.tsx';
import { ShareTab } from './doctors/Share.tsx';

interface Question { text: string; done: boolean }
/** A repeating visit's rule, which run it's in and which visit of it this is (0 = the first). */
export type ApptRepeat = RepeatRule & { seriesId: string; index: number };
interface Appointment { id: string; kind: string; title: string; provider: string | null; location: string | null; startsAt: string; durationMinutes: number | null; status: string; notes: string | null; questions: Question[]; summary: string | null; repeat: ApptRepeat | null }
interface TGoal { id: string; area: string; title: string; description: string | null; targetDate: string | null; status: string; progress: number; metAt: string | null; history: { date: string; progress: number }[]; rewardStep: number; rewardMet: number; rewardMetPaid: boolean;
  steps: PracticeStep[]; practiceMinutes: number | null; kidPractice: boolean;
  practice: { schedule: 'weekly' | 'once'; weekdays: number[]; date: string | null; time: string | null } | null }
interface TNote { id: string; goalId: string | null; goalTitle: string | null; body: string; progress: number | null; date: string; by: string | null }
interface TherapyData { kidVisible: boolean; appointments: Appointment[]; goals: TGoal[]; notes: TNote[] }

export const KIND_ICONS: Record<string, string> = {
  doctor: '🩺', speech: '🗣️', feeding: '🥄', occupational: '✋', physical: '🏃', behavioral: '🧩', dental: '🦷', other: '📌',
};
export const KIND_LABELS: Record<string, string> = {
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

export interface AppointmentDraft {
  kind: string; title: string; provider: string; location: string; startsAt: string; durationMinutes: number; notes: string; status?: string;
  /** Sent as null for "doesn't repeat"; left out when only this visit of a repeating one changes. */
  repeat?: RepeatRule | null; scope?: 'one' | 'following';
}

/** "Every 2 weeks until Mar 3", for a visit's list line. */
export const repeatLabel = (r: RepeatRule) => describeRepeat({ ...r, endDate: null }) + (r.endDate ? ` until ${shortDate(r.endDate)}` : '');

type RepeatPreset = 'none' | 'weekly' | 'biweekly' | 'monthly' | 'custom';
interface RepeatForm { preset: RepeatPreset; every: number; unit: RepeatUnit; ends: 'never' | 'date' | 'count'; endDate: string; count: number }
const REPEAT_PRESETS: { id: RepeatPreset; label: string }[] = [
  { id: 'none', label: "Doesn't repeat" }, { id: 'weekly', label: 'Weekly' }, { id: 'biweekly', label: 'Every 2 weeks' }, { id: 'monthly', label: 'Monthly' }, { id: 'custom', label: 'Custom…' },
];

function repeatForm(r: ApptRepeat | RepeatRule | null | undefined): RepeatForm {
  if (!r) return { preset: 'none', every: 1, unit: 'week', ends: 'never', endDate: '', count: 6 };
  // A visit partway through a run counts the visits left from it.
  const count = r.count != null ? r.count - ('index' in r ? r.index : 0) : null;
  const preset: RepeatPreset = r.every === 1 && r.unit === 'week' ? 'weekly' : r.every === 2 && r.unit === 'week' ? 'biweekly' : r.every === 1 && r.unit === 'month' ? 'monthly' : 'custom';
  return { preset, every: r.every, unit: r.unit, ends: count != null ? 'count' : r.endDate ? 'date' : 'never', endDate: r.endDate ?? '', count: count ?? 6 };
}

function repeatRule(f: RepeatForm): RepeatRule | null {
  if (f.preset === 'none') return null;
  const [every, unit]: [number, RepeatUnit] = f.preset === 'weekly' ? [1, 'week'] : f.preset === 'biweekly' ? [2, 'week'] : f.preset === 'monthly' ? [1, 'month'] : [Math.max(1, Math.round(f.every) || 1), f.unit];
  return { every, unit, endDate: f.ends === 'date' && f.endDate ? f.endDate : null, count: f.ends === 'count' ? Math.max(1, Math.round(f.count) || 1) : null };
}

/** Doesn't repeat / weekly / every 2 weeks / monthly / every N days, weeks or months; ending never, on a date, or after N visits. */
function RepeatFields({ value: f, onChange, firstDate }: { value: RepeatForm; onChange: (f: RepeatForm) => void; firstDate: string }) {
  const set = (p: Partial<RepeatForm>) => onChange({ ...f, ...p });
  return (
    <div className="stack" style={{ gap: 8 }}>
      <strong className="small">🔁 Repeat</strong>
      <div className="chips">
        {REPEAT_PRESETS.map((p) => <button key={p.id} type="button" className={`chip${f.preset === p.id ? ' on' : ''}`} onClick={() => set({ preset: p.id })}>{p.label}</button>)}
      </div>
      {f.preset === 'custom' && (
        <div className="row">
          <span>Every</span>
          <input type="number" min={1} max={365} value={f.every} onChange={(e) => set({ every: Number(e.target.value) })} style={{ width: 90 }} aria-label="Repeat every" />
          <select style={{ width: 'auto' }} value={f.unit} onChange={(e) => set({ unit: e.target.value as RepeatUnit })} aria-label="Repeat unit">
            <option value="day">{f.every === 1 ? 'day' : 'days'}</option>
            <option value="week">{f.every === 1 ? 'week' : 'weeks'}</option>
            <option value="month">{f.every === 1 ? 'month' : 'months'}</option>
          </select>
        </div>
      )}
      {f.preset !== 'none' && (
        <div className="row">
          <span>Ends</span>
          <select style={{ width: 'auto' }} value={f.ends} onChange={(e) => set({ ends: e.target.value as RepeatForm['ends'] })} aria-label="Repeat ends">
            <option value="never">Never</option>
            <option value="date">On a date</option>
            <option value="count">After some visits</option>
          </select>
          {f.ends === 'date' && <input type="date" style={{ width: 'auto' }} min={firstDate} value={f.endDate} onChange={(e) => set({ endDate: e.target.value })} aria-label="Last date" />}
          {f.ends === 'count' && <><input type="number" min={1} max={500} value={f.count} onChange={(e) => set({ count: Number(e.target.value) })} style={{ width: 90 }} aria-label="Number of visits" /><span className="small muted">visits</span></>}
        </div>
      )}
      {f.preset !== 'none' && <span className="small muted">Each visit shows on Doctors and the calendars, with its own questions and follow-up.</span>}
    </div>
  );
}

/** New appointment, or edit one (with status and delete) when `initial` is given. Also used from the calendar and reminders. */
export function AppointmentForm({ onSave, onClose, areasOff, initial, initialRepeat, onDelete }: {
  onSave: (a: AppointmentDraft) => Promise<void>; onClose: () => void; areasOff: DoctorArea[]; initial?: AppointmentDraft;
  /** The repeat of the visit being edited, if it's part of one. */
  initialRepeat?: ApptRepeat | null;
  onDelete?: (scope: 'one' | 'following') => Promise<void>;
}) {
  const [a, setA] = useState<AppointmentDraft>(initial ?? { kind: 'speech', title: '', provider: '', location: '', startsAt: nowLocal(), durationMinutes: 45, notes: '' });
  const [rep, setRep] = useState<RepeatForm>(() => repeatForm(initialRepeat));
  const inSeries = !!initialRepeat;
  const [scope, setScope] = useState<'one' | 'following'>('one');
  const save = () => {
    if (inSeries && scope === 'one') return onSave({ ...a, scope: 'one' });
    const repeat = repeatRule(rep);
    if (repeat?.endDate && repeat.endDate < a.startsAt.slice(0, 10)) return Promise.resolve(alert('The repeat has to end on or after this visit.'));
    return onSave({ ...a, repeat, ...(inSeries ? { scope: 'following' as const } : {}) });
  };
  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2 style={{ margin: 0 }}>{initial ? 'Edit appointment' : 'New appointment'}</h2>
        {inSeries && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="small muted">🔁 Part of a repeat: {repeatLabel(initialRepeat!)}</span>
            <div className="chips">
              <button type="button" className={`chip${scope === 'one' ? ' on' : ''}`} onClick={() => setScope('one')}>Just this visit</button>
              <button type="button" className={`chip${scope === 'following' ? ' on' : ''}`} onClick={() => setScope('following')}>This and later visits</button>
            </div>
          </div>
        )}
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
        {(!inSeries || scope === 'following') && <RepeatFields value={rep} onChange={setRep} firstDate={a.startsAt.slice(0, 10)} />}
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
          {onDelete && !inSeries && <button type="button" className="ghost danger" onClick={() => { if (confirm('Delete this appointment?')) void onDelete('one'); }}>Delete</button>}
          {onDelete && inSeries && <>
            <button type="button" className="ghost danger" onClick={() => { if (confirm('Delete just this visit?')) void onDelete('one'); }}>Delete this visit</button>
            <button type="button" className="ghost danger" onClick={() => { if (confirm('Delete this visit and every later one? Visits marked done stay.')) void onDelete('following'); }}>Delete this and later</button>
          </>}
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
      <PracticeModeEditor goal={goal} onSaved={onChange} goalUrl={goalUrl(base, goal.id)} />
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

const STEP_ICONS = ['👀', '👂', '👄', '🐍', '🎈', '✋', '🧩', '🥄', '🪥', '🏃', '🫁', '⭐'];

/** Kid practice mode: picture steps and a timer on the kid's screen; "I did it!" waits for a parent. */
function PracticeModeEditor({ goal, goalUrl, onSaved }: { goal: TGoal; goalUrl: string; onSaved: () => Promise<void> }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kidPractice: goal.kidPractice, practiceMinutes: goal.practiceMinutes ?? 5, steps: goal.steps.length ? goal.steps : [{ icon: '⭐', text: '' }] });
  if (!open) {
    return (
      <button className="ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        ▶️ {goal.kidPractice ? `Practice mode on · ${goal.steps.length} step${goal.steps.length === 1 ? '' : 's'}${goal.practiceMinutes ? ` · ${goal.practiceMinutes} min timer` : ''}` : 'Set up practice mode for the tablet'}
      </button>
    );
  }
  const setStep = (i: number, p: Partial<PracticeStep>) => setF({ ...f, steps: f.steps.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return (
    <form className="stack card" style={{ background: 'var(--surface-2)' }} onSubmit={async (e) => {
      e.preventDefault();
      try { await api(goalUrl, { method: 'PATCH', body: { ...f, steps: f.steps.filter((x) => x.text.trim()) } }); toast('Practice mode saved'); setOpen(false); await onSaved(); } catch (err) { toast((err as Error).message); }
    }}>
      <label className="row small"><input type="checkbox" checked={f.kidPractice} onChange={(e) => setF({ ...f, kidPractice: e.target.checked })} style={{ width: 22, minHeight: 22 }} /> Show a ▶️ Practice button on the kid's screen</label>
      <p className="small muted" style={{ margin: 0 }}>They follow the steps, watch the timer, and tap “I did it!”. It waits for you on the home screen; approving it counts as the practice (and pays the practice points). Needs Doctors shared with them.</p>
      <label className="row small">Timer <input type="number" min={1} max={60} value={f.practiceMinutes} onChange={(e) => setF({ ...f, practiceMinutes: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} style={{ width: 80 }} /> minutes</label>
      <strong className="small">Steps</strong>
      {f.steps.map((st, i) => (
        <div key={i} className="row" style={{ gap: 6 }}>
          <select value={st.icon} onChange={(e) => setStep(i, { icon: e.target.value })} aria-label={`Step ${i + 1} picture`} style={{ width: 70 }}>
            {[...new Set([st.icon, ...STEP_ICONS])].map((ic) => <option key={ic} value={ic}>{ic}</option>)}
          </select>
          <input placeholder={`Step ${i + 1}, e.g. Hiss like a snake 5 times`} value={st.text} onChange={(e) => setStep(i, { text: e.target.value })} style={{ flex: 1, minWidth: 160 }} maxLength={160} />
          <button type="button" className="ghost" aria-label="Remove step" onClick={() => setF({ ...f, steps: f.steps.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      {f.steps.length < 12 && <button type="button" className="ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setF({ ...f, steps: [...f.steps, { icon: '⭐', text: '' }] })}>＋ Step</button>}
      <div className="row"><span className="spacer" /><button type="button" className="ghost" onClick={() => setOpen(false)}>Cancel</button><button className="primary">Save</button></div>
    </form>
  );
}

/** Questions to ask at the next visit. */
function PrepModal({ appt, url, onClose, onSaved }: { appt: Appointment; url: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useApp();
  const [qs, setQs] = useState<Question[]>(appt.questions);
  const [text, setText] = useState('');
  const add = () => { if (text.trim()) { setQs([...qs, { text: text.trim(), done: false }]); setText(''); } };
  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        const all = text.trim() ? [...qs, { text: text.trim(), done: false }] : qs;
        try { await api(url, { method: 'PATCH', body: { questions: all } }); toast('Questions saved'); onClose(); await onSaved(); } catch (err) { toast((err as Error).message); }
      }}>
        <h2 style={{ margin: 0 }}>❓ Questions for {appt.title}</h2>
        <p className="small muted" style={{ margin: 0 }}>Jot them down as they come up. At the visit, tick them off as you ask; they also print on the visit summary.</p>
        {qs.map((q, i) => (
          <div key={i} className="row">
            <input type="checkbox" checked={q.done} onChange={(e) => setQs(qs.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} style={{ width: 22, minHeight: 22 }} aria-label="Asked" />
            <span style={{ flex: 1, textDecoration: q.done ? 'line-through' : undefined }}>{q.text}</span>
            <button type="button" className="ghost" aria-label="Remove" onClick={() => setQs(qs.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <div className="row">
          <input placeholder="e.g. Is 3-word sentences on track for 4?" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} style={{ flex: 1, minWidth: 200 }} />
          <button type="button" onClick={add} disabled={!text.trim()}>Add</button>
        </div>
        <div className="row"><span className="spacer" /><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary">Save</button></div>
      </form>
    </Modal>
  );
}

/** After a visit: what the provider said, which questions got answered, and quick goal updates. */
function FollowUpModal({ appt, url, goals, notesUrl, onClose, onSaved }: {
  appt: Appointment; url: string; goals: TGoal[]; notesUrl: string; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { toast } = useApp();
  const [summary, setSummary] = useState(appt.summary ?? '');
  const [qs, setQs] = useState<Question[]>(appt.questions);
  const active = goals.filter((g) => g.status === 'active');
  const [prog, setProg] = useState<Record<string, number>>(Object.fromEntries(active.map((g) => [g.id, g.progress])));
  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(url, { method: 'PATCH', body: { status: 'done', summary, questions: qs } });
          for (const g of active) {
            if (prog[g.id] !== g.progress) {
              await api(notesUrl, { body: { goalId: g.id, appointmentId: appt.id, progress: prog[g.id], body: `Updated after ${appt.title}`, noReward: true } });
            }
          }
          toast('Visit saved');
          onClose();
          await onSaved();
        } catch (err) { toast((err as Error).message); }
      }}>
        <h2 style={{ margin: 0 }}>✓ How did {appt.title} go?</h2>
        <textarea placeholder="What did they say? e.g. Great progress on S sounds; start on L next. Come back in 6 weeks." value={summary} onChange={(e) => setSummary(e.target.value)} style={{ minHeight: 100 }} autoFocus />
        {qs.length > 0 && (
          <>
            <strong className="small">Questions you planned to ask</strong>
            {qs.map((q, i) => (
              <label key={i} className="row small">
                <input type="checkbox" checked={q.done} onChange={(e) => setQs(qs.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} style={{ width: 22, minHeight: 22 }} />
                {q.text}
              </label>
            ))}
          </>
        )}
        {active.length > 0 && (
          <>
            <strong className="small">Update goals (optional)</strong>
            {active.map((g) => (
              <div key={g.id} className="row small">
                <span style={{ flex: 1, minWidth: 140 }}>{AREA_ICONS[g.area] ?? '📌'} {g.title}</span>
                <input type="range" min={0} max={100} step={5} value={prog[g.id]} onChange={(e) => setProg({ ...prog, [g.id]: Number(e.target.value) })} style={{ width: 140, minHeight: 0 }} aria-label={`${g.title} progress`} />
                <strong style={{ width: 44, textAlign: 'right' }}>{prog[g.id]}%</strong>
              </div>
            ))}
          </>
        )}
        <p className="small muted" style={{ margin: 0 }}>Need a follow-up visit? Add it with ＋ Appointment, or set a reminder to call and book it.</p>
        <div className="row"><span className="spacer" /><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary">Save</button></div>
      </form>
    </Modal>
  );
}

/** Practices kids finished on the tablet, waiting for a parent. Also on the parents' home. */
export function PracticeWaitingCard({ kidId, onChange }: { kidId?: string; onChange?: () => Promise<void> }) {
  const { base, toast, home } = useApp();
  const [list, reload] = useLoad<PracticeWaiting[]>(`${base}/therapy/practice-requests`, [base]);
  const shown = (list ?? []).filter((p) => !kidId || p.memberId === kidId);
  if (!shown.length) return null;
  const act = async (id: string, action: 'approve' | 'reject') => {
    try {
      const r = await api<{ awarded: number }>(`${base}/therapy/practice-requests/${id}/${action}`, { method: 'POST' });
      toast(action === 'reject' ? 'Not this time' : r.awarded ? `Nice! +${r.awarded} ${home?.pointsIcon ?? ''}` : 'Practice counted');
      await reload();
      await onChange?.();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <section className="card stack review-card has-items">
      <h2 style={{ margin: 0 }}>▶️ Practice to check ({shown.length})</h2>
      {shown.map((p) => (
        <div key={p.id} className="list-item">
          <RaccoonAvatar variant={p.kidAvatar} size={32} />
          <div style={{ flex: 1 }}>
            <strong>{p.kidName}</strong> practiced <strong>{AREA_ICONS[p.area] ?? ''} {p.goalTitle}</strong>
            <div className="small muted">{shortDate(p.date)}{p.minutes ? ` · ${p.minutes} min on the timer` : ''}{p.points ? ` · +${p.points} ${home?.pointsIcon ?? ''}` : ''}</div>
          </div>
          <button className="primary" onClick={() => void act(p.id, 'approve')}>✓ Yes</button>
          <button className="ghost" onClick={() => void act(p.id, 'reject')}>Not yet</button>
        </div>
      ))}
    </section>
  );
}

export const DOCTOR_TABS = [
  { id: 'therapy', icon: '🌈', label: 'Goals & visits' },
  { id: 'meds', icon: '💊', label: 'Medicines' },
  { id: 'health', icon: '🪪', label: 'Health card' },
  { id: 'log', icon: '📓', label: 'Log' },
  { id: 'share', icon: '🔗', label: 'Summary & sharing' },
] as const;
type DoctorTab = (typeof DOCTOR_TABS)[number]['id'];

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
  const [params, setParams] = useSearchParams();
  const tab: DoctorTab = DOCTOR_TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') as DoctorTab : 'therapy';
  const hBase = kid && (tab === 'meds' || tab === 'health') ? `${base}/kids/${kid.id}/health` : null;
  const [health, reloadHealth] = useLoad<HealthData>(hBase, [hBase]);
  const [prep, setPrep] = useState<Appointment | null>(null);
  const [followUp, setFollowUp] = useState<Appointment | null>(null);
  const [editAppt, setEditAppt] = useState<Appointment | null>(null);
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

      {kid && (
        <div className="chips doctor-tabs" role="tablist">
          {DOCTOR_TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`chip${tab === t.id ? ' on' : ''}`}
              onClick={() => setParams(t.id === 'therapy' ? {} : { tab: t.id }, { replace: true })}>{t.icon} {t.label}</button>
          ))}
        </div>
      )}

      {kid && tab === 'meds' && health && <MedsTab kid={kid} data={health.meds} today={health.today} reload={reloadHealth} />}
      {kid && tab === 'health' && health && <HealthTab kid={kid} data={health} reload={reloadHealth} color={color} />}
      {kid && tab === 'log' && <LogTab key={kid.id} kid={kid} today={health?.today ?? now.slice(0, 10)} dark={dark} />}
      {kid && tab === 'share' && data && <ShareTab key={kid.id} kid={kid} goals={data.goals} />}

      {kid && data && tab === 'therapy' && (
        <>
          <PracticeWaitingCard kidId={kid.id} onChange={reload} />
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
                  <div className="small muted">{whenText(a.startsAt)}{a.durationMinutes ? ` · ${a.durationMinutes} min` : ''}{a.location && ` · ${a.location}`}{a.repeat && ` · 🔁 ${repeatLabel(a.repeat)}`}</div>
                  {a.notes && <div className="small">{a.notes}</div>}
                  {a.questions.length > 0 && <div className="small">❓ {a.questions.filter((q) => !q.done).length} question{a.questions.filter((q) => !q.done).length === 1 ? '' : 's'} to ask: {a.questions.filter((q) => !q.done).map((q) => q.text).join(' · ')}</div>}
                </div>
                <button className="icon edit-btn" aria-label="Edit appointment" onClick={() => setEditAppt(a)}>✏️</button>
                <button className="ghost" onClick={() => setPrep(a)}>❓ Questions</button>
                <button className="ghost" onClick={() => setFollowUp(a)}>✓ Done</button>
                <button className="ghost danger" onClick={() => void run(() => api(apptUrl(a.id), { method: 'PATCH', body: { status: 'cancelled' } }), 'Cancelled')}>Cancel</button>
              </div>
            ))}
            {!upcoming.length && <p className="muted" style={{ margin: 0 }}>Nothing coming up.</p>}
            {past.length > 0 && <button className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowPast(!showPast)}>{showPast ? '▾' : '▸'} Past and cancelled ({past.length})</button>}
            {showPast && past.map((a) => (
              <div key={a.id} className="list-item small">
                <span>{KIND_ICONS[a.kind] ?? '📌'}</span>
                <span style={{ flex: 1 }}>{a.title} · {whenText(a.startsAt)}{a.summary && <span className="muted"> · “{a.summary}”</span>}</span>
                {a.status === 'done' && !a.summary && <button className="ghost" onClick={() => setFollowUp(a)}>Add what they said</button>}
                <span className={`pill${a.status === 'done' ? ' ok' : a.status === 'scheduled' ? ' warn' : ''}`}>{a.status === 'scheduled' ? 'not marked' : a.status}</span>
                {a.status === 'scheduled' && <button className="ghost" onClick={() => setFollowUp(a)}>Done</button>}
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

      {prep && <PrepModal appt={prep} url={apptUrl(prep.id)} onClose={() => setPrep(null)} onSaved={reload} />}
      {followUp && tBase && data && <FollowUpModal appt={followUp} url={apptUrl(followUp.id)} goals={data.goals} notesUrl={`${tBase}/notes`} onClose={() => setFollowUp(null)} onSaved={reload} />}
      {editAppt && (
        <AppointmentForm areasOff={areasOff} initialRepeat={editAppt.repeat} onClose={() => setEditAppt(null)}
          initial={{ kind: editAppt.kind, title: editAppt.title, provider: editAppt.provider ?? '', location: editAppt.location ?? '', startsAt: editAppt.startsAt,
            durationMinutes: editAppt.durationMinutes ?? 45, notes: editAppt.notes ?? '', status: editAppt.status }}
          onSave={(a) => run(async () => { await api(apptUrl(editAppt.id), { method: 'PATCH', body: a }); setEditAppt(null); }, 'Appointment saved')}
          onDelete={(scope) => run(async () => { await api(`${apptUrl(editAppt.id)}?scope=${scope}`, { method: 'DELETE' }); setEditAppt(null); }, 'Deleted')} />
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
