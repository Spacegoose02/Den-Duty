import { useEffect, useState } from 'react';
import { api, type Timeout } from '../api.ts';
import { useApp } from '../state.tsx';
import { Modal } from './Bits.tsx';

/** "2 days 3 hours", "45 minutes": the biggest two units, so a countdown stays readable. */
export function timeLeft(minutes: number): string {
  if (minutes <= 0) return 'any second now';
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (d) return h ? `${part(d, 'day')} ${part(h, 'hour')}` : part(d, 'day');
  if (h) return m ? `${part(h, 'hour')} ${part(m, 'minute')}` : part(h, 'hour');
  return part(m, 'minute');
}

const WHEN_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** Minutes left right now, ticking every 20 seconds so the countdown moves without reloading. */
function useMinutesLeft(t: Timeout): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 20000); return () => window.clearInterval(id); }, []);
  const from = Math.max(now, Date.parse(t.startsAt));
  return Math.max(0, Math.ceil((Date.parse(t.endsAt) - from) / 60000));
}

/** One time-out as a kid sees it (kindly worded), with the buy-back ask; parents get answer/extend/end buttons. */
export function TimeoutCard({ t, asParent, balance, kidName, onChange }: {
  t: Timeout; asParent: boolean; balance: number; kidName?: string; onChange: () => void;
}) {
  const { base, home, toast } = useApp();
  const icon = home?.pointsIcon ?? '✨';
  const left = useMinutesLeft(t);
  const [units, setUnits] = useState(1);
  const [busy, setBusy] = useState(false);
  const [extending, setExtending] = useState(false);
  const [ext, setExt] = useState({ length: 1, unit: 'hours' });
  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    setBusy(true);
    try { await fn(); if (msg) toast(msg); onChange(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const unit = t.buy?.unit ?? 'hour';
  const cost = units * (t.buy?.price ?? 0);
  const upcoming = t.state === 'upcoming';

  return (
    <div className="timeout-card">
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <span className="timeout-icon" aria-hidden>⏳</span>
        <div style={{ flex: 1 }}>
          <div className="timeout-what">{asParent && kidName ? `${kidName}: ` : asParent ? '' : 'Taking a break from: '}<strong>{t.what}</strong></div>
          {t.reason && <div className="small muted">{asParent ? 'Why: ' : 'What to work on: '}{t.reason}</div>}
          <div className="timeout-left">
            {upcoming ? `Starts ${WHEN_FMT.format(new Date(t.startsAt))}, for ${timeLeft(left)}` : asParent ? `${timeLeft(left)} left` : `Back in ${timeLeft(left)}`}
          </div>
          {!asParent && !upcoming && <div className="small">You've got this. Every minute counts down. 💛</div>}
          {asParent && t.buy && <div className="small muted">Can buy back: {t.buy.price} {icon} per {t.buy.unit}, up to {t.buy.maxMinutes / (t.buy.unit === 'day' ? 1440 : 60)} {t.buy.unit}s{t.buy.boughtMinutes ? ` · ${timeLeft(t.buy.boughtMinutes)} bought so far` : ''}</div>}
        </div>
      </div>

      {t.pending && (
        <div className="timeout-ask">
          <span style={{ flex: 1 }}>
            {asParent ? `Wants to trade ${t.pending.points} ${icon} for ${timeLeft(t.pending.minutes)} off`
              : `Asked a grown-up: ${timeLeft(t.pending.minutes)} off for ${t.pending.points} ${icon}`}
          </span>
          {asParent ? (
            <>
              <button className="ghost" disabled={busy} onClick={() => void run(() => api(`${base}/timeout-requests/${t.pending!.id}/deny`, { body: {} }), 'Said not this time')}>Not now</button>
              <button className="primary" disabled={busy} onClick={() => void run(() => api(`${base}/timeout-requests/${t.pending!.id}/approve`, { body: {} }), `Took ${t.pending!.points} ${icon}, ${timeLeft(t.pending!.minutes)} off`)}>Approve</button>
            </>
          ) : (
            <button className="ghost" disabled={busy} onClick={() => void run(() => api(`${base}/timeout-requests/${t.pending!.id}`, { method: 'DELETE' }))}>Never mind</button>
          )}
        </div>
      )}

      {!asParent && t.buy && !t.pending && t.buy.unitsLeft > 0 && (
        <div className="timeout-ask">
          <span>Trade {icon} for time?</span>
          <button className="icon" disabled={units <= 1} onClick={() => setUnits(units - 1)} aria-label="Less">−</button>
          <strong>{units} {unit}{units === 1 ? '' : 's'}</strong>
          <button className="icon" disabled={units >= t.buy.unitsLeft} onClick={() => setUnits(units + 1)} aria-label="More">＋</button>
          <span className="small muted" style={{ flex: 1 }}>{cost} {icon}</span>
          <button className="primary" disabled={busy || cost > balance}
            onClick={() => void run(() => api(`${base}/timeouts/${t.id}/requests`, { body: { units } }), 'Sent to a grown-up!')}>
            {cost > balance ? `Need ${cost - balance} more` : 'Ask a grown-up'}
          </button>
        </div>
      )}

      {asParent && (
        <div className="row">
          <span className="spacer" />
          <button className="ghost" disabled={busy} onClick={() => setExtending(!extending)}>＋ Add time</button>
          <button className="ghost" disabled={busy} onClick={() => { if (confirm(`End “${t.what}” now?`)) void run(() => api(`${base}/timeouts/${t.id}`, { method: 'PATCH', body: { end: true } }), 'Time-out ended'); }}>End now</button>
        </div>
      )}
      {asParent && extending && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); void run(() => api(`${base}/timeouts/${t.id}`, { method: 'PATCH', body: { extend: ext } }), 'Added time').then(() => setExtending(false)); }}>
          <input type="number" min={1} value={ext.length} onChange={(e) => setExt({ ...ext, length: Number(e.target.value) })} style={{ width: 80 }} />
          <select value={ext.unit} onChange={(e) => setExt({ ...ext, unit: e.target.value })}>
            <option value="hours">hours</option><option value="days">days</option><option value="weeks">weeks</option>
          </select>
          <button className="primary" disabled={busy || !(ext.length > 0)}>Add</button>
        </form>
      )}
    </div>
  );
}

const IDEAS = ['No Roblox', 'No tablet', 'No TV', 'No video games', 'No phone', 'No YouTube', 'No sleepovers', 'No dessert'];

/** Parents start a time-out: what's paused, why, how long, from when, and whether points can buy time back. */
export function TimeoutForm({ kidId, kidName, onClose, onDone }: { kidId: string; kidName: string; onClose: () => void; onDone: () => void }) {
  const { base, home, toast } = useApp();
  const icon = home?.pointsIcon ?? '✨';
  const [f, setF] = useState({ what: '', reason: '', length: 1, unit: 'days', later: false, startsAt: '', buy: false, buyUnit: 'hour', buyPrice: 5, buyMaxUnits: 4 });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`${base}/kids/${kidId}/timeouts`, {
        body: {
          what: f.what, reason: f.reason, length: f.length, unit: f.unit,
          startsAt: f.later && f.startsAt ? new Date(f.startsAt).toISOString() : undefined,
          ...(f.buy ? { buyUnit: f.buyUnit, buyPrice: f.buyPrice, buyMaxUnits: f.buyMaxUnits } : {}),
        },
      });
      toast(`Time-out started for ${kidName}`);
      onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2 style={{ margin: 0 }}>⏳ Time-out for {kidName}</h2>
        <p className="small muted" style={{ margin: 0 }}>{kidName} sees what's paused, the reason and a countdown, worded kindly.</p>
        <input placeholder="What's paused, e.g. No Roblox" value={f.what} onChange={(e) => setF({ ...f, what: e.target.value })} autoFocus maxLength={80} />
        <div className="chips">{IDEAS.map((i) => <button type="button" key={i} className={`chip${f.what === i ? ' on' : ''}`} onClick={() => setF({ ...f, what: i })}>{i}</button>)}</div>
        <input placeholder="Reason, e.g. Played past bedtime" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={300} />
        <div className="row">
          <span>For</span>
          <input type="number" min={1} value={f.length} onChange={(e) => setF({ ...f, length: Number(e.target.value) })} style={{ width: 80 }} />
          <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
            <option value="hours">hours</option><option value="days">days</option><option value="weeks">weeks</option>
          </select>
          <label className="row small check-row"><input type="checkbox" checked={f.later} onChange={(e) => setF({ ...f, later: e.target.checked })} /> Start later</label>
          {f.later && <input type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />}
        </div>
        <label className="row check-row"><input type="checkbox" checked={f.buy} onChange={(e) => setF({ ...f, buy: e.target.checked })} /> Let {kidName} buy time back with {home?.pointsName}</label>
        {f.buy && (
          <div className="row">
            <input type="number" min={1} value={f.buyPrice} onChange={(e) => setF({ ...f, buyPrice: Number(e.target.value) })} style={{ width: 80 }} />
            <span>{icon} per</span>
            <select value={f.buyUnit} onChange={(e) => setF({ ...f, buyUnit: e.target.value })}><option value="hour">hour</option><option value="day">day</option></select>
            <span>, at most</span>
            <input type="number" min={1} value={f.buyMaxUnits} onChange={(e) => setF({ ...f, buyMaxUnits: Number(e.target.value) })} style={{ width: 70 }} />
            <span>{f.buyUnit}s off. You approve each one.</span>
          </div>
        )}
        <div className="row">
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !f.what.trim() || !(f.length > 0) || (f.later && !f.startsAt)}>Start time-out</button>
        </div>
      </form>
    </Modal>
  );
}
