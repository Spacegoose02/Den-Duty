import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AgendaItem, type AppointmentItem, type Day, type Kid, type PracticeItem } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { dayName, shortDate, STATUS_LABEL } from '../components/Bits.tsx';
import { FEED_ICONS } from './Calendars.tsx';
import { AREA_ICONS, KIND_ICONS, timeText } from './Doctors.tsx';
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
function PracticeGroup({ kid, practices, label, canTick, onTick }: {
  kid?: Kid; practices: PracticeItem[]; label: string; canTick: boolean; onTick?: (p: PracticeItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const done = practices.filter((p) => p.done).length;
  return (
    <div className="chore-group practice" style={{ borderLeft: `4px solid ${kid?.color ?? 'var(--border)'}` }}>
      <button className="chore-group-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span aria-hidden>🌈</span>
        <span className="agenda-title">{label}</span>
        {done > 0 && <span className="small">{done === practices.length ? '✅' : `${done} done`}</span>}
        <span className="small muted" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && practices.map((p) => {
        const inner = (
          <>
            <span aria-hidden>{AREA_ICONS[p.area] ?? '🌱'}</span>
            <span className="agenda-title">{p.time && <strong>{timeText(p.time)} </strong>}{p.title}</span>
            <span className="agenda-mark">{p.done ? '✅' : p.points ? <span className="small muted">+{p.points}</span> : ''}</span>
          </>
        );
        return onTick
          ? <button key={p.goalId} className={`agenda-item ${p.done ? 'approved' : ''}`} disabled={!canTick} onClick={() => onTick(p)}
            title={canTick ? (p.done ? 'Tap to untick' : 'Tap when practiced') : 'Coming up'}>{inner}</button>
          : <div key={p.goalId} className={`agenda-item ${p.done ? 'approved' : ''}`}>{inner}</div>;
      })}
    </div>
  );
}

function AppointmentLine({ a, kid, withName }: { a: AppointmentItem; kid?: Kid; withName: boolean }) {
  return (
    <div className={`agenda-ext appt${a.status === 'done' ? ' done' : ''}`} style={{ borderLeftColor: kid?.color }} title={a.provider ?? undefined}>
      <span aria-hidden>{KIND_ICONS[a.kind] ?? '📌'}</span>
      <span><strong>{timeText(a.time)} </strong>{withName && kid ? `${kid.name}: ` : ''}{a.title}{a.status === 'done' && ' ✓'}</span>
    </div>
  );
}

/** Everything on one day, grouped per kid: chores, practices, appointments; then Parent Duty and subscribed feeds. */
function DayDetail({ d, kids, today, parent, solo, onTap, onTick }: {
  d: Day; kids: Kid[]; today: string; parent: boolean; solo: boolean; onTap?: (i: AgendaItem) => void; onTick?: (p: PracticeItem) => void;
}) {
  const past = d.date <= today;
  const empty = !d.items.length && !d.external?.length && !d.duty?.length && !d.practices?.length && !d.appointments?.length;
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
            {practices.length > 0 && <PracticeGroup kid={k} practices={practices} label={`${solo && !parent ? 'You have' : `${k.name}:`} ${plural(practices.length, 'practice')}`} canTick={past} onTick={onTick} />}
            {appts.map((a) => <AppointmentLine key={a.id} a={a} kid={k} withName={!solo} />)}
          </div>
        );
      })}
      {d.duty?.map((x) => (
        <Link key={x.id} to="/parent-duty" className="agenda-ext duty" title="Parent Duty">
          <span aria-hidden>📝</span>
          <span>{x.kidName ? `For ${x.kidName}: ` : ''}{x.title}</span>
        </Link>
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
    try { await api(`${base}/instances/${i.id}/${i.status === 'approved' ? 'undo' : 'done'}`, { body: {} }); await reload(); } catch (e) { toast((e as Error).message); }
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
              <DayDetail d={d} kids={kids} today={realToday} parent={parent} solo={!!kidId} onTap={parent ? (i) => void tap(i) : undefined} onTick={parent ? tick(d.date) : undefined} />
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
                    const prs = d.practices?.filter((p) => p.memberId === k.id) ?? [];
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
              <DayDetail d={pickedDay} kids={kids} today={realToday} parent={parent} solo={!!kidId} onTap={parent ? (i) => void tap(i) : undefined} onTick={parent ? tick(pickedDay.date) : undefined} />
            </div>
          )}
        </>
      )}
    </div>
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
