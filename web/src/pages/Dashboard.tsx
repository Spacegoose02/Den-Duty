import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type QuickReward, type ReviewItem, type Summary } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { Modal, ProgressBar, dayName, shortDate } from '../components/Bits.tsx';
import { KIND_ICONS, whenText } from './Doctors.tsx';
import { IdeasButton } from '../components/Ideas.tsx';
import { TodaysTipsCard } from '../components/TherapyHelper.tsx';
import { TimeoutCard, TimeoutForm } from '../components/Timeouts.tsx';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function Dashboard() {
  const { who, home, base, toast } = useApp();
  const [queue, reloadQueue] = useLoad<ReviewItem[]>(`${base}/review`);
  const [summary, reloadSummary] = useLoad<Summary>(`${base}/summary`);
  const [quick] = useLoad<QuickReward[]>(`${base}/quick-rewards`);
  const [appointments] = useLoad<{ id: string; kind: string; title: string; provider: string | null; startsAt: string; kidName: string; kidAvatar: string }[]>(`${base}/therapy/upcoming`);
  const [penalty, setPenalty] = useState<{ id: string; name: string; points: number; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [timeoutFor, setTimeoutFor] = useState<{ id: string; name: string } | null>(null);
  const icon = home?.pointsIcon ?? '✨';

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
    await Promise.all([reloadQueue(), reloadSummary()]);
  }
  const approve = (i: ReviewItem) => act(async () => {
    const r = await api<{ awarded: number }>(`${base}/instances/${i.id}/approve`, { body: {} });
    toast(`${i.kid.name}: +${r.awarded} ${icon}`);
  });
  const reject = (i: ReviewItem) => {
    const note = prompt(`What should ${i.kid.name} fix? (optional)`, '');
    if (note === null) return;
    void act(() => api(`${base}/instances/${i.id}/reject`, { body: { note } }));
  };
  const approveAll = () => act(async () => {
    const r = await api<{ awarded: number }>(`${base}/review/approve`, { body: { ids: queue!.map((i) => i.id) } });
    toast(`Approved everything: ${r.awarded} ${icon} handed out`);
  });

  return (
    <div className="stack">
      <div className="topbar">
        <h1>{greeting()}, {who?.user?.name}</h1>
        <span className="muted">{home?.name}</span>
      </div>

      {home && !home.kids.length && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Let's get started</h2>
          <p className="muted" style={{ margin: 0 }}>Add your kids, give them some chores, then set up a family tablet so they can tap their raccoon and get going.</p>
          <div className="row">
            <Link className="btn primary" to="/kids">🦝 Add kids</Link>
            <Link className="btn" to="/chores">🧹 Add chores</Link>
            <Link className="btn" to="/settings">📱 Family tablet</Link>
          </div>
        </div>
      )}

      <section className="card stack">
        <div className="row">
          <h2 style={{ margin: 0, flex: 1 }}>To review {!!queue?.length && <span className="pill warn">{queue.length}</span>}</h2>
          {(queue?.length ?? 0) > 1 && <button className="primary" disabled={busy} onClick={approveAll}>✅ Approve all</button>}
        </div>
        {queue?.map((i) => (
          <div key={i.id} className="list-item">
            <RaccoonAvatar variant={i.kid.avatar} size={44} />
            <span className="review-icon" aria-hidden>{i.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{i.title}</div>
              <div className="small muted">{i.kid.name} · {i.date === summary?.today ? 'today' : `${dayName(i.date)} ${shortDate(i.date)}`} · +{i.points} {icon}</div>
            </div>
            <button className="ghost danger" disabled={busy} onClick={() => reject(i)}>Not yet</button>
            <button className="primary" disabled={busy} onClick={() => void approve(i)}>Approve</button>
          </div>
        ))}
        {queue && !queue.length && <p className="muted" style={{ margin: 0 }}>Nothing waiting. 🦝 The raccoons are on it.</p>}
      </section>

      {!!summary?.timeouts.length && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>⏳ Time-outs {summary.timeouts.some((t) => t.pending) && <span className="pill warn">{summary.timeouts.filter((t) => t.pending).length} asking</span>}</h2>
          {summary.timeouts.map((t) => (
            <TimeoutCard key={t.id} t={t} asParent kidName={t.kid.name} balance={summary.kids.find((k) => k.id === t.memberId)?.balance ?? 0} onChange={() => void reloadSummary()} />
          ))}
        </section>
      )}

      {!!appointments?.length && (
        <section className="card stack">
          <div className="row"><h2 style={{ margin: 0, flex: 1 }}>Coming up</h2><Link to="/doctors" className="btn ghost">Doctors →</Link></div>
          {appointments.slice(0, 4).map((a) => (
            <div key={a.id} className="row">
              <RaccoonAvatar variant={a.kidAvatar} size={32} />
              <span>{KIND_ICONS[a.kind] ?? '📌'}</span>
              <span style={{ flex: 1 }}><strong>{a.kidName}</strong>: {a.title}{a.provider && ` with ${a.provider}`}</span>
              <span className="small muted">{whenText(a.startsAt)}</span>
            </div>
          ))}
        </section>
      )}

      <TodaysTipsCard />

      <div className="kid-summaries">
        {summary?.kids.map((k) => {
          const goal = k.goals[0];
          return (
            <div key={k.id} className="card kid-summary" style={{ borderTop: `6px solid ${k.color}` }}>
              <Link to={`/kids/${k.id}`} className="row" style={{ textDecoration: 'none', color: 'inherit' }}>
                <RaccoonAvatar variant={k.avatar} size={56} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: '1.2rem' }}>{k.name}</div>
                  <div className="small muted">{k.balance} {icon} to spend · {k.level.badge} {k.level.name}{k.streak.current > 1 && ` · 🔥 ${k.streak.current}`}</div>
                </div>
              </Link>
              <div className="stats" hidden={k.pagesOff.includes('chores')}>
                <div><span className="num">{k.pointsThisWeek}</span><span className="small muted">{icon} this week</span></div>
                <div><span className="num">{k.choresDone}<span className="small muted">/{k.choresDue}</span></span><span className="small muted">chores done</span></div>
                <div><span className="num">{k.leftToday}</span><span className="small muted">left today</span></div>
              </div>
              {goal && !k.pagesOff.includes('goals') && (
                <div className="goal">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="small"><strong>{goal.reached ? '🏆' : '🎯'} {goal.title}</strong></span>
                    <span className="small muted">{goal.progress}/{goal.targetPoints}</span>
                  </div>
                  <ProgressBar percent={goal.percent} color={goal.reached ? 'var(--ok)' : k.color} />
                </div>
              )}
              {!!k.choresWaiting && !k.pagesOff.includes('chores') && <span className="pill warn">{k.choresWaiting} waiting for review</span>}
              <div className="chips">
                {quick?.map((q) => (
                  <button key={q.id} className="chip" title={`${q.title}: +${q.amount}`} onClick={() => void act(async () => {
                    await api(`${base}/quick-rewards/${q.id}/give`, { body: { memberId: k.id } });
                    toast(`${q.icon} ${q.title}: +${q.amount} ${icon} for ${k.name}`);
                  })}>{q.icon} +{q.amount}</button>
                ))}
                <button className="chip" onClick={() => setPenalty({ id: k.id, name: k.name, points: 1, reason: '' })}>🌱 Take away</button>
                {!k.pagesOff.includes('timeout') && <button className="chip" onClick={() => setTimeoutFor({ id: k.id, name: k.name })}>⏳ Time-out</button>}
              </div>
            </div>
          );
        })}
      </div>
      {summary && <p className="small muted">Week of {shortDate(summary.weekStart)} to {shortDate(summary.weekEnd)}</p>}
      {timeoutFor && <TimeoutForm kidId={timeoutFor.id} kidName={timeoutFor.name} onClose={() => setTimeoutFor(null)} onDone={() => { setTimeoutFor(null); void reloadSummary(); }} />}
      {penalty && (
        <Modal onClose={() => setPenalty(null)}>
          <form className="stack" onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const r = await api<{ taken: number }>(`${base}/kids/${penalty.id}/penalty`, { body: { points: penalty.points, reason: penalty.reason } });
              toast(r.taken < penalty.points ? `Took ${r.taken} (that's all ${penalty.name} had)` : `Took ${r.taken} ${icon}`);
              setPenalty(null);
            });
          }}>
            <h2 style={{ margin: 0 }}>Take away {home?.pointsName} from {penalty.name}</h2>
            <p className="small muted" style={{ margin: 0 }}>
              {penalty.name} will see the reason, worded kindly. {home?.allowNegative ? 'Balances can go below zero (change in Settings).' : "Balances don't go below zero (change in Settings)."}
            </p>
            <input placeholder="Reason, e.g. Left toys on the stairs" value={penalty.reason} onChange={(e) => setPenalty({ ...penalty, reason: e.target.value })} autoFocus />
            <IdeasButton kind="penalty" kidId={penalty.id} onPick={(i) => setPenalty({ ...penalty, reason: i.title, points: Math.max(1, i.points) })} />
            <div className="row">
              <button type="button" className="icon" onClick={() => setPenalty({ ...penalty, points: Math.max(1, penalty.points - 1) })}>−</button>
              <strong style={{ fontSize: '1.4rem', minWidth: 40, textAlign: 'center' }}>{penalty.points}</strong>
              <button type="button" className="icon" onClick={() => setPenalty({ ...penalty, points: penalty.points + 1 })}>＋</button>
              <span style={{ fontSize: '1.3rem' }}>{icon}</span>
              <span className="spacer" />
              <button type="button" className="ghost" onClick={() => setPenalty(null)}>Cancel</button>
              <button className="primary" disabled={!penalty.reason.trim()}>Take away</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
