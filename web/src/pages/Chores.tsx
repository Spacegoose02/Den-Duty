import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Chore } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { Modal } from '../components/Bits.tsx';
import { CHORE_ICONS } from '../../../shared/catalog.ts';
import { WEEKDAY_SHORT, type ScheduleKind } from '../../../shared/schedule.ts';

interface Draft { id?: string; title: string; icon: string; points: number; schedule: ScheduleKind; weekdays: number[]; dueDate: string; memberIds: string[] }

function localToday(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function ChoreEditor({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const { base, home, toast } = useApp();
  const [d, setD] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function save() {
    setError(null);
    try {
      const body = { title: d.title, icon: d.icon, points: d.points, schedule: d.schedule, weekdays: d.weekdays, dueDate: d.schedule === 'once' ? d.dueDate : null, memberIds: d.memberIds };
      if (d.id) await api(`${base}/chores/${d.id}`, { method: 'PATCH', body });
      else await api(`${base}/chores`, { body });
      toast(d.id ? 'Chore saved' : 'Chore added');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal onClose={onClose} wide>
      <div className="stack">
        <h2 style={{ margin: 0 }}>{d.id ? 'Edit chore' : 'New chore'}</h2>
        <div className="row">
          <span className="big-icon" aria-hidden>{d.icon}</span>
          <input value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="What needs doing? e.g. Make your bed" style={{ flex: 1 }} autoFocus />
        </div>
        <div className="chips">
          {CHORE_ICONS.map((i) => (
            <button key={i} type="button" className={`chip icon-chip${d.icon === i ? ' on' : ''}`} onClick={() => set({ icon: i })}>{i}</button>
          ))}
        </div>
        <label className="field">{home?.pointsName ?? 'Points'} for doing it
          <div className="row">
            <button type="button" className="icon" onClick={() => set({ points: Math.max(0, d.points - 1) })}>−</button>
            <input type="number" min={0} value={d.points} onChange={(e) => set({ points: Math.max(0, Math.round(Number(e.target.value) || 0)) })} style={{ width: 100, textAlign: 'center' }} />
            <button type="button" className="icon" onClick={() => set({ points: d.points + 1 })}>＋</button>
            <span style={{ fontSize: '1.4rem' }}>{home?.pointsIcon}</span>
          </div>
        </label>
        <label className="field">How often
          <div className="chips">
            {([['daily', 'Every day'], ['weekly', 'Some days'], ['once', 'Just once']] as const).map(([v, l]) => (
              <button key={v} type="button" className={`chip${d.schedule === v ? ' on' : ''}`} onClick={() => set({ schedule: v })}>{l}</button>
            ))}
          </div>
        </label>
        {d.schedule === 'weekly' && (
          <div className="chips">
            {WEEKDAY_SHORT.map((name, i) => (
              <button key={name} type="button" className={`chip${d.weekdays.includes(i) ? ' on' : ''}`} onClick={() => set({ weekdays: toggle(d.weekdays, i) })}>{name}</button>
            ))}
          </div>
        )}
        {d.schedule === 'once' && <input type="date" value={d.dueDate} onChange={(e) => set({ dueDate: e.target.value })} style={{ maxWidth: 220 }} />}
        <label className="field">Who does it
          <div className="chips">
            {home?.kids.map((k) => (
              <button key={k.id} type="button" className={`chip${d.memberIds.includes(k.id) ? ' on' : ''}`} onClick={() => set({ memberIds: toggle(d.memberIds, k.id) })}>
                <RaccoonAvatar variant={k.avatar} size={26} /> {k.name}
              </button>
            ))}
          </div>
        </label>
        {home && !home.kids.length && <p className="small muted" style={{ margin: 0 }}>Add a kid first in <Link to="/kids">Kids</Link>.</p>}
        {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <div className="row">
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!d.title.trim() || !d.memberIds.length} onClick={() => void save()}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

export function Chores() {
  const { base, home, toast } = useApp();
  const [chores, reload] = useLoad<Chore[]>(`${base}/chores`);
  const [editing, setEditing] = useState<Draft | null>(null);
  const kids = new Map(home?.kids.map((k) => [k.id, k]));
  const blank = (): Draft => ({ title: '', icon: '⭐', points: 1, schedule: 'daily', weekdays: [1, 2, 3, 4, 5], dueDate: localToday(), memberIds: home?.kids.map((k) => k.id) ?? [] });

  return (
    <div className="stack">
      <div className="topbar">
        <h1>Chores</h1>
        <button className="primary" onClick={() => setEditing(blank())}>＋ New chore</button>
      </div>
      <div className="card list">
        {chores?.map((c) => (
          <div key={c.id} className="list-item">
            <span className="big-icon" aria-hidden>{c.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{c.title}</div>
              <div className="small muted">{c.describe} · +{c.points} {home?.pointsIcon}</div>
            </div>
            <div className="row" style={{ gap: 2 }}>
              {c.memberIds.map((m) => <RaccoonAvatar key={m} variant={kids.get(m)?.avatar} size={30} title={kids.get(m)?.name} />)}
            </div>
            <button className="ghost" onClick={() => setEditing({ ...c, dueDate: c.dueDate ?? localToday() })}>Edit</button>
            <button className="ghost danger" onClick={async () => {
              if (!confirm(`Remove “${c.title}”? Days already done keep their ${home?.pointsName}.`)) return;
              await api(`${base}/chores/${c.id}`, { method: 'DELETE' });
              toast('Chore removed');
              await reload();
            }}>Remove</button>
          </div>
        ))}
        {chores && !chores.length && <p className="muted" style={{ margin: 0 }}>No chores yet. Tap “New chore” to add the first one.</p>}
      </div>
      {editing && <ChoreEditor draft={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}
