// Practice and habits on a kid's board ("📚 Reading, 3 of 5 days this week"), the timer, the parent's editor, and
// the "practice waiting" card on the parent home.
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { Modal, dayName, shortDate } from './Bits.tsx';
import { TimerRing } from './KidPractice.tsx';
import { RaccoonAvatar } from './Raccoon.tsx';
import { confetti } from './Confetti.ts';
import { SpeakButton } from './Speak.tsx';
import { HABIT_TEMPLATES } from '../../../shared/habits.ts';

export interface Habit {
  id: string; memberId: string; title: string; icon: string; minutes: number | null; targetDays: number; points: number; needsOk: boolean;
  week: { days: { date: string; status: 'waiting' | 'approved' | 'rejected' | null; minutes: number }[]; doneDays: number; minutes: number; reached: boolean };
  today: 'waiting' | 'approved' | 'rejected' | null; todayMinutes: number;
}
interface WaitingLog { id: string; date: string; minutes: number; title: string; icon: string; points: number; kid: { name: string; avatar: string } }

export function KidHabits({ memberId, kidName, color, asParent, readAloud }: { memberId: string; kidName: string; color: string; asParent: boolean; readAloud: boolean }) {
  const { base, home } = useApp();
  const [habits, reload] = useLoad<Habit[]>(`${base}/kids/${memberId}/habits`, [memberId]);
  const [playing, setPlaying] = useState<Habit | null>(null);
  const [editing, setEditing] = useState<Habit | 'new' | null>(null);
  if (!habits || (!habits.length && !asParent)) return null;
  const icon = home?.pointsIcon ?? '✨';
  return (
    <section className="card stack pg-habits">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>🎯 {asParent ? 'Practice' : 'My practice'}</h2>
        {asParent && <button onClick={() => setEditing('new')}>＋ Practice</button>}
      </div>
      {!habits.length && <p className="small muted" style={{ margin: 0 }}>Reading, an instrument, homework: add something {kidName} practices most days, with a timer and a weekly target.</p>}
      {habits.map((h) => (
        <div key={h.id} className="habit-row">
          <span className="kanban-icon" aria-hidden>{h.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="kanban-title">{h.title} {readAloud && <SpeakButton text={`${h.title}. ${h.week.doneDays} of ${h.targetDays} days this week.`} />}</div>
            <div className="habit-days" aria-label={`${h.week.doneDays} of ${h.targetDays} days this week`}>
              {h.week.days.map((d) => (
                <span key={d.date} title={`${dayName(d.date)}${d.minutes ? `: ${d.minutes} min` : ''}`}
                  className={`habit-day ${d.status ?? ''}`} style={d.status === 'approved' ? { background: color, borderColor: color } : undefined}>
                  {dayName(d.date).slice(0, 1)}
                </span>
              ))}
              <span className="small muted">{h.week.reached ? '🏆 Week done!' : `${h.week.doneDays} / ${h.targetDays} days`}{h.week.minutes ? ` · ${h.week.minutes} min` : ''}</span>
            </div>
            <div className="small muted">
              {h.minutes ? `${h.minutes} min` : 'No timer'}{h.points ? ` · +${h.points} ${icon} a day` : ''}{!h.needsOk && ' · ✨ trusted'}
              {h.today === 'waiting' && ' · ⏳ waiting for a grown-up'}{h.today === 'rejected' && ' · 🔁 try again'}{h.today === 'approved' && ' · ✅ done today'}
            </div>
          </div>
          {asParent && <button className="ghost" onClick={() => setEditing(h)} aria-label={`Edit ${h.title}`}>✏️</button>}
          <button className="primary" onClick={() => setPlaying(h)}>{h.today ? '▶ Again' : '▶ Start'}</button>
        </div>
      ))}
      {playing && <HabitPlayer habit={playing} color={color} asParent={asParent} onClose={() => setPlaying(null)} onDone={() => { setPlaying(null); void reload(); }} />}
      {editing && <HabitForm memberId={memberId} habit={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void reload(); }} />}
    </section>
  );
}

function HabitPlayer({ habit, color, asParent, onClose, onDone }: { habit: Habit; color: string; asParent: boolean; onClose: () => void; onDone: () => void }) {
  const { base, toast } = useApp();
  const total = (habit.minutes ?? 0) * 60;
  const [left, setLeft] = useState(total);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!running || left <= 0) return;
    // A running timer counts as using the tablet, so the idle sign-out doesn't end the practice.
    const t = window.setTimeout(() => { setLeft((x) => x - 1); window.dispatchEvent(new Event('scroll')); }, 1000);
    return () => window.clearTimeout(t);
  }, [running, left]);
  useEffect(() => { if (left === 0 && total) { setRunning(false); confetti({ colors: [color], count: 60 }); } }, [left, total, color]);
  const finish = async () => {
    setBusy(true);
    try {
      const minutes = total ? Math.max(1, Math.round((total - left) / 60)) : 0;
      const r = await api<{ paid: number; habit: Habit }>(`${base}/habits/${habit.id}/log`, { body: { minutes } });
      confetti({ colors: [color], count: 120 });
      toast(r.habit.today === 'approved' ? `Great practice!${r.paid ? ` +${r.paid}` : ''}` : 'Great practice! A grown-up will check it.');
      onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} wide>
      <div className="stack practice-mode" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div style={{ fontSize: '5rem', lineHeight: 1 }} aria-hidden>{habit.icon}</div>
        <h2 style={{ margin: 0 }}>{habit.title}</h2>
        {total > 0 && (
          <>
            <TimerRing total={total} left={left} color={color} />
            {left > 0 && <button onClick={() => setRunning(!running)}>{running ? '⏸ Pause' : left === total ? '⏱️ Start the timer' : '▶ Keep going'}</button>}
          </>
        )}
        <button className="primary" style={{ fontSize: '1.3rem', minHeight: 64, padding: '0 32px' }} disabled={busy || (!asParent && total > 0 && left === total)} onClick={() => void finish()}>
          🙌 I did it!
        </button>
        {total > 0 && left === total && !asParent && <p className="small muted" style={{ margin: 0 }}>Start the timer, then tap “I did it!” when you're done.</p>}
      </div>
    </Modal>
  );
}

function HabitForm({ memberId, habit, onClose, onDone }: { memberId: string; habit: Habit | null; onClose: () => void; onDone: () => void }) {
  const { base, toast, home } = useApp();
  const [d, setD] = useState({
    title: habit?.title ?? '', icon: habit?.icon ?? '🎯', minutes: habit?.minutes == null ? '' : String(habit.minutes),
    targetDays: habit?.targetDays ?? 5, points: habit?.points ?? 1, needsOk: habit?.needsOk ?? true,
  });
  const save = async () => {
    try {
      const body = { ...d, minutes: d.minutes === '' ? null : Number(d.minutes) };
      if (habit) await api(`${base}/habits/${habit.id}`, { method: 'PATCH', body });
      else await api(`${base}/kids/${memberId}/habits`, { body });
      onDone();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <Modal onClose={onClose}>
      <div className="stack">
        <h2 style={{ margin: 0 }}>{habit ? 'Edit practice' : 'New practice'}</h2>
        {!habit && (
          <div className="row" style={{ gap: 6 }}>
            {HABIT_TEMPLATES.map((t) => <button key={t.title} type="button" className="chip" onClick={() => setD({ ...d, title: t.title, icon: t.icon, minutes: String(t.minutes) })}>{t.icon} {t.title}</button>)}
          </div>
        )}
        <div className="row">
          <input aria-label="Icon" value={d.icon} onChange={(e) => setD({ ...d, icon: e.target.value })} style={{ width: 64, textAlign: 'center' }} />
          <input aria-label="Name" placeholder="Reading" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} style={{ flex: 1 }} />
        </div>
        <label className="row">Minutes each time <input type="number" min={1} max={240} placeholder="No timer" value={d.minutes} onChange={(e) => setD({ ...d, minutes: e.target.value })} style={{ width: 110 }} /></label>
        <label className="row">Days a week <input type="number" min={1} max={7} value={d.targetDays} onChange={(e) => setD({ ...d, targetDays: Number(e.target.value) })} style={{ width: 80 }} /></label>
        <label className="row">{home?.pointsName ?? 'Points'} a day <input type="number" min={0} max={1000} value={d.points} onChange={(e) => setD({ ...d, points: Number(e.target.value) })} style={{ width: 90 }} /></label>
        <label className="row"><input type="checkbox" checked={!d.needsOk} onChange={(e) => setD({ ...d, needsOk: !e.target.checked })} style={{ width: 22, minHeight: 22 }} /> Trust it (counts straight away, no check)</label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {habit && <button className="ghost danger" onClick={() => confirm(`Remove ${habit.title}? Past practice and points stay.`) && void api(`${base}/habits/${habit.id}`, { method: 'DELETE' }).then(onDone)}>Remove</button>}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!d.title.trim()} onClick={() => void save()}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

/** Parent home: practices waiting for a grown-up. */
export function HabitsWaitingCard({ onChange }: { onChange?: () => void }) {
  const { base, toast, home } = useApp();
  const [logs, reload] = useLoad<WaitingLog[]>(`${base}/habit-logs`);
  const [busy, setBusy] = useState(false);
  if (!logs?.length) return null;
  const act = async (path: string, body: object = {}) => {
    setBusy(true);
    try { await api(`${base}/habit-logs/${path}`, { body }); await reload(); onChange?.(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="card stack review-card has-items">
      <h2 style={{ margin: 0 }}>🎯 Practice to check <span className="pill warn">{logs.length}</span></h2>
      {logs.map((l) => (
        <div key={l.id} className="list-item">
          <RaccoonAvatar variant={l.kid.avatar} size={40} />
          <span className="review-icon" aria-hidden>{l.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{l.title}{l.minutes ? `, ${l.minutes} min` : ''}</div>
            <div className="small muted">{l.kid.name} · {dayName(l.date)} {shortDate(l.date)}{l.points ? ` · +${l.points} ${home?.pointsIcon ?? '✨'}` : ''}</div>
          </div>
          <button className="ghost danger" disabled={busy} onClick={() => void act(`${l.id}/reject`, { note: prompt('A note for them? (optional)') ?? '' })}>Not yet</button>
          <button className="primary" disabled={busy} onClick={() => void act(`${l.id}/approve`)}>Approve</button>
        </div>
      ))}
    </section>
  );
}
