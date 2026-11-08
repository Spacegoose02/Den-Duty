// Caregivers in Settings (the code, who's a caregiver, until when) and the two-homes card on the Kids page.
import { useState } from 'react';
import { api, type HomeDetail } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { dayName } from './Bits.tsx';

/** Settings → Parents: the caregiver code and each person's access. */
export function CaregiverControls({ home }: { home: HomeDetail }) {
  const { base, toast, refreshHome } = useApp();
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); await refreshHome(); } catch (e) { toast((e as Error).message); } };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <span>Caregiver code (grandparents, sitters):</span>
        {home.caregiverCode
          ? <><strong className="pair-code" style={{ fontSize: '1.4rem' }}>{home.caregiverCode}</strong>
            <button onClick={() => void run(() => api(`${base}/caregiver-code`, { body: {} }))}>New code</button>
            <button className="ghost" onClick={() => void run(() => api(`${base}/caregiver-code`, { method: 'DELETE' }))}>Turn off</button></>
          : <button onClick={() => void run(() => api(`${base}/caregiver-code`, { body: {} }))}>Make a caregiver code</button>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Caregivers see today's chores and the calendar, approve chores and practice, answer the Helpdesk, run time-outs, give quick rewards and use the lists.
        They don't see settings, money, doctors, feelings or exports.
      </p>
    </div>
  );
}

/** One parent row's access controls (for full parents managing others). */
export function AccessControls({ p }: { p: NonNullable<HomeDetail['parents']>[number] }) {
  const { base, toast, refreshHome } = useApp();
  const patch = async (body: object) => { try { await api(`${base}/parents/${p.id}`, { method: 'PATCH', body }); await refreshHome(); } catch (e) { toast((e as Error).message); } };
  if (p.access !== 'caregiver') return <button className="ghost small" onClick={() => void patch({ access: 'caregiver' })}>Make caregiver</button>;
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className="pill">Caregiver</span>
      <label className="small">until <input type="date" value={p.accessUntil ?? ''} onChange={(e) => void patch({ until: e.target.value || null })} style={{ width: 160 }} /></label>
      <button className="ghost small" onClick={() => void patch({ access: 'full' })}>Make full parent</button>
    </span>
  );
}

interface AwayRange { id: string; start: string; end: string; label: string | null }
interface AwayView {
  plan: { label: string; anchor: string; days: boolean[] } | null; ranges: AwayRange[];
  today: { label: string; back: string | null } | null; presets: { id: string; name: string; days: boolean[] }[];
}

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const mondayOf = (d: Date) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

/** Kids page: a kid who lives in two homes. No chores are due here on days they're away. */
export function TwoHomesCard({ kidId, kidName }: { kidId: string; kidName: string }) {
  const { base, toast } = useApp();
  const [v, reload] = useLoad<AwayView>(`${base}/kids/${kidId}/away`, [kidId]);
  const [label, setLabel] = useState<string | null>(null);
  const [range, setRange] = useState({ start: '', end: '', label: '' });
  if (!v) return null;
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); await reload(); } catch (e) { toast((e as Error).message); } };
  const name = label ?? v.plan?.label ?? "At Dad's";
  const setPlan = (days: boolean[] | null, anchor = v.plan?.anchor ?? mondayOf(new Date())) =>
    run(() => api(`${base}/kids/${kidId}/away/plan`, { method: 'PUT', body: days ? { label: name, anchor, days } : null }));
  const days = v.plan?.days ?? [];
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h3 style={{ margin: 0 }}>🏠🏠 Two homes</h3>
      <p className="small muted" style={{ margin: 0 }}>
        On days {kidName} is at the other home, no chores are due here and their board says where they are. Streaks don't break.
        {v.today && <> <strong>Today: {v.today.label}{v.today.back ? `, back ${dayName(v.today.back)}` : ''}.</strong></>}
      </p>
      <div className="row">
        <input value={name} onChange={(e) => setLabel(e.target.value)} onBlur={() => { if (v.plan && label && label !== v.plan.label) void setPlan(days); }} maxLength={40} aria-label="What the board says" style={{ width: 180 }} />
        <select value={v.presets.find((p) => JSON.stringify(p.days) === JSON.stringify(days))?.id ?? (days.length ? 'custom' : '')}
          onChange={(e) => { const p = v.presets.find((x) => x.id === e.target.value); void setPlan(p ? p.days : null); }} aria-label="Pattern">
          <option value="">No regular pattern</option>
          {v.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          {days.length > 0 && !v.presets.some((p) => JSON.stringify(p.days) === JSON.stringify(days)) && <option value="custom">Custom</option>}
        </select>
        {v.plan && <label className="small">from <input type="date" value={v.plan.anchor} onChange={(e) => e.target.value && void setPlan(days, e.target.value)} style={{ width: 160 }} /></label>}
      </div>
      {days.length > 0 && (
        <div className="away-grid" role="group" aria-label="Tap a day to switch it">
          {days.map((away, i) => (
            <button key={i} type="button" className={`away-day${away ? ' on' : ''}`} aria-pressed={away}
              onClick={() => void setPlan(days.map((d, j) => (j === i ? !d : d)))}>
              <span className="small">{i >= 7 ? 'wk 2 ' : ''}{DAY[(new Date(`${v.plan!.anchor}T12:00:00`).getDay() + 6 + i) % 7]}</span>
              {away ? '🚗' : '🏠'}
            </button>
          ))}
        </div>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); void run(() => api(`${base}/kids/${kidId}/away/dates`, { body: { ...range, end: range.end || range.start } })).then(() => setRange({ start: '', end: '', label: '' })); }}>
        <span className="small">Away</span>
        <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} aria-label="First day away" style={{ width: 160 }} />
        <span className="small">to</span>
        <input type="date" value={range.end} min={range.start} onChange={(e) => setRange({ ...range, end: e.target.value })} aria-label="Last day away" style={{ width: 160 }} />
        <input value={range.label} onChange={(e) => setRange({ ...range, label: e.target.value })} placeholder="Like Camp" maxLength={40} style={{ width: 140 }} />
        <button disabled={!range.start}>Add</button>
      </form>
      {v.ranges.map((r) => (
        <div key={r.id} className="row small">
          <span style={{ flex: 1 }}>{r.label || name}: {r.start}{r.end !== r.start ? ` to ${r.end}` : ''}</span>
          <button className="ghost small" onClick={() => void run(() => api(`${base}/kids/${kidId}/away/dates/${r.id}`, { method: 'DELETE' }))}>Remove</button>
        </div>
      ))}
    </div>
  );
}
