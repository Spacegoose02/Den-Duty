import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type AgendaItem, type Board, type KidTherapyGoal, type LedgerEntry, type Poll } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { AvatarPicker, RaccoonAvatar } from '../components/Raccoon.tsx';
import { Modal, ProgressBar, dayName } from '../components/Bits.tsx';
import { OUTFIT_UNLOCK_LEVEL, outfitUnlocked } from '../../../shared/catalog.ts';
import { AREA_ICONS, KIND_ICONS, whenText } from './Doctors.tsx';
import { Calendar } from './Week.tsx';
import { TimeoutCard, TimeoutForm } from '../components/Timeouts.tsx';
import { KidHelpdesk } from '../components/Helpdesk.tsx';
import { confetti } from '../components/Confetti.ts';
import { KidShop, LootdenPlay } from '../components/Shop.tsx';
import { KidTeamGoals } from '../components/TeamGoals.tsx';
import { cheerOf, pickPhoto, PhotoThumb } from '../components/Photo.tsx';
import { KidMedicine, PracticeMode } from '../components/KidPractice.tsx';
import { RoutineCards, RoutinePlayer } from '../components/Routines.tsx';
import { KidJars } from '../components/Money.tsx';
import { KidHabits } from '../components/Habits.tsx';
import { KidFeelings } from '../components/Feelings.tsx';
import { KidDen } from '../components/Den.tsx';
import { KidLists } from '../components/Lists.tsx';
import { KidScreenTime } from '../components/ScreenTime.tsx';
import { KidMeetingNote } from './Meeting.tsx';
import { KidTrades, TradeForm, useTrades } from '../components/Trades.tsx';
import { KidSportsCards } from '../components/Sports.tsx';
import { KidWeatherCard } from '../components/Weather.tsx';
import { SpeakButton, speak } from '../components/Speak.tsx';
import { QueuedError, useQueuedDone } from '../offline.tsx';
import { clockText } from '../../../shared/schedule.ts';
import type { RoutineId } from '../../../shared/catalog.ts';
import { LangProvider, translate, type T } from '../i18n.tsx';
import { isLang } from '../../../shared/languages.ts';

const IDLE_MS = 3 * 60e3;
/** How often a kid's own board checks for chores a grown-up just approved. */
const APPROVAL_POLL_MS = 20e3;

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
  if (e.kind === 'redeem' && e.amount > 0) return { mark: '↩️', text: e.reason.replace(/^Refund: /, 'Points back: '), amount };
  if (e.kind === 'redeem') return { mark: '🎁', text: e.reason.replace(/^(Redeemed|Bought): /, 'Got: '), amount };
  if (e.kind === 'reversal') return { mark: '↩️', text: e.reason, amount };
  if (e.amount < 0) return { mark: '🌱', text: `Let's work on: ${e.reason}`, amount };
  if (e.kind === 'chore') return { mark: '✅', text: e.reason, amount };
  return { mark: '⭐', text: e.reason, amount };
}

function BoardView({ memberId, asParent, onExit }: { memberId: string; asParent: boolean; onExit?: () => void }) {
  const { base, home, toast, refresh } = useApp();
  const [loaded, reload] = useLoad<Board>(`${base}/kids/${memberId}/board`);
  const queued = useQueuedDone();
  // A chore tapped while offline shows as sent; it goes to the server when the Wi-Fi is back.
  const board = loaded && queued.size
    ? { ...loaded, todayItems: loaded.todayItems.map((i) => i.id && queued.has(i.id) && (i.status === 'pending' || i.status === 'rejected') ? { ...i, status: 'submitted' as const } : i) }
    : loaded;
  const [practicing, setPracticing] = useState<KidTherapyGoal | null>(null);
  const [polls, reloadPolls] = useLoad<Poll[]>(`${base}/polls`);
  const [denNote] = useLoad<{ text: string; source: string } | null>(`${base}/kids/${memberId}/room-message`, [memberId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [cheer, setCheer] = useState<{ icon: string; text: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [newTimeout, setNewTimeout] = useState(false);
  const [routine, setRoutine] = useState<RoutineId | null>(null);
  const seenApproved = useRef<Set<string> | null>(null);
  const [trading, setTrading] = useState<AgendaItem | null>(null);
  const [trades, reloadTrades] = useTrades(!asParent);

  // Things tapped while offline just went through: show them as the server sees them.
  useEffect(() => {
    const on = () => void reload();
    window.addEventListener('den-duty-synced', on);
    return () => window.removeEventListener('den-duty-synced', on);
  }, [reload]);

  // On the kid's own screen, keep an eye out for approvals so the party happens while they're still looking.
  useEffect(() => {
    if (asParent) return;
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, APPROVAL_POLL_MS);
    return () => window.clearInterval(t);
  }, [asParent, reload]);

  // Confetti when a chore turns approved after the board first loaded (a grown-up said yes).
  useEffect(() => {
    if (!board) return;
    const approved = new Set(board.todayItems.filter((i) => i.status === 'approved' && i.id).map((i) => i.id!));
    const before = seenApproved.current;
    seenApproved.current = approved;
    // A parent's own ticks count straight away and get their cheer when they're tapped.
    if (!before || asParent) return;
    const fresh = board.todayItems.filter((i) => i.id && approved.has(i.id) && !before.has(i.id));
    if (!fresh.length) return;
    confetti({ colors: [board.kid.color] });
    const sent = cheerOf(fresh.find((i) => i.cheer)?.cheer);
    setCheer(sent ? { icon: sent.icon, text: `${sent.text} ${fresh.length > 1 ? `${fresh.length} chores approved` : `${fresh[0].title}: approved`} 🎉` }
      : { icon: fresh[0].icon, text: fresh.length > 1 ? `${fresh.length} chores approved! 🎉` : `${fresh[0].title}: approved! 🎉` });
    window.setTimeout(() => setCheer(null), 2200);
  }, [board, asParent]);

  if (!board) return <div className="center-screen"><RaccoonAvatar variant="ninja" size={96} title="Loading" /></div>;
  const { kid, stats, level, streak } = board;
  // A kid's own screen speaks their language; a parent looking at it sees English.
  const langRaw = asParent ? 'en' : kid.language ?? home?.language;
  const lang = isLang(langRaw) ? langRaw : 'en';
  const t: T = (k, v) => translate(lang, k, v);
  const icon = home?.pointsIcon ?? '✨';
  const celebrate = (i: string, text: string) => { setCheer({ icon: i, text }); window.setTimeout(() => setCheer(null), 1600); };

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try { await fn(); await reload(); } catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  }
  const left = board.todayItems.filter((i) => i.status === 'pending' || i.status === 'rejected').length;
  const post = (path: string, body: object = {}) => api(`${base}${path}`, { body });
  // Photo chores: a kid snaps the picture first, then it goes to a grown-up. A parent ticking it off doesn't need one.
  const needsSnap = (i: AgendaItem) => !asParent && i.needsPhoto && !i.hasPhoto;
  const done = (i: AgendaItem) => act(i.id!, async () => {
    if (needsSnap(i)) {
      const image = await pickPhoto();
      if (!image) return;
      await post(`/instances/${i.id}/photo`, { image });
    }
    let r: { awarded: number };
    try { r = await post(`/instances/${i.id}/done`) as { awarded: number }; } catch (e) {
      if (!(e instanceof QueuedError)) throw e;
      confetti({ colors: [kid.color], count: 90 });
      celebrate(i.icon, t('Saved! It will send when the Wi-Fi is back. 📶'));
      return;
    }
    if (asParent) { confetti({ colors: [kid.color], count: 80 }); toast(`${i.title}: +${r.awarded} ${icon}`); }
    else { confetti({ colors: [kid.color], count: left === 1 ? 220 : 90 }); celebrate(i.icon, t(left === 1 ? 'Last one! You did them all! 🎉' : 'Nice work! Sent to a grown-up.')); }
  });

  // Routine steps live in their routine cards, not the kanban.
  const byColumn = (c: Column) => board.todayItems.filter((i) => !i.routine && columnOf(i) === c);
  const readAloud = kid.readAloud;
  const earned = board.achievements.filter((a) => a.earned);
  const openPolls = polls?.filter((p) => p.status === 'open') ?? [];
  const decided = polls?.filter((p) => p.status === 'closed').slice(0, 2) ?? [];

  return (
    <LangProvider lang={lang}>
    <div className={`stack board${asParent && kid.theme ? ' themed' : ''}${kid.pictureMode ? ' picture' : ''}${kid.pagesOff.map((p) => ` off-${p}`).join('')}`} data-theme={asParent ? kid.theme ?? undefined : undefined} style={{ ['--kid' as string]: kid.color }}>
      <header className="board-head">
        <button className="avatar-button" onClick={() => setPicking(true)} aria-label="Change raccoon">
          <RaccoonAvatar variant={kid.avatar} size={92} />
          <span className="level-badge" title={`Level ${level.level}: ${level.name}`}>{level.badge}</span>
        </button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ margin: 0 }}>{asParent ? kid.name : t('Hi {name}!', { name: kid.name })}</h1>
          <p className="muted" style={{ margin: '0 0 6px' }}>
            {left ? t(left === 1 ? '{n} chore left today' : '{n} chores left today', { n: left }) : t(board.todayItems.length ? 'All done for today! 🎉' : 'Nothing to do today')}
            {streak.current > 0 && ` · ${t('🔥 {n}-day streak', { n: streak.current })}`}
          </p>
          <div className="level-line pg-stats">
            <strong>{level.name}</strong>
            <ProgressBar percent={level.percent} color={kid.color} />
            <span className="small muted">{level.next ? t('{n} to {next}', { n: level.next.min - level.points, next: `${level.next.badge} ${level.next.name}` }) : t('Top level!')}</span>
          </div>
        </div>
        <div className="balance">
          <span className="balance-num">{kid.balance}</span>
          <span className="balance-label">{icon} {home?.pointsName}</span>
        </div>
        {onExit && <button className="kid-exit" onClick={onExit}>{t("👋 I'm done")}</button>}
      </header>

      {board.away && (
        <div className="card away-note">
          <span style={{ fontSize: '2rem' }} aria-hidden>🚗</span>
          <span style={{ flex: 1 }}>{asParent
            ? <>{kid.name} is {board.away.label.replace(/^At /, 'at ')} today, so no chores here.{board.away.back ? ` Back ${dayName(board.away.back)}.` : ''}</>
            : <>{t('Today: {where}. No chores here.', { where: board.away.label })}{board.away.back ? ` ${t('Back {day}.', { day: dayName(board.away.back) })}` : ''}</>}</span>
          {readAloud && !asParent && <SpeakButton text={`You're ${board.away.label} today.`} />}
        </div>
      )}
      {denNote && (
        <div className="den-note pg-chores" aria-live="polite">
          <RaccoonAvatar variant={kid.avatar} size={44} />
          <span style={{ flex: 1 }}>{denNote.text}</span>
          {readAloud && <SpeakButton text={denNote.text} />}
        </div>
      )}

      {!asParent && trades && <KidTrades memberId={memberId} trades={trades.trades} mode={trades.mode} onChange={() => { void reloadTrades(); void reload(); }} />}
      {trading && <TradeForm item={trading} onClose={() => setTrading(null)} onDone={() => { setTrading(null); void reloadTrades(); }} />}

      <KidMeetingNote memberId={memberId} color={kid.color} />

      <KidFeelings memberId={memberId} kidName={kid.name} asParent={asParent} readAloud={readAloud} picture={kid.pictureMode} />

      {(board.timeouts.length > 0 || (asParent && !kid.pagesOff.includes('timeout'))) && (
        <section className="card stack pg-timeout">
          <div className="row">
            <h2 style={{ margin: 0, flex: 1 }}>{asParent ? '⏳ Time-outs' : t('⏳ Taking a break')}</h2>
            {asParent && <button onClick={() => setNewTimeout(true)}>＋ Time-out</button>}
          </div>
          {board.timeouts.map((t) => <TimeoutCard key={t.id} t={t} asParent={asParent} balance={kid.balance} onChange={() => void reload()} />)}
          {!board.timeouts.length && <p className="small muted" style={{ margin: 0 }}>{t('None right now.')}</p>}
        </section>
      )}
      {!kid.pagesOff.includes('helpdesk') && <KidHelpdesk memberId={memberId} kidName={kid.name} picture={kid.pictureMode} asParent={asParent} />}

      {newTimeout && <TimeoutForm kidId={memberId} kidName={kid.name} onClose={() => setNewTimeout(false)} onDone={() => { setNewTimeout(false); void reload(); }} />}

      <RoutineCards items={board.todayItems} color={kid.color} icon={icon} readAloud={readAloud} onStart={setRoutine} />
      {routine && <RoutinePlayer routine={routine} items={board.todayItems} color={kid.color} readAloud={readAloud} onDone={(i) => done(i)} onClose={() => setRoutine(null)} />}

      <section className="pg-chores">
        <div className="row">
          <h2 style={{ flex: 1 }}>{t('Today')}</h2>
          {readAloud && !asParent && left > 0 && <button className="speak-btn" aria-label="Read my chores" onClick={() => speak(`${t('You have {n} chores left.', { n: left })} ${board.todayItems.filter((i) => !i.routine && (i.status === 'pending' || i.status === 'rejected')).map((i) => i.title).join('. ')}`)}>{t('🔊 My chores')}</button>}
        </div>
        <div className="kanban">
          {COLUMNS.map((col) => {
            const items = byColumn(col.id);
            return (
              <div key={col.id} className={`kanban-col ${col.id}`}>
                <div className="kanban-head">{t(col.title)} <span className="pill">{items.length}</span></div>
                {items.map((i) => {
                  const isBonus = board.bonus.some((b) => b.instanceId === i.id);
                  const k = i.id!;
                  return (
                    <div key={k} className={`kanban-card ${i.status}`}>
                      <span className="kanban-icon" aria-hidden>{i.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="kanban-title">{i.title} {readAloud && <SpeakButton text={i.title} />}</div>
                        <div className="small muted">+{i.points} {icon}{i.surprise ? ` · ${t('🎁 surprise ×2')}` : isBonus && ` · ${t('bonus')}`}{i.date !== board.today && ` · ${t('from {day}', { day: dayName(i.date) })}`}{i.auto && ` · ${t('✨ auto')}`}</div>
                        {i.dueTime && (col.id === 'todo' || col.id === 'doing') && <div className="due-tag">{t('⏰ by {time}', { time: clockText(i.dueTime) })}{i.latePoints != null && i.latePoints < i.points && ` ${t('(then +{n})', { n: i.latePoints })}`}</div>}
                        {i.late && <div className="due-tag late">{t('⏰ late')}</div>}
                        {i.status === 'rejected' && <div className="chore-note">🔁 {i.note ? `“${i.note}”` : t('Try again')}</div>}
                        {needsSnap(i) && (col.id === 'todo' || col.id === 'doing') && <div className="small">{t(i.status === 'rejected' ? "📸 Snap a new photo when it's done" : "📸 Snap a photo when it's done")}</div>}
                        {cheerOf(i.cheer) && <div className="cheer-tag">{cheerOf(i.cheer)!.icon} {cheerOf(i.cheer)!.text}</div>}
                      </div>
                      {i.hasPhoto && <PhotoThumb src={`${base}/instances/${k}/photo?v=${i.photoVersion ?? ''}`} alt={i.title} size={48} />}
                      <div className="kanban-actions">
                        {col.id === 'todo' && <button disabled={busy === k} onClick={() => void act(k, () => post(`/instances/${k}/start`, { started: true }))} aria-label="Start">▶</button>}
                        {(col.id === 'todo' || col.id === 'doing') && <button className="primary" disabled={busy === k} onClick={() => void done(i)} aria-label={needsSnap(i) ? 'Snap a photo and finish' : 'Done'}>{needsSnap(i) ? '📸' : '✓'}</button>}
                        {col.id === 'doing' && <button disabled={busy === k} onClick={() => void act(k, () => post(`/instances/${k}/start`, { started: false }))} aria-label="Back to to do">↩</button>}
                        {col.id === 'todo' && !asParent && trades?.mode && trades.mode !== 'off' && !isBonus && !i.helperId && (home?.kids.length ?? 0) > 1 && i.date === board.today && (
                          <button disabled={busy === k} onClick={() => setTrading(i)} aria-label="Swap or ask for help">🔁</button>
                        )}
                        {col.id === 'todo' && isBonus && !i.surprise && <button disabled={busy === k} onClick={() => void act(k, () => post(`/instances/${k}/unclaim`))} aria-label="Drop bonus">✕</button>}
                        {col.id === 'waiting' && <button disabled={busy === k} onClick={() => void act(k, () => post(`/instances/${k}/undo`))}>{t('Not yet')}</button>}
                        {col.id === 'done' && asParent && <button disabled={busy === k} onClick={() => void act(k, async () => {
                          const r = await post(`/instances/${k}/undo`) as { paid?: number; taken?: number };
                          if (r.paid != null && r.taken != null && r.taken < r.paid) toast(`Took back ${r.taken} ${icon} (${kid.name} already spent the rest)`);
                        })}>Undo</button>}
                      </div>
                    </div>
                  );
                })}
                {!items.length && col.empty && <p className="small muted" style={{ margin: 0 }}>{t(col.empty)}</p>}
              </div>
            );
          })}
        </div>
      </section>

      <KidHabits memberId={memberId} kidName={kid.name} color={kid.color} asParent={asParent} readAloud={readAloud} />

      <KidScreenTime memberId={memberId} asParent={asParent} readAloud={readAloud} onChange={() => void reload()} />

      {!asParent && <KidLists memberId={memberId} />}

      <KidDen memberId={memberId} avatar={kid.avatar} color={kid.color} asParent={asParent} readAloud={readAloud} onChange={() => void reload()} />

      {board.surprise?.state === 'waiting' && (
        <section className="card pg-chores surprise-card">
          <button className="surprise-box" disabled={busy === 'surprise'} aria-label="Open your surprise"
            onClick={() => void act('surprise', async () => {
              const r = await post(`/kids/${memberId}/surprise/open`) as { item: AgendaItem };
              confetti({ colors: [kid.color, '#ffd43b', '#ff6b6b'], count: 200 });
              setCheer({ icon: r.item.icon, text: t('Surprise! {title} for double {points}: +{n} {icon}', { title: r.item.title, points: home?.pointsName ?? 'points', n: r.item.points, icon }) });
              window.setTimeout(() => setCheer(null), 3200);
            })}>
            <span className="surprise-gift" aria-hidden>🎁</span>
            <span>
              <strong>{asParent ? `${kid.name} has a surprise waiting` : t('A surprise is waiting for you!')}</strong>
              <span className="small muted" style={{ display: 'block' }}>{asParent ? 'It opens on their board, or tap to open it now.' : t('Tap to open it')}</span>
            </span>
          </button>
        </section>
      )}

      {board.bonus.length > 0 && (
        <section className="card stack pg-chores">
          <h2 style={{ margin: 0 }}>{t('💪 Up for grabs')}</h2>
          <p className="small muted" style={{ margin: 0 }}>{t('Extra chores for extra {points}. Pick one if you want it!', { points: home?.pointsName ?? '' })}</p>
          <div className="bonus-grid">
            {board.bonus.map((b) => (
              <div key={b.choreId} className="bonus-card">
                <span className="kanban-icon">{b.icon}</span>
                <div style={{ flex: 1 }}>
                  <div className="kanban-title">{b.title}</div>
                  <div className="small muted">+{b.points} {icon}{b.claimLimit === 'one' && ` · ${t('first to grab it')}`}</div>
                </div>
                {b.instanceId ? <span className="pill ok">{t("You're on it")}</span>
                  : b.takenBy ? <span className="pill">{t('{name} has it', { name: b.takenBy })}</span>
                    : <button className="primary" disabled={busy === b.choreId} onClick={() => void act(b.choreId, async () => {
                      await post(`/chores/${b.choreId}/claim`, asParent ? { memberId } : {});
                      if (!asParent) celebrate(b.icon, t("It's yours! Go get it."));
                    })}>{t("I'll do it")}</button>}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid-2">
        <section className="card stack pg-goals">
          <h2 style={{ margin: 0 }}>{t('Goals')}</h2>
          {board.goals.map((g) => (
            <div key={g.id} className="goal">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{g.reached ? '🏆 ' : '🎯 '}{g.title}</strong>
                <span className="small">{g.progress} / {g.targetPoints} {icon}</span>
              </div>
              <ProgressBar percent={g.percent} color={g.reached ? 'var(--ok)' : kid.color} />
              {g.reward && <span className="small muted">{t('Reward: {r}', { r: g.reward })}{g.reached && ` · ${t('Ask a grown-up!')}`}</span>}
            </div>
          ))}
          {!board.goals.length && <p className="muted" style={{ margin: 0 }}>{t('No goals yet. Ask a grown-up to set one!')}</p>}
        </section>
        <section className="card stack pg-stats">
          <h2 style={{ margin: 0 }}>{t('This week')}</h2>
          <div className="stats">
            <div><span className="num">{stats.pointsThisWeek}</span><span className="small muted">{t('{points} earned', { points: home?.pointsName ?? '' })}</span></div>
            <div><span className="num">{stats.choresDone}</span><span className="small muted">{t('chores done')}</span></div>
            <div><span className="num">{streak.best}</span><span className="small muted">{t('best streak')}</span></div>
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

      {board.money && <KidJars money={board.money} color={kid.color} readAloud={readAloud} />}

      <KidWeatherCard simple={kid.pictureMode} readAloud={readAloud} color={kid.color} />

      <KidSportsCards memberId={memberId} simple={kid.pictureMode} readAloud={readAloud} color={kid.color} />

      {board.meds.length > 0 && !asParent && <KidMedicine meds={board.meds} color={kid.color} onChange={() => void reload()} />}
      {practicing && <PracticeMode goal={practicing} color={kid.color} onClose={() => setPracticing(null)} onDone={() => { setPracticing(null); void reload(); }} />}

      {board.therapy && (board.therapy.goals.length > 0 || board.therapy.upcoming.length > 0) && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>{t('🌈 My big goals')}</h2>
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
              {g.practiceMode && !asParent && (
                g.practiceMode.waiting
                  ? <span className="pill warn" style={{ alignSelf: 'flex-start' }}>⏳ Waiting for a grown-up to check your practice</span>
                  : <button className="primary" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={() => setPracticing(g)}>▶️ Practice{g.practiceMode.doneToday ? ` again (${g.practiceMode.doneToday} today)` : ''}</button>
              )}
            </div>
          ))}
          {board.therapy.upcoming.map((a) => (
            <p key={a.id} className="small" style={{ margin: 0 }}>{KIND_ICONS[a.kind] ?? '📌'} Coming up: <strong>{a.title}</strong>{a.provider && ` with ${a.provider}`} · {whenText(a.startsAt)}</p>
          ))}
        </section>
      )}

      <KidTeamGoals />

      <LootdenPlay kidId={kid.id} />
      <KidShop kid={kid} asParent={asParent} onBought={() => void reload()} />

      {(openPolls.length > 0 || decided.length > 0) && (
        <section className="card stack pg-goals">
          <h2 style={{ margin: 0 }}>{t('🗳️ Vote for a reward')}</h2>
          {openPolls.map((p) => (
            <div key={p.id} className="stack">
              <strong>{p.title}</strong>
              <div className="vote-grid">
                {p.options.map((o) => (
                  <button key={o.id} className={`vote-option${p.myVote === o.id ? ' on' : ''}`} disabled={asParent}
                    onClick={() => void act(o.id, async () => { await post(`/polls/${p.id}/vote`, { optionId: o.id }); await reloadPolls(); })}>
                    <span style={{ fontSize: '2.4rem' }}>{o.icon}</span>
                    <span>{o.title}</span>
                    {p.myVote === o.id && <span className="small">{t('✓ Your vote')}</span>}
                    {asParent && <span className="small muted">{o.votes} votes</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {decided.map((p) => {
            const w = p.options.find((o) => o.id === p.winnerOptionId);
            return w && <p key={p.id} style={{ margin: 0 }}>🏆 <strong>{p.title}</strong> {t('The winner is {w}!', { w: `${w.icon} ${w.title}` })}</p>;
          })}
        </section>
      )}

      <section className="card stack pg-stats">
        <h2 style={{ margin: 0 }}>{t('Badges')} <span className="pill">{earned.length} / {board.achievements.length}</span></h2>
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
        <Calendar kidId={memberId} title={asParent ? `${kid.name}'s calendar` : t('My calendar')} />
      </section>

      {picking && (
        <Modal onClose={() => setPicking(false)}>
          <div className="stack">
            <h2 style={{ margin: 0 }}>{t('Pick your animal friend')}</h2>
            <p className="small muted" style={{ margin: 0 }}>{t('Every animal is yours to pick. Level up to unlock more outfits.')} {level.badge} {level.name}</p>
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
    </LangProvider>
  );
}
