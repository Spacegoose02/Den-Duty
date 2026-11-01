import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { ProgressBar, dayName } from '../components/Bits.tsx';
import { KidPicker, useKidSignIn } from './KidPicker.tsx';
import { AREA_ICONS, KIND_ICONS, timeText } from './Doctors.tsx';
import { timeLeft } from '../components/Timeouts.tsx';
import type { KidPage } from '../../../shared/pages.ts';
import type { TeamGoal } from '../api.ts';
import { TeamBar } from '../components/TeamGoals.tsx';

interface WallKid {
  id: string; name: string; avatar: string; color: string; theme: string | null; hasPin: boolean; pagesOff: KidPage[]; balance: number;
  level: { level: number; name: string; badge: string } | null;
  chores: { done: number; waiting: number; total: number } | null;
  goal: { title: string; percent: number; progress: number; target: number; reached: boolean } | null;
  streak: number | null; badgesToday: { id: string; icon: string; title: string }[]; denMessage: string | null;
  timeouts: { id: string; what: string; state: string; endsAt: string; startsAt: string; minutesLeft: number }[];
  penalties: { reason: string; amount: number }[];
  doctorGoals: { id: string; title: string; area: string; progress: number }[];
}
interface WallDay { date: string; kids: { kidId: string; chores: number; done: number; practices: number; appointments: { id: string; kind: string; title: string; time: string }[] }[] }
interface Wall {
  home: { name: string; pointsName: string; pointsIcon: string; theme: string; timezone: string };
  today: string; tomorrow: string;
  settings: { landing: 'wall' | 'picker'; dim: { on: boolean; from: string; to: string } };
  kids: WallKid[]; family: WallDay[]; lunch: { title: string; time: string | null }[];
  polls: { id: string; title: string; options: { id: string; title: string; icon: string }[]; voted: number }[];
  teamGoals: TeamGoal[];
  /** From LootDen, the family's game library, when it's linked. */
  lootden?: LootDenWall | null;
}
interface LootDenWall {
  nowPlaying: { name: string; title: string; device: string; playedFor: string }[];
  nextGameNight: { id: number; title: string; date: string; time: string; game: { title: string } | null; players: { name: string }[]; goal: { icon: string; title: string } | null } | null;
  screenshots: { id: number; imageUrl: string; by: string; game: string | null; caption: string | null }[];
}

/** The family's screenshots from LootDen, one at a time, a new one every ten seconds. */
function ShotShow({ shots }: { shots: LootDenWall['screenshots'] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((x) => x + 1), 10e3);
    return () => window.clearInterval(t);
  }, []);
  const s = shots[i % shots.length];
  return (
    <figure className="wall-shot">
      <img src={s.imageUrl} alt={s.caption ?? `${s.by}'s screenshot`} />
      <figcaption className="wall-sub">📸 {s.by}{s.game ? ` · ${s.game}` : ''}{s.caption ? ` · “${s.caption}”` : ''}</figcaption>
    </figure>
  );
}

const REFRESH_MS = 60e3;
const CLOCK_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const DATE_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

/** Is the local time inside a dim window (which may cross midnight, e.g. 21:00 to 06:30)? */
export function inWindow(now: Date, from: string, to: string): boolean {
  const m = now.getHours() * 60 + now.getMinutes();
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  const f = fh * 60 + fm;
  const t = th * 60 + tm;
  return f <= t ? m >= f && m < t : m >= f || m < t;
}

function Ring({ done, total, color }: { done: number; total: number; color: string }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <svg className="wall-ring" viewBox="0 0 110 110" role="img" aria-label={`${done} of ${total} chores done`}>
      <circle cx="55" cy="55" r={r} fill="none" stroke="color-mix(in srgb, currentColor 14%, transparent)" strokeWidth="11" />
      <circle cx="55" cy="55" r={r} fill="none" stroke={total && done === total ? 'var(--ok)' : color} strokeWidth="11" strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 55 55)" />
      <text x="55" y="52" textAnchor="middle" className="wall-ring-num">{done}/{total}</text>
      <text x="55" y="72" textAnchor="middle" className="wall-ring-label">{total && done === total ? 'all done!' : 'chores'}</text>
    </svg>
  );
}

/**
 * The family tablet's home page: every kid at once, made to be read from across the room. Live (refreshes every
 * minute), a clock on top, optional night dimming, and a slow few-pixel drift so a wall screen doesn't burn in.
 * Tapping a kid opens their sign-in and then their board; the board's idle timeout brings the wall back.
 */
export function FamilyWall() {
  const [wall, reload] = useLoad<Wall>('/api/kiosk/wall');
  const [now, setNow] = useState(new Date());
  const sign = useKidSignIn();

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 15e3);
    const data = window.setInterval(() => void reload(), REFRESH_MS);
    const wake = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', wake);
    return () => { window.clearInterval(clock); window.clearInterval(data); document.removeEventListener('visibilitychange', wake); };
  }, [reload]);

  if (!wall) return <div className="center-screen"><RaccoonAvatar variant="ninja" size={96} title="Loading" /></div>;
  if (wall.settings.landing === 'picker') return <KidPicker />;

  const dim = wall.settings.dim.on && inWindow(now, wall.settings.dim.from, wall.settings.dim.to);
  // Burn-in: move everything a few pixels every few minutes, in a slow loop.
  const step = Math.floor(now.getTime() / 180e3) % 8;
  const drift = [[0, 0], [3, 1], [5, 3], [3, 5], [0, 6], [-3, 5], [-5, 3], [-3, 1]][step];
  const kidsById = new Map(wall.kids.map((k) => [k.id, k]));
  const n = wall.kids.length;
  const icon = wall.home.pointsIcon;

  return (
    <div className={`wall${dim ? ' dim' : ''}`} style={{ ['--cols' as string]: String(n <= 4 ? Math.max(n, 1) : 3), ['--cols-p' as string]: String(n <= 1 ? 1 : 2) }}>
      <div className="wall-inner" style={{ transform: `translate(${drift[0]}px, ${drift[1]}px)` }}>
        <header className="wall-head">
          <div className="wall-clock">{CLOCK_FMT.format(now)}</div>
          <div style={{ flex: 1 }}>
            <div className="wall-date">{DATE_FMT.format(now)}</div>
            <div className="wall-home">{wall.home.name}</div>
          </div>
          <Link to="/picker" className="btn ghost wall-parents">🦝 Pick a raccoon</Link>
          <Link to="/login" className="btn ghost wall-parents">🔒 Parents</Link>
        </header>

        <div className="wall-kids">
          {wall.kids.map((k) => (
            <button key={k.id} className="wall-kid" data-theme={k.theme ?? undefined} style={{ ['--kid' as string]: k.color }} onClick={() => sign.start(k)}
              aria-label={`${k.name}: open my board`}>
              <div className="wall-kid-top">
                <span className="wall-avatar">
                  <RaccoonAvatar variant={k.avatar} size={84} />
                  {k.level && <span className="level-badge" title={`Level ${k.level.level}: ${k.level.name}`}>{k.level.badge}</span>}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="wall-name">{k.name}</div>
                  {k.level && <div className="wall-sub">{k.level.name}</div>}
                </div>
              </div>
              <div className="wall-kid-mid">
                {k.chores && <Ring done={k.chores.done} total={k.chores.total} color={k.color} />}
                <div className="wall-stats">
                  <div><span className="wall-big">{k.balance}</span> <span className="wall-sub">{icon} {wall.home.pointsName}</span></div>
                  {k.streak != null && k.streak > 0 && <div className="wall-streak">🔥 {k.streak}-day streak</div>}
                  {k.chores && k.chores.waiting > 0 && <div className="wall-sub">⏳ {k.chores.waiting} waiting for a grown-up</div>}
                </div>
              </div>
              {k.goal && (
                <div className="wall-goal">
                  <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                    <span className="wall-goal-title">{k.goal.reached ? '🏆' : '🎯'} {k.goal.title}</span>
                    <span className="wall-sub">{k.goal.progress}/{k.goal.target}</span>
                  </div>
                  <ProgressBar percent={k.goal.percent} color={k.goal.reached ? 'var(--ok)' : k.color} />
                </div>
              )}
              {k.badgesToday.length > 0 && (
                <div className="wall-badges">{k.badgesToday.map((b) => <span key={b.id} className="pill ok" title={b.title}>{b.icon} {b.title}</span>)}</div>
              )}
              {k.timeouts.map((t) => (
                <div key={t.id} className="wall-note">⏳ Break from {t.what}{t.state === 'active' ? ` · back in ${timeLeft(t.minutesLeft)}` : ' · starts later'}</div>
              ))}
              {k.penalties.map((p, i) => <div key={i} className="wall-note">🌱 Working on: {p.reason}</div>)}
              {k.doctorGoals.slice(0, 2).map((g) => <div key={g.id} className="wall-note">{AREA_ICONS[g.area] ?? '🌈'} {g.title} · {g.progress}%</div>)}
              {k.denMessage && <div className="wall-den">{k.denMessage}</div>}
            </button>
          ))}
          {!n && <div className="card">No kids yet. A parent can add them in Kids.</div>}
        </div>

        <section className="wall-strip">
          {wall.family.map((d, i) => (
            <div key={d.date} className="wall-day">
              <div className="wall-day-title">{i === 0 ? 'Today' : 'Tomorrow'} <span className="wall-sub">{dayName(d.date)}</span></div>
              {d.kids.map((x) => {
                const k = kidsById.get(x.kidId);
                if (!k || (!x.chores && !x.practices && !x.appointments.length)) return null;
                return (
                  <div key={x.kidId} className="wall-line" style={{ borderLeftColor: k.color }}>
                    <strong>{k.name}</strong>
                    {x.chores > 0 && <span> · {x.chores} chore{x.chores === 1 ? '' : 's'}{i === 0 && ` (${x.done} done)`}</span>}
                    {x.practices > 0 && <span> · 🌈 {x.practices}</span>}
                    {x.appointments.map((a) => <span key={a.id} className="wall-appt"> · {KIND_ICONS[a.kind] ?? '📌'} {timeText(a.time)} {a.title}</span>)}
                  </div>
                );
              })}
            </div>
          ))}
          {wall.lunch.length > 0 && (
            <div className="wall-day">
              <div className="wall-day-title">🍎 Lunch today</div>
              {wall.lunch.map((l, i) => <div key={i} className="wall-line">{l.title}</div>)}
            </div>
          )}
          {wall.teamGoals?.map((g) => (
            <div key={g.id} className="wall-day">
              <div className="wall-day-title">🤝 {g.icon} {g.title}</div>
              <TeamBar goal={g} />
              <div className="wall-sub">{g.reached ? '🎉 The family made it!' : `${g.progress} / ${g.target} together`}</div>
            </div>
          ))}
          {wall.lootden?.nowPlaying.length ? (
            <div className="wall-day">
              <div className="wall-day-title">🎮 Playing now</div>
              {wall.lootden.nowPlaying.map((p, i) => <div key={i} className="wall-line"><strong>{p.name}</strong> · {p.title} <span className="wall-sub">· {p.playedFor}</span></div>)}
            </div>
          ) : null}
          {wall.lootden?.nextGameNight && (
            <div className="wall-day">
              <div className="wall-day-title">🎲 {wall.lootden.nextGameNight.title}</div>
              <div className="wall-line">{dayName(wall.lootden.nextGameNight.date)} at {wall.lootden.nextGameNight.time}{wall.lootden.nextGameNight.game ? ` · ${wall.lootden.nextGameNight.game.title}` : ''}</div>
              <div className="wall-sub">{wall.lootden.nextGameNight.players.map((p) => p.name).join(', ')}{wall.lootden.nextGameNight.goal ? ` · earned with ${wall.lootden.nextGameNight.goal.icon} ${wall.lootden.nextGameNight.goal.title}` : ''}</div>
            </div>
          )}
          {wall.lootden?.screenshots.length ? <div className="wall-day"><ShotShow shots={wall.lootden.screenshots} /></div> : null}
          {wall.polls.map((p) => (
            <div key={p.id} className="wall-day">
              <div className="wall-day-title">🗳️ {p.title}</div>
              <div className="wall-line">{p.options.map((o) => `${o.icon} ${o.title}`).join(' · ')}</div>
              <div className="wall-sub">{p.voted} of {n} voted · vote on your board</div>
            </div>
          ))}
        </section>
      </div>
      {sign.error && <p className="wall-error">{sign.error}</p>}
      {sign.modal}
    </div>
  );
}
