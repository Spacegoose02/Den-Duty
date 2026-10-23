import { useState } from 'react';
import type { ArchivedWeek, ArchiveWeek, Kid } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { ChartTable, LineChart } from '../components/Charts.tsx';
import { shortDate } from '../components/Bits.tsx';
import { seriesColor } from '../../../shared/catalog.ts';
import { addDays } from '../../../shared/schedule.ts';

const pct = (done: number, due: number) => (due ? Math.round((done / due) * 100) : 0);
const weekLabel = (w: { weekStart: string; weekEnd: string }) => `${shortDate(w.weekStart)} – ${shortDate(w.weekEnd)}`;

/** "▲ 3" / "▼ 2" / "same" against the comparison week; `lowerIsBetter` flips the colors (penalties). */
function Delta({ now, then, suffix = '', lowerIsBetter = false }: { now: number; then: number | undefined; suffix?: string; lowerIsBetter?: boolean }) {
  if (then == null) return null;
  const d = now - then;
  if (!d) return <span className="small muted"> same</span>;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return <span className={`small ${good ? 'trend-up' : 'trend-down'}`}> {d > 0 ? '▲' : '▼'} {Math.abs(d)}{suffix}</span>;
}

function csv(weeks: ArchiveWeek[], kids: Kid[]): string {
  const name = (id: string) => kids.find((k) => k.id === id)?.name ?? '';
  const q = (v: string | number) => (typeof v === 'number' ? String(v) : `"${v.replace(/"/g, '""')}"`);
  const head = ['Week start', 'Week end', 'Kid', 'Points', 'Chores done', 'Chores due', 'Done %', 'Bonus chores', 'Perfect days', 'Streak', 'Penalties', 'Spent', 'Rewards', 'Balance'];
  const rows = [...weeks].reverse().flatMap((w) => w.kids.map((k) => [w.weekStart, w.weekEnd, name(k.memberId), k.points, k.done, k.due, pct(k.done, k.due),
    k.bonusDone, k.perfectDays, k.streak, k.penalties, k.spent, k.rewards, k.balance]));
  return [head, ...rows].map((r) => r.map(q).join(',')).join('\n');
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One kid's chores in the picked week, next to the comparison week. */
function ChoreCompare({ a, b }: { a: ArchivedWeek; b: ArchivedWeek | undefined }) {
  const { home } = useApp();
  const icon = home?.pointsIcon ?? '✨';
  const titles = [...new Map([...a.chores, ...(b?.chores ?? [])].map((c) => [`${c.icon} ${c.title}`, c])).keys()];
  const find = (w: ArchivedWeek | undefined, key: string) => w?.chores.find((c) => `${c.icon} ${c.title}` === key);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead><tr><th>Chore</th><th>This week</th>{b && <th>Compared week</th>}<th>{icon}</th></tr></thead>
        <tbody>
          {titles.map((t) => {
            const x = find(a, t);
            const y = find(b, t);
            return (
              <tr key={t}>
                <td>{t}</td>
                <td>{x ? `${x.done}/${x.due} (${pct(x.done, x.due)}%)` : '–'}{x && y && <Delta now={pct(x.done, x.due)} then={pct(y.done, y.due)} suffix="%" />}</td>
                {b && <td className="muted">{y ? `${y.done}/${y.due} (${pct(y.done, y.due)}%)` : '–'}</td>}
                <td>{x?.points ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!titles.length && <p className="muted" style={{ margin: 0 }}>No chores that week.</p>}
    </div>
  );
}

/** The weekly archive: every finished week, frozen, with any two weeks side by side and the long-run trend. */
export function WeeklyArchive() {
  const { base, home, dark } = useApp();
  const [data] = useLoad<{ today: string; thisWeek: string; weeks: ArchiveWeek[] }>(`${base}/archive`);
  const [picked, setPicked] = useState<string | null>(null);
  const [against, setAgainst] = useState<string | null>(null);
  const [kidId, setKidId] = useState<string | null>(null);
  const kids = home?.kids ?? [];
  const icon = home?.pointsIcon ?? '✨';

  if (!data) return null;
  const weeks = data.weeks;
  if (!weeks.length) return <div className="card">The archive fills in as weeks finish. Check back after this week is over.</div>;

  const i = Math.max(0, weeks.findIndex((w) => w.weekStart === picked));
  const week = weeks[i];
  // Compare with the week before by default; "none" turns comparing off.
  const other = against === 'none' ? undefined : weeks.find((w) => w.weekStart === against) ?? weeks[i + 1];
  const kidName = (id: string) => kids.find((k) => k.id === id);
  const shown = week.kids.find((k) => k.memberId === kidId) ?? week.kids[0];
  const shownKid = shown && kidName(shown.memberId);

  const chrono = [...weeks].reverse();
  const labels = chrono.map((w) => shortDate(w.weekStart));
  const ids = [...new Set(weeks.flatMap((w) => w.kids.map((k) => k.memberId)))];
  const line = (pick: (k: ArchivedWeek) => number) => ids.map((id) => {
    const k = kidName(id);
    return { id, name: k?.name ?? '?', color: seriesColor(k?.color ?? '#868e96', dark), values: chrono.map((w) => { const r = w.kids.find((x) => x.memberId === id); return r ? pick(r) : 0; }) };
  });

  return (
    <div className="stack">
      <section className="card stack">
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button onClick={() => setPicked(weeks[i + 1]?.weekStart ?? week.weekStart)} disabled={i + 1 >= weeks.length} aria-label="Older week">◀</button>
          <select value={week.weekStart} onChange={(e) => setPicked(e.target.value)} style={{ width: 'auto' }} aria-label="Week">
            {weeks.map((w) => <option key={w.weekStart} value={w.weekStart}>Week of {weekLabel(w)}</option>)}
          </select>
          <button onClick={() => setPicked(weeks[i - 1]?.weekStart ?? week.weekStart)} disabled={i === 0} aria-label="Newer week">▶</button>
          <span className="small muted">compared with</span>
          <select value={against ?? ''} onChange={(e) => setAgainst(e.target.value || null)} style={{ width: 'auto' }} aria-label="Compare with">
            <option value="">The week before</option>
            {weeks.filter((w) => w.weekStart !== week.weekStart).map((w) => <option key={w.weekStart} value={w.weekStart}>Week of {weekLabel(w)}</option>)}
            <option value="none">Nothing</option>
          </select>
          <button className="ghost" style={{ marginLeft: 'auto' }} onClick={() => download(`den-duty-weeks-${data.today}.csv`, csv(weeks, kids))}>⬇ CSV</button>
        </div>
        {!week.final && <p className="small muted" style={{ margin: 0 }}>⏳ This week is still open for late approvals until {shortDate(addDays(week.weekEnd, 7))}; after that it's frozen.</p>}
        {other && <p className="small muted" style={{ margin: 0 }}>Arrows compare with the week of {weekLabel(other)}.</p>}

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Kid</th><th>{home?.pointsName ?? 'Points'}</th><th>Chores done</th><th>Perfect days</th><th>Streak</th><th>Bonus</th><th>Penalties</th><th>Rewards</th></tr></thead>
            <tbody>
              {week.kids.map((k) => {
                const o = other?.kids.find((x) => x.memberId === k.memberId);
                const kid = kidName(k.memberId);
                return (
                  <tr key={k.memberId}>
                    <td><span className="row" style={{ gap: 6 }}>{kid && <RaccoonAvatar variant={kid.avatar} size={24} />} {kid?.name}</span></td>
                    <td>{k.points} {icon}<Delta now={k.points} then={o?.points} /></td>
                    <td>{k.done}/{k.due} ({pct(k.done, k.due)}%)<Delta now={pct(k.done, k.due)} then={o && pct(o.done, o.due)} suffix="%" /></td>
                    <td>{k.perfectDays}<Delta now={k.perfectDays} then={o?.perfectDays} /></td>
                    <td>🔥 {k.streak}</td>
                    <td>{k.bonusDone}<Delta now={k.bonusDone} then={o?.bonusDone} /></td>
                    <td>{k.penalties ? `−${k.penalties}` : '0'}<Delta now={k.penalties} then={o?.penalties} lowerIsBetter /></td>
                    <td>{k.rewards ? `🎁 ${k.rewards} (${k.spent} ${icon})` : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {shown && (
        <section className="card stack">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Chore by chore{shownKid ? ` for ${shownKid.name}` : ''}</h3>
            <div className="chips">
              {week.kids.map((k) => {
                const kid = kidName(k.memberId);
                return <button key={k.memberId} className={`chip${shown.memberId === k.memberId ? ' on' : ''}`} onClick={() => setKidId(k.memberId)}>
                  {kid && <RaccoonAvatar variant={kid.avatar} size={24} />} {kid?.name}
                </button>;
              })}
            </div>
          </div>
          <ChoreCompare a={shown} b={other?.kids.find((x) => x.memberId === shown.memberId)} />
        </section>
      )}

      {chrono.length > 1 && (
        <div className="grid-2">
          <section className="card stack">
            <h3 style={{ margin: 0 }}>{home?.pointsName ?? 'Points'} per week, every archived week</h3>
            <LineChart labels={labels} series={line((k) => k.points)} />
            <ChartTable labels={labels} series={line((k) => k.points)} />
          </section>
          <section className="card stack">
            <h3 style={{ margin: 0 }}>Chores done, % of due</h3>
            <LineChart labels={labels} series={line((k) => pct(k.done, k.due))} unit="%" />
            <ChartTable labels={labels} series={line((k) => pct(k.done, k.due))} />
          </section>
        </div>
      )}
    </div>
  );
}

