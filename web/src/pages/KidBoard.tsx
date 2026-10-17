import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type AgendaItem, type Board } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { ChoreTile, dayName, ProgressBar, shortDate, STATUS_LABEL } from '../components/Bits.tsx';
import { addDays } from '../../../shared/schedule.ts';

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

function BoardView({ memberId, asParent, onExit }: { memberId: string; asParent: boolean; onExit?: () => void }) {
  const { base, home, toast } = useApp();
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [board, reload] = useLoad<Board>(`${base}/kids/${memberId}/board${weekStart ? `?start=${weekStart}` : ''}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [cheer, setCheer] = useState<string | null>(null);

  if (!board) return <div className="center-screen"><RaccoonAvatar variant="ninja" size={96} title="Loading" /></div>;
  const { kid, stats } = board;
  const icon = home?.pointsIcon ?? '✨';

  async function tap(item: AgendaItem) {
    if (!item.id || (item.status === 'approved' && !asParent)) return;
    setBusy(item.id);
    try {
      if (item.status === 'submitted' || (asParent && item.status === 'approved')) {
        await api(`${base}/instances/${item.id}/undo`, { body: {} });
      } else {
        const r = await api<{ awarded: number }>(`${base}/instances/${item.id}/done`, { body: {} });
        if (asParent) toast(`${item.title}: +${r.awarded} ${icon}`);
        else {
          setCheer(item.icon);
          window.setTimeout(() => setCheer(null), 1600);
        }
      }
      await reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const left = board.todayItems.filter((i) => i.status === 'pending' || i.status === 'rejected').length;
  const thisWeek = board.week.some((d) => d.date === board.today);

  return (
    <div className={`stack board${asParent && kid.theme ? ' themed' : ''}`} data-theme={asParent ? kid.theme ?? undefined : undefined} style={{ ['--kid' as string]: kid.color }}>
      <header className="board-head">
        <RaccoonAvatar variant={kid.avatar} size={92} />
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0 }}>{asParent ? kid.name : `Hi ${kid.name}!`}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {left ? `${left} chore${left === 1 ? '' : 's'} left today` : board.todayItems.length ? 'All done for today! 🎉' : 'Nothing to do today'}
          </p>
        </div>
        <div className="balance">
          <span className="balance-num">{kid.balance}</span>
          <span className="balance-label">{icon} {home?.pointsName}</span>
        </div>
        {onExit && <button className="kid-exit" onClick={onExit}>👋 I'm done</button>}
      </header>

      <section>
        <h2>Today</h2>
        <div className="chore-grid">
          {board.todayItems.map((i) => (
            <ChoreTile key={i.id} item={i} pointsIcon={icon} busy={busy === i.id}
              onTap={i.status === 'approved' && !asParent ? undefined : () => void tap(i)} />
          ))}
        </div>
        {!board.todayItems.length && <p className="muted">No chores today. Go play! 🦝</p>}
        {!asParent && board.todayItems.some((i) => i.status === 'submitted') && (
          <p className="small muted">⏳ Waiting chores go to a grown-up to check. Tap one to take it back.</p>
        )}
      </section>

      <div className="grid-2">
        <section className="card stack">
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
        <section className="card stack">
          <h2 style={{ margin: 0 }}>This week</h2>
          <div className="stats">
            <div><span className="num">{stats.pointsThisWeek}</span><span className="small muted">{home?.pointsName} earned</span></div>
            <div><span className="num">{stats.choresDone}</span><span className="small muted">chores done</span></div>
            <div><span className="num">{stats.choresWaiting}</span><span className="small muted">waiting</span></div>
          </div>
        </section>
      </div>

      <section>
        <div className="row">
          <h2 style={{ margin: 0, flex: 1 }}>Week</h2>
          <button className="icon" aria-label="Previous week" onClick={() => setWeekStart(addDays(board.weekStart, -7))}>◀</button>
          {!thisWeek && <button onClick={() => setWeekStart(null)}>This week</button>}
          <button className="icon" aria-label="Next week" onClick={() => setWeekStart(addDays(board.weekStart, 7))}>▶</button>
        </div>
        <div className="agenda">
          {board.week.map((d) => (
            <div key={d.date} className={`agenda-day${d.date === board.today ? ' today' : ''}${d.date < board.today ? ' past' : ''}`}>
              <div className="agenda-date"><strong>{dayName(d.date)}</strong> <span className="small muted">{shortDate(d.date)}</span></div>
              {d.items.map((i, n) => (
                <div key={i.id ?? `${i.choreId}-${n}`} className={`agenda-item ${i.status}`} title={STATUS_LABEL[i.status]}>
                  <span aria-hidden>{i.icon}</span>
                  <span className="agenda-title">{i.title}</span>
                  <span className="agenda-mark" aria-label={STATUS_LABEL[i.status]}>
                    {i.status === 'approved' ? '✅' : i.status === 'submitted' ? '⏳' : i.status === 'rejected' ? '🔁' : ''}
                  </span>
                </div>
              ))}
              {!d.items.length && <span className="small muted">Free day</span>}
            </div>
          ))}
        </div>
      </section>

      {cheer && (
        <div className="cheer" aria-live="polite">
          <span className="cheer-icon">{cheer}</span>
          <span>Nice work! Sent to a grown-up.</span>
        </div>
      )}
    </div>
  );
}
