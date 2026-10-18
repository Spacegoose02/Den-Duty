import { useState } from 'react';
import type { DoctorsStats, GoalStats, Kid, KidStats } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { BarList, ChartTable, ColumnChart, Legend, LineChart } from '../components/Charts.tsx';
import { ProgressBar, shortDate } from '../components/Bits.tsx';
import { seriesColor } from '../../../shared/catalog.ts';
import { AREA_ICONS, AREA_LABELS } from './Doctors.tsx';

type StatsKid = Kid & KidStats;

function trend(weekly: KidStats['weekly']) {
  const cur = weekly.at(-1)?.points ?? 0;
  const prev = weekly.slice(-5, -1);
  const avg = prev.length ? prev.reduce((s, w) => s + w.points, 0) / prev.length : 0;
  return { cur, avg: Math.round(avg) };
}

const pct = (done: number, due: number) => (due ? Math.round((done / due) * 100) : 0);

function KidDetail({ kid, color, missedColor }: { kid: StatsKid; color: string; missedColor: string }) {
  const { home } = useApp();
  const icon = home?.pointsIcon ?? '✨';
  const t = trend(kid.weekly);
  const totals = kid.weekly.reduce((a, w) => ({ done: a.done + w.done, due: a.due + w.due }), { done: 0, due: 0 });
  const weekLabels = kid.weekly.map((w) => shortDate(w.weekStart));
  const dayLabels = kid.daily.map((d) => shortDate(d.date));
  const maxDue = Math.max(1, ...kid.byChore.map((c) => c.due));

  return (
    <div className="stack">
      <div className="tiles-row">
        <div className="card stat-tile">
          <span className="small muted">Raccoon level</span>
          <span className="big">{kid.level.badge} {kid.level.name}</span>
          <ProgressBar percent={kid.level.percent} color={color} />
          <span className="small muted">{kid.level.next ? `${kid.level.next.min - kid.level.points} to ${kid.level.next.name}` : 'Top level!'}</span>
        </div>
        <div className="card stat-tile">
          <span className="small muted">Streak</span>
          <span className="big">🔥 {kid.streak.current} day{kid.streak.current === 1 ? '' : 's'}</span>
          <span className="small muted">Best: {kid.streak.best}</span>
        </div>
        <div className="card stat-tile">
          <span className="small muted">This week</span>
          <span className="big">{t.cur} {icon}</span>
          <span className={`small ${t.cur >= t.avg ? 'trend-up' : 'trend-down'}`}>
            {t.cur >= t.avg ? '▲ above' : '▼ below'} the usual {t.avg}
          </span>
        </div>
        <div className="card stat-tile">
          <span className="small muted">Chores done</span>
          <span className="big">{pct(totals.done, totals.due)}%</span>
          <span className="small muted">{totals.done} of {totals.due} since {shortDate(kid.from)}</span>
        </div>
        <div className="card stat-tile">
          <span className="small muted">Earned all-time</span>
          <span className="big">{kid.lifetime} {icon}</span>
          <span className="small muted">{kid.balance} to spend now</span>
        </div>
      </div>

      <div className="grid-2">
        <section className="card stack">
          <h3 style={{ margin: 0 }}>{home?.pointsName} per day</h3>
          <p className="small muted" style={{ margin: 0 }}>Last 30 days, everything earned (spending on rewards doesn't count against it).</p>
          <ColumnChart labels={dayLabels} segments={[{ id: 'p', name: home?.pointsName ?? 'Points', color, values: kid.daily.map((d) => d.points) }]} />
          <ChartTable labels={dayLabels} series={[{ id: 'p', name: home?.pointsName ?? 'Points', values: kid.daily.map((d) => d.points) }]} />
        </section>
        <section className="card stack">
          <h3 style={{ margin: 0 }}>Chores done vs due, by week</h3>
          <p className="small muted" style={{ margin: 0 }}>The full column is everything due; the colored part got done.</p>
          <ColumnChart labels={weekLabels} segments={[
            { id: 'done', name: 'Done', color, values: kid.weekly.map((w) => w.done) },
            { id: 'open', name: 'Not done (yet)', color: missedColor, values: kid.weekly.map((w) => w.due - w.done) },
          ]} />
          <ChartTable labels={weekLabels} series={[
            { id: 'done', name: 'Done', values: kid.weekly.map((w) => w.done) },
            { id: 'due', name: 'Due', values: kid.weekly.map((w) => w.due) },
          ]} />
        </section>
      </div>

      {kid.doctors && <DoctorsPanel s={kid.doctors} color={color} />}
      {kid.goalStats && <GoalsPanel s={kid.goalStats} color={color} missedColor={missedColor} />}

      <section className="card stack">
        <h3 style={{ margin: 0 }}>Which chores get done</h3>
        <BarList color={color} rows={kid.byChore.map((c) => ({
          key: c.title, label: <span>{c.icon} {c.title}</span>, value: c.done, max: maxDue,
          note: `${c.done}/${c.due} · ${pct(c.done, c.due)}% · ${c.points} ${icon}`,
        }))} />
        {!kid.byChore.length && <p className="muted" style={{ margin: 0 }}>No chores yet in this range.</p>}
      </section>
    </div>
  );
}

// Stable, distinguishable colors for goal areas in the stacked practice chart.
const AREA_COLORS = ['#2f9e44', '#1c7ed6', '#e8590c', '#ae3ec9', '#0c8599', '#f08c00', '#c2255c', '#5c7cfa', '#66a80f', '#868e96', '#d6336c', '#495057'];

function DoctorsPanel({ s, color }: { s: DoctorsStats; color: string }) {
  const labels = s.weeks.map((w) => shortDate(w));
  const series = s.perWeek.map((p, i) => ({ id: p.area, name: `${AREA_ICONS[p.area] ?? ''} ${AREA_LABELS[p.area] ?? p.area}`, color: AREA_COLORS[i % AREA_COLORS.length], values: p.values }));
  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>🩺 Doctors</h2>
      <div className="tiles-row">
        <div className="stat-tile"><span className="small muted">Practice streak</span><span className="big">🌈 {s.streak} day{s.streak === 1 ? '' : 's'}</span></div>
        <div className="stat-tile"><span className="small muted">Practices logged</span><span className="big">{s.practicesInRange}</span><span className="small muted">in this range</span></div>
        <div className="stat-tile"><span className="small muted">Goals reached</span><span className="big">🎉 {s.goalsReached}</span><span className="small muted">{s.goalsReachedInRange} in this range</span></div>
        <div className="stat-tile"><span className="small muted">Appointments</span><span className="big">{s.appointments.attended} kept</span>
          <span className="small muted">{s.appointments.missed} missed · {s.appointments.upcoming} coming up</span></div>
      </div>
      <h3 style={{ margin: 0 }}>Practices per week, by area</h3>
      {series.length ? (
        <>
          <Legend series={series} />
          <ColumnChart labels={labels} segments={series} />
          <ChartTable labels={labels} series={series} />
        </>
      ) : <p className="muted" style={{ margin: 0 }}>No practices logged in this range. Tick scheduled practices off on the calendar, or add a progress note to a goal.</p>}
      {s.goals.length > 0 && (
        <>
          <h3 style={{ margin: 0 }}>Goals progress</h3>
          <BarList color={color} rows={s.goals.map((g) => ({
            key: g.id, label: <span>{AREA_ICONS[g.area] ?? '📌'} {g.title}</span>, value: g.progress, max: 100,
            note: g.status === 'met' ? '🎉 met' : g.status === 'paused' ? `${g.progress}% · paused` : `${g.progress}%`,
          }))} />
        </>
      )}
    </section>
  );
}

function GoalsPanel({ s, color, missedColor }: { s: GoalStats; color: string; missedColor: string }) {
  const { home } = useApp();
  const labels = s.weeks.map((w) => shortDate(w));
  const series = [
    { id: 'reached', name: 'Reached', color, values: s.reachedPerWeek },
    { id: 'redeemed', name: 'Redeemed', color: missedColor, values: s.redeemedPerWeek },
  ];
  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>🎯 Goals</h2>
      <div className="tiles-row">
        <div className="stat-tile"><span className="small muted">Goals reached</span><span className="big">🏆 {s.reachedTotal}</span></div>
        <div className="stat-tile"><span className="small muted">Rewards redeemed</span><span className="big">🎁 {s.redeemedTotal}</span></div>
        <div className="stat-tile"><span className="small muted">Time to reach a goal</span><span className="big">{s.averageDays == null ? '–' : `${s.averageDays} day${s.averageDays === 1 ? '' : 's'}`}</span><span className="small muted">on average</span></div>
      </div>
      {s.active.length > 0 && (
        <BarList color={color} rows={s.active.map((g) => ({
          key: g.id, label: <span>{g.reached ? '🏆' : '🎯'} {g.title}</span>, value: g.percent, max: 100, note: `${g.progress}/${g.target} ${home?.pointsIcon ?? ''}`,
        }))} />
      )}
      {!s.active.length && <p className="muted" style={{ margin: 0 }}>No goals right now.</p>}
      <h3 style={{ margin: 0 }}>Reached and redeemed, by week</h3>
      <LineChart labels={labels} series={series} height={180} />
      <ChartTable labels={labels} series={series} />
      {s.recent.length > 0 && <p className="small muted" style={{ margin: 0 }}>Recently: {s.recent.map((r) => `${r.title} (${r.days} day${r.days === 1 ? '' : 's'})`).join(' · ')}</p>}
    </section>
  );
}

export function Stats() {
  const { base, home, dark } = useApp();
  const [weeks, setWeeks] = useState(12);
  const [data] = useLoad<{ today: string; weeks: number; kids: StatsKid[] }>(`${base}/stats?weeks=${weeks}`);
  const [picked, setPicked] = useState<string | null>(null);
  const kid = data?.kids.find((k) => k.id === picked) ?? data?.kids[0];
  const missedColor = dark ? '#5c636a' : '#ced4da';
  const weekLabels = data?.kids[0]?.weekly.map((w) => shortDate(w.weekStart)) ?? [];
  const compare = data?.kids.map((k) => ({ id: k.id, name: k.name, color: seriesColor(k.color, dark), values: k.weekly.map((w) => w.points) })) ?? [];

  return (
    <div className="stack">
      <div className="topbar">
        <h1>Stats</h1>
        <div className="chips">
          {[4, 12, 26].map((w) => <button key={w} className={`chip${weeks === w ? ' on' : ''}`} onClick={() => setWeeks(w)}>{w} weeks</button>)}
        </div>
      </div>
      {data && !data.kids.length && <div className="card">Add kids and chores, and their charts show up here.</div>}

      {data && data.kids.length > 1 && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>{home?.pointsName} per week, everyone</h2>
          <LineChart labels={weekLabels} series={compare} />
          <ChartTable labels={weekLabels} series={compare} />
        </section>
      )}

      {data && kid && (
        <>
          <div className="chips">
            {data.kids.map((k) => (
              <button key={k.id} className={`chip${kid.id === k.id ? ' on' : ''}`} onClick={() => setPicked(k.id)}>
                <RaccoonAvatar variant={k.avatar} size={28} /> {k.name}
              </button>
            ))}
          </div>
          <KidDetail kid={kid} color={seriesColor(kid.color, dark)} missedColor={missedColor} />
        </>
      )}
    </div>
  );
}
