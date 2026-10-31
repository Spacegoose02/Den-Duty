import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AgendaItem, type AppointmentItem, type Day, type DutyItem, type Kid, type PracticeItem } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { dayName, shortDate, STATUS_LABEL } from '../components/Bits.tsx';
import { FEED_ICONS } from './Calendars.tsx';
import { AREA_ICONS, AppointmentForm, KIND_ICONS, NO_PRACTICE, PracticeFields, practiceReady, timeText, type PracticeForm } from './Doctors.tsx';
import { Modal } from '../components/Bits.tsx';
import { ReminderForm } from '../components/Reminders.tsx';
import type { Reminder } from '../api.ts';
import { addDays, startOfWeek } from '../../../shared/schedule.ts';

const mark = (i: AgendaItem) => (i.status === 'approved' ? '✅' : i.status === 'submitted' ? '⏳' : i.status === 'rejected' ? '🔁' : '');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * One kid's chores on one day as a single line ("Ava has 5 chores · 2 done"); tap it to see and tick off each chore.
 * `onTap` makes the chores tappable (parents).
 */
export function ChoreGroup({ name, avatar, color, items, past, label, onTap }: {
  name: string; avatar?: string; color?: string; items: AgendaItem[]; past: boolean; label?: string; onTap?: (i: AgendaItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const done = items.filter((i) => i.status === 'approved').length;
  const all = done === items.length;
  return (
    <div className="chore-group" style={{ borderLeft: `4px solid ${color ?? 'var(--border)'}` }}>
      <button className="chore-group-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <RaccoonAvatar variant={avatar} size={24} />
        <span className="agenda-title">{label ?? `${name} has ${plural(items.length, 'chore')}`}</span>
        {past || done ? <span className={`small ${all ? '' : 'muted'}`}>{all ? '✅' : `${done} done`}</span> : null}
        <span className="small muted" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && items.map((i, n) => {
        const inner = (
          <>
            <span aria-hidden>{i.icon}</span>
            <span className="agenda-title">{i.title}</span>
            <span className="agenda-mark" aria-label={STATUS_LABEL[i.status]}>{mark(i)}</span>
          </>
        );
        const key = i.id ?? `${i.choreId}-${n}`;
        return onTap
          ? <button key={key} className={`agenda-item ${i.status}`} disabled={!i.id} onClick={() => onTap(i)} title={STATUS_LABEL[i.status]}>{inner}</button>
          : <div key={key} className={`agenda-item ${i.status}`} title={STATUS_LABEL[i.status]}>{inner}</div>;
      })}
    </div>
  );
}

/** One kid's scheduled Doctors practices on a day, as one line; parents tick each one off (today or earlier). */
function PracticeGroup({ kid, practices, label, canTick, onTick, onEdit }: {
  kid?: Kid; practices: PracticeItem[]; label: string; canTick: boolean; onTick?: (p: PracticeItem) => void; onEdit?: (p: PracticeItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const done = practices.filter((p) => p.done).length;
  const live = practices.filter((p) => !p.skipped).length;
  return (
    <div className="chore-group practice" style={{ borderLeft: `4px solid ${kid?.color ?? 'var(--border)'}` }}>
      <button className="chore-group-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span aria-hidden>🌈</span>
        <span className="agenda-title">{label}</span>
        {done > 0 && <span className="small">{done === live ? '✅' : `${done} done`}</span>}
        <span className="small muted" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && practices.map((p) => {
        const inner = (
          <>
            <span aria-hidden>{AREA_ICONS[p.area] ?? '🌱'}</span>
            <span className="agenda-title">{p.time && <strong>{timeText(p.time)} </strong>}{p.title}{p.moved && <span className="small muted"> (moved)</span>}{p.skipped && <span className="small muted"> (skipped)</span>}</span>
            <span className="agenda-mark">{p.done ? '✅' : p.skipped ? '⏭️' : p.points ? <span className="small muted">+{p.points}</span> : ''}</span>
          </>
        );
        const row = onTick
          ? <button className={`agenda-item ${p.done ? 'approved' : ''}${p.skipped ? ' skipped' : ''}`} disabled={!canTick || p.skipped} onClick={() => onTick(p)}
            title={canTick ? (p.done ? 'Tap to untick' : 'Tap when practiced') : 'Coming up'} style={{ flex: 1 }}>{inner}</button>
          : <div className={`agenda-item ${p.done ? 'approved' : ''}`} style={{ flex: 1 }}>{inner}</div>;
        return (
          <div key={p.goalId} className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
            {row}
            {onEdit && <button className="icon edit-btn" onClick={() => onEdit(p)} aria-label={`Change this practice: ${p.title}`} title="Move, skip or change the days">✏️</button>}
          </div>
        );
      })}
    </div>
  );
}

function AppointmentLine({ a, kid, withName, onEdit }: { a: AppointmentItem; kid?: Kid; withName: boolean; onEdit?: (a: AppointmentItem) => void }) {
  const inner = (
    <>
      <span aria-hidden>{KIND_ICONS[a.kind] ?? '📌'}</span>
      <span style={{ flex: 1 }}><strong>{timeText(a.time)} </strong>{withName && kid ? `${kid.name}: ` : ''}{a.title}{a.status === 'done' && ' ✓'}{a.status === 'missed' && ' (missed)'}</span>
      {onEdit && <span aria-hidden className="small">✏️</span>}
    </>
  );
  const cls = `agenda-ext appt${a.status === 'done' ? ' done' : ''}`;
  return onEdit
    ? <button className={`${cls} as-button`} style={{ borderLeftColor: kid?.color }} onClick={() => onEdit(a)} title="Edit appointment">{inner}</button>
    : <div className={cls} style={{ borderLeftColor: kid?.color }} title={a.provider ?? undefined}>{inner}</div>;
}

/** Everything on one day, grouped per kid: chores, practices, appointments; then Parent Duty and subscribed feeds. */
interface Edits { appt: (a: AppointmentItem) => void; practice: (p: PracticeItem) => void; duty: (d: DutyItem) => void; reminder: (r: Reminder) => void }

function DayDetail({ d, kids, today, parent, solo, onTap, onTick, edit }: {
  d: Day; kids: Kid[]; today: string; parent: boolean; solo: boolean; onTap?: (i: AgendaItem) => void; onTick?: (p: PracticeItem) => void; edit?: Edits;
}) {
  const past = d.date <= today;
  const empty = !d.items.length && !d.external?.length && !d.duty?.length && !d.reminders?.length && !d.practices?.length && !d.appointments?.length;
  return (
    <>
      {kids.map((k) => {
        const items = d.items.filter((i) => i.memberId === k.id);
        const practices = d.practices?.filter((p) => p.memberId === k.id) ?? [];
        const appts = d.appointments?.filter((a) => a.memberId === k.id) ?? [];
        const who = solo ? (parent ? `${k.name} has` : 'You have') : `${k.name} has`;
        return (
          <div key={k.id} className="stack" style={{ gap: 4 }}>
            {items.length > 0 && <ChoreGroup name={k.name} avatar={k.avatar} color={k.color} items={items} past={past} label={`${who} ${plural(items.length, 'chore')}`} onTap={onTap} />}
            {practices.length > 0 && <PracticeGroup kid={k} practices={practices} label={`${solo && !parent ? 'You have' : `${k.name}:`} ${practices.some((p) => !p.skipped) ? plural(practices.filter((p) => !p.skipped).length, 'practice') : 'practice skipped'}`} canTick={past} onTick={onTick} onEdit={edit?.practice} />}
            {appts.map((a) => <AppointmentLine key={a.id} a={a} kid={k} withName={!solo} onEdit={edit?.appt} />)}
          </div>
        );
      })}
      {d.reminders?.map((r) => (
        <button key={r.id} className="agenda-ext duty reminder-line as-button" title="Edit reminder" onClick={() => edit?.reminder(r)} disabled={!edit}>
          <span aria-hidden>🔔</span>
          <span style={{ flex: 1 }}>{r.dueTime && <strong>{timeText(r.dueTime)} </strong>}{r.kidName ? `${r.kidName}: ` : ''}{r.title}</span>
          {edit && <span aria-hidden className="small">✏️</span>}
        </button>
      ))}
      {d.duty?.map((x) => (
        <button key={x.id} className="agenda-ext duty as-button" title="Change the due date" onClick={() => edit?.duty(x)} disabled={!edit}>
          <span aria-hidden>📝</span>
          <span style={{ flex: 1 }}>{x.kidName ? `For ${x.kidName}: ` : ''}{x.title}</span>
          {edit && <span aria-hidden className="small">✏️</span>}
        </button>
      ))}
      {d.external?.map((x, n) => (
        <div key={`x-${n}`} className="agenda-ext" title={x.feed}>
          <span aria-hidden>{FEED_ICONS[x.kind] ?? '📅'}</span>
          <span>{x.time && <strong>{x.time} </strong>}{x.title}</span>
        </div>
      ))}
      {empty && <span className="small muted">Nothing planned</span>}
    </>
  );
}

type View = 'month' | 'week';
const VIEW_KEY = 'dd.calendarView';
function savedView(): View {
  try { return localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'month'; } catch { return 'month'; }
}
const localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`;
function addMonths(first: string, n: number): string {
  const d = new Date(`${first}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The calendar: Month (the default) or Week, remembered per device. One summary line per kid per day; tap a month day
 * to open it below. With `kidId` it shows one kid (their board); parents can tick chores and practices off.
 */
export function Calendar({ kidId, title = 'Calendar' }: { kidId?: string; title?: string }) {
  const { base, home, toast, who } = useApp();
  const parent = !!who?.user;
  const weekStart = home?.weekStart ?? 0;
  const [view, setViewState] = useState<View>(savedView);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const today = localToday();
  const setView = (v: View) => {
    setViewState(v);
    setAnchor(null);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode: just this visit */ }
  };
  const month = view === 'month' ? (anchor ?? monthOf(today)) : null;
  const start = month ? startOfWeek(month, weekStart) : (anchor ?? startOfWeek(today, weekStart));
  const days = month ? (addDays(start, 35) >= addMonths(month, 1) ? 35 : 42) : 7;
  const kidQ = kidId ? `&kid=${kidId}` : '';
  const [data, reload] = useLoad<{ today: string; start: string; days: Day[] }>(`${base}/agenda?start=${start}&days=${days}${kidQ}`, [start, days, kidId]);
  const kids = (home?.kids ?? []).filter((k) => !kidId || k.id === kidId);
  const realToday = data?.today ?? today;

  async function tap(i: AgendaItem) {
    if (!i.id) return;
    try {
      const r = await api<{ paid?: number; taken?: number }>(`${base}/instances/${i.id}/${i.status === 'approved' ? 'undo' : 'done'}`, { body: {} });
      if (r.paid != null && r.taken != null && r.taken < r.paid) toast(`Took back ${r.taken} ${home?.pointsIcon ?? ''} (the rest was already spent)`);
      await reload();
    } catch (e) { toast((e as Error).message); }
  }
  const tick = (date: string) => async (p: PracticeItem) => {
    try {
      if (p.done) await api(`${base}/therapy/goals/${p.goalId}/practice?date=${date}`, { method: 'DELETE' });
      else {
        const r = await api<{ awarded: number }>(`${base}/therapy/goals/${p.goalId}/practice`, { body: { date } });
        toast(r.awarded ? `Practice logged: +${r.awarded} ${home?.pointsIcon ?? ''}` : 'Practice logged');
      }
      await reload();
    } catch (e) { toast((e as Error).message); }
  };
  const step = (n: number) => setAnchor(month ? addMonths(month, n) : addDays(start, 7 * n));
  const label = month ? MONTH_FMT.format(new Date(`${month}T00:00:00Z`)) : `${shortDate(start)} – ${shortDate(addDays(start, 6))}`;
  const pickedDay = data?.days.find((d) => d.date === picked);
  const [editing, setEditing] = useState<{ appt?: AppointmentItem; practice?: PracticeItem; duty?: DutyItem; reminder?: Reminder } | null>(null);
  // Parents edit straight from the calendar; kids only look.
  const edits: Edits | undefined = parent ? { appt: (a) => setEditing({ appt: a }), practice: (p) => setEditing({ practice: p }), duty: (d) => setEditing({ duty: d }), reminder: (r) => setEditing({ reminder: r }) } : undefined;
  const done = async () => { setEditing(null); await reload(); };

  return (
    <div className="stack calendar">
      <div className="row cal-head">
        <h2 style={{ margin: 0, flex: 1, minWidth: 160 }}>{title} <span className="small muted" style={{ fontWeight: 600 }}>{label}</span></h2>
        <div className="seg" role="group" aria-label="Calendar view">
          <button className={view === 'month' ? 'on' : ''} aria-pressed={view === 'month'} onClick={() => setView('month')}>Month</button>
          <button className={view === 'week' ? 'on' : ''} aria-pressed={view === 'week'} onClick={() => setView('week')}>Week</button>
        </div>
        <button className="icon" aria-label={`Previous ${view}`} onClick={() => step(-1)}>◀</button>
        {anchor && <button onClick={() => setAnchor(null)}>Today</button>}
        <button className="icon" aria-label={`Next ${view}`} onClick={() => step(1)}>▶</button>
      </div>

      {view === 'week' && (
        <div className="agenda">
          {data?.days.map((d) => (
            <div key={d.date} className={`agenda-day${d.date === realToday ? ' today' : ''}${d.date < realToday ? ' past' : ''}`}>
              <div className="agenda-date"><strong>{dayName(d.date)}</strong> <span className="small muted">{shortDate(d.date)}</span></div>
              <DayDetail d={d} kids={kids} today={realToday} parent={parent} solo={!!kidId} onTap={parent ? (i) => void tap(i) : undefined} onTick={parent ? tick(d.date) : undefined} edit={edits} />
            </div>
          ))}
        </div>
      )}

      {month && data && (
        <>
          <div className="month-grid" role="grid">
            {data.days.slice(0, 7).map((d) => <div key={`h-${d.date}`} className="month-dow small muted">{dayName(d.date)}</div>)}
            {data.days.map((d) => {
              const inMonth = d.date.slice(0, 7) === month.slice(0, 7);
              return (
                <button key={d.date} role="gridcell" aria-selected={picked === d.date} onClick={() => setPicked(picked === d.date ? null : d.date)}
                  className={`month-day${inMonth ? '' : ' other'}${d.date === realToday ? ' today' : ''}${picked === d.date ? ' picked' : ''}${d.date < realToday ? ' past' : ''}`}>
                  <span className="month-num">{Number(d.date.slice(8))}</span>
                  {kids.map((k) => {
                    const items = d.items.filter((i) => i.memberId === k.id);
                    const prs = d.practices?.filter((p) => p.memberId === k.id && !p.skipped) ?? [];
                    const pr = prs.length;
                    const prDone = prs.filter((p) => p.done).length;
                    if (!items.length && !pr) return null;
                    const done = items.filter((i) => i.status === 'approved').length;
                    return (
                      <span key={k.id} className="month-line" style={{ borderLeftColor: k.color }}>
                        {kidId ? '' : `${k.name} `}{items.length > 0 && `${items.length}🧹`}{done > 0 && ` ${done}✅`}{pr > 0 && ` ${prDone ? `${prDone}/` : ''}${pr}🌈`}
                      </span>
                    );
                  })}
                  {d.appointments?.map((a) => <span key={a.id} className="month-line appt">{KIND_ICONS[a.kind] ?? '📌'} {timeText(a.time)}</span>)}
                  {!!d.duty?.length && <span className="month-line">📝 {d.duty.length}</span>}
                  {!!d.reminders?.length && <span className="month-line">🔔 {d.reminders.length}</span>}
                  {!!d.external?.length && <span className="month-line muted">📅 {d.external.length}</span>}
                </button>
              );
            })}
          </div>
          <p className="small muted" style={{ margin: 0 }}>🧹 chores · ✅ done · 🌈 practices. Tap a day to open it.</p>
          {pickedDay && (
            <div className={`agenda-day picked-day${pickedDay.date === realToday ? ' today' : ''}`}>
              <div className="agenda-date row">
                <strong style={{ flex: 1 }}>{dayName(pickedDay.date)} {shortDate(pickedDay.date)}</strong>
                <button className="ghost" onClick={() => setPicked(null)} aria-label="Close day">✕</button>
              </div>
              <DayDetail d={pickedDay} kids={kids} today={realToday} parent={parent} solo={!!kidId} onTap={parent ? (i) => void tap(i) : undefined} onTick={parent ? tick(pickedDay.date) : undefined} edit={edits} />
            </div>
          )}
        </>
      )}

      {editing?.appt && (
        <AppointmentForm
          areasOff={(home?.kids.find((k) => k.id === editing.appt!.memberId)?.doctorAreasOff ?? []).filter((x) => x !== 'appointments')}
          initial={{
            kind: editing.appt.kind, title: editing.appt.title, provider: editing.appt.provider ?? '', location: editing.appt.location ?? '',
            startsAt: `${data?.days.find((d) => d.appointments?.some((a) => a.id === editing.appt!.id))?.date}T${editing.appt.time}`,
            durationMinutes: editing.appt.durationMinutes ?? 45, notes: editing.appt.notes ?? '', status: editing.appt.status,
          }}
          onClose={() => setEditing(null)}
          onSave={async (a) => {
            try { await api(`${base}/therapy/appointments/${editing.appt!.id}`, { method: 'PATCH', body: a }); toast('Appointment saved'); await done(); } catch (e) { toast((e as Error).message); }
          }}
          onDelete={async () => {
            try { await api(`${base}/therapy/appointments/${editing.appt!.id}`, { method: 'DELETE' }); toast('Appointment deleted'); await done(); } catch (e) { toast((e as Error).message); }
          }}
        />
      )}
      {editing?.practice && <PracticeEdit p={editing.practice} onClose={() => setEditing(null)} onDone={() => void done()} />}
      {editing?.reminder && <ReminderForm initial={editing.reminder} onClose={() => setEditing(null)} onDone={() => void done()} />}
      {editing?.duty && <DutyDueEdit item={editing.duty} onClose={() => setEditing(null)} onDone={() => void done()} />}
    </div>
  );
}

/**
 * Change a practice from the calendar: just this day (skip it, or move it to another day/time) or all upcoming (the
 * goal's schedule). A day that was already moved or skipped can be put back.
 */
function PracticeEdit({ p, onClose, onDone }: { p: PracticeItem; onClose: () => void; onDone: () => void }) {
  const { base, toast } = useApp();
  const [scope, setScope] = useState<'day' | 'all' | null>(null);
  const [move, setMove] = useState({ date: p.occurrence, time: p.time ?? '' });
  const ex = `${base}/therapy/goals/${p.goalId}/practice-exception`;
  const run = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); onDone(); } catch (e) { toast((e as Error).message); } };
  if (scope !== 'all') {
    return (
      <Modal onClose={onClose}>
        <div className="stack">
          <h2 style={{ margin: 0 }}>🌈 {p.title}</h2>
          <p className="small muted" style={{ margin: 0 }}>Scheduled for {dayName(p.occurrence)} {shortDate(p.occurrence)}{p.time ? ` at ${timeText(p.time)}` : ''}{p.moved ? ' (moved)' : ''}{p.skipped ? ' (skipped)' : ''}.</p>
          {(p.moved || p.skipped) && (
            <button className="primary" onClick={() => void run(() => api(`${ex}?date=${p.occurrence}`, { method: 'DELETE' }), 'Back on its usual day')}>↩️ Put it back on its usual day</button>
          )}
          {scope === null && (
            <div className="grid-2">
              <button className="help-pick" onClick={() => setScope('day')}><span className="help-pick-icon">📍</span>Just this day<span className="small muted">Skip it or move it</span></button>
              <button className="help-pick" onClick={() => setScope('all')}><span className="help-pick-icon">🔁</span>All upcoming<span className="small muted">Change the practice days</span></button>
            </div>
          )}
          {scope === 'day' && (
            <>
              {!p.skipped && <button onClick={() => void run(() => api(ex, { body: { date: p.occurrence, action: 'skip' } }), 'Skipped. It won\'t break the streak.')}>⏭️ Skip this day</button>}
              <div className="row">
                <span>Move to</span>
                <input type="date" value={move.date} onChange={(e) => setMove({ ...move, date: e.target.value })} style={{ maxWidth: 180 }} />
                <input type="time" value={move.time} onChange={(e) => setMove({ ...move, time: e.target.value })} style={{ maxWidth: 140 }} />
                <button className="primary" disabled={!move.date} onClick={() => void run(() => api(ex, { body: { date: p.occurrence, action: 'move', newDate: move.date, newTime: move.time || null } }), 'Moved')}>Move</button>
              </div>
            </>
          )}
          <div className="row"><span className="spacer" /><button className="ghost" onClick={onClose}>Close</button></div>
        </div>
      </Modal>
    );
  }
  return <PracticeScheduleEdit goalId={p.goalId} title={p.title} onClose={onClose} onDone={onDone} />;
}

/** Change a goal's practice days (or its one practice date). */
function PracticeScheduleEdit({ goalId, title, onClose, onDone }: { goalId: string; title: string; onClose: () => void; onDone: () => void }) {
  const { base, toast } = useApp();
  const [goal] = useLoad<{ practice: { schedule: 'weekly' | 'once'; weekdays: number[]; date: string | null; time: string | null } | null }>(`${base}/therapy/goals/${goalId}`, [goalId]);
  const [f, setF] = useState<PracticeForm | null>(null);
  const p = goal?.practice;
  const form = f ?? (goal ? (p ? { practiceSchedule: p.schedule, practiceWeekdays: p.weekdays, practiceDate: p.date ?? '', practiceTime: p.time ?? '' } : NO_PRACTICE) : null);
  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        try { await api(`${base}/therapy/goals/${goalId}`, { method: 'PATCH', body: form }); toast('Practice days saved'); onDone(); } catch (err) { toast((err as Error).message); }
      }}>
        <h2 style={{ margin: 0 }}>📅 Practice: {title}</h2>
        {form ? <PracticeFields value={form} onChange={setF} /> : <p className="muted">Loading…</p>}
        <p className="small muted" style={{ margin: 0 }}>Moves every upcoming practice for this goal. Practices already ticked off stay logged.</p>
        <div className="row"><span className="spacer" /><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={!form || !practiceReady(form)}>Save</button></div>
      </form>
    </Modal>
  );
}

/** Change (or clear) a Parent Duty card's due date from the calendar. */
function DutyDueEdit({ item, onClose, onDone }: { item: DutyItem; onClose: () => void; onDone: () => void }) {
  const { base, toast } = useApp();
  const [due, setDue] = useState(item.dueDate ?? '');
  const save = async (dueDate: string | null) => {
    try { await api(`${base}/parent-duty/${item.id}`, { method: 'PATCH', body: { dueDate } }); toast(dueDate ? 'Due date moved' : 'Due date cleared'); onDone(); } catch (e) { toast((e as Error).message); }
  };
  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(due || null); }}>
        <h2 style={{ margin: 0 }}>📝 {item.kidName ? `For ${item.kidName}: ` : ''}{item.title}</h2>
        <label className="field">Due
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ maxWidth: 220 }} autoFocus />
        </label>
        <div className="row">
          <Link to="/parent-duty" className="btn ghost">Open Parent Duty</Link>
          <button type="button" className="ghost" onClick={() => void save(null)}>No due date</button>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!due}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

/** The parents' calendar page: everyone, Month or Week. */
export function Week() {
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Calendar</h1>
      <p className="small muted" style={{ margin: 0 }}>Tap a kid's line to see their chores or practices, then tap one from today or earlier to tick it off (or undo it).</p>
      <Calendar title="Everyone" />
    </div>
  );
}
