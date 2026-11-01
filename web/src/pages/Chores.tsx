import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Chore } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { Modal } from '../components/Bits.tsx';
import { CHORE_ICONS, ROOM_TEMPLATES, ROUTINE_TEMPLATES, ROUTINES, routineOf, type RoutineId } from '../../../shared/catalog.ts';
import { WEEKDAY_SHORT, type ScheduleKind } from '../../../shared/schedule.ts';
import { IdeasButton } from '../components/Ideas.tsx';
import { choresForAge } from '../../../shared/ages.ts';

interface Draft {
  id?: string; title: string; icon: string; points: number; schedule: ScheduleKind; weekdays: number[]; dueDate: string; memberIds: string[]; bonus: boolean; claimLimit: 'each' | 'one'; category: 'room' | null; photo: boolean;
  everyDays: number | null; monthDay: number | null; dueTime: string | null; latePoints: number | null;
  routine: RoutineId | null; routinePos: number; minutes: number | null; rotate: 'daily' | 'weekly' | null; autoApprove: boolean;
}

function localToday(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function ChoreEditor({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const { base, home, toast } = useApp();
  const [d, setD] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  // The youngest picked kid with a known age sets the ideas, so everyone picked can do the chore.
  const youngest = home?.kids.filter((k) => d.memberIds.includes(k.id) && k.age != null).sort((a, b) => a.age! - b.age!)[0];
  const ageIdeas = youngest && !d.id ? choresForAge(youngest.age).slice(0, 10) : [];
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function save() {
    setError(null);
    try {
      const canTurn = !d.bonus && d.schedule !== 'once' && d.memberIds.length > 1;
      const body = {
        title: d.title, icon: d.icon, points: d.points, schedule: d.schedule, weekdays: d.weekdays, dueDate: d.schedule === 'once' ? d.dueDate : null, memberIds: d.memberIds, bonus: d.bonus, claimLimit: d.claimLimit, category: d.category, photo: d.photo,
        everyDays: d.schedule === 'interval' ? d.everyDays ?? 2 : null, monthDay: d.schedule === 'monthly' ? d.monthDay ?? 1 : null,
        dueTime: d.bonus ? null : d.dueTime || null, latePoints: d.dueTime && !d.bonus ? d.latePoints : null,
        routine: d.bonus ? null : d.routine, routinePos: d.routinePos, minutes: d.minutes, rotate: canTurn ? d.rotate : null, autoApprove: d.autoApprove,
      };
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
        {ageIdeas.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="small muted">Good for {youngest!.name} (age {youngest!.age}):</span>
            <div className="chips">
              {ageIdeas.map((c) => <button key={c.title} type="button" className="chip" onClick={() => set({ title: c.title, icon: c.icon, points: c.points })}>{c.icon} {c.title}</button>)}
            </div>
          </div>
        )}
        <IdeasButton kind="chore" kidId={youngest?.id} onPick={(i) => set({ title: i.title, points: i.points })} />
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
            {([['daily', 'Every day'], ['weekly', 'Some days'], ['interval', 'Every few days'], ['monthly', 'Monthly'], ['once', 'Just once']] as const).map(([v, l]) => (
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
        {d.schedule === 'interval' && (
          <div className="row">Every
            <input type="number" min={2} max={365} value={d.everyDays ?? 2} onChange={(e) => set({ everyDays: Math.max(2, Math.round(Number(e.target.value) || 2)) })} style={{ width: 90, textAlign: 'center' }} />
            days, starting today
            <span className="chips">{[2, 3, 7, 14].map((n) => <button key={n} type="button" className={`chip${d.everyDays === n ? ' on' : ''}`} onClick={() => set({ everyDays: n })}>{n === 7 ? 'weekly' : n === 14 ? 'every 2 weeks' : n}</button>)}</span>
          </div>
        )}
        {d.schedule === 'monthly' && (
          <div className="row">On day
            <input type="number" min={1} max={31} value={d.monthDay ?? 1} onChange={(e) => set({ monthDay: Math.min(31, Math.max(1, Math.round(Number(e.target.value) || 1))) })} style={{ width: 90, textAlign: 'center' }} />
            of each month <span className="small muted">(short months use their last day)</span>
          </div>
        )}
        {!d.bonus && (
          <label className="field">Due by (optional)
            <div className="row">
              <input type="time" value={d.dueTime ?? ''} onChange={(e) => set({ dueTime: e.target.value || null })} style={{ maxWidth: 160 }} />
              {d.dueTime && <>
                <span className="small">If it's late, it's worth</span>
                <input type="number" min={0} max={d.points} value={d.latePoints ?? ''} placeholder={String(d.points)} onChange={(e) => set({ latePoints: e.target.value === '' ? null : Math.min(d.points, Math.max(0, Math.round(Number(e.target.value)))) })} style={{ width: 80, textAlign: 'center' }} />
                <span>{home?.pointsIcon}</span>
                <button type="button" className="ghost" onClick={() => set({ dueTime: null, latePoints: null })}>Clear</button>
              </>}
            </div>
            {d.dueTime && <span className="small muted">The family tablet gets a nudge 15 minutes before, if notifications are on there.</span>}
          </label>
        )}
        {!d.bonus && (
          <label className="field">Part of a routine
            <div className="chips">
              <button type="button" className={`chip${!d.routine ? ' on' : ''}`} onClick={() => set({ routine: null })}>No</button>
              {ROUTINES.map((r) => <button key={r.id} type="button" className={`chip${d.routine === r.id ? ' on' : ''}`} onClick={() => set({ routine: r.id, minutes: d.minutes ?? 5 })}>{r.icon} {r.title}</button>)}
            </div>
          </label>
        )}
        {!d.bonus && d.routine && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row">
              <span>Step</span>
              <input type="number" min={1} max={99} value={d.routinePos + 1} onChange={(e) => set({ routinePos: Math.min(98, Math.max(0, Math.round(Number(e.target.value) || 1) - 1)) })} style={{ width: 70, textAlign: 'center' }} />
              <span>with a timer of</span>
              <input type="number" min={1} max={120} value={d.minutes ?? ''} placeholder="none" onChange={(e) => set({ minutes: e.target.value === '' ? null : Math.min(120, Math.max(1, Math.round(Number(e.target.value)))) })} style={{ width: 80, textAlign: 'center' }} />
              <span>minutes</span>
            </div>
            {!d.id && (
              <div className="chips">
                {ROUTINE_TEMPLATES[d.routine].map((t, i) => <button key={t.title} type="button" className="chip" onClick={() => set({ title: t.title, icon: t.icon, minutes: t.minutes, routinePos: i })}>{t.icon} {t.title}</button>)}
              </div>
            )}
          </div>
        )}
        <label className="field">Category
          <div className="chips">
            <button type="button" className={`chip${!d.category ? ' on' : ''}`} onClick={() => set({ category: null })}>🏠 Around the house</button>
            <button type="button" className={`chip${d.category === 'room' ? ' on' : ''}`} onClick={() => set({ category: 'room' })}>🛏️ Their room</button>
          </div>
        </label>
        {d.category === 'room' && !d.id && (
          <div className="chips">
            {ROOM_TEMPLATES.map((t) => <button key={t.title} type="button" className="chip" onClick={() => set({ title: t.title, icon: t.icon })}>{t.icon} {t.title}</button>)}
          </div>
        )}
        <label className="field">Kind of chore
          <div className="chips">
            <button type="button" className={`chip${!d.bonus ? ' on' : ''}`} onClick={() => set({ bonus: false })}>📋 Regular (always on their list)</button>
            <button type="button" className={`chip${d.bonus ? ' on' : ''}`} onClick={() => set({ bonus: true })}>💪 Bonus (kids opt in for extra)</button>
          </div>
        </label>
        {d.bonus && (
          <div className="chips">
            <button type="button" className={`chip${d.claimLimit === 'each' ? ' on' : ''}`} onClick={() => set({ claimLimit: 'each' })}>Every kid can do it</button>
            <button type="button" className={`chip${d.claimLimit === 'one' ? ' on' : ''}`} onClick={() => set({ claimLimit: 'one' })}>First to grab it, one per day</button>
          </div>
        )}
        <label className="row" style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={d.photo} onChange={(e) => set({ photo: e.target.checked })} style={{ width: 24, minHeight: 24 }} />
          📸 Ask for a photo when it's done
        </label>
        <label className="row" style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={d.autoApprove} onChange={(e) => set({ autoApprove: e.target.checked })} style={{ width: 24, minHeight: 24 }} />
          ✨ Trust it: approve by itself when it's marked done
        </label>
        <label className="field">{d.bonus ? 'Who can pick it (none = every kid)' : 'Who does it'}
          <div className="chips">
            {home?.kids.filter((k) => !k.pagesOff.includes('chores')).map((k) => (
              <button key={k.id} type="button" className={`chip${d.memberIds.includes(k.id) ? ' on' : ''}`} onClick={() => set({ memberIds: toggle(d.memberIds, k.id) })}>
                <RaccoonAvatar variant={k.avatar} size={26} /> {k.name}
              </button>
            ))}
          </div>
        </label>
        {!d.bonus && d.schedule !== 'once' && d.memberIds.length > 1 && (
          <label className="field">With more than one kid
            <div className="chips">
              <button type="button" className={`chip${!d.rotate ? ' on' : ''}`} onClick={() => set({ rotate: null })}>Everyone does it</button>
              <button type="button" className={`chip${d.rotate === 'daily' ? ' on' : ''}`} onClick={() => set({ rotate: 'daily' })}>🔄 Take turns each time</button>
              <button type="button" className={`chip${d.rotate === 'weekly' ? ' on' : ''}`} onClick={() => set({ rotate: 'weekly' })}>🔄 Take turns each week</button>
            </div>
            {d.rotate && <span className="small muted">Turn order: {d.memberIds.map((m, i) => `${i + 1}. ${home?.kids.find((k) => k.id === m)?.name ?? '?'}`).join('  ')} (the order you picked them)</span>}
          </label>
        )}
        {home && !home.kids.length && <p className="small muted" style={{ margin: 0 }}>Add a kid first in <Link to="/kids">Kids</Link>.</p>}
        {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <div className="row">
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!d.title.trim() || (!d.bonus && !d.memberIds.length)} onClick={() => void save()}>Save</button>
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
  const blank = (): Draft => ({
    title: '', icon: '⭐', points: 1, schedule: 'daily', weekdays: [1, 2, 3, 4, 5], dueDate: localToday(), memberIds: home?.kids.map((k) => k.id) ?? [], bonus: false, claimLimit: 'each', category: null, photo: false,
    everyDays: 3, monthDay: Number(localToday().slice(8)), dueTime: null, latePoints: null, routine: null, routinePos: 0, minutes: null, rotate: null, autoApprove: false,
  });

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
              <div className="small muted">{c.category === 'room' && <span className="pill">🛏️ room</span>} {c.bonus && <span className="pill">💪 bonus{c.claimLimit === 'one' ? ', first come' : ''}</span>} {c.photo && <span className="pill">📸 photo</span>} {c.routine && <span className="pill">{routineOf(c.routine)?.icon} step {c.routinePos + 1}{c.minutes ? `, ${c.minutes} min` : ''}</span>} {c.rotate && <span className="pill">🔄 turns{c.rotate === 'weekly' ? ' by week' : ''}</span>} {c.autoApprove && <span className="pill">✨ auto</span>} {c.describe} · +{c.points} {home?.pointsIcon}</div>
            </div>
            <div className="row" style={{ gap: 2 }}>
              {c.memberIds.map((m) => <RaccoonAvatar key={m} variant={kids.get(m)?.avatar} size={30} title={kids.get(m)?.name} />)}
            </div>
            <button className="ghost" onClick={() => setEditing({ ...c, dueDate: c.dueDate ?? localToday(), everyDays: c.everyDays ?? 3, monthDay: c.monthDay ?? Number(localToday().slice(8)) })}>Edit</button>
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
