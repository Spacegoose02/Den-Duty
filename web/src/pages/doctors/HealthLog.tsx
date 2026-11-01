// The symptom, mood and behavior log: quick taps ("meltdown, 10 min, at bedtime") and charts that help spot
// patterns and triggers to bring up with the doctor or therapist.
import { useState } from 'react';
import { api, type LogEntry, type LogKind } from '../../api.ts';
import { useApp, useLoad } from '../../state.tsx';
import { Modal, shortDate } from '../../components/Bits.tsx';
import { BarList, ColumnChart } from '../../components/Charts.tsx';
import { KID_COLORS, seriesColor } from '../../../../shared/catalog.ts';

export const LOG_KINDS: { id: LogKind; icon: string; label: string; picks: string[] }[] = [
  { id: 'mood', icon: '🙂', label: 'Mood', picks: ['😀 Happy', '😌 Calm', '😢 Sad', '😟 Worried', '😠 Angry', '😴 Tired'] },
  { id: 'behavior', icon: '🧩', label: 'Behavior', picks: ['🌋 Meltdown', '✋ Hitting', '🙅 Refusing', '🏃 Ran off', '🌟 Great day', '🤝 Shared nicely'] },
  { id: 'symptom', icon: '🤒', label: 'Symptom', picks: ['🌡️ Fever', '🤧 Cough', '🤢 Stomach ache', '🤕 Headache', '🔴 Rash', '😮‍💨 Wheezing'] },
  { id: 'sleep', icon: '🌙', label: 'Sleep', picks: ['😴 Slept well', '🌃 Woke at night', '👻 Nightmare', '⏰ Late bedtime', '🛌 Nap'] },
  { id: 'other', icon: '📌', label: 'Other', picks: [] },
];
export const KIND_ICON = Object.fromEntries(LOG_KINDS.map((k) => [k.id, k.icon])) as Record<LogKind, string>;
/** Kid color slots, so the chart colors work on light and dark themes. */
const KIND_COLOR: Record<LogKind, string> = { mood: KID_COLORS[6], behavior: KID_COLORS[3], symptom: KID_COLORS[5], sleep: KID_COLORS[4], other: KID_COLORS[7] };
const STRENGTH = ['', 'Tiny', 'Small', 'Medium', 'Big', 'Huge'];

interface Draft { kind: LogKind; label: string; date: string; time: string; severity: number | null; minutes: string; trigger: string; note: string }

function LogForm({ draft, onSave, onClose }: { draft: Draft; onSave: (d: Draft) => Promise<void>; onClose: () => void }) {
  const [d, setD] = useState(draft);
  const kind = LOG_KINDS.find((k) => k.id === d.kind)!;
  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void onSave(d); }}>
        <h2 style={{ margin: 0 }}>{kind.icon} Log {kind.label.toLowerCase()}</h2>
        <div className="chips">{LOG_KINDS.map((k) => <button key={k.id} type="button" className={`chip${d.kind === k.id ? ' on' : ''}`} onClick={() => setD({ ...d, kind: k.id })}>{k.icon} {k.label}</button>)}</div>
        <div className="chips">{kind.picks.map((p) => <button key={p} type="button" className={`chip${d.label === p ? ' on' : ''}`} onClick={() => setD({ ...d, label: p })}>{p}</button>)}</div>
        <input placeholder="What happened? e.g. Meltdown" value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} maxLength={60} />
        <div className="row">
          <input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} style={{ width: 160 }} aria-label="Date" />
          <input type="time" value={d.time} onChange={(e) => setD({ ...d, time: e.target.value })} style={{ width: 130 }} aria-label="Time" />
          <input type="number" min={0} placeholder="Minutes" value={d.minutes} onChange={(e) => setD({ ...d, minutes: e.target.value })} style={{ width: 110 }} aria-label="How many minutes" />
        </div>
        <div className="small muted">How big was it?</div>
        <div className="chips">
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={`chip${d.severity === n ? ' on' : ''}`} onClick={() => setD({ ...d, severity: d.severity === n ? null : n })}>{n} · {STRENGTH[n]}</button>)}
        </div>
        <input placeholder="What set it off? e.g. Screen time ending (optional)" value={d.trigger} onChange={(e) => setD({ ...d, trigger: e.target.value })} />
        <textarea placeholder="Anything else (optional)" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} style={{ minHeight: 60 }} />
        <div className="row"><span className="spacer" /><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={!d.label.trim()}>Save</button></div>
      </form>
    </Modal>
  );
}

const nowTime = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const partOfDay = (t: string | null) => !t ? null : t < '05:00' ? 'Night' : t < '12:00' ? 'Morning' : t < '17:00' ? 'Afternoon' : t < '21:00' ? 'Evening' : 'Night';
/** Monday-start week label for a date. */
const weekOf = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

export function LogTab({ kid, today, dark }: { kid: { id: string; name: string }; today: string; dark: boolean }) {
  const { base, toast } = useApp();
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState<LogKind | 'all'>('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const url = `${base}/kids/${kid.id}/health/log?days=${days}`;
  const [data, reload] = useLoad<{ from: string; to: string; entries: LogEntry[] }>(url, [url]);
  const run = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); if (msg) toast(msg); await reload(); } catch (e) { toast((e as Error).message); } };
  const start = (kind: LogKind, label = '') => setDraft({ kind, label, date: today, time: nowTime(), severity: null, minutes: '', trigger: '', note: '' });
  const entries = (data?.entries ?? []).filter((e) => filter === 'all' || e.kind === filter);

  // Weekly counts by kind.
  const weeks: string[] = [];
  if (data) for (let w = weekOf(data.from); w <= data.to; w = new Date(Date.parse(`${w}T00:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10)) weeks.push(w);
  const kindsShown = LOG_KINDS.filter((k) => entries.some((e) => e.kind === k.id));
  const segments = kindsShown.map((k) => ({
    id: k.id, name: k.label, color: seriesColor(KIND_COLOR[k.id], dark), values: weeks.map((w) => entries.filter((e) => e.kind === k.id && weekOf(e.date) === w).length),
  }));
  // Most common things, with average strength.
  const groups = new Map<string, { label: string; kind: LogKind; n: number; sev: number[] }>();
  for (const e of entries) {
    const key = `${e.kind}:${e.label.toLowerCase()}`;
    const gr = groups.get(key) ?? { label: e.label, kind: e.kind, n: 0, sev: [] };
    gr.n++;
    if (e.severity) gr.sev.push(e.severity);
    groups.set(key, gr);
  }
  const top = [...groups.values()].sort((a, b) => b.n - a.n).slice(0, 8);
  const triggers = new Map<string, number>();
  for (const e of entries) if (e.trigger) triggers.set(e.trigger.trim().toLowerCase(), (triggers.get(e.trigger.trim().toLowerCase()) ?? 0) + 1);
  const topTriggers = [...triggers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const parts = ['Morning', 'Afternoon', 'Evening', 'Night'].map((p) => ({ p, n: entries.filter((e) => partOfDay(e.time) === p).length }));
  const color = seriesColor(KID_COLORS[3], dark);

  return (
    <div className="stack">
      <section className="card stack">
        <h2 style={{ margin: 0 }}>Log something for {kid.name}</h2>
        <div className="chips">
          {LOG_KINDS.filter((k) => k.picks.length).flatMap((k) => k.picks.slice(0, 3).map((p) => (
            <button key={p} className="chip" onClick={() => start(k.id, p)}>{p}</button>
          )))}
          <button className="chip" onClick={() => start('behavior')}>＋ Something else</button>
        </div>
      </section>

      <div className="row">
        <div className="chips" style={{ flex: 1 }}>
          <button className={`chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>All</button>
          {LOG_KINDS.map((k) => <button key={k.id} className={`chip${filter === k.id ? ' on' : ''}`} onClick={() => setFilter(k.id)}>{k.icon} {k.label}</button>)}
        </div>
        <div className="seg">
          {[14, 30, 90].map((d) => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d} days</button>)}
        </div>
      </div>

      {data && entries.length > 0 && (
        <div className="grid-2">
          <section className="card stack">
            <h3 style={{ margin: 0 }}>Each week</h3>
            <ColumnChart height={180} labels={weeks.map(shortDate)} segments={segments} />
          </section>
          <section className="card stack">
            <h3 style={{ margin: 0 }}>Most often</h3>
            <BarList color={color} rows={top.map((t) => ({
              key: `${t.kind}:${t.label}`, label: <>{KIND_ICON[t.kind]} {t.label}</>, value: t.n, max: top[0].n,
              note: `${t.n}×${t.sev.length ? ` · avg ${Math.round((t.sev.reduce((a, b) => a + b, 0) / t.sev.length) * 10) / 10}/5` : ''}`,
            }))} />
            {parts.some((p) => p.n) && (
              <>
                <h3 style={{ margin: 0 }}>Time of day</h3>
                <BarList color={color} rows={parts.map((p) => ({ key: p.p, label: p.p, value: p.n, max: Math.max(...parts.map((x) => x.n)), note: String(p.n) }))} />
              </>
            )}
            {topTriggers.length > 0 && (
              <>
                <h3 style={{ margin: 0 }}>Common triggers</h3>
                <div className="chips">{topTriggers.map(([t, n]) => <span key={t} className="pill">{t} · {n}×</span>)}</div>
              </>
            )}
          </section>
        </div>
      )}

      <section className="card stack">
        <h3 style={{ margin: 0 }}>Entries</h3>
        {data && !entries.length && <p className="muted" style={{ margin: 0 }}>Nothing logged in the last {days} days. Tap a button above when something happens; the charts fill in as you go.</p>}
        {entries.map((e) => (
          <div key={e.id} className="list-item">
            <span style={{ fontSize: '1.4rem' }} aria-hidden>{KIND_ICON[e.kind]}</span>
            <div style={{ flex: 1 }}>
              <strong>{e.label}</strong>
              {e.severity != null && <span className="muted"> · {STRENGTH[e.severity]} ({e.severity}/5)</span>}
              {e.minutes != null && <span className="muted"> · {e.minutes} min</span>}
              <div className="small muted">{shortDate(e.date)}{e.time && ` · ${e.time}`}{e.trigger && ` · set off by ${e.trigger}`}{e.by && ` · ${e.by}`}</div>
              {e.note && <div className="small">{e.note}</div>}
            </div>
            <button className="ghost danger" aria-label="Delete" onClick={() => { if (confirm('Delete this entry?')) void run(() => api(`${base}/health/log/${e.id}`, { method: 'DELETE' })); }}>✕</button>
          </div>
        ))}
      </section>

      {draft && (
        <LogForm draft={draft} onClose={() => setDraft(null)} onSave={(d) => run(async () => {
          await api(`${base}/kids/${kid.id}/health/log`, { body: { ...d, minutes: d.minutes === '' ? null : Number(d.minutes), time: d.time || null } });
          setDraft(null);
        }, 'Logged')} />
      )}
    </div>
  );
}
