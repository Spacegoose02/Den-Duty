import { useState } from 'react';
import type { Kid, KidStats } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { BarList, ChartTable, ColumnChart, LineChart } from '../components/Charts.tsx';
import { ProgressBar, shortDate } from '../components/Bits.tsx';
import { seriesColor } from '../../../shared/catalog.ts';

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
