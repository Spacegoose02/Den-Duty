// My teams: a kid's followed teams from the family's sports tracker. Big team-colored cards on the kid's board with
// the live score, a countdown to the next game and the last result, and a one-line version for the family wall.
import { useEffect, useRef, useState } from 'react';
import { useApp, useLoad } from '../state.tsx';
import { confetti } from './Confetti.ts';
import { SpeakButton } from './Speak.tsx';

export interface SportsSide {
  name: string | null; abbreviation: string | null; logo: string | null; color: string | null;
  score: number | null; winner: boolean; rank: number | null;
}
export interface SportsGame {
  id: string; date: string; timeValid: boolean; venue: string | null; broadcast: string | null;
  state: 'pre' | 'in' | 'post'; detail: string | null; isHome: boolean; team: SportsSide; opponent: SportsSide;
}
export interface SportsTeam {
  sport: string; sportLabel: string; id: string; name: string; abbreviation: string | null; logo: string | null;
  color: string | null; record: string | null; rank: number | null;
  liveGame: SportsGame | null; nextGame: SportsGame | null; lastGame: SportsGame | null;
}
/** null: not linked. teams null: linked, but the tracker can't be reached. */
export type KidSports = { teams: SportsTeam[] | null; updatedAt: string | null; stale: boolean } | null;

const SPORT_ICONS: Record<string, string> = {
  cfb: '🏈', nfl: '🏈', cbb: '🏀', wcbb: '🏀', nba: '🏀', wnba: '🏀', mlb: '⚾', nhl: '🏒', mls: '⚽', epl: '⚽', soccer: '⚽', nascar: '🏁', f1: '🏎️',
};
export const sportIcon = (sport: string) => SPORT_ICONS[sport] ?? SPORT_ICONS[sport.replace(/^(w|m)/, '')] ?? '🏆';

const WHEN_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const DAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** Whole calendar days from today to the game (0 = today). */
export function daysUntil(iso: string, now = new Date()): number {
  return Math.round((startOfDay(new Date(iso)) - startOfDay(now)) / 86_400_000);
}

/** "in 2 days, 4 hours", "in 3 h 12 min", "starting now". */
export function countdown(iso: string, now = new Date()): string {
  const ms = Date.parse(iso) - now.getTime();
  if (ms <= 60_000) return 'starting now';
  const min = Math.floor(ms / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d >= 2) return `in ${d} days${h ? `, ${h} h` : ''}`;
  if (d === 1) return `in 1 day, ${h} h`;
  if (h) return `in ${h} h ${m} min`;
  return `in ${m} min`;
}

/** For kids on the picture board: sleeps until game day. */
export function sleepsText(iso: string, now = new Date()): string {
  const n = daysUntil(iso, now);
  if (n <= 0) return "It's game day! 🎉";
  if (n === 1) return '1 more sleep! 😴';
  return `${n} more sleeps 😴`;
}

function whenText(g: SportsGame): string {
  const d = new Date(g.date);
  const n = daysUntil(g.date);
  if (!g.timeValid) return n === 0 ? 'Today' : DAY_FMT.format(d);
  if (n === 0) return `Today ${TIME_FMT.format(d)}`;
  if (n === 1) return `Tomorrow ${TIME_FMT.format(d)}`;
  return WHEN_FMT.format(d);
}

const nameOf = (s: SportsSide) => s.name ?? s.abbreviation ?? 'them';
const shortOf = (s: SportsSide) => s.abbreviation ?? s.name ?? '?';
const vsText = (g: SportsGame) => (g.isHome ? 'vs' : 'at');

function resultOf(g: SportsGame): 'W' | 'L' | 'T' | null {
  const a = g.team.score;
  const b = g.opponent.score;
  if (a == null || b == null) return null;
  if (g.team.winner || a > b) return 'W';
  if (g.opponent.winner || b > a) return 'L';
  return 'T';
}

function Logo({ side, size = 40 }: { side: { logo: string | null; abbreviation: string | null; name: string | null; color: string | null }; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (side.logo && !broken) return <img className="sp-logo" src={side.logo} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(true)} />;
  return (
    <span className="sp-logo sp-logo-text" style={{ width: size, height: size, background: side.color ?? 'var(--muted)', fontSize: size * 0.32 }} aria-hidden>
      {(side.abbreviation ?? side.name ?? '?').slice(0, 4)}
    </span>
  );
}

/** What the read-aloud button says for a team. */
function sayTeam(t: SportsTeam, simple: boolean): string {
  const g = t.liveGame;
  if (g) {
    const a = g.team.score ?? 0;
    const b = g.opponent.score ?? 0;
    return `${t.name} are playing ${nameOf(g.opponent)} right now! ${a > b ? `They're winning, ${a} to ${b}.` : a < b ? `They're behind, ${a} to ${b}.` : `It's tied, ${a} to ${b}.`}`;
  }
  const n = t.nextGame;
  if (n) return `${t.name} play ${nameOf(n.opponent)} next. ${simple ? sleepsText(n.date).replace(/[😴🎉]/gu, '') : whenText(n)}.`;
  return `${t.name}. No game coming up.`;
}

function Score({ g, color }: { g: SportsGame; color: string | null }) {
  const team = { ...g.team, color: g.team.color ?? color };
  return (
    <div className="sp-score" aria-label={`${shortOf(g.team)} ${g.team.score ?? 0}, ${shortOf(g.opponent)} ${g.opponent.score ?? 0}`}>
      <span className="sp-score-side"><Logo side={team} size={34} /><span className="sp-score-num">{g.team.score ?? 0}</span></span>
      <span className="sp-score-dash">–</span>
      <span className="sp-score-side"><span className="sp-score-num">{g.opponent.score ?? 0}</span><Logo side={g.opponent} size={34} /></span>
    </div>
  );
}

export function TeamCard({ team, simple, readAloud }: { team: SportsTeam; simple: boolean; readAloud: boolean }) {
  const live = team.liveGame;
  const next = team.nextGame;
  const last = team.lastGame;
  const res = last ? resultOf(last) : null;
  const today = next && daysUntil(next.date) === 0;
  return (
    <article className={`sp-card${live ? ' live' : ''}${today ? ' gameday' : ''}`} style={{ ['--team' as string]: team.color ?? 'var(--kid, var(--primary))' }}>
      <header className="sp-head">
        <Logo side={team} size={52} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sp-name">{team.rank ? <span className="sp-rank">#{team.rank}</span> : null}{team.name}</div>
          <div className="sp-sub">{sportIcon(team.sport)} {team.sportLabel}{team.record ? ` · ${team.record}` : ''}</div>
        </div>
        {readAloud && <SpeakButton text={sayTeam(team, simple)} />}
      </header>

      {live ? (
        <div className="sp-body">
          <div className="sp-live"><span className="sp-dot" /> {simple ? 'Playing now!' : 'LIVE'} {live.detail && <span className="sp-detail">{live.detail}</span>}</div>
          <Score g={live} color={team.color} />
          {!simple && <div className="sp-sub">{vsText(live)} {nameOf(live.opponent)}{live.broadcast ? ` · 📺 ${live.broadcast}` : ''}</div>}
        </div>
      ) : next ? (
        <div className="sp-body">
          <div className="sp-next">
            <span className="sp-sub">{simple ? 'Next game' : `Next: ${vsText(next)}`}</span>
            <Logo side={next.opponent} size={30} />
            <strong>{next.opponent.rank ? `#${next.opponent.rank} ` : ''}{nameOf(next.opponent)}</strong>
          </div>
          <div className="sp-count">{simple ? sleepsText(next.date) : today ? `🎉 Game day! ${countdown(next.date)}` : `⏳ ${countdown(next.date)}`}</div>
          {!simple && <div className="sp-sub">{whenText(next)}{next.broadcast ? ` · 📺 ${next.broadcast}` : ''}</div>}
        </div>
      ) : (
        <div className="sp-body sp-sub">No games on the schedule right now.</div>
      )}

      {last && !live && res && (
        <div className={`sp-last ${res}`}>
          <span className="sp-result">{res === 'W' ? (simple ? '🎉 Won' : 'W') : res === 'L' ? (simple ? 'Lost' : 'L') : 'Tie'}</span>
          {' '}{last.team.score}–{last.opponent.score} {vsText(last)} {shortOf(last.opponent)}
        </div>
      )}
    </article>
  );
}

/** On a kid's board: their followed teams, refreshed every minute (every 20 s while one is playing). */
export function KidSportsCards({ memberId, simple, readAloud, color }: { memberId: string; simple: boolean; readAloud: boolean; color: string }) {
  const { base } = useApp();
  const [data, reload] = useLoad<{ sports: KidSports }>(`${base}/kids/${memberId}/sports`, [memberId]);
  const sports = data?.sports ?? null;
  const live = !!sports?.teams?.some((t) => t.liveGame);
  const scores = useRef<Map<string, number> | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, live ? 20e3 : 60e3);
    const clock = window.setInterval(() => tick((n) => n + 1), 30e3); // keeps the countdowns moving
    return () => { window.clearInterval(t); window.clearInterval(clock); };
  }, [reload, live]);

  // Confetti when one of their teams scores while they're looking.
  useEffect(() => {
    if (!sports?.teams) return;
    const now = new Map(sports.teams.filter((t) => t.liveGame).map((t) => [t.id, t.liveGame!.team.score ?? 0]));
    const before = scores.current;
    scores.current = now;
    if (!before) return;
    const scored = sports.teams.find((t) => t.liveGame && before.has(t.id) && (now.get(t.id) ?? 0) > (before.get(t.id) ?? 0));
    if (scored) confetti({ colors: [scored.color ?? color, color] });
  }, [sports, color]);

  if (!sports) return null;
  if (!sports.teams) {
    return (
      <section className="card stack sp-section">
        <h2 style={{ margin: 0 }}>🏟️ My teams</h2>
        <p className="muted" style={{ margin: 0 }}>Can't get the scores right now. They'll be back soon!</p>
      </section>
    );
  }
  if (!sports.teams.length) return null;
  // Playing now first, then whoever plays soonest.
  const order = (t: SportsTeam) => (t.liveGame ? 0 : t.nextGame ? Date.parse(t.nextGame.date) : Number.MAX_SAFE_INTEGER);
  const teams = [...sports.teams].sort((a, b) => order(a) - order(b));
  return (
    <section className="card stack sp-section">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>🏟️ My teams</h2>
        {sports.stale && sports.updatedAt && <span className="pill warn">Scores from {TIME_FMT.format(new Date(sports.updatedAt))}</span>}
      </div>
      <div className="sp-grid">
        {teams.map((t) => <TeamCard key={`${t.sport}:${t.id}`} team={t} simple={simple} readAloud={readAloud} />)}
      </div>
    </section>
  );
}

/** On the family wall: one line per team, live ones first, at most three. */
export function WallSports({ sports }: { sports: KidSports | undefined }) {
  if (!sports?.teams?.length) return null;
  const live = sports.teams.filter((t) => t.liveGame);
  const next = sports.teams.filter((t) => !t.liveGame && t.nextGame).sort((a, b) => Date.parse(a.nextGame!.date) - Date.parse(b.nextGame!.date));
  const lines = [...live, ...next].slice(0, 3);
  if (!lines.length) return null;
  return (
    <div className="wall-sports">
      {lines.map((t) => {
        const g = (t.liveGame ?? t.nextGame)!;
        return (
          <div key={`${t.sport}:${t.id}`} className={`wall-sport${t.liveGame ? ' live' : ''}`} style={{ ['--team' as string]: t.color ?? 'var(--kid)' }}>
            <Logo side={t} size={26} />
            {t.liveGame ? (
              <span><span className="sp-dot" /> <strong>{shortOf(g.team)} {g.team.score ?? 0}–{g.opponent.score ?? 0} {shortOf(g.opponent)}</strong>{g.detail ? <span className="wall-sub"> · {g.detail}</span> : null}</span>
            ) : (
              <span><strong>{t.abbreviation ?? t.name}</strong> {vsText(g)} {shortOf(g.opponent)} <span className="wall-sub">· {daysUntil(g.date) === 0 ? `today ${g.timeValid ? TIME_FMT.format(new Date(g.date)) : ''}` : countdown(g.date)}</span></span>
            )}
          </div>
        );
      })}
    </div>
  );
}
