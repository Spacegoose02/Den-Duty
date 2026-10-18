import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AgendaItem, type Day } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { dayName, shortDate, STATUS_LABEL } from '../components/Bits.tsx';
import { FEED_ICONS } from './Calendars.tsx';
import { addDays } from '../../../shared/schedule.ts';

const mark = (i: AgendaItem) => (i.status === 'approved' ? '✅' : i.status === 'submitted' ? '⏳' : i.status === 'rejected' ? '🔁' : '');

/**
 * One kid's chores on one day as a single line ("Ava has 5 chores · 2 done"); tap it to see and tick off each chore.
 * `onTap` makes the chores tappable (parents on the Week page).
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
        <span className="agenda-title">{label ?? `${name} has ${items.length} chore${items.length === 1 ? '' : 's'}`}</span>
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

/** Everyone's week, one line per kid per day. Parents can tick things off (or undo) here; Parent Duty due dates show too. */
export function Week() {
  const { base, home, toast } = useApp();
  const [start, setStart] = useState<string | null>(null);
  const [data, reload] = useLoad<{ today: string; start: string; days: Day[] }>(`${base}/agenda${start ? `?start=${start}` : ''}`);
  const kids = home?.kids ?? [];

  async function tap(i: AgendaItem) {
    if (!i.id) return;
    try {
      await api(`${base}/instances/${i.id}/${i.status === 'approved' ? 'undo' : 'done'}`, { body: {} });
      await reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="stack">
      <div className="topbar">
        <h1>Week</h1>
        <button className="icon" aria-label="Previous week" onClick={() => data && setStart(addDays(data.start, -7))}>◀</button>
        <button onClick={() => setStart(null)}>This week</button>
        <button className="icon" aria-label="Next week" onClick={() => data && setStart(addDays(data.start, 7))}>▶</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Tap a kid's line to see their chores, then tap a chore from today or earlier to mark it done (or undo it).</p>
      <div className="agenda">
        {data?.days.map((d) => (
          <div key={d.date} className={`agenda-day card${d.date === data.today ? ' today' : ''}${d.date < data.today ? ' past' : ''}`}>
            <div className="agenda-date"><strong>{dayName(d.date)}</strong> <span className="small muted">{shortDate(d.date)}</span></div>
            {kids.map((k) => {
              const items = d.items.filter((i) => i.memberId === k.id);
              return items.length > 0 && (
                <ChoreGroup key={`${d.date}-${k.id}`} name={k.name} avatar={k.avatar} color={k.color} items={items} past={d.date <= data.today} onTap={(i) => void tap(i)} />
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
            {!d.items.length && !d.external?.length && !d.duty?.length && <span className="small muted">Nothing planned</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
