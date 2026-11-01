// On the kid's screen: practice mode (big picture steps and a timer ring, then "I did it!", which waits for a
// grown-up) and "My medicine" (tick off a dose a parent lets them mark).
import { useEffect, useState } from 'react';
import { api, type Board, type KidTherapyGoal } from '../api.ts';
import { useApp } from '../state.tsx';
import { Modal } from './Bits.tsx';
import { confetti } from './Confetti.ts';

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
const timeText = (t: string) => TIME_FMT.format(new Date(`2000-01-01T${t}:00Z`));

function TimerRing({ total, left, color }: { total: number; left: number; color: string }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const frac = total ? left / total : 0;
  const m = Math.floor(left / 60);
  const s = left % 60;
  return (
    <svg viewBox="0 0 120 120" width={180} height={180} role="img" aria-label={`${m} minutes ${s} seconds left`}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="12" />
      <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 60 60)" style={{ transition: 'stroke-dashoffset 1s linear' }} />
      <text x="60" y="68" textAnchor="middle" style={{ font: '800 26px var(--font, inherit)', fill: 'var(--text)' }}>{left ? `${m}:${String(s).padStart(2, '0')}` : '🎉'}</text>
    </svg>
  );
}

export function PracticeMode({ goal, color, onClose, onDone }: { goal: KidTherapyGoal; color: string; onClose: () => void; onDone: () => void }) {
  const { base, toast } = useApp();
  const pm = goal.practiceMode!;
  const total = (pm.minutes ?? 0) * 60;
  const [step, setStep] = useState(0);
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
  const steps = pm.steps.length ? pm.steps : [{ icon: '⭐', text: goal.title }];
  const s = steps[step];
  const finish = async () => {
    setBusy(true);
    try {
      await api(`${base}/therapy/goals/${goal.id}/kid-practice`, { body: { minutes: total ? Math.round((total - left) / 60) : null } });
      confetti({ colors: [color], count: 120 });
      toast('Great practice! A grown-up will check it.');
      onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} wide>
      <div className="stack practice-mode" style={{ alignItems: 'center', textAlign: 'center' }}>
        <h2 style={{ margin: 0 }}>▶️ {goal.title}</h2>
        <div className="practice-step" aria-live="polite">
          <div style={{ fontSize: '5rem', lineHeight: 1 }} aria-hidden>{s.icon}</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{s.text}</div>
          {steps.length > 1 && <div className="small muted">Step {step + 1} of {steps.length}</div>}
        </div>
        {steps.length > 1 && (
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="icon" disabled={step === 0} onClick={() => setStep(step - 1)} aria-label="Back">◀</button>
            {steps.map((_, i) => <span key={i} aria-hidden style={{ width: 12, height: 12, borderRadius: 6, background: i <= step ? color : 'var(--surface-2)' }} />)}
            <button className="icon" disabled={step === steps.length - 1} onClick={() => setStep(step + 1)} aria-label="Next">▶</button>
          </div>
        )}
        {total > 0 && (
          <>
            <TimerRing total={total} left={left} color={color} />
            {left > 0 && <button onClick={() => setRunning(!running)}>{running ? '⏸ Pause' : left === total ? '⏱️ Start the timer' : '▶ Keep going'}</button>}
          </>
        )}
        <button className="primary" style={{ fontSize: '1.3rem', minHeight: 64, padding: '0 32px' }} disabled={busy || (total > 0 && left === total)} onClick={() => void finish()}>
          🙌 I did it!
        </button>
        {total > 0 && left === total && <p className="small muted" style={{ margin: 0 }}>Start the timer, then tap “I did it!” when you're done.</p>}
      </div>
    </Modal>
  );
}

export function KidMedicine({ meds, color, onChange }: { meds: Board['meds']; color: string; onChange: () => void }) {
  const { base, toast } = useApp();
  if (!meds.length) return null;
  const take = async (id: string, slot: string, name: string) => {
    try {
      await api(`${base}/meds/${id}/kid-dose`, { body: { slot } });
      confetti({ colors: [color], count: 40 });
      toast(`You took your ${name}. Good job!`);
      onChange();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>💊 My medicine</h2>
      {meds.map((m) => (
        <div key={m.id} className="row" style={{ flexWrap: 'wrap' }}>
          <strong style={{ flex: 1, minWidth: 120 }}>{m.name}{m.dose && <span className="muted"> · {m.dose}</span>}</strong>
          {m.slots.map((s) => s.status === 'given' || s.status === 'skipped'
            ? <span key={s.slot} className="pill ok">✓ {timeText(s.slot)}</span>
            : <button key={s.slot} className={s.status === 'late' ? 'primary' : ''} onClick={() => void take(m.id, s.slot, m.name)}>💊 I took my {timeText(s.slot)} medicine</button>)}
        </div>
      ))}
    </section>
  );
}
