import { useState } from 'react';
import { api, type AgendaItem, type Day } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { dayName, shortDate, STATUS_LABEL } from '../components/Bits.tsx';
import { FEED_ICONS } from './Calendars.tsx';
import { addDays } from '../../../shared/schedule.ts';

/** Everyone's chores for the week. Parents can tick things off (or undo) right here. */
export function Week() {
  const { base, home, toast } = useApp();
  const [start, setStart] = useState<string | null>(null);
  const [data, reload] = useLoad<{ today: string; start: string; days: Day[] }>(`${base}/agenda${start ? `?start=${start}` : ''}`);
  const kids = new Map(home?.kids.map((k) => [k.id, k]));

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
      <p className="small muted" style={{ margin: 0 }}>Tap a chore from today or earlier to mark it done (or undo it). Future days show what's planned.</p>
      <div className="agenda">
        {data?.days.map((d) => (
          <div key={d.date} className={`agenda-day card${d.date === data.today ? ' today' : ''}${d.date < data.today ? ' past' : ''}`}>
            <div className="agenda-date"><strong>{dayName(d.date)}</strong> <span className="small muted">{shortDate(d.date)}</span></div>
            {d.items.map((i, n) => {
              const kid = kids.get(i.memberId);
              return (
                <button key={i.id ?? `${i.choreId}-${i.memberId}-${n}`} className={`agenda-item week-item ${i.status}`} disabled={!i.id}
                  onClick={() => void tap(i)} title={`${kid?.name}: ${STATUS_LABEL[i.status]}`} style={{ borderLeft: `4px solid ${kid?.color ?? 'transparent'}` }}>
                  <RaccoonAvatar variant={kid?.avatar} size={24} />
                  <span aria-hidden>{i.icon}</span>
                  <span className="agenda-title">{i.title}</span>
                  <span className="agenda-mark">{i.status === 'approved' ? '✅' : i.status === 'submitted' ? '⏳' : i.status === 'rejected' ? '🔁' : ''}</span>
                </button>
              );
            })}
            {d.external?.map((x, n) => (
              <div key={`x-${n}`} className="agenda-ext" title={x.feed}>
                <span aria-hidden>{FEED_ICONS[x.kind] ?? '📅'}</span>
                <span>{x.time && <strong>{x.time} </strong>}{x.title}</span>
              </div>
            ))}
            {!d.items.length && !d.external?.length && <span className="small muted">Nothing planned</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
