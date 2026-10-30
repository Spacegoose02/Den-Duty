import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type AgendaItem, type Board, type LedgerEntry, type Poll } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { AvatarPicker, RaccoonAvatar } from '../components/Raccoon.tsx';
import { Modal, ProgressBar, dayName } from '../components/Bits.tsx';
import { OUTFIT_UNLOCK_LEVEL, outfitUnlocked } from '../../../shared/catalog.ts';
import { AREA_ICONS, KIND_ICONS, whenText } from './Doctors.tsx';
import { Calendar } from './Week.tsx';
import { TimeoutCard, TimeoutForm } from '../components/Timeouts.tsx';
import { KidHelpdesk } from '../components/Helpdesk.tsx';

const IDLE_MS = 3 * 60e3;

/** A kid signed in on the family tablet. Signs itself out after a few idle minutes so the next kid starts fresh. */
export function KidBoard() {
  const { who, refresh } = useApp();
  const signOut = useCallback(async () => {
    await api('/api/kiosk/kid/logout', { body: {} });
    await refresh();
  }, [refresh]);

  useEffect(() => {
    let timer = window.setTimeout(signOut, IDLE_MS);
    const poke = () => { window.clearTimeout(timer); timer = window.setTimeout(signOut, IDLE_MS); };
    const events = ['pointerdown', 'keydown', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, poke, { passive: true }));
    return () => { window.clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, poke)); };
  }, [signOut]);

  if (!who?.kid) return null;
  return (
    <div className="kiosk">
      <BoardView memberId={who.kid.id} asParent={false} onExit={signOut} />
    </div>
  );
}

/** A parent looking at one kid's board. Ticking chores off here counts straight away. */
export function ParentKidBoard() {
  const { memberId } = useParams();
  return (
    <div className="stack">
      <div className="row"><Link to="/kids" className="btn ghost">← Kids</Link></div>
      <BoardView memberId={memberId!} asParent />
    </div>
  );
}

type Column = 'todo' | 'doing' | 'waiting' | 'done';

function columnOf(i: AgendaItem): Column {
  if (i.status === 'approved') return 'done';
  if (i.status === 'submitted') return 'waiting';
  return i.started ? 'doing' : 'todo';
}

const COLUMNS: { id: Column; title: string; empty: string }[] = [
  { id: 'todo', title: 'To do', empty: 'Nothing left!' },
  { id: 'doing', title: 'Doing', empty: 'Tap ▶ to start one' },
  { id: 'waiting', title: 'Waiting for a grown-up', empty: '' },
  { id: 'done', title: 'Done', empty: '' },
];

/** How a points entry reads to a kid. Take-aways are shown gently: what happened, not a scolding. */
function recentLine(e: LedgerEntry, icon: string): { mark: string; text: string; amount: string } {
  const amount = `${e.amount > 0 ? '+' : '−'}${Math.abs(e.amount)} ${icon}`;
  if (e.kind === 'redeem') return { mark: '🎁', text: e.reason.replace(/^Redeemed: /, 'Got: '), amount };
  if (e.kind === 'reversal') return { mark: '↩️', text: e.reason, amount };
  if (e.amount < 0) return { mark: '🌱', text: `Let's work on: ${e.reason}`, amount };
  if (e.kind === 'chore') return { mark: '✅', text: e.reason, amount };
  return { mark: '⭐', text: e.reason, amount };
}

function BoardView({ memberId, asParent, onExit }: { memberId: string; asParent: boolean; onExit?: () => void }) {
  const { base, home, toast, refresh } = useApp();
  const [board, reload] = useLoad<Board>(`${base}/kids/${memberId}/board`);
  const [polls, reloadPolls] = useLoad<Poll[]>(`${base}/polls`);
  const [denNote] = useLoad<{ text: string; source: string } | null>(`${base}/kids/${memberId}/room-message`, [memberId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [cheer, setCheer] = useState<{ icon: string; text: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [newTimeout, setNewTimeout] = useState(false);

  if (!board) return <div className="center-screen"><RaccoonAvatar variant="ninja" size={96} title="Loading" /></div>;
  const { kid, stats, level, streak } = board;
  const icon = home?.pointsIcon ?? '✨';
  const celebrate = (i: string, text: string) => { setCheer({ icon: i, text }); window.setTimeout(() => setCheer(null), 1600); };

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try { await fn(); await reload(); } catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  }
  const post = (path: string, body: object = {}) => api(`${base}${path}`, { body });
  const done = (i: AgendaItem) => act(i.id!, async () => {
    const r = await post(`/instances/${i.id}/done`) as { awarded: number };
    if (asParent) toast(`${i.title}: +${r.awarded} ${icon}`);
    else celebrate(i.icon, 'Nice work! Sent to a grown-up.');
  });

  const left = board.todayItems.filter((i) => i.status === 'pending' || i.status === 'rejected').length;
  const byColumn = (c: Column) => board.todayItems.filter((i) => columnOf(i) === c);
  const earned = board.achievements.filter((a) => a.earned);
  const openPolls = polls?.filter((p) => p.status === 'open') ?? [];
  const decided = polls?.filter((p) => p.status === 'closed').slice(0, 2) ?? [];

  return (
    <div className={`stack board${asParent && kid.theme ? ' themed' : ''}${kid.pictureMode ? ' picture' : ''}${kid.pagesOff.map((p) => ` off-${p}`).join('')}`} data-theme={asParent ? kid.theme ?? undefined : undefined} style={{ ['--kid' as string]: kid.color }}>
      <header className="board-head">
        <button className="avatar-button" onClick={() => setPicking(true)} aria-label="Change raccoon">
          <RaccoonAvatar variant={kid.avatar} size={92} />
          <span className="level-badge" title={`Level ${level.level}: ${level.name}`}>{level.badge}</span>
        </button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ margin: 0 }}>{asParent ? kid.name : `Hi ${kid.name}!`}</h1>
          <p className="muted" style={{ margin: '0 0 6px' }}>
            {left ? `${left} chore${left === 1 ? '' : 's'} left today` : board.todayItems.length ? 'All done for today! 🎉' : 'Nothing to do today'}
            {streak.current > 0 && ` · 🔥 ${streak.current}-day streak`}
          </p>
          <div className="level-line pg-stats">
            <strong>{level.name}</strong>
            <ProgressBar percent={level.percent} color={kid.color} />
            <span className="small muted">{level.next ? `${level.next.min - level.points} to ${level.next.badge} ${level.next.name}` : 'Top level!'}</span>
          </div>
        </div>
        <div className="balance">
          <span className="balance-num">{kid.balance}</span>
          <span className="balance-label">{icon} {home?.pointsName}</span>
        </div>
        {onExit && <button className="kid-exit" onClick={onExit}>👋 I'm done</button>}
      </header>

      {denNote && (
        <div className="den-note pg-chores" aria-live="polite">
          <RaccoonAvatar variant={kid.avatar} size={44} />
          <span>{denNote.text}</span>
        </div>
      )}

      {(board.timeouts.length > 0 || (asParent && !kid.pagesOff.includes('timeout'))) && (
        <section className="card stack pg-timeout">
          <div className="row">
            <h2 style={{ margin: 0, flex: 1 }}>{asParent ? '⏳ Time-outs' : '⏳ Taking a break'}</h2>
            {asParent && <button onClick={() => setNewTimeout(true)}>＋ Time-out</button>}
          </div>
          {board.timeouts.map((t) => <TimeoutCard key={t.id} t={t} asParent={asParent} balance={kid.balance} onChange={() => void reload()} />)}
          {!board.timeouts.length && <p className="small muted" style={{ margin: 0 }}>None right now.</p>}
        </section>
      )}
      {!kid.pagesOff.includes('helpdesk') && <KidHelpdesk memberId={memberId} kidName={kid.name} picture={kid.pictureMode} asParent={asParent} />}

      {newTimeout && <TimeoutForm kidId={memberId} kidName={kid.name} onClose={() => setNewTimeout(false)} onDone={() => { setNewTimeout(false); void reload(); }} />}

      <section className="pg-chores">
        <h2>Today</h2>
        <div className="kanban">
          {COLUMNS.map((col) => {
            const items = byColumn(col.id);
            return (
              <div key={col.id} className={`kanban-col ${col.id}`}>
                <div className="kanban-head">{col.title} <span className="pill">{items.length}</span></div>
                {items.map((i) => {
                  const isBonus = board.bonus.some((b) => b.instanceId === i.id);
                  const k = i.id!;
                  return (
                    <div key={k} className={`kanban-card ${i.status}`}>
                      <span className="kanban-icon" aria-hidden>{i.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="kanban-title">{i.title}</div>
                        <div className="small muted">+{i.points} {icon}{isBonus && ' · bonus'}{i.date !== board.today && ` · from ${dayName(i.date)}`}</div>
                        {i.status === 'rejected' && <div className="chore-note">🔁 {i.note ? `“${i.note}”` : 'Try again'}</div>}
                      </div>
                      <div className="kanban-actions">
                        {col.id === 'todo' && <button disabled={busy === k} onClick={() => void act(k, () => post(`/instances/${k}/start`, { started: true }))} aria-label="Start">▶</button>}
                        {(col.id === 'todo' || col.id === 'doing') && <button className="primary" disabled={busy === k} onClick={() => void done(i)} aria-label="Done">✓</button>}
                        {col.id === 'doing' && <button disabled={busy === k} onClick={() => void act(k, () => post(`/instances/${k}/start`, { started: false }))} aria-label="Back to to do">↩</button>}
                        {col.id === 'todo' && isBonus && <button disabled={busy === k} onClick={() => void act(k, () => post(`/instances/${k}/unclaim`))} aria-label="Drop bonus">✕</button>}
                        {col.id === 'waiting' && <button disabled={busy === k} onClick={() => void act(k, () => post(`/instances/${k}/undo`))}>Not yet</button>}
                        {col.id === 'done' && asParent && <button disabled={busy === k} onClick={() => void act(k, () => post(`/instances/${k}/undo`))}>Undo</button>}
                      </div>
                    </div>
                  );
                })}
                {!items.length && col.empty && <p className="small muted" style={{ margin: 0 }}>{col.empty}</p>}
              </div>
            );
          })}
        </div>
      </section>

      {board.bonus.length > 0 && (
        <section className="card stack pg-chores">
          <h2 style={{ margin: 0 }}>💪 Up for grabs</h2>
          <p className="small muted" style={{ margin: 0 }}>Extra chores for extra {home?.pointsName}. Pick one if you want it!</p>
          <div className="bonus-grid">
            {board.bonus.map((b) => (
              <div key={b.choreId} className="bonus-card">
                <span className="kanban-icon">{b.icon}</span>
                <div style={{ flex: 1 }}>
                  <div className="kanban-title">{b.title}</div>
                  <div className="small muted">+{b.points} {icon}{b.claimLimit === 'one' && ' · first to grab it'}</div>
                </div>
                {b.instanceId ? <span className="pill ok">You're on it</span>
                  : b.takenBy ? <span className="pill">{b.takenBy} has it</span>
                    : <button className="primary" disabled={busy === b.choreId} onClick={() => void act(b.choreId, async () => {
                      await post(`/chores/${b.choreId}/claim`, asParent ? { memberId } : {});
                      if (!asParent) celebrate(b.icon, "It's yours! Go get it.");
                    })}>I'll do it</button>}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid-2">
        <section className="card stack pg-goals">
          <h2 style={{ margin: 0 }}>Goals</h2>
          {board.goals.map((g) => (
            <div key={g.id} className="goal">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{g.reached ? '🏆 ' : '🎯 '}{g.title}</strong>
                <span className="small">{g.progress} / {g.targetPoints} {icon}</span>
              </div>
              <ProgressBar percent={g.percent} color={g.reached ? 'var(--ok)' : kid.color} />
              {g.reward && <span className="small muted">Reward: {g.reward}{g.reached && ' · Ask a grown-up!'}</span>}
            </div>
          ))}
          {!board.goals.length && <p className="muted" style={{ margin: 0 }}>No goals yet. Ask a grown-up to set one!</p>}
        </section>
        <section className="card stack pg-stats">
          <h2 style={{ margin: 0 }}>This week</h2>
          <div className="stats">
            <div><span className="num">{stats.pointsThisWeek}</span><span className="small muted">{home?.pointsName} earned</span></div>
            <div><span className="num">{stats.choresDone}</span><span className="small muted">chores done</span></div>
            <div><span className="num">{streak.best}</span><span className="small muted">best streak</span></div>
          </div>
          {board.recent.length > 0 && (
            <div className="list">
              {board.recent.slice(0, 5).map((e) => {
                const l = recentLine(e, icon);
                return (
                  <div key={e.id} className="row small" style={{ padding: '4px 0', flexWrap: 'nowrap' }}>
                    <span aria-hidden>{l.mark}</span><span style={{ flex: 1 }}>{l.text}</span><strong>{l.amount}</strong>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {board.therapy && (board.therapy.goals.length > 0 || board.therapy.upcoming.length > 0) && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>🌈 My big goals</h2>
          {board.therapy.goals.map((g) => (
            <div key={g.id} className="goal">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{AREA_ICONS[g.area] ?? '🌱'} {g.title}</strong>
                {(g.rewardStep > 0 || g.rewardMet > 0) && (
                  <span className="pill ok">{g.rewardStep > 0 && `+${g.rewardStep} ${icon} each practice`}{g.rewardStep > 0 && g.rewardMet > 0 && ' · '}{g.rewardMet > 0 && `+${g.rewardMet} ${icon} when you get there!`}</span>
                )}
                <span className="small">{g.progress}%</span>
              </div>
              <ProgressBar percent={g.progress} color={kid.color} />
            </div>
          ))}
          {board.therapy.upcoming.map((a) => (
            <p key={a.id} className="small" style={{ margin: 0 }}>{KIND_ICONS[a.kind] ?? '📌'} Coming up: <strong>{a.title}</strong>{a.provider && ` with ${a.provider}`} · {whenText(a.startsAt)}</p>
          ))}
        </section>
      )}

      {(openPolls.length > 0 || decided.length > 0) && (
        <section className="card stack pg-goals">
          <h2 style={{ margin: 0 }}>🗳️ Vote for a reward</h2>
          {openPolls.map((p) => (
            <div key={p.id} className="stack">
              <strong>{p.title}</strong>
              <div className="vote-grid">
                {p.options.map((o) => (
                  <button key={o.id} className={`vote-option${p.myVote === o.id ? ' on' : ''}`} disabled={asParent}
                    onClick={() => void act(o.id, async () => { await post(`/polls/${p.id}/vote`, { optionId: o.id }); await reloadPolls(); })}>
                    <span style={{ fontSize: '2.4rem' }}>{o.icon}</span>
                    <span>{o.title}</span>
                    {p.myVote === o.id && <span className="small">✓ Your vote</span>}
                    {asParent && <span className="small muted">{o.votes} votes</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {decided.map((p) => {
            const w = p.options.find((o) => o.id === p.winnerOptionId);
            return w && <p key={p.id} style={{ margin: 0 }}>🏆 <strong>{p.title}</strong> The winner is {w.icon} <strong>{w.title}</strong>!</p>;
          })}
        </section>
      )}

      <section className="card stack pg-stats">
        <h2 style={{ margin: 0 }}>Badges <span className="pill">{earned.length} / {board.achievements.length}</span></h2>
        <div className="badge-grid">
          {board.achievements.map((a) => (
            <div key={a.id} className={`badge${a.earned ? ' earned' : ''}`} title={a.description}>
              <span className="badge-icon">{a.earned ? a.icon : '🔒'}</span>
              <span className="badge-title">{a.title}</span>
              <span className="small muted">{a.earned ? a.description : `${a.progress} / ${a.target}`}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="pg-chores pg-calendar-week">
        <Calendar kidId={memberId} title={asParent ? `${kid.name}'s calendar` : 'My calendar'} />
      </section>

      {picking && (
        <Modal onClose={() => setPicking(false)}>
          <div className="stack">
            <h2 style={{ margin: 0 }}>Pick your animal friend</h2>
            <p className="small muted" style={{ margin: 0 }}>Every animal is yours to pick. Level up to unlock more outfits. You're level {level.level}: {level.badge} {level.name}.</p>
            <AvatarPicker value={kid.avatar} lockedAt={(o) => (asParent || outfitUnlocked(o, level.level) ? null : OUTFIT_UNLOCK_LEVEL[o] ?? null)}
              onPick={(a) => void act(`av-${a}`, async () => { await post(`/kids/${memberId}/avatar`, { avatar: a }); await refresh(); })} />
          </div>
        </Modal>
      )}

      {cheer && (
        <div className="cheer" aria-live="polite">
          <span className="cheer-icon">{cheer.icon}</span>
          <span>{cheer.text}</span>
        </div>
      )}
    </div>
  );
}
