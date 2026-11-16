// Math facts helper on a kid's board: today's "remember cards" (gentle spaced review, no timer), and any fact shown
// several different ways (a memory trick, groups, an array, hops on a number line, breaking it apart, its fact family, a
// story, or Rocky explaining it another way). Parents set the tables and see which facts are tricky and which ways help.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { Modal, ProgressBar, dayName } from './Bits.tsx';
import { RaccoonAvatar } from './Raccoon.tsx';
import { confetti } from './Confetti.ts';
import { SpeakButton, speak } from './Speak.tsx';
import {
  MAX_TABLE, REMEMBERED_BOX, WAYS, answerOf, factKey, factText, familyOf, familySentences, parseFact, splitFor, storyFor, thingFor, trickFor,
  type Fact, type MathPlan, type Op, type Way,
} from '../../../shared/mathfacts.ts';

interface MathView {
  today: string; plan: MathPlan | null; review: Fact[]; answeredToday: number; rightToday: number; paidToday: boolean;
  facts: { fact: string; box: number | null; right: number; wrong: number }[]; remembered: number; total: number;
  tricky: { fact: string; wrong: number; right: number; box: number }[];
  week: { recalled: number; right: number; explored: number; days: number };
  daily: { date: string; recalled: number; right: number; explored: number }[];
  helped: { way: string; n: number }[]; ai: boolean;
}

const wayOf = (id: string) => WAYS.find((w) => w.id === id);
const fk = (key: string) => parseFact(key)!;

export function KidMath({ memberId, kidName, color, asParent, readAloud }: { memberId: string; kidName: string; color: string; asParent: boolean; readAloud: boolean }) {
  const { base, home } = useApp();
  const [view, reload] = useLoad<MathView | null>(`${base}/kids/${memberId}/math`, [memberId]);
  const [mode, setMode] = useState<'recall' | 'pick' | 'plan' | null>(null);
  const [exploring, setExploring] = useState<Fact | null>(null);
  if (!view) return null;
  if (!view.plan) {
    if (!asParent) return null;
    return (
      <section className="card stack pg-math">
        <h2 style={{ margin: 0 }}>🧮 Math facts helper</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Help {kidName} understand and remember multiplication and division facts: every fact shown different ways (groups, arrays, hops,
          memory tricks, stories), and a few gentle “remember cards” a day that bring back the facts they miss. No timers.
        </p>
        <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={() => setMode('plan')}>Set it up for {kidName}</button>
        {mode === 'plan' && <PlanForm memberId={memberId} plan={null} onClose={() => setMode(null)} onDone={() => { setMode(null); void reload(); }} />}
      </section>
    );
  }
  const left = view.review.length;
  const icon = home?.pointsIcon ?? '✨';
  return (
    <section className="card stack pg-math math-card">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>🧮 {asParent ? 'Math facts' : 'My math facts'} {readAloud && !asParent && <SpeakButton text={left ? `You have ${left} remember cards today.` : 'All your remember cards are done today!'} />}</h2>
        {asParent && <button className="ghost" onClick={() => setMode('plan')} aria-label="Math facts settings">⚙️</button>}
      </div>
      <div className="math-actions">
        <button className="help-pick" disabled={!left} onClick={() => setMode('recall')}>
          <span className="help-pick-icon">🧠</span>
          {left ? `Remember cards (${left})` : 'Cards done today ✓'}
          <span className="small muted">{left ? 'No timer. Take your time.' : `${view.rightToday} of ${view.answeredToday} remembered`}</span>
        </button>
        <button className="help-pick" onClick={() => setMode('pick')}>
          <span className="help-pick-icon">🔍</span>
          See a fact different ways
          <span className="small muted">Groups, arrays, hops, tricks…</span>
        </button>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <div className="row small" style={{ justifyContent: 'space-between' }}>
          <strong>🌳 Remembered {view.remembered} of {view.total} facts</strong>
          {view.plan.points > 0 && <span className="muted">{view.paidToday ? `+${view.plan.points} ${icon} today ✓` : `+${view.plan.points} ${icon} a day`}</span>}
        </div>
        <ProgressBar percent={view.total ? (view.remembered / view.total) * 100 : 0} color={color} />
      </div>
      {view.tricky.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small muted">{asParent ? 'Tricky facts (missed most)' : 'Facts to look at again. Tap one to see it a new way:'}</span>
          <div className="row" style={{ gap: 6 }}>
            {view.tricky.slice(0, asParent ? 12 : 6).map((t) => (
              <button key={t.fact} className="chip tricky-chip" onClick={() => setExploring(fk(t.fact))}>
                {factText(fk(t.fact))}{asParent && <span className="small muted"> · missed {t.wrong}, got {t.right}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      <FactGarden view={view} onPick={setExploring} />
      {asParent && <MathStats view={view} kidName={kidName} color={color} />}
      {mode === 'recall' && <RecallPlayer memberId={memberId} cards={view.review} color={color} readAloud={readAloud} onClose={() => { setMode(null); void reload(); }} />}
      {mode === 'pick' && <FactPicker view={view} onPick={(f) => { setMode(null); setExploring(f); }} onClose={() => setMode(null)} />}
      {mode === 'plan' && <PlanForm memberId={memberId} plan={view.plan} onClose={() => setMode(null)} onDone={() => { setMode(null); void reload(); }} />}
      {exploring && <FactExplorer memberId={memberId} fact={exploring} kidName={kidName} color={color} ai={view.ai} readAloud={readAloud} onClose={() => { setExploring(null); void reload(); }} />}
    </section>
  );
}

/** The multiplication table for the plan, each fact a seed, sprout or tree by how well it's remembered. */
function FactGarden({ view, onPick }: { view: MathView; onPick: (f: Fact) => void }) {
  const plan = view.plan!;
  const byKey = new Map(view.facts.map((f) => [f.fact, f]));
  const cols = Array.from({ length: plan.upTo }, (_, i) => i + 1);
  // A cell is as strong as the shakiest of its × and ÷ facts.
  const cell = (t: number, n: number) => {
    const keys = [`${t}x${n}`, ...(t ? [`${t * n}/${t}`] : [])].map((k) => byKey.get(k)).filter((x): x is NonNullable<typeof x> => !!x);
    const seen = keys.filter((k) => k.box != null);
    if (!seen.length) return { mark: '', cls: 'new' };
    const box = Math.min(...seen.map((k) => k.box!));
    if (box >= REMEMBERED_BOX) return { mark: '🌳', cls: 'known' };
    if (box >= 1) return { mark: '🌿', cls: 'growing' };
    return { mark: '🌱', cls: 'seed' };
  };
  return (
    <details className="fact-garden">
      <summary className="small"><strong>🌱 My fact garden</strong> <span className="muted">🌱 just planted · 🌿 growing · 🌳 remembered</span></summary>
      <div className="garden-grid" style={{ gridTemplateColumns: `auto repeat(${cols.length}, minmax(0, 1fr))` }}>
        <span className="garden-head">×</span>
        {cols.map((n) => <span key={n} className="garden-head">{n}</span>)}
        {plan.tables.map((t) => (
          <FragmentRow key={t} t={t} cols={cols} cell={cell} onPick={onPick} />
        ))}
      </div>
    </details>
  );
}
function FragmentRow({ t, cols, cell, onPick }: { t: number; cols: number[]; cell: (t: number, n: number) => { mark: string; cls: string }; onPick: (f: Fact) => void }) {
  return (
    <>
      <span className="garden-head">{t}</span>
      {cols.map((n) => {
        const c = cell(t, n);
        return <button key={n} className={`garden-cell ${c.cls}`} onClick={() => onPick({ op: 'x', a: t, b: n })} title={`${t} × ${n} = ${t * n}`}>{c.mark || t * n}</button>;
      })}
    </>
  );
}

function MathStats({ view, kidName, color }: { view: MathView; kidName: string; color: string }) {
  const max = Math.max(1, ...view.helped.map((h) => h.n));
  const pct = view.week.recalled ? Math.round((view.week.right / view.week.recalled) * 100) : null;
  const days = view.daily.slice(-14);
  const maxDay = Math.max(1, ...days.map((d) => d.recalled + d.explored));
  return (
    <div className="stack math-stats">
      <div className="stats">
        <div><span className="num">{view.week.days}</span><span className="small muted">days this week</span></div>
        <div><span className="num">{view.week.recalled}</span><span className="small muted">cards answered</span></div>
        <div><span className="num">{pct == null ? '–' : `${pct}%`}</span><span className="small muted">remembered</span></div>
        <div><span className="num">{view.week.explored}</span><span className="small muted">facts explored</span></div>
      </div>
      {days.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="small muted">Last two weeks (answered and explored)</span>
          <div className="math-bars" role="img" aria-label="Math practice per day">
            {days.map((d) => (
              <span key={d.date} title={`${dayName(d.date)}: ${d.right}/${d.recalled} remembered, ${d.explored} explored`} className="math-bar">
                <span style={{ height: `${((d.recalled + d.explored) / maxDay) * 100}%`, background: color }} />
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="stack" style={{ gap: 4 }}>
        <span className="small"><strong>What helps {kidName}</strong> <span className="muted">(the way they picked when a fact clicked)</span></span>
        {!view.helped.length && <span className="small muted">Nothing yet. After {kidName} explores a fact, they tap which way helped.</span>}
        {view.helped.map((h) => (
          <div key={h.way} className="row small" style={{ flexWrap: 'nowrap' }}>
            <span style={{ width: 150 }}>{wayOf(h.way)?.icon} {wayOf(h.way)?.label ?? h.way}</span>
            <span style={{ flex: 1 }}><ProgressBar percent={(h.n / max) * 100} color={color} /></span>
            <strong style={{ width: 28, textAlign: 'right' }}>{h.n}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanForm({ memberId, plan, onClose, onDone }: { memberId: string; plan: MathPlan | null; onClose: () => void; onDone: () => void }) {
  const { base, toast, home } = useApp();
  const [p, setP] = useState<MathPlan>(plan ?? { tables: [2, 3, 4, 5, 6, 7, 8, 9], ops: ['x', '/'], upTo: 10, perDay: 8, points: 2 });
  const save = async (off = false) => {
    try { await api(`${base}/kids/${memberId}/math/plan`, { method: 'PUT', body: off ? { off: true } : p }); onDone(); } catch (e) { toast((e as Error).message); }
  };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <Modal onClose={onClose}>
      <div className="stack">
        <h2 style={{ margin: 0 }}>🧮 Math facts</h2>
        <span className="small"><strong>Tables they're working on</strong></span>
        <div className="row" style={{ gap: 6 }}>
          {Array.from({ length: MAX_TABLE + 1 }, (_, n) => n).map((n) => (
            <button key={n} type="button" className={`chip${p.tables.includes(n) ? ' on' : ''}`} onClick={() => setP({ ...p, tables: toggle(p.tables, n).sort((a, b) => a - b) })}>{n}s</button>
          ))}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className={`chip${p.ops.includes('x') ? ' on' : ''}`} onClick={() => setP({ ...p, ops: toggle(p.ops, 'x' as Op) })}>× Multiplication</button>
          <button type="button" className={`chip${p.ops.includes('/') ? ' on' : ''}`} onClick={() => setP({ ...p, ops: toggle(p.ops, '/' as Op) })}>÷ Division</button>
          <button type="button" className={`chip${p.upTo === 12 ? ' on' : ''}`} onClick={() => setP({ ...p, upTo: p.upTo === 12 ? 10 : 12 })}>Up to × 12</button>
        </div>
        <label className="row">Remember cards a day <input type="number" min={3} max={20} value={p.perDay} onChange={(e) => setP({ ...p, perDay: Number(e.target.value) })} style={{ width: 80 }} /></label>
        <label className="row">{home?.pointsName ?? 'Points'} a day for doing them <input type="number" min={0} max={100} value={p.points} onChange={(e) => setP({ ...p, points: Number(e.target.value) })} style={{ width: 80 }} /></label>
        <p className="small muted" style={{ margin: 0 }}>Facts they miss come back tomorrow with a memory trick; facts they know come back after 1, 3, 7, 14 and 30 days. At most 4 new facts a day. Points come once a day, after 3 cards or one fact explored.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {plan && <button className="ghost danger" onClick={() => void save(true)}>Turn off</button>}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!p.tables.length || !p.ops.length} onClick={() => void save()}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function FactPicker({ view, onPick, onClose }: { view: MathView; onPick: (f: Fact) => void; onClose: () => void }) {
  const plan = view.plan!;
  const [op, setOp] = useState<Op>(plan.ops[0]);
  const tricky = new Set(view.tricky.map((t) => t.fact));
  const facts = plan.tables.flatMap((t) => Array.from({ length: plan.upTo }, (_, i) => (op === 'x' ? { op, a: t, b: i + 1 } : { op, a: t * (i + 1), b: t }) as Fact)).filter((f) => op === 'x' || f.b > 0);
  return (
    <Modal onClose={onClose} wide>
      <div className="stack">
        <div className="row">
          <h2 style={{ margin: 0, flex: 1 }}>🔍 Pick a fact</h2>
          {plan.ops.length > 1 && (
            <div className="seg" role="group" aria-label="Times or divide">
              <button className={op === 'x' ? 'on' : ''} onClick={() => setOp('x')}>× Times</button>
              <button className={op === '/' ? 'on' : ''} onClick={() => setOp('/')}>÷ Divide</button>
            </div>
          )}
          <button className="primary" onClick={() => onPick(facts[Math.floor(Math.random() * facts.length)])}>🎲 Surprise me</button>
        </div>
        {plan.tables.map((t) => (
          <div key={t} className="row" style={{ gap: 6 }}>
            {facts.filter((f) => (op === 'x' ? f.a === t : f.b === t)).map((f) => (
              <button key={factKey(f)} className={`chip fact-chip${tricky.has(factKey(f)) ? ' tricky-chip' : ''}`} onClick={() => onPick(f)}>{factText(f)}</button>
            ))}
          </div>
        ))}
        <p className="small muted" style={{ margin: 0 }}>🟠 = a fact to look at again.</p>
      </div>
    </Modal>
  );
}

// ---------- remember cards ----------

function RecallPlayer({ memberId, cards, color, readAloud, onClose }: { memberId: string; cards: Fact[]; color: string; readAloud: boolean; onClose: () => void }) {
  const { base, toast, home } = useApp();
  const [list] = useState(cards);
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState('');
  const [hinted, setHinted] = useState(false);
  const [phase, setPhase] = useState<'ask' | 'right' | 'wrong' | 'end'>('ask');
  const [score, setScore] = useState(0);
  const [busy, setBusy] = useState(false);
  const f = list[i];
  useEffect(() => { if (f && readAloud) speak(`What is ${factText(f).replace('×', 'times').replace('÷', 'divided by')}?`); }, [f, readAloud]);
  if (!f) return null;
  const ans = answerOf(f);
  const check = async () => {
    if (!typed) return;
    const right = Number(typed) === ans;
    const result = right ? (hinted ? 'hint' : 'right') : 'wrong';
    setBusy(true);
    try {
      // A miss only counts the first time; after seeing the answer they type it in to lock it in.
      if (phase === 'ask') await api(`${base}/kids/${memberId}/math/answer`, { body: { fact: factKey(f), result } });
      if (right) { setScore((s) => s + (result === 'right' && phase === 'ask' ? 1 : 0)); setPhase('right'); confetti({ colors: [color], count: 40 }); }
      else setPhase('wrong');
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const next = async () => {
    setTyped(''); setHinted(false);
    if (i + 1 < list.length) { setI(i + 1); setPhase('ask'); return; }
    setPhase('end');
    try {
      const r = await api<{ paid: number }>(`${base}/kids/${memberId}/math/finish`, { body: {} });
      confetti({ colors: [color, '#ffd43b'], count: 200 });
      if (r.paid) toast(`+${r.paid} ${home?.pointsIcon ?? '✨'} for your math facts!`);
    } catch { /* points can wait */ }
  };
  const tricks = trickFor(f);
  return (
    <Modal onClose={onClose} wide>
      <div className="stack recall" style={{ alignItems: 'center', textAlign: 'center' }}>
        {phase === 'end' ? (
          <>
            <div style={{ fontSize: '4rem' }} aria-hidden>🌟</div>
            <h2 style={{ margin: 0 }}>All done for today!</h2>
            <p style={{ margin: 0 }}>You remembered {score} of {list.length} on the first try. The ones you missed will come back tomorrow, with a trick to help.</p>
            <button className="primary" onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            <div className="small muted">Card {i + 1} of {list.length} · no timer, take your time</div>
            <div className="recall-fact">{factText(f)} = <span className={`recall-answer ${phase}`}>{phase === 'wrong' && !typed ? '?' : typed || '?'}</span></div>
            {phase === 'ask' && hinted && <TrickList tricks={tricks.slice(0, 2)} />}
            {phase === 'wrong' && (
              <div className="stack" style={{ alignItems: 'center' }}>
                <p style={{ margin: 0 }}><strong>It's {ans}.</strong> That's OK, now you'll see it again tomorrow. Here's a way to remember:</p>
                <TrickList tricks={tricks.slice(0, 1)} />
                <MiniArray fact={f} color={color} />
                <p className="small muted" style={{ margin: 0 }}>Type {ans} to lock it in.</p>
              </div>
            )}
            {phase === 'right' && <p style={{ margin: 0, fontWeight: 800, fontSize: '1.3rem' }}>{hinted ? 'Yes! The trick worked. 💡' : 'You remembered! 🎉'}</p>}
            {phase === 'right'
              ? <button className="primary big-btn" onClick={() => void next()}>{i + 1 < list.length ? 'Next card ▶' : 'Finish 🌟'}</button>
              : (
                <>
                  <NumberPad value={typed} onChange={setTyped} onEnter={() => void check()} />
                  <div className="row" style={{ justifyContent: 'center' }}>
                    {phase === 'ask' && !hinted && <button onClick={() => setHinted(true)}>💡 Give me a hint</button>}
                    <button className="primary big-btn" disabled={busy || !typed} onClick={() => void check()}>Check ✓</button>
                  </div>
                </>
              )}
          </>
        )}
      </div>
    </Modal>
  );
}

function NumberPad({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) onChange((value + e.key).slice(0, 3));
      else if (e.key === 'Backspace') onChange(value.slice(0, -1));
      else if (e.key === 'Enter') onEnter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [value, onChange, onEnter]);
  return (
    <div className="pin-pad math-pad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" onClick={() => onChange((value + d).slice(0, 3))}>{d}</button>)}
      <button type="button" className="ghost" onClick={() => onChange('')} aria-label="Clear">✕</button>
      <button type="button" onClick={() => onChange((value + '0').slice(0, 3))}>0</button>
      <button type="button" className="ghost" onClick={() => onChange(value.slice(0, -1))} aria-label="Back">⌫</button>
    </div>
  );
}

function TrickList({ tricks }: { tricks: ReturnType<typeof trickFor> }) {
  return (
    <div className="stack trick-list">
      {tricks.map((t) => (
        <div key={t.title} className="trick">
          <span className="trick-icon" aria-hidden>{t.icon}</span>
          <div>
            <strong>{t.title}</strong>
            {t.lines.map((l) => <div key={l}>{l}</div>)}
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniArray({ fact, color }: { fact: Fact; color: string }) {
  const { x, y } = familyOf(fact);
  return (
    <div className="mini-array" style={{ gridTemplateColumns: `repeat(${y}, 14px)` }} aria-label={`${x} rows of ${y}`}>
      {Array.from({ length: x * y }, (_, n) => <span key={n} style={{ background: color }} />)}
    </div>
  );
}

// ---------- see it different ways ----------

function FactExplorer({ memberId, fact, kidName, color, ai, readAloud, onClose }: {
  memberId: string; fact: Fact; kidName: string; color: string; ai: boolean; readAloud: boolean; onClose: () => void;
}) {
  const { base, toast, home } = useApp();
  const ways = WAYS.filter((w) => w.id !== 'ask' || ai);
  const [way, setWay] = useState<Way>('trick');
  const [seen, setSeen] = useState<Way[]>(['trick']);
  const [show, setShow] = useState(false);
  const [saying, setSaying] = useState(false);
  const pick = (w: Way) => { setWay(w); setSeen((s) => (s.includes(w) ? s : [...s, w])); };
  const ans = answerOf(fact);
  const feel = async (f: 'got' | 'tricky') => {
    setSaying(true);
    try {
      await api(`${base}/kids/${memberId}/math/explore`, { body: { fact: factKey(fact), way: f === 'got' ? way : null, feel: f } });
      const r = await api<{ paid: number }>(`${base}/kids/${memberId}/math/finish`, { body: {} });
      if (f === 'got') confetti({ colors: [color], count: 120 });
      toast(f === 'got' ? `Nice thinking!${r.paid ? ` +${r.paid} ${home?.pointsIcon ?? '✨'}` : ''}` : "That's OK! It'll come back tomorrow so you can see it again.");
      onClose();
    } catch (e) { toast((e as Error).message); setSaying(false); }
  };
  return (
    <Modal onClose={onClose} wide>
      <div className="stack explorer">
        <div className="row" style={{ justifyContent: 'center' }}>
          <div className="recall-fact">{factText(fact)} = <button className={`answer-peek${show ? ' shown' : ''}`} onClick={() => setShow(!show)} aria-label={show ? 'Hide the answer' : 'Show the answer'}>{show ? ans : '?'}</button></div>
          {readAloud && <SpeakButton text={`${factText(fact).replace('×', 'times').replace('÷', 'divided by')} equals ${ans}`} />}
        </div>
        <div className="way-tabs" role="tablist">
          {ways.map((w) => (
            <button key={w.id} role="tab" aria-selected={way === w.id} className={`way-tab${way === w.id ? ' on' : ''}${seen.includes(w.id) ? ' seen' : ''}`} onClick={() => pick(w.id)}>
              <span aria-hidden>{w.icon}</span>{w.label}
            </button>
          ))}
        </div>
        <div className="way-body">
          {way === 'trick' && <TrickList tricks={trickFor(fact)} />}
          {way === 'groups' && <GroupsWay fact={fact} color={color} />}
          {way === 'array' && <ArrayWay fact={fact} color={color} />}
          {way === 'hops' && <HopsWay fact={fact} color={color} />}
          {way === 'split' && <SplitWay fact={fact} color={color} />}
          {way === 'family' && <FamilyWay fact={fact} color={color} />}
          {way === 'story' && <StoryWay fact={fact} kidName={kidName} />}
          {way === 'ask' && <AskRocky memberId={memberId} fact={fact} tried={seen.filter((w) => w !== 'ask')} />}
        </div>
        <div className="explore-feel">
          <span style={{ fontWeight: 800 }}>Did that help it click?</span>
          <span className="small muted">Try another way any time. When one makes sense, tap 👍 on that way.</span>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button disabled={saying} onClick={() => void feel('tricky')}>🤔 Still tricky</button>
            <button className="primary" disabled={saying} onClick={() => void feel('got')}>👍 I get it! ({wayOf(way)?.label})</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function GroupsWay({ fact, color }: { fact: Fact; color: string }) {
  const thing = thingFor(fact);
  const { x, y, product } = familyOf(fact);
  // Division as sharing: deal the things out one round at a time.
  const groups = fact.op === 'x' ? x : fact.b;
  const [dealt, setDealt] = useState(fact.op === 'x' ? product : 0);
  useEffect(() => setDealt(fact.op === 'x' ? product : 0), [fact, product]);
  const per = (g: number) => Math.floor(dealt / groups) + (g < dealt % groups ? 1 : 0);
  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <p style={{ margin: 0, textAlign: 'center' }}>
        {fact.op === 'x'
          ? <><strong>{x} {thing.boxes}</strong> with <strong>{y} {thing.many}</strong> in each. Count them all: <strong>{product}</strong>.</>
          : <>Share <strong>{product} {thing.many}</strong> equally into <strong>{fact.b} {thing.boxes}</strong>. How many in each?</>}
      </p>
      <div className="groups">
        {Array.from({ length: groups }, (_, g) => (
          <div key={g} className="group" style={{ borderColor: color }}>
            <div className="group-things">{Array.from({ length: per(g) }, (_, n) => <span key={n}>{thing.icon}</span>)}</div>
            {fact.op === '/' && <span className="small muted">{per(g)}</span>}
          </div>
        ))}
      </div>
      {fact.op === '/' && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <span className="small">Left to share: {product - dealt} {thing.icon}</span>
          {dealt < product
            ? <button className="primary" onClick={() => setDealt(Math.min(product, dealt + groups))}>Give one to each {thing.box} ▶</button>
            : <strong>Each {thing.box} got {y}! So {product} ÷ {fact.b} = {y}.</strong>}
          {dealt > 0 && <button className="ghost" onClick={() => setDealt(0)}>↺</button>}
        </div>
      )}
      {fact.op === 'x' && <p className="small muted" style={{ margin: 0 }}>Skip count the {thing.boxes}: {Array.from({ length: x }, (_, i) => (i + 1) * y).join(', ')}.</p>}
    </div>
  );
}

function ArrayWay({ fact, color }: { fact: Fact; color: string }) {
  const fam = familyOf(fact);
  const [turned, setTurned] = useState(false);
  const rows = fact.op === '/' ? fam.y : turned ? fam.y : fam.x;
  const cols = fact.op === '/' ? fact.b : turned ? fam.x : fam.y;
  const [lit, setLit] = useState(fact.op === '/' ? 0 : rows);
  useEffect(() => setLit(fact.op === '/' ? 0 : rows), [fact, rows]);
  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <p style={{ margin: 0, textAlign: 'center' }}>
        {fact.op === 'x'
          ? <><strong>{rows} rows</strong> of <strong>{cols}</strong>. The numbers at the end count by {cols}s.</>
          : <>Line up <strong>{fam.product} dots</strong> in rows of <strong>{fact.b}</strong>. How many rows?</>}
      </p>
      <div className="array-wrap">
        <div className="array" style={{ gridTemplateColumns: `repeat(${cols}, var(--dot))` }}>
          {Array.from({ length: rows * cols }, (_, n) => <span key={n} className={Math.floor(n / cols) < lit ? 'on' : ''} style={Math.floor(n / cols) < lit ? { background: color } : undefined} />)}
        </div>
        <div className="array-counts">{Array.from({ length: rows }, (_, r) => <span key={r} className={r < lit ? '' : 'faded'}>{(r + 1) * cols}</span>)}</div>
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        {fact.op === 'x' && fam.x !== fam.y && <button onClick={() => setTurned(!turned)}>🔄 Turn it</button>}
        {fact.op === 'x' && fam.x !== fam.y && <span className="small muted">Same dots either way: {fam.x} × {fam.y} = {fam.y} × {fam.x} = {fam.product}.</span>}
        {fact.op === '/' && (lit < rows
          ? <button className="primary" onClick={() => setLit(lit + 1)}>Make a row of {fact.b} ▶</button>
          : <strong>{rows} rows! {fam.product} ÷ {fact.b} = {rows}.</strong>)}
        {fact.op === '/' && lit > 0 && <button className="ghost" onClick={() => setLit(0)}>↺</button>}
      </div>
    </div>
  );
}

function HopsWay({ fact, color }: { fact: Fact; color: string }) {
  const { product } = familyOf(fact);
  const size = fact.op === 'x' ? familyOf(fact).y : fact.b;
  const total = fact.op === 'x' ? familyOf(fact).x : product / fact.b;
  const [hops, setHops] = useState(0);
  useEffect(() => setHops(0), [fact]);
  const W = 640, pad = 24, end = Math.max(product, size), scale = (W - pad * 2) / end;
  const px = (v: number) => pad + v * scale;
  const ticks = end <= 40 ? Array.from({ length: end + 1 }, (_, i) => i) : Array.from({ length: Math.floor(end / size) + 1 }, (_, i) => i * size);
  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <p style={{ margin: 0, textAlign: 'center' }}>
        {fact.op === 'x' ? <>🐸 The frog hops <strong>{size}</strong> at a time. Where does it land after <strong>{total} hops</strong>?</>
          : <>🐸 The frog hops <strong>{size}</strong> at a time. How many hops to reach <strong>{product}</strong>?</>}
      </p>
      <svg viewBox={`0 0 ${W} 110`} className="hops" role="img" aria-label={`Hops of ${size} on a number line`}>
        <line x1={pad} x2={W - pad} y1={80} y2={80} stroke="currentColor" strokeWidth={2} />
        {ticks.map((t) => <g key={t}><line x1={px(t)} x2={px(t)} y1={74} y2={86} stroke="currentColor" opacity={t % size === 0 ? 1 : 0.35} />
          {(t % size === 0 || end <= 20) && <text x={px(t)} y={104} textAnchor="middle" fontSize={13} fill="currentColor" fontWeight={t % size === 0 && t / size <= hops && t > 0 ? 800 : 400}>{t}</text>}</g>)}
        {Array.from({ length: hops }, (_, h) => {
          const a = px(h * size), b = px((h + 1) * size), mid = (a + b) / 2;
          return <g key={h}><path d={`M ${a} 78 Q ${mid} ${20} ${b} 78`} fill="none" stroke={color} strokeWidth={3} />
            <text x={mid} y={36} textAnchor="middle" fontSize={12} fill={color} fontWeight={800}>+{size}</text></g>;
        })}
        <text x={px(hops * size)} y={70} textAnchor="middle" fontSize={20}>🐸</text>
      </svg>
      <div className="row" style={{ justifyContent: 'center' }}>
        <span className="small">Hops: <strong>{hops}</strong> · Landed on <strong>{hops * size}</strong></span>
        {hops < total ? <button className="primary" onClick={() => setHops(hops + 1)}>Hop! +{size}</button>
          : <strong>{fact.op === 'x' ? `${total} hops of ${size} = ${product}` : `${total} hops! ${product} ÷ ${size} = ${total}`}</strong>}
        {hops > 0 && <button className="ghost" onClick={() => setHops(0)}>↺</button>}
      </div>
    </div>
  );
}

function SplitWay({ fact, color }: { fact: Fact; color: string }) {
  const s = splitFor(fact);
  const [p1, p2] = s.parts;
  const other = '#f59f00';
  const rowsA = s.minus ? s.big : p1;
  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <p style={{ margin: 0, textAlign: 'center' }}>
        {s.minus
          ? <>9 is close to 10. Do <strong>10 × {s.small}</strong>, then take away one {s.small}.</>
          : p2 ? <>Break <strong>{s.big}</strong> into <strong>{p1} + {p2}</strong>: two facts that are easier.</> : <>This one is already small. Count the rows!</>}
      </p>
      <div className="array" style={{ gridTemplateColumns: `repeat(${s.small}, var(--dot))` }}>
        {Array.from({ length: (s.minus ? p1 : s.big) * s.small }, (_, n) => {
          const row = Math.floor(n / s.small);
          const second = s.minus ? row >= rowsA : row >= p1;
          return <span key={n} className={`on${s.minus && second ? ' crossed' : ''}`} style={{ background: second ? other : color }} />;
        })}
      </div>
      <div className="split-eq">
        {s.minus ? (
          <><span style={{ color }}>10 × {s.small} = {10 * s.small}</span> <span>−</span> <span style={{ color: other }}>1 × {s.small} = {s.small}</span> <span>→</span> <strong>{9 * s.small}</strong></>
        ) : p2 ? (
          <><span style={{ color }}>{p1} × {s.small} = {p1 * s.small}</span> <span>+</span> <span style={{ color: other }}>{p2} × {s.small} = {p2 * s.small}</span> <span>→</span> <strong>{s.big * s.small}</strong></>
        ) : <strong>{s.big} × {s.small} = {s.big * s.small}</strong>}
      </div>
      {fact.op === '/' && <p className="small muted" style={{ margin: 0 }}>So {fact.a} ÷ {fact.b} = {answerOf(fact)}, because {fact.b} × {answerOf(fact)} = {fact.a}.</p>}
    </div>
  );
}

function FamilyWay({ fact, color }: { fact: Fact; color: string }) {
  const { x, y, product } = familyOf(fact);
  const sentences = familySentences(fact);
  const [shown, setShown] = useState(1);
  useEffect(() => setShown(1), [fact]);
  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      <p style={{ margin: 0, textAlign: 'center' }}>Three numbers that always go together. Know one fact, and you know the whole family!</p>
      <svg viewBox="0 0 220 180" className="family-tri" role="img" aria-label={`Fact family: ${x}, ${y} and ${product}`}>
        <polygon points="110,12 206,168 14,168" fill={`${color}22`} stroke={color} strokeWidth={4} strokeLinejoin="round" />
        <text x={110} y={78} textAnchor="middle" fontSize={34} fontWeight={900} fill="currentColor">{product}</text>
        <text x={62} y={150} textAnchor="middle" fontSize={30} fontWeight={800} fill="currentColor">{x}</text>
        <text x={158} y={150} textAnchor="middle" fontSize={30} fontWeight={800} fill="currentColor">{y}</text>
        <text x={110} y={150} textAnchor="middle" fontSize={20} fill="currentColor" opacity={0.6}>× ÷</text>
      </svg>
      <div className="stack" style={{ gap: 4, alignItems: 'center' }}>
        {sentences.slice(0, shown).map((s) => <div key={s} className="family-line">{s}</div>)}
        {shown < sentences.length && <button className="primary" onClick={() => setShown(shown + 1)}>Show the next one ▶</button>}
      </div>
      {fact.op === '/' && <p className="small muted" style={{ margin: 0 }}>Dividing is multiplying backwards: {fact.a} ÷ {fact.b} asks “{fact.b} times what makes {fact.a}?”</p>}
    </div>
  );
}

function StoryWay({ fact, kidName }: { fact: Fact; kidName: string }) {
  const [salt, setSalt] = useState(0);
  const [show, setShow] = useState(false);
  const s = useMemo(() => storyFor(fact, kidName, String(salt)), [fact, kidName, salt]);
  const { x, y } = familyOf(fact);
  return (
    <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
      <div style={{ fontSize: '2.6rem' }} aria-hidden>{s.thing.icon}</div>
      <p style={{ margin: 0, fontSize: '1.15rem' }}>{s.text}</p>
      <p style={{ margin: 0, fontWeight: 800, fontSize: '1.15rem' }}>{s.question}</p>
      <div className="story-pic" aria-hidden>
        {Array.from({ length: fact.op === 'x' ? x : y }, (_, g) => <span key={g}>{s.thing.icon.repeat(fact.op === 'x' ? y : fact.b)}</span>)}
      </div>
      {show ? <p style={{ margin: 0 }}><strong>{s.answer}</strong></p> : <button className="primary" onClick={() => setShow(true)}>Show the answer</button>}
      <button className="ghost" onClick={() => { setSalt(salt + 1); setShow(false); }}>📖 Another story</button>
    </div>
  );
}

function AskRocky({ memberId, fact, tried }: { memberId: string; fact: Fact; tried: Way[] }) {
  const { base } = useApp();
  const [r, setR] = useState<{ explanation: string[]; picture: string; memoryHook: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    setBusy(true); setErr(null);
    try { setR(await api(`${base}/kids/${memberId}/math/explain`, { body: { fact: factKey(fact), tried } })); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
      <RaccoonAvatar variant="classic" size={72} />
      {!r && <p style={{ margin: 0 }}>Rocky can explain {factText(fact)} a brand-new way, different from the ones you've seen.</p>}
      {r && (
        <div className="stack rocky-says">
          {r.explanation.map((l) => <p key={l} style={{ margin: 0 }}>{l}</p>)}
          {r.picture && <div className="rocky-pic">{r.picture}</div>}
          {r.memoryHook && <p style={{ margin: 0 }}><strong>💡 {r.memoryHook}</strong></p>}
        </div>
      )}
      {err && <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>}
      <button className="primary" disabled={busy} onClick={() => void ask()}>{busy ? 'Rocky is thinking…' : r ? '🦝 Another way, please' : '🦝 Explain it another way'}</button>
    </div>
  );
}

