// Allowance and jars: the kid's three jars on their board, and the parents' Allowance page.
import { useState } from 'react';
import { api, type Jar, type KidMoney, type MoneyPage } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from './Raccoon.tsx';
import { Modal } from './Bits.tsx';
import { WEEKDAY_NAMES } from '../../../shared/schedule.ts';
import { SpeakButton } from './Speak.tsx';

export const JAR_INFO: Record<Jar, { icon: string; label: string; hint: string }> = {
  spend: { icon: '🛍️', label: 'Spend', hint: 'Yours to use' },
  save: { icon: '🐷', label: 'Save', hint: 'For something big' },
  give: { icon: '💝', label: 'Give', hint: 'To help others' },
};
const JAR_IDS: Jar[] = ['spend', 'save', 'give'];

export const fmt = (cents: number, symbol: string) => `${cents < 0 ? '−' : ''}${symbol}${(Math.abs(cents) / 100).toFixed(2)}`;
/** "2.50" → 250; anything odd → NaN. */
const toCents = (v: string) => Math.round(Number(v.replace(/[^0-9.]/g, '')) * 100);

/** The kid's jars on their board. */
export function KidJars({ money, color, readAloud }: { money: KidMoney; color: string; readAloud: boolean }) {
  const max = Math.max(1, ...JAR_IDS.map((j) => money.jars[j]));
  const say = JAR_IDS.map((j) => `${JAR_INFO[j].label} jar: ${fmt(money.jars[j], money.symbol)}`).join('. ');
  return (
    <section className="card stack pg-goals">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>💰 My money</h2>
        {readAloud && <SpeakButton text={say} />}
        <strong>{fmt(money.total, money.symbol)}</strong>
      </div>
      <div className="jar-row">
        {JAR_IDS.map((j) => (
          <div key={j} className={`jar jar-${j}`}>
            <div className="jar-glass"><div className="jar-fill" style={{ height: `${Math.round((money.jars[j] / max) * 100)}%`, background: color }} /></div>
            <span className="jar-icon" aria-hidden>{JAR_INFO[j].icon}</span>
            <strong>{fmt(money.jars[j], money.symbol)}</strong>
            <span className="small muted">{JAR_INFO[j].label}</span>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {money.allowanceCents > 0 && `${fmt(money.allowanceCents, money.symbol)} allowance every ${WEEKDAY_NAMES[money.allowanceDay]}. `}
        {money.interest > 0 && `Your Save jar grows ${money.interest / 10}% every month! `}
        {money.centsPerPoint > 0 && 'Ask a grown-up to turn points into money.'}
      </p>
    </section>
  );
}

type Action = { kind: 'cashout' | 'withdraw' | 'deposit' | 'move'; kidId: string };

function ActionForm({ a, page, onClose, onDone }: { a: Action; page: MoneyPage; onClose: () => void; onDone: () => void }) {
  const { base, home, toast } = useApp();
  const kid = page.kids.find((k) => k.id === a.kidId)!;
  const sym = page.settings.symbol;
  const [points, setPoints] = useState(Math.min(kid.balance, 50));
  const [amount, setAmount] = useState('');
  const [jar, setJar] = useState<Jar | 'split'>(a.kind === 'deposit' ? 'split' : 'spend');
  const [to, setTo] = useState<Jar>('save');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const url = `${base}/money/kids/${kid.id}/${a.kind}`;
  async function go() {
    setError(null);
    try {
      const cents = toCents(amount);
      if (a.kind === 'cashout') await api(url, { body: { points } });
      else if (a.kind === 'move') await api(url, { body: { from: jar, to, cents } });
      else await api(url, { body: { jar: jar === 'split' ? null : jar, cents, reason } });
      toast('Done');
      onDone();
    } catch (e) { setError((e as Error).message); }
  }
  const titles = { cashout: `Turn ${home?.pointsName ?? 'points'} into money`, withdraw: 'Take money out', deposit: 'Add money', move: 'Move between jars' };
  return (
    <Modal onClose={onClose}>
      <div className="stack">
        <h2 style={{ margin: 0 }}>{titles[a.kind]} for {kid.name}</h2>
        {a.kind === 'cashout' ? (
          <>
            <label className="field">{home?.pointsName} to cash out (has {kid.balance})
              <input type="number" min={1} max={kid.balance} value={points} onChange={(e) => setPoints(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
            </label>
            <p style={{ margin: 0 }}>= <strong>{fmt(points * page.settings.centsPerPoint, sym)}</strong>, split {JAR_IDS.map((j) => `${page.settings.split[j]}% ${JAR_INFO[j].label}`).join(', ')}</p>
          </>
        ) : (
          <>
            <label className="field">Amount ({sym})
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5.00" autoFocus />
            </label>
            <div className="chips">
              {a.kind === 'deposit' && <button type="button" className={`chip${jar === 'split' ? ' on' : ''}`} onClick={() => setJar('split')}>Split like usual</button>}
              {JAR_IDS.map((j) => <button key={j} type="button" className={`chip${jar === j ? ' on' : ''}`} onClick={() => setJar(j)}>{a.kind === 'move' ? 'From ' : ''}{JAR_INFO[j].icon} {JAR_INFO[j].label} {a.kind !== 'deposit' && `(${fmt(kid.jars[j], sym)})`}</button>)}
            </div>
            {a.kind === 'move' && (
              <div className="chips">{JAR_IDS.filter((j) => j !== jar).map((j) => <button key={j} type="button" className={`chip${to === j ? ' on' : ''}`} onClick={() => setTo(j)}>To {JAR_INFO[j].icon} {JAR_INFO[j].label}</button>)}</div>
            )}
            {a.kind !== 'move' && <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={a.kind === 'withdraw' ? 'What was it for? e.g. Lego set' : 'e.g. Birthday money from Grandma'} maxLength={80} />}
          </>
        )}
        {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <div className="row"><span className="spacer" /><button className="ghost" onClick={onClose}>Cancel</button><button className="primary" onClick={() => void go()}>OK</button></div>
      </div>
    </Modal>
  );
}

/** Parents: turn it on, set the rate, the split, interest and each kid's weekly allowance; move money around. */
export function AllowancePage() {
  const { base, home, toast } = useApp();
  const [page, reload] = useLoad<MoneyPage>(`${base}/money`);
  const [action, setAction] = useState<Action | null>(null);
  if (!page) return null;
  const s = page.settings;
  const sym = s.symbol;
  const save = async (body: object) => {
    try { await api(`${base}/money/settings`, { method: 'PATCH', body }); await reload(); } catch (e) { toast((e as Error).message); }
  };
  // Spend takes up the slack so the split always adds up to 100.
  const setSplit = (j: 'save' | 'give', v: number) => {
    const split = { ...s.split, [j]: v };
    split.spend = 100 - split.save - split.give;
    if (split.spend >= 0) void save({ split });
  };
  return (
    <div className="stack">
      <div className="topbar"><h1>💰 Allowance & jars</h1></div>
      <section className="card stack">
        <label className="row" style={{ fontWeight: 700 }}>
          <input type="checkbox" checked={s.enabled} onChange={(e) => void save({ enabled: e.target.checked })} style={{ width: 24, minHeight: 24 }} />
          Use allowance and money jars
        </label>
        <p className="small muted" style={{ margin: 0 }}>Kids see three jars on their board: Spend, Save and Give. Turn {home?.pointsName} into money, pay a weekly allowance, and reward saving with interest. The money here is a record; you hand over the real thing.</p>
        {s.enabled && (
          <div className="grid-2">
            <label className="field">Money symbol
              <input defaultValue={sym} maxLength={4} onBlur={(e) => e.target.value !== sym && void save({ symbol: e.target.value })} style={{ maxWidth: 100 }} />
            </label>
            <label className="field">1 {home?.pointsIcon} is worth (cents)
              <input type="number" min={0} max={10000} defaultValue={s.centsPerPoint} onBlur={(e) => Number(e.target.value) !== s.centsPerPoint && void save({ centsPerPoint: Math.round(Number(e.target.value)) })} style={{ maxWidth: 140 }} />
            </label>
            <div className="field">Split new money
              <div className="stack" style={{ gap: 4 }}>
                {(['save', 'give'] as const).map((j) => (
                  <label key={j} className="row">{JAR_INFO[j].icon} {JAR_INFO[j].label}
                    <input type="range" min={0} max={100} step={5} value={s.split[j]} onChange={(e) => setSplit(j, Number(e.target.value))} style={{ flex: 1 }} />
                    <strong style={{ width: 44 }}>{s.split[j]}%</strong>
                  </label>
                ))}
                <span className="small">{JAR_INFO.spend.icon} Spend gets the rest: <strong>{s.split.spend}%</strong></span>
              </div>
            </div>
            <label className="field">Interest on the Save jar, each month
              <select value={s.interest} onChange={(e) => void save({ interest: Number(e.target.value) })} style={{ maxWidth: 200 }}>
                {[0, 5, 10, 20, 50, 100].map((n) => <option key={n} value={n}>{n ? `${n / 10}% a month` : 'None'}</option>)}
              </select>
            </label>
          </div>
        )}
      </section>
      {s.enabled && page.kids.map((k) => (
        <section key={k.id} className="card stack">
          <div className="row">
            <RaccoonAvatar variant={k.avatar} size={48} />
            <h2 style={{ margin: 0, flex: 1 }}>{k.name}</h2>
            <strong style={{ fontSize: '1.3rem' }}>{fmt(k.total, sym)}</strong>
          </div>
          <div className="jar-row">
            {JAR_IDS.map((j) => (
              <div key={j} className="jar small-jar"><span className="jar-icon">{JAR_INFO[j].icon}</span><strong>{fmt(k.jars[j], sym)}</strong><span className="small muted">{JAR_INFO[j].label}</span></div>
            ))}
          </div>
          <div className="row">
            <span>Weekly allowance</span>
            <input inputMode="decimal" defaultValue={(k.allowanceCents / 100).toFixed(2)} style={{ width: 100 }}
              onBlur={async (e) => { const c = toCents(e.target.value); if (Number.isFinite(c) && c !== k.allowanceCents) { try { await api(`${base}/money/kids/${k.id}`, { method: 'PATCH', body: { allowanceCents: c } }); toast('Allowance saved'); await reload(); } catch (err) { toast((err as Error).message); } } }} />
            <span>every</span>
            <select value={k.allowanceDay} style={{ width: 'auto' }} onChange={async (e) => { await api(`${base}/money/kids/${k.id}`, { method: 'PATCH', body: { allowanceDay: Number(e.target.value) } }); await reload(); }}>
              {WEEKDAY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
          </div>
          <div className="row">
            <button className="primary" disabled={!k.balance || !s.centsPerPoint} onClick={() => setAction({ kind: 'cashout', kidId: k.id })}>{home?.pointsIcon} → {sym} Cash out ({k.balance})</button>
            <button onClick={() => setAction({ kind: 'deposit', kidId: k.id })}>＋ Add money</button>
            <button onClick={() => setAction({ kind: 'withdraw', kidId: k.id })}>− Take out</button>
            <button onClick={() => setAction({ kind: 'move', kidId: k.id })}>⇄ Move</button>
          </div>
          {k.history.length > 0 && (
            <details>
              <summary className="small">History</summary>
              <div className="list">
                {k.history.map((h) => (
                  <div key={h.id} className="row small" style={{ padding: '3px 0', flexWrap: 'nowrap' }}>
                    <span className="muted" style={{ width: 90 }}>{h.date}</span>
                    <span aria-hidden>{JAR_INFO[h.jar].icon}</span>
                    <span style={{ flex: 1 }}>{h.reason}{h.by && <span className="muted"> · {h.by}</span>}</span>
                    <strong style={{ color: h.cents < 0 ? 'var(--danger)' : 'var(--ok)' }}>{h.cents > 0 ? '+' : ''}{fmt(h.cents, sym)}</strong>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      ))}
      {action && <ActionForm a={action} page={page} onClose={() => setAction(null)} onDone={() => { setAction(null); void reload(); }} />}
    </div>
  );
}
