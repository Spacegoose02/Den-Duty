// Routines on a kid's board: ordered steps (morning, after school, bedtime) with a big one-step-at-a-time player
// and a countdown for each step. Steps are ordinary chores, so "done" works the same way (review, or auto-approve).
import { useEffect, useRef, useState } from 'react';
import type { AgendaItem } from '../api.ts';
import { ROUTINES, type RoutineId } from '../../../shared/catalog.ts';
import { clockText } from '../../../shared/schedule.ts';
import { ProgressBar } from './Bits.tsx';
import { SpeakButton, speak, stopSpeaking } from './Speak.tsx';
import { confetti } from './Confetti.ts';

export const isDone = (i: AgendaItem) => i.status === 'submitted' || i.status === 'approved';

export function routinesOf(items: AgendaItem[]) {
  return ROUTINES.map((r) => ({ ...r, steps: items.filter((i) => i.routine === r.id).sort((a, b) => (a.routinePos ?? 0) - (b.routinePos ?? 0) || a.title.localeCompare(b.title)) }))
    .filter((r) => r.steps.length);
}

/** The routine cards above the kanban. */
export function RoutineCards({ items, color, icon, readAloud, onStart }: {
  items: AgendaItem[]; color: string; icon: string; readAloud: boolean; onStart: (id: RoutineId) => void;
}) {
  const routines = routinesOf(items);
  if (!routines.length) return null;
  return (
    <section className="routine-grid pg-chores">
      {routines.map((r) => {
        const done = r.steps.filter(isDone).length;
        const all = done === r.steps.length;
        const due = r.steps.find((s) => s.dueTime)?.dueTime;
        return (
          <div key={r.id} className={`card routine-card${all ? ' finished' : ''}`}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <span className="routine-icon" aria-hidden>{r.icon}</span>
              <div style={{ flex: 1 }}>
                <strong>{r.title}</strong>
                <div className="small muted">{done} of {r.steps.length} steps{due && ` · by ${clockText(due)}`}</div>
              </div>
              {readAloud && <SpeakButton text={`${r.title}. ${r.steps.map((s) => s.title).join('. ')}`} />}
            </div>
            <ProgressBar percent={(done / r.steps.length) * 100} color={all ? 'var(--ok)' : color} />
            <div className="routine-steps">
              {r.steps.map((s) => <span key={s.id} className={`routine-step${isDone(s) ? ' done' : ''}`} title={s.title}>{isDone(s) ? '✓' : s.icon}</span>)}
            </div>
            {all ? <span className="pill ok" style={{ alignSelf: 'flex-start' }}>All done! 🎉</span>
              : <button className="primary" onClick={() => onStart(r.id)}>▶ {done ? 'Keep going' : 'Start'}</button>}
            <span className="small muted">+{r.steps.reduce((n, s) => n + s.points, 0)} {icon}</span>
          </div>
        );
      })}
    </section>
  );
}

const mmss = (sec: number) => `${sec < 0 ? '−' : ''}${Math.floor(Math.abs(sec) / 60)}:${String(Math.abs(sec) % 60).padStart(2, '0')}`;

/** Full-screen, one step at a time: big picture, a countdown, and one big Done button. */
export function RoutinePlayer({ routine, items, color, readAloud, onDone, onClose }: {
  routine: RoutineId; items: AgendaItem[]; color: string; readAloud: boolean;
  onDone: (i: AgendaItem) => Promise<void>; onClose: () => void;
}) {
  const r = routinesOf(items).find((x) => x.id === routine);
  const step = r?.steps.find((s) => !isDone(s));
  const [left, setLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const finished = useRef(false);
  const stepId = step?.id ?? null;

  // A fresh countdown for each step, read out loud when it starts.
  useEffect(() => {
    if (!step) return;
    setLeft(step.minutes ? step.minutes * 60 : null);
    if (readAloud) speak(`${step.title}${step.minutes ? `. You have ${step.minutes} minute${step.minutes === 1 ? '' : 's'}` : ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId]);
  useEffect(() => {
    if (left == null) return;
    const t = window.setInterval(() => setLeft((v) => (v == null ? v : v - 1)), 1000);
    return () => window.clearInterval(t);
  }, [left == null]);
  useEffect(() => {
    if (left === 0 && readAloud && step) speak(`Time's up for ${step.title}. Tap done when you're finished!`);
  }, [left === 0]);
  useEffect(() => {
    if (r && !step && !finished.current) {
      finished.current = true;
      confetti({ colors: [color, '#ffd43b'], count: 240 });
      if (readAloud) speak(`You finished your ${r.title}! Amazing!`);
    }
  }, [r, step, color, readAloud]);
  useEffect(() => () => stopSpeaking(), []);

  if (!r) return null;
  const index = step ? r.steps.indexOf(step) : r.steps.length;
  const total = step?.minutes ? step.minutes * 60 : 0;
  return (
    <div className="routine-player" role="dialog" aria-label={r.title} style={{ ['--kid' as string]: color }}>
      <div className="row" style={{ width: '100%' }}>
        <strong style={{ flex: 1 }}>{r.icon} {r.title}</strong>
        <span className="pill">{Math.min(index + 1, r.steps.length)} / {r.steps.length}</span>
        <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="routine-dots">{r.steps.map((s, i) => <span key={s.id} className={`dot${isDone(s) ? ' done' : i === index ? ' now' : ''}`} />)}</div>
      {step ? (
        <>
          <span className="routine-big" aria-hidden>{step.icon}</span>
          <h1 style={{ margin: 0, textAlign: 'center' }}>{step.title} {readAloud && <SpeakButton text={step.title} />}</h1>
          {left != null && (
            <div className={`routine-timer${left <= 0 ? ' over' : ''}`}>
              <svg viewBox="0 0 120 120" aria-hidden>
                <circle cx="60" cy="60" r="52" className="track" />
                <circle cx="60" cy="60" r="52" className="fill" style={{ strokeDasharray: 327, strokeDashoffset: 327 * (1 - Math.max(0, left) / Math.max(1, total)) }} />
              </svg>
              <span>{left > 0 ? mmss(left) : 'Time!'}</span>
            </div>
          )}
          {step.status === 'rejected' && step.note && <p className="chore-note">🔁 “{step.note}”</p>}
          <button className="primary routine-done" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await onDone(step); } finally { setBusy(false); }
          }}>{step.needsPhoto && !step.hasPhoto ? '📸 Snap it, done!' : '✓ Done!'}</button>
        </>
      ) : (
        <>
          <span className="routine-big" aria-hidden>🏆</span>
          <h1 style={{ margin: 0 }}>All done!</h1>
          <button className="primary routine-done" onClick={onClose}>Back to my board</button>
        </>
      )}
    </div>
  );
}
