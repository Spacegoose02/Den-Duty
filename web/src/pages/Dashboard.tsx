import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ReviewItem, type Summary } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { ProgressBar, dayName, shortDate } from '../components/Bits.tsx';

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
  const [busy, setBusy] = useState(false);
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

      <div className="kid-summaries">
        {summary?.kids.map((k) => {
          const goal = k.goals[0];
          return (
            <Link key={k.id} to={`/kids/${k.id}`} className="card kid-summary" style={{ borderTop: `6px solid ${k.color}` }}>
              <div className="row">
                <RaccoonAvatar variant={k.avatar} size={56} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: '1.2rem' }}>{k.name}</div>
                  <div className="small muted">{k.balance} {icon} to spend</div>
                </div>
              </div>
              <div className="stats">
                <div><span className="num">{k.pointsThisWeek}</span><span className="small muted">{icon} this week</span></div>
                <div><span className="num">{k.choresDone}<span className="small muted">/{k.choresDue}</span></span><span className="small muted">chores done</span></div>
                <div><span className="num">{k.leftToday}</span><span className="small muted">left today</span></div>
              </div>
              {goal && (
                <div className="goal">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="small"><strong>{goal.reached ? '🏆' : '🎯'} {goal.title}</strong></span>
                    <span className="small muted">{goal.progress}/{goal.targetPoints}</span>
                  </div>
                  <ProgressBar percent={goal.percent} color={goal.reached ? 'var(--ok)' : k.color} />
                </div>
              )}
              {!!k.choresWaiting && <span className="pill warn">{k.choresWaiting} waiting for review</span>}
            </Link>
          );
        })}
      </div>
      {summary && <p className="small muted">Week of {shortDate(summary.weekStart)} to {shortDate(summary.weekEnd)}</p>}
    </div>
  );
}
