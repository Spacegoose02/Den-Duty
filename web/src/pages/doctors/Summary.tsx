// The visit summary: one page per kid to print or save as a PDF and hand to the doctor or therapist.
// The same view (without the health card) is what a therapist sees on a shared link.
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { VisitSummary } from '../../api.ts';
import { useApp, useLoad } from '../../state.tsx';
import { shortDate } from '../../components/Bits.tsx';
import { LineChart } from '../../components/Charts.tsx';
import { AREA_ICONS, AREA_LABELS, KIND_ICONS, whenText } from '../Doctors.tsx';
import { KIND_ICON } from './HealthLog.tsx';
import { heightText, weightText, yearDate } from './Health.tsx';
import { seriesColor } from '../../../../shared/catalog.ts';

export function SummaryView({ s, color, extra }: { s: VisitSummary; color: string; extra?: (goalId: string) => ReactNode }) {
  const units = localStorage.getItem('dd-units') === 'us' ? 'us' : 'metric';
  const latest = s.growth[0];
  return (
    <div className="stack summary-sheet">
      <header className="card stack">
        <div className="row">
          <h1 style={{ margin: 0, flex: 1 }}>{s.kid.name}{s.kid.age != null && <span className="muted" style={{ fontWeight: 600 }}> · {s.kid.age} years</span>}</h1>
          <span className="pill">{shortDate(s.from)} – {shortDate(s.to)}</span>
        </div>
        {s.profile && (
          <div className="grid-2 small">
            <div><span className="muted">Allergies: </span><strong style={{ color: s.profile.allergies ? 'var(--danger)' : undefined }}>{s.profile.allergies || 'none listed'}</strong></div>
            <div><span className="muted">Conditions: </span>{s.profile.conditions || 'none listed'}</div>
            {s.kid.birthdate && <div><span className="muted">Born: </span>{yearDate(s.kid.birthdate)}{s.profile.bloodType && ` · blood type ${s.profile.bloodType}`}</div>}
            {latest && <div><span className="muted">Last measured ({yearDate(latest.date)}): </span>{[heightText(latest.heightCm, units), weightText(latest.weightKg, units)].filter(Boolean).join(', ')}</div>}
          </div>
        )}
      </header>

      {s.next && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>{KIND_ICONS[s.next.kind] ?? '📌'} Next visit: {s.next.title}{s.next.provider && ` with ${s.next.provider}`}</h2>
          <div className="small muted">{whenText(s.next.startsAt)}</div>
          {s.next.questions.length > 0 && (
            <>
              <strong className="small">Questions to ask</strong>
              <ul style={{ margin: 0 }}>{s.next.questions.map((q, i) => <li key={i}>{q.done ? '✓ ' : ''}{q.text}</li>)}</ul>
            </>
          )}
        </section>
      )}

      <section className="stack">
        <h2 style={{ margin: 0 }}>Goals</h2>
        {!s.goals.length && <div className="card muted">No goals in this period.</div>}
        <div className="grid-2">
          {s.goals.map((g) => {
            const change = g.startProgress != null ? g.progress - g.startProgress : null;
            return (
              <div key={g.id} className="card stack summary-goal">
                <div className="row">
                  <span style={{ fontSize: '1.4rem' }} aria-hidden>{AREA_ICONS[g.area] ?? '📌'}</span>
                  <div style={{ flex: 1 }}>
                    <strong>{g.title}</strong>
                    <div className="small muted">{AREA_LABELS[g.area] ?? g.area}{g.status === 'met' ? ` · 🎉 met ${g.metAt ? shortDate(g.metAt.slice(0, 10)) : ''}` : g.status === 'paused' ? ' · paused' : ''}{g.targetDate && ` · aiming for ${shortDate(g.targetDate)}`}</div>
                  </div>
                  <strong style={{ fontSize: '1.2rem' }}>{g.progress}%</strong>
                </div>
                <div className="small">
                  {change != null && <span className={`pill${change > 0 ? ' ok' : change < 0 ? ' warn' : ''}`}>{change ? `${change > 0 ? '▲ up' : '▼ down'} ${Math.abs(change)}% this period` : '= no change this period'}</span>}{' '}
                  <span className="pill">{g.practiced} practice{g.practiced === 1 ? '' : 's'}{g.scheduled ? ` of ${g.scheduled} planned` : ''}</span>
                </div>
                {g.description && <p className="small" style={{ margin: 0 }}>{g.description}</p>}
                {g.history.length >= 2 && (
                  <LineChart height={120} unit="%" labels={g.history.map((h) => shortDate(h.date))} series={[{ id: g.id, name: 'Progress', color, values: g.history.map((h) => h.progress) }]} />
                )}
                {extra?.(g.id)}
              </div>
            );
          })}
        </div>
      </section>

      {s.meds.length > 0 && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>💊 Medicines</h2>
          <table className="summary-table">
            <thead><tr><th>Medicine</th><th>When</th><th>Given</th><th>Missed</th><th>On time</th></tr></thead>
            <tbody>
              {s.meds.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.name}</strong>{m.dose && ` ${m.dose}`}{!m.active && ' (stopped)'}</td>
                  <td>{[m.times.join(', '), m.asNeeded ? 'when needed' : ''].filter(Boolean).join(' · ')}</td>
                  <td>{m.adherence.given}{m.adherence.asNeeded ? ` + ${m.adherence.asNeeded} as needed` : ''}</td>
                  <td>{m.adherence.missed}{m.adherence.skipped ? ` (+${m.adherence.skipped} skipped)` : ''}</td>
                  <td>{m.adherence.percent != null ? `${m.adherence.percent}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {s.log && s.log.total > 0 && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>📓 Log ({s.log.total} entries)</h2>
          <table className="summary-table">
            <thead><tr><th>What</th><th>Times</th><th>Avg strength</th><th>Avg minutes</th></tr></thead>
            <tbody>
              {s.log.groups.map((g) => (
                <tr key={`${g.kind}${g.label}`}><td>{KIND_ICON[g.kind]} {g.label}</td><td>{g.count}</td><td>{g.avgSeverity != null ? `${g.avgSeverity}/5` : '—'}</td><td>{g.avgMinutes ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
          {s.log.recent.some((e) => e.trigger || e.note) && (
            <>
              <strong className="small">Recent details</strong>
              {s.log.recent.filter((e) => e.trigger || e.note).slice(0, 10).map((e) => (
                <div key={e.id} className="small">{shortDate(e.date)}{e.time && ` ${e.time}`} · {e.label}{e.trigger && ` · set off by ${e.trigger}`}{e.note && ` · ${e.note}`}</div>
              ))}
            </>
          )}
        </section>
      )}

      {s.appointments.length > 0 && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>📅 Visits</h2>
          {s.appointments.map((a, i) => (
            <div key={i} className="small">
              <strong>{shortDate(a.date)}</strong> · {KIND_ICONS[a.kind] ?? '📌'} {a.title}{a.provider && ` with ${a.provider}`} · {a.status === 'scheduled' ? 'not marked' : a.status}
              {a.summary && <div>“{a.summary}”</div>}
            </div>
          ))}
        </section>
      )}

      {s.notes.length > 0 && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>📝 Notes</h2>
          {s.notes.map((n, i) => (
            <div key={i} className="small">
              <strong>{shortDate(n.date)}</strong>{n.goalTitle && ` · ${n.goalTitle}`}{n.progress != null && ` · ${n.progress}%`}{n.by && <span className="muted"> · {n.by}</span>}
              <div>{n.body}</div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/** /doctors/summary/:memberId?days=30 — the printable visit summary. */
export function VisitSummaryPage() {
  const { memberId } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { base, home, dark } = useApp();
  const days = Number(params.get('days')) || 30;
  const [custom, setCustom] = useState({ from: params.get('from') ?? '', to: params.get('to') ?? '' });
  const range = custom.from && custom.to ? `from=${custom.from}&to=${custom.to}` : `days=${days}`;
  const url = memberId ? `${base}/kids/${memberId}/health/summary?${range}` : null;
  const [s, , error] = useLoad<VisitSummary>(url, [url]);
  const kid = home?.kids.find((k) => k.id === memberId);
  return (
    <div className="stack">
      <div className="topbar no-print">
        <button className="ghost" onClick={() => nav('/doctors')}>← Doctors</button>
        <h1 style={{ flex: 1 }}>Visit summary</h1>
        <button className="primary" onClick={() => window.print()} disabled={!s}>🖨️ Print or save as PDF</button>
      </div>
      <div className="row no-print">
        <div className="seg">
          {[14, 30, 90, 180].map((d) => (
            <button key={d} className={!custom.from && days === d ? 'on' : ''} onClick={() => { setCustom({ from: '', to: '' }); setParams({ days: String(d) }); }}>{d} days</button>
          ))}
        </div>
        <label className="row small">From <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} style={{ width: 160 }} /></label>
        <label className="row small">to <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} style={{ width: 160 }} /></label>
      </div>
      {error && <div className="card">{error}</div>}
      {s && <SummaryView s={s} color={kid ? seriesColor(kid.color, dark) : 'var(--primary)'} />}
      {s && <p className="small muted">Made with Den Duty on {shortDate(s.today)}. Notes and logs are from the family; they're not medical records.</p>}
    </div>
  );
}
