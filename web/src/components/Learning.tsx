// Learning time on a kid's board: a few questions a day at their grade (Virginia SOL), or "Talk & play" picture
// questions for a kid working on speech. Tap an answer; a miss gets one more try, then the answer and why. Parents set
// the grade, how many a day and the points, and see which skills are clicking and which need practice.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { Modal, ProgressBar, dayName } from './Bits.tsx';
import { confetti } from './Confetti.ts';
import { SpeakButton, speak } from './Speak.tsx';
import {
  DEFAULT_LEARN_PLAN, LEVELS, SUBJECTS, makeQuestion, subjectInfo, subjectsAt, type LearnPlan, type LearnResult, type Level, type Question, type Subject,
} from '../../../shared/learning.ts';

interface Card { skill: string; seed: string; card: number; result: LearnResult | null; extra: boolean }
interface SkillRow { id: string; label: string; subject: Subject; area: string; total: number; pct: number | null; got: boolean }
interface LearnView {
  today: string; level: Level | null; levelLabel: string | null; auto: boolean; pictures: boolean; plan: LearnPlan | null; subjects: Subject[];
  cards: Card[]; left: number; rightToday: number; paidToday: boolean;
  skills: SkillRow[]; gotCount: number; mastered: { min: number; acc: number }; practice: SkillRow[];
  week: { answered: number; right: number; days: number };
  daily: { date: string; answered: number; right: number }[];
  bySubject: { subject: Subject; answered: number; right: number }[];
}

const MORE = 5;

export function KidLearning({ memberId, kidName, color, asParent, readAloud }: { memberId: string; kidName: string; color: string; asParent: boolean; readAloud: boolean }) {
  const { base, home } = useApp();
  const [extra, setExtra] = useState(0);
  const [view, reload] = useLoad<LearnView | null>(`${base}/kids/${memberId}/learn${extra ? `?extra=${extra}` : ''}`, [memberId, extra]);
  const [mode, setMode] = useState<'play' | 'plan' | null>(null);
  const [wantPlay, setWantPlay] = useState(false);
  // "Keep practicing" asks for more cards, then opens them once they're loaded.
  useEffect(() => { if (wantPlay && view?.cards.some((c) => !c.result)) { setWantPlay(false); setMode('play'); } }, [wantPlay, view]);
  if (!view) return null;
  if (!view.plan) {
    if (!asParent) return null;
    return (
      <section className="card stack pg-learning">
        <h2 style={{ margin: 0 }}>🎓 Learning time</h2>
        <p className="small muted" style={{ margin: 0 }}>
          A few quick questions a day for {kidName} at their grade, lined up with the Virginia Standards of Learning: math, reading,
          science and history. Big tap-to-answer buttons, read out loud for little ones, and a “Talk &amp; play” level with picture
          questions for kids working on speech. The skills {kidName} finds hard come up more often.
        </p>
        <p className="small" style={{ margin: 0 }}>{view.level ? <>Grade: <strong>{view.levelLabel}</strong>{view.auto ? ' (by age; you can change it)' : ''}</> : 'Pick a grade to start.'}</p>
        <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={() => setMode('plan')}>Set it up for {kidName}</button>
        {mode === 'plan' && <PlanForm memberId={memberId} view={view} kidName={kidName} onClose={() => setMode(null)} onDone={() => { setMode(null); void reload(); }} />}
      </section>
    );
  }
  const todays = view.cards.filter((c) => !c.extra);
  const open = view.cards.filter((c) => !c.result);
  const icon = home?.pointsIcon ?? '✨';
  const total = view.skills.length;
  const speakIt = readAloud || view.pictures;
  return (
    <section className="card stack pg-learning learn-card">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>
          🎓 {asParent ? 'Learning time' : 'My learning time'} <span className="chip learn-grade">{view.levelLabel ?? 'No grade'}</span>
          {speakIt && !asParent && <SpeakButton text={view.left ? `You have ${view.left} questions today.` : 'All your questions are done today! Great learning!'} />}
        </h2>
        {asParent && <button className="ghost" onClick={() => setMode('plan')} aria-label="Learning time settings">⚙️</button>}
      </div>
      {!view.level && <p className="small muted" style={{ margin: 0 }}>{asParent ? `Pick a grade for ${kidName} in ⚙️ to start.` : 'Ask a grown-up to pick your grade.'}</p>}
      {view.level && (
        <div className="math-actions">
          <button className="help-pick" disabled={!open.length} onClick={() => setMode('play')}>
            <span className="help-pick-icon">{view.left ? '✏️' : '🌟'}</span>
            {view.left ? `Today's questions (${view.left})` : open.length ? `Practice (${open.length} more)` : 'Done for today ✓'}
            <span className="small muted">{view.left ? `${todays.length} quick questions. No timer.` : `${view.rightToday} of ${todays.length} right the first time`}</span>
          </button>
          {!view.left && !open.length && (
            <button className="help-pick" onClick={() => { setExtra(view.cards.length - todays.length + MORE); setWantPlay(true); }}>
              <span className="help-pick-icon">💪</span>
              Keep practicing
              <span className="small muted">{MORE} more, just for fun</span>
            </button>
          )}
        </div>
      )}
      {view.level && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="row small" style={{ justifyContent: 'space-between' }}>
            <strong>⭐ {view.gotCount} of {total} skills got</strong>
            {view.plan.points > 0 && <span className="muted">{view.paidToday ? `+${view.plan.points} ${icon} today ✓` : `+${view.plan.points} ${icon} for today's questions`}</span>}
          </div>
          <ProgressBar percent={total ? (view.gotCount / total) * 100 : 0} color={color} />
        </div>
      )}
      {view.level && <SkillStars view={view} asParent={asParent} />}
      {asParent && view.level && <LearnStats view={view} kidName={kidName} color={color} />}
      {mode === 'play' && <Player memberId={memberId} kidName={kidName} cards={open} color={color} speakIt={speakIt} onClose={() => { setMode(null); void reload(); }} />}
      {mode === 'plan' && <PlanForm memberId={memberId} view={view} kidName={kidName} onClose={() => setMode(null)} onDone={() => { setMode(null); void reload(); }} />}
    </section>
  );
}

/** Every skill at their level, by subject: a star once they've got it, orange when it needs practice. */
function SkillStars({ view, asParent }: { view: LearnView; asParent: boolean }) {
  const subjects = SUBJECTS.filter((s) => view.skills.some((k) => k.subject === s.id));
  return (
    <details className="fact-garden">
      <summary className="small"><strong>⭐ {asParent ? 'Skills' : 'My skill stars'}</strong> <span className="muted">⭐ got it ({view.mastered.min}+ tries, {Math.round(view.mastered.acc * 100)}% right) · 🟠 practice</span></summary>
      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
        {subjects.map((s) => (
          <div key={s.id} className="stack" style={{ gap: 4 }}>
            <span className="small muted">{s.icon} {s.label}</span>
            <div className="row" style={{ gap: 6 }}>
              {view.skills.filter((k) => k.subject === s.id).map((k) => (
                <span key={k.id} className={`chip skill-chip${k.got ? ' got' : k.total >= 3 && (k.pct ?? 100) < 60 ? ' tricky-chip' : ''}`} title={k.area}>
                  {k.got ? '⭐ ' : ''}{k.label}{asParent && k.total > 0 && <span className="small muted"> · {k.pct}% of {k.total}</span>}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function LearnStats({ view, kidName, color }: { view: LearnView; kidName: string; color: string }) {
  const pct = view.week.answered ? Math.round((view.week.right / view.week.answered) * 100) : null;
  const days = view.daily;
  const maxDay = Math.max(1, ...days.map((d) => d.answered));
  return (
    <div className="stack math-stats">
      <div className="stats">
        <div><span className="num">{view.week.days}</span><span className="small muted">days this week</span></div>
        <div><span className="num">{view.week.answered}</span><span className="small muted">questions</span></div>
        <div><span className="num">{pct == null ? '–' : `${pct}%`}</span><span className="small muted">right first try</span></div>
        <div><span className="num">{view.gotCount}/{view.skills.length}</span><span className="small muted">skills got</span></div>
      </div>
      {days.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="small muted">Last two weeks (darker = right the first time)</span>
          <div className="math-bars" role="img" aria-label="Questions answered per day">
            {days.map((d) => (
              <span key={d.date} title={`${dayName(d.date)}: ${d.right} of ${d.answered} right first try`} className="math-bar learn-bar">
                <span style={{ height: `${(d.answered / maxDay) * 100}%`, background: `color-mix(in srgb, ${color} 35%, transparent)` }}>
                  <span style={{ height: `${d.answered ? (d.right / d.answered) * 100 : 0}%`, background: color }} />
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
      {view.bySubject.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="small"><strong>By subject</strong> <span className="muted">(last 30 days, right the first time)</span></span>
          {view.bySubject.map((s) => (
            <div key={s.subject} className="row small" style={{ flexWrap: 'nowrap' }}>
              <span style={{ width: 170 }}>{subjectInfo(s.subject)?.icon} {subjectInfo(s.subject)?.label ?? s.subject}</span>
              <span style={{ flex: 1 }}><ProgressBar percent={s.answered ? (s.right / s.answered) * 100 : 0} color={color} /></span>
              <strong style={{ width: 70, textAlign: 'right' }}>{s.right}/{s.answered}</strong>
            </div>
          ))}
        </div>
      )}
      <span className="small">
        <strong>Needs practice</strong>{' '}
        {view.practice.length
          ? view.practice.map((p) => `${p.label} (${p.pct}%)`).join(', ')
          : <span className="muted">Nothing stands out yet. Skills {kidName} misses come up more often by themselves.</span>}
      </span>
    </div>
  );
}

function PlanForm({ memberId, view, kidName, onClose, onDone }: { memberId: string; view: LearnView; kidName: string; onClose: () => void; onDone: () => void }) {
  const { base, toast, home } = useApp();
  const [p, setP] = useState<LearnPlan>(view.plan ?? { ...DEFAULT_LEARN_PLAN, perDay: view.level === 'talk' || view.level === 'pk' ? 4 : DEFAULT_LEARN_PLAN.perDay });
  // null = by age.
  const [grade, setGrade] = useState<Level | null>(view.auto ? null : view.level);
  const subjects = subjectsAt(grade ?? view.level);
  const save = async (off = false) => {
    try {
      await api(`${base}/kids/${memberId}/learn/plan`, { method: 'PUT', body: off ? { off: true } : { ...p, grade: grade ?? '' } });
      onDone();
    } catch (e) { toast((e as Error).message); }
  };
  const ready = !!(grade ?? view.level);
  return (
    <Modal onClose={onClose}>
      <div className="stack">
        <h2 style={{ margin: 0 }}>🎓 Learning time for {kidName}</h2>
        <span className="small"><strong>Grade</strong> <span className="muted">(moves up by itself each July)</span></span>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className={`chip${!grade ? ' on' : ''}`} onClick={() => setGrade(null)}>By age{view.auto && view.levelLabel ? ` (${view.levelLabel})` : ''}</button>
          {LEVELS.map((l) => (
            <button key={l.id} type="button" className={`chip${grade === l.id ? ' on' : ''}`} title={l.hint} onClick={() => setGrade(l.id)}>{l.id === 'talk' ? '🗣️ ' : ''}{l.label}</button>
          ))}
        </div>
        <p className="small muted" style={{ margin: 0 }}>{LEVELS.find((l) => l.id === (grade ?? view.level))?.hint ?? 'Add a birthday or pick a grade.'}</p>
        {subjects.length > 1 && (
          <>
            <span className="small"><strong>Subjects</strong></span>
            <div className="row" style={{ gap: 6 }}>
              {subjects.map((id) => {
                const s = subjectInfo(id)!;
                const on = !p.subjectsOff.includes(id);
                return (
                  <button key={id} type="button" className={`chip${on ? ' on' : ''}`} aria-pressed={on}
                    onClick={() => setP({ ...p, subjectsOff: on ? [...p.subjectsOff, id] : p.subjectsOff.filter((x) => x !== id) })}>{s.icon} {s.label}</button>
                );
              })}
            </div>
          </>
        )}
        <label className="row">Questions a day <input type="number" min={3} max={15} value={p.perDay} onChange={(e) => setP({ ...p, perDay: Number(e.target.value) })} style={{ width: 80 }} /></label>
        <label className="row">{home?.pointsName ?? 'Points'} for finishing them <input type="number" min={0} max={100} value={p.points} onChange={(e) => setP({ ...p, points: Number(e.target.value) })} style={{ width: 80 }} /></label>
        <p className="small muted" style={{ margin: 0 }}>
          Subjects take turns, and skills {kidName} misses come up more often. A miss gets one more try, then the answer and why.
          Points come once a day, when today's questions are done. 1st grade and up also has the Math facts helper for × and ÷.
        </p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {view.plan && <button className="ghost danger" onClick={() => void save(true)}>Turn off</button>}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!ready} onClick={() => void save()}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- answering ----------

function Player({ memberId, kidName, cards, color, speakIt, onClose }: { memberId: string; kidName: string; cards: Card[]; color: string; speakIt: boolean; onClose: () => void }) {
  const { base, toast, home } = useApp();
  const [list] = useState(cards);
  const [i, setI] = useState(0);
  const [missed, setMissed] = useState<number[]>([]);
  const [done, setDone] = useState<LearnResult | null>(null);
  const [score, setScore] = useState(0);
  const [end, setEnd] = useState(false);
  const card = list[i];
  const q: Question | null = useMemo(() => (card ? makeQuestion(card.skill, card.seed, { name: kidName }) : null), [card, kidName]);
  useEffect(() => { if (q && speakIt) speak(q.say ?? q.prompt); }, [q, speakIt]);
  if (!card || !q) return null;
  const tap = async (k: number) => {
    if (done || missed.includes(k)) return;
    const right = k === q.answer;
    if (!right && !missed.length) {
      setMissed([k]);
      if (speakIt) speak('Not quite. Try again!');
      return;
    }
    const result: LearnResult = right ? (missed.length ? 'second' : 'right') : 'wrong';
    if (!right) setMissed([...missed, k]);
    setDone(result);
    if (right) { confetti({ colors: [color], count: result === 'right' ? 50 : 25 }); if (result === 'right') setScore((s) => s + 1); }
    if (speakIt) speak(right ? `Yes! ${q.why}` : `The answer is ${q.choices[q.answer].text}. ${q.why}`);
    try {
      const r = await api<{ paid: number }>(`${base}/kids/${memberId}/learn/answer`, { body: { card: card.card, skill: card.skill, result } });
      if (r.paid) toast(`+${r.paid} ${home?.pointsIcon ?? '✨'} for learning time!`);
    } catch (e) { toast((e as Error).message); }
  };
  const next = () => {
    setMissed([]); setDone(null);
    if (i + 1 < list.length) { setI(i + 1); return; }
    setEnd(true);
    confetti({ colors: [color, '#ffd43b'], count: 200 });
  };
  return (
    <Modal onClose={onClose} wide>
      <div className="stack learn-player" style={{ alignItems: 'center', textAlign: 'center' }}>
        {end ? (
          <>
            <div style={{ fontSize: '4rem' }} aria-hidden>🌟</div>
            <h2 style={{ margin: 0 }}>Great learning, {kidName}!</h2>
            <p style={{ margin: 0 }}>You got {score} of {list.length} right the first time. The tricky ones will come back so you can practice.</p>
            <button className="primary big-btn" onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            <div className="small muted">Question {i + 1} of {list.length} · no timer</div>
            <div className="learn-prompt">
              {q.prompt} <SpeakButton text={q.say ?? q.prompt} label="Read the question" />
            </div>
            {q.show && <div className={`learn-show${q.show.length > 14 ? ' long' : ''}`}>{q.show}</div>}
            <div className={`learn-choices${q.pictures ? ' pictures' : ''}`}>
              {q.choices.map((c, k) => {
                const cls = done && k === q.answer ? ' right' : missed.includes(k) ? ' wrong' : '';
                return (
                  <button key={k} className={`learn-choice${cls}`} disabled={!!done || missed.includes(k)} onClick={() => void tap(k)}>
                    {c.pic && <span className="learn-pic" aria-hidden>{c.pic}</span>}
                    <span>{c.text}</span>
                  </button>
                );
              })}
            </div>
            {!done && missed.length > 0 && <p style={{ margin: 0, fontWeight: 800 }}>Not quite. Try again! 💪</p>}
            {done && (
              <div className="stack" style={{ alignItems: 'center', gap: 8 }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: '1.25rem' }}>
                  {done === 'right' ? 'You got it! 🎉' : done === 'second' ? 'Yes! You figured it out. 💡' : `It's “${q.choices[q.answer].text}”. Now you know!`}
                </p>
                <p className="trick" style={{ margin: 0 }}>💡 {q.why}</p>
                <button className="primary big-btn" onClick={next}>{i + 1 < list.length ? 'Next ▶' : 'Finish 🌟'}</button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
