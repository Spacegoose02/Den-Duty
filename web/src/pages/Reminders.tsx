import { useState } from 'react';
import type { Reminder } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { ReminderForm, ReminderRow } from '../components/Reminders.tsx';

const GROUPS: { state: Reminder['state']; title: string }[] = [
  { state: 'overdue', title: '⚠️ Overdue' },
  { state: 'today', title: 'Today' },
  { state: 'upcoming', title: 'Coming up' },
  { state: 'someday', title: 'Someday' },
  { state: 'done', title: 'Done lately' },
];

/** Parents-only reminders: grouped by when they're due. Kids and the family wall never see these. */
export function Reminders() {
  const { base } = useApp();
  const [items, reload] = useLoad<Reminder[]>(`${base}/reminders`);
  const [adding, setAdding] = useState(false);
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="topbar">
        <h1>Reminders</h1>
        <span className="pill">🔒 Parents only</span>
        <span className="spacer" />
        <button className="primary" onClick={() => setAdding(true)}>＋ Reminder</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Things for grown-ups to remember: calls to make, forms, checkups. Dated ones show on your calendar and calendar feed. Repeating ones move to their next date when ticked.</p>
      {GROUPS.map((g) => {
        const list = items?.filter((r) => r.state === g.state) ?? [];
        return list.length > 0 && (
          <section key={g.state} className="card stack">
            <h2 style={{ margin: 0 }}>{g.title} <span className="pill">{list.length}</span></h2>
            {list.map((r) => <ReminderRow key={r.id} r={r} onChange={() => void reload()} />)}
          </section>
        );
      })}
      {items && !items.length && <div className="card muted">No reminders yet. Add one, like “Call to book Ava's dentist, every 6 months”.</div>}
      {adding && <ReminderForm onClose={() => setAdding(false)} onDone={() => { setAdding(false); void reload(); }} />}
    </div>
  );
}
