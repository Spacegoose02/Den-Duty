// Family meeting: a guided weekly sit-down, one big step at a time, made to be shown on the family tablet or a TV.
// Last week → what we said we'd do → cheers → votes and the family goal → next week → done.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type AgendaItem, type Recap, type TeamGoal } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { dayName, shortDate } from '../components/Bits.tsx';
import { TeamBar } from '../components/TeamGoals.tsx';
import { confetti } from '../components/Confetti.ts';

interface Prep {
  today: string;
  kids: { id: string; name: string; avatar: string; color: string; balance: number }[];
  recap: Recap;
  last: { heldOn: string; intentions: Record<string, string>; plans: string[] } | null;
  polls: { id: string; title: string; options: { id: string; title: string; icon: string; votes: number }[] }[];
  teamGoals: TeamGoal[];
}
interface WeekDay { date: string; items: AgendaItem[]; external?: { title: string; time?: string | null }[]; reminders?: { title: string }[]; appointments?: { memberId: string; title: string; time: string }[]; duty?: { label: string; memberId: string }[] }

const STEPS = ['👋 Hello', '📊 Last week', '🔁 What we said', '🎉 Cheers', '🗳️ Votes and goals', '📅 Next week', '✅ Wrap up'] as const;

export function Meeting() {
  const { base, home, toast } = useApp();
  const nav = useNavigate();
  const [prep] = useLoad<Prep>(`${base}/meetings/prep`);
  const [week] = useLoad<{ days: WeekDay[] }>(prep ? `${base}/agenda?start=${prep.today}&days=7` : null, [prep?.today]);
  const [step, setStep] = useState(0);
  const [cheers, setCheers] = useState<{ memberId: string; text: string; points: number }[]>([]);
  const [draft, setDraft] = useState<Record<string, { text: string; points: number }>>({});
  const [intentions, setIntentions] = useState<Record<string, string>>({});
  const [plans, setPlans] = useState<string[]>([]);
  const [plan, setPlan] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  if (!prep) return null;
  const icon = home?.pointsIcon ?? '✨';
  const kidById = new Map(prep.kids.map((k) => [k.id, k]));
  const r = prep.recap;

  const addCheer = (kidId: string) => {
    const d = draft[kidId];
    if (!d?.text.trim()) return;
    setCheers([...cheers, { memberId: kidId, text: d.text.trim(), points: d.points || 0 }]);
    setDraft({ ...draft, [kidId]: { text: '', points: d.points } });
    confetti({ colors: [kidById.get(kidId)?.color ?? '#ffd43b'], count: 60 });
  };
  const finish = async () => {
    setSaving(true);
    try {
      await api(`${base}/meetings`, { body: { cheers, intentions, plans, notes } });
      confetti({ count: 260 });
      toast('Meeting saved. Everyone\'s plan is on their board 🎉');
      nav('/');
    } catch (e) { toast((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <div className="stack meeting">
      <div className="topbar">
        <h1>🗓️ Family meeting</h1>
        <Link to="/" className="btn ghost">Close</Link>
      </div>
      <div className="meeting-steps" role="tablist">
        {STEPS.map((s, i) => <button key={s} role="tab" aria-selected={i === step} className={`chip${i === step ? ' on' : ''}`} onClick={() => setStep(i)}>{s}</button>)}
      </div>

      <section className="card stack meeting-card">
        {step === 0 && (
          <>
            <h2 style={{ margin: 0 }}>Welcome to the family meeting!</h2>
            <p className="muted" style={{ margin: 0 }}>Everyone gets a turn. We'll look back at last week, cheer each other on, and plan the week ahead.</p>
            <div className="meeting-kids">
              {prep.kids.map((k) => <div key={k.id} className="stack" style={{ alignItems: 'center' }}><RaccoonAvatar variant={k.avatar} size={96} /><strong>{k.name}</strong></div>)}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 style={{ margin: 0 }}>Last week: {r.total.done} of {r.total.due} chores done{r.total.rate != null ? ` (${r.total.rate}%)` : ''}</h2>
            <div className="meeting-kids">
              {r.kids.map((k) => (
                <div key={k.id} className="meeting-kid" style={{ borderColor: k.color, ['--kid' as string]: k.color }}>
                  <RaccoonAvatar variant={k.avatar} size={64} />
                  <strong>{k.name}</strong>
                  <span className="wall-big">{k.points}</span><span className="small muted">{icon} earned</span>
                  <span className="small">{k.done} / {k.due} chores · {k.perfectDays} perfect day{k.perfectDays === 1 ? '' : 's'}</span>
                </div>
              ))}
            </div>
            {r.highlights.length > 0 && <div><strong>🎉 Cheer about</strong>{r.highlights.map((h) => <p key={h} style={{ margin: '4px 0' }}>{h}</p>)}</div>}
            {r.workOn.length > 0 && <div><strong>🌱 Work on together</strong>{r.workOn.map((h) => <p key={h} style={{ margin: '4px 0' }}>{h}</p>)}</div>}
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={{ margin: 0 }}>What we said we'd do</h2>
            {!prep.last ? <p className="muted" style={{ margin: 0 }}>This is your first meeting. Next time, this step shows what everyone planned.</p> : (
              <>
                <p className="small muted" style={{ margin: 0 }}>From the meeting on {dayName(prep.last.heldOn)} {shortDate(prep.last.heldOn)}. How did it go?</p>
                {Object.entries(prep.last.intentions).map(([id, text]) => kidById.get(id) && (
                  <div key={id} className="row"><RaccoonAvatar variant={kidById.get(id)!.avatar} size={40} /><strong>{kidById.get(id)!.name}:</strong> <span style={{ flex: 1 }}>“{text}”</span></div>
                ))}
                {prep.last.plans.length > 0 && <div><strong>Family plans</strong><ul>{prep.last.plans.map((p) => <li key={p}>{p}</li>)}</ul></div>}
              </>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h2 style={{ margin: 0 }}>Cheers! What did everyone do great?</h2>
            <p className="small muted" style={{ margin: 0 }}>Anyone can give a cheer. Add {home?.pointsName ?? 'points'} if you like; they're paid when you save.</p>
            {prep.kids.map((k) => (
              <div key={k.id} className="stack" style={{ gap: 6 }}>
                <div className="row">
                  <RaccoonAvatar variant={k.avatar} size={40} />
                  <strong style={{ minWidth: 80 }}>{k.name}</strong>
                  <input placeholder="Helped clear the table without being asked" value={draft[k.id]?.text ?? ''} onChange={(e) => setDraft({ ...draft, [k.id]: { text: e.target.value, points: draft[k.id]?.points ?? 0 } })}
                    onKeyDown={(e) => e.key === 'Enter' && addCheer(k.id)} style={{ flex: 1, minWidth: 180 }} maxLength={140} />
                  <input type="number" min={0} max={1000} aria-label={`${home?.pointsName ?? 'Points'} for ${k.name}`} value={draft[k.id]?.points ?? 0}
                    onChange={(e) => setDraft({ ...draft, [k.id]: { text: draft[k.id]?.text ?? '', points: Number(e.target.value) } })} style={{ width: 80 }} />
                  <button onClick={() => addCheer(k.id)}>🎉 Cheer</button>
                </div>
                {cheers.filter((c) => c.memberId === k.id).map((c, i) => (
                  <div key={i} className="small" style={{ marginLeft: 52 }}>🎉 {c.text}{c.points ? ` · +${c.points} ${icon}` : ''} <button className="ghost" onClick={() => setCheers(cheers.filter((x) => x !== c))} aria-label="Remove">✕</button></div>
                ))}
              </div>
            ))}
          </>
        )}

        {step === 4 && (
          <>
            <h2 style={{ margin: 0 }}>Votes and family goals</h2>
            {prep.teamGoals.map((g) => (
              <div key={g.id} className="stack" style={{ gap: 4 }}>
                <strong>🤝 {g.icon} {g.title}</strong>
                <TeamBar goal={g} />
                <span className="small muted">{g.progress} / {g.target} together</span>
              </div>
            ))}
            {prep.polls.map((p) => (
              <div key={p.id} className="stack" style={{ gap: 4 }}>
                <strong>🗳️ {p.title}</strong>
                <div className="row">{p.options.map((o) => <span key={o.id} className="pill">{o.icon} {o.title} · {o.votes}</span>)}</div>
              </div>
            ))}
            {!prep.teamGoals.length && !prep.polls.length && <p className="muted" style={{ margin: 0 }}>No family goal or reward vote right now. <Link to="/rewards">Start one in Rewards</Link> and talk about what everyone wants to work toward.</p>}
          </>
        )}

        {step === 5 && (
          <>
            <h2 style={{ margin: 0 }}>The week ahead</h2>
            <div className="meeting-week">
              {(week?.days ?? []).map((d) => {
                const extra = [...(d.external ?? []).map((x) => `📅 ${x.title}`), ...(d.appointments ?? []).map((a) => `🩺 ${kidById.get(a.memberId)?.name ?? ''}: ${a.title}`), ...(d.reminders ?? []).map((x) => `🔔 ${x.title}`)];
                return (
                  <div key={d.date} className="meeting-day">
                    <strong>{dayName(d.date)}</strong> <span className="small muted">{shortDate(d.date)}</span>
                    <div className="small">{d.items.length} chore{d.items.length === 1 ? '' : 's'}</div>
                    {extra.slice(0, 4).map((x, i) => <div key={i} className="small">{x}</div>)}
                  </div>
                );
              })}
            </div>
            <strong>This week I'll…</strong>
            {prep.kids.map((k) => (
              <div key={k.id} className="row">
                <RaccoonAvatar variant={k.avatar} size={36} />
                <strong style={{ minWidth: 80 }}>{k.name}</strong>
                <input placeholder="Read every night before bed" value={intentions[k.id] ?? ''} onChange={(e) => setIntentions({ ...intentions, [k.id]: e.target.value })} style={{ flex: 1 }} maxLength={140} />
              </div>
            ))}
            <strong>Family plans</strong>
            <div className="row">
              <input placeholder="Zoo trip on Saturday" value={plan} onChange={(e) => setPlan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && plan.trim()) { setPlans([...plans, plan.trim()]); setPlan(''); } }} style={{ flex: 1 }} maxLength={140} />
              <button disabled={!plan.trim()} onClick={() => { setPlans([...plans, plan.trim()]); setPlan(''); }}>Add</button>
            </div>
            {plans.map((p) => <div key={p} className="small">• {p} <button className="ghost" onClick={() => setPlans(plans.filter((x) => x !== p))} aria-label="Remove">✕</button></div>)}
          </>
        )}

        {step === 6 && (
          <>
            <h2 style={{ margin: 0 }}>Great meeting! 🎉</h2>
            <p style={{ margin: 0 }}>{cheers.length} cheer{cheers.length === 1 ? '' : 's'}{cheers.some((c) => c.points) ? `, ${cheers.reduce((n, c) => n + c.points, 0)} ${icon} to hand out` : ''}, {Object.values(intentions).filter((x) => x.trim()).length} plan{Object.values(intentions).filter((x) => x.trim()).length === 1 ? '' : 's'} for the week{plans.length ? ` and ${plans.length} family plan${plans.length === 1 ? '' : 's'}` : ''}.</p>
            <textarea placeholder="Notes for next time (parents only)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            <button className="primary" style={{ alignSelf: 'flex-start', minHeight: 56 }} disabled={saving} onClick={() => void finish()}>✅ Save and finish</button>
          </>
        )}
      </section>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button disabled={step === 0} onClick={() => setStep(step - 1)}>← Back</button>
        {step < STEPS.length - 1 && <button className="primary" onClick={() => setStep(step + 1)}>Next →</button>}
      </div>
    </div>
  );
}

/** On a kid's board: what they said they'd do this week, and the cheers they got. */
export function KidMeetingNote({ memberId, color }: { memberId: string; color: string }) {
  const { base } = useApp();
  const [m] = useLoad<{ heldOn: string; intention: string | null; cheers: string[] } | null>(`${base}/kids/${memberId}/meeting`, [memberId]);
  if (!m) return null;
  return (
    <div className="den-note" style={{ borderColor: color }}>
      <span style={{ fontSize: '1.8rem' }} aria-hidden>🗓️</span>
      <span style={{ flex: 1 }}>
        {m.intention && <>This week I'll: <strong>{m.intention}</strong></>}
        {m.cheers.map((c) => <span key={c} style={{ display: 'block' }}>🎉 {c}</span>)}
      </span>
    </div>
  );
}
