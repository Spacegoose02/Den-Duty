// The weekly recap for parents: last week per kid next to the week before, family totals, highlights and what to work on.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Recap as RecapData } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { ProgressBar } from '../components/Bits.tsx';
import { addDays } from '../../../shared/schedule.ts';

const short = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function Delta({ now, before, unit = '' }: { now: number | null; before: number | null; unit?: string }) {
  if (now == null || before == null || now === before) return null;
  const up = now > before;
  return <span className={`delta ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {Math.abs(now - before)}{unit}</span>;
}

export function Recap() {
  const { base, home, refreshHome } = useApp();
  const [week, setWeek] = useState<string | null>(null);
  const [r] = useLoad<RecapData>(`${base}/recap${week ? `?week=${week}` : ''}`, [week]);
  const [newest, setNewest] = useState<string | null>(null);
  useEffect(() => { if (r && !week) setNewest(r.weekStart); }, [r, week]);
  // Opening it counts as seen, so it stops showing on Home.
  useEffect(() => { void api(`${base}/recap/seen`, { body: {} }).then(() => refreshHome()).catch(() => {}); }, [base, refreshHome]);
  if (!r) return null;
  const icon = home?.pointsIcon ?? '✨';
  const latest = !week || week === newest;
  return (
    <div className="stack">
      <div className="topbar">
        <h1>📊 Weekly recap</h1>
        <div className="row">
          <button onClick={() => setWeek(addDays(r.weekStart, -7))}>← Earlier</button>
          <strong>{short(r.weekStart)} – {short(r.weekEnd)}</strong>
          <button disabled={latest} onClick={() => setWeek(addDays(r.weekStart, 7) >= (newest ?? '') ? null : addDays(r.weekStart, 7))}>Later →</button>
        </div>
      </div>
      <section className="card stats recap-total">
        <div><span className="num">{r.total.points}</span><span className="small muted">{home?.pointsName} earned <Delta now={r.total.points} before={r.total.prevPoints} /></span></div>
        <div><span className="num">{r.total.done}</span><span className="small muted">of {r.total.due} chores done</span></div>
        <div><span className="num">{r.total.rate ?? '–'}{r.total.rate != null && '%'}</span><span className="small muted">done as a family</span></div>
      </section>
      {(r.highlights.length > 0 || r.workOn.length > 0) && (
        <div className="grid-2">
          {r.highlights.length > 0 && (
            <section className="card stack">
              <h2 style={{ margin: 0 }}>🎉 Cheer about</h2>
              {r.highlights.map((h) => <p key={h} style={{ margin: 0 }}>{h}</p>)}
            </section>
          )}
          {r.workOn.length > 0 && (
            <section className="card stack">
              <h2 style={{ margin: 0 }}>🌱 Work on together</h2>
              {r.workOn.map((h) => <p key={h} style={{ margin: 0 }}>{h}</p>)}
            </section>
          )}
        </div>
      )}
      <div className="grid-2">
        {r.kids.map((k) => (
          <section key={k.id} className="card stack" style={{ ['--kid' as string]: k.color }}>
            <div className="row">
              <RaccoonAvatar variant={k.avatar} size={52} />
              <h2 style={{ margin: 0, flex: 1 }}>{k.name}</h2>
              <strong>{k.points} {icon} <Delta now={k.points} before={k.prevPoints} /></strong>
            </div>
            <div className="row small" style={{ justifyContent: 'space-between' }}>
              <span>{k.done} of {k.due} chores</span>
              <span>{k.rate != null ? `${k.rate}%` : 'nothing due'} <Delta now={k.rate} before={k.prevRate} unit="%" /></span>
            </div>
            <ProgressBar percent={k.rate ?? 0} color={k.color} />
            <div className="chips">
              {k.perfectDays > 0 && <span className="pill ok">🌟 {k.perfectDays} perfect day{k.perfectDays === 1 ? '' : 's'}</span>}
              {k.streak > 0 && <span className="pill">🔥 {k.streak}-day streak</span>}
              {k.bonusDone > 0 && <span className="pill">💪 {k.bonusDone} bonus</span>}
              {k.late > 0 && <span className="pill warn">⏰ {k.late} late</span>}
              {k.spent > 0 && <span className="pill">🛍️ spent {k.spent} {icon}</span>}
            </div>
            {k.best && <p className="small" style={{ margin: 0 }}>Best at: {k.best.icon} {k.best.title} ({k.best.done}×)</p>}
            {k.missed && <p className="small" style={{ margin: 0 }}>Missed most: {k.missed.icon} {k.missed.title} ({k.missed.missed}×)</p>}
          </section>
        ))}
      </div>
      <p className="small muted">Every week is kept in <Link to="/stats">Stats → Weekly archive</Link>.</p>
    </div>
  );
}
