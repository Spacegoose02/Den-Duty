import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Goal, type Kid, type LedgerEntry } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { Modal, ProgressBar, shortDate } from '../components/Bits.tsx';
import { AVATARS, AVATAR_LABELS, KID_COLORS } from '../../../shared/catalog.ts';

interface KidDraft { name: string; avatar: string; color: string; pin: string }

/** Name, raccoon, color and PIN. Used to add a kid and to edit one. */
function KidForm({ initial, onSubmit, submitLabel, hasPin, onClearPin }: {
  initial: KidDraft; onSubmit: (d: KidDraft) => Promise<void>; submitLabel: string; hasPin?: boolean; onClearPin?: () => void;
}) {
  const [d, setD] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      setError(null);
      try { await onSubmit(d); } catch (err) { setError((err as Error).message); }
    }}>
      <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Name" autoFocus />
      <div className="chips">
        {AVATARS.map((a) => (
          <button key={a} type="button" className={`chip avatar-chip${d.avatar === a ? ' on' : ''}`} onClick={() => setD({ ...d, avatar: a })}>
            <RaccoonAvatar variant={a} size={52} />
            <span className="small">{AVATAR_LABELS[a]}</span>
          </button>
        ))}
      </div>
      <div className="chips">
        {KID_COLORS.map((c) => (
          <button key={c} type="button" className={`swatch${d.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setD({ ...d, color: c })} aria-label={`Color ${c}`} />
        ))}
      </div>
      <label className="field">{hasPin ? 'New 4-digit PIN (leave empty to keep it)' : '4-digit PIN (optional, keeps siblings out)'}
        <div className="row">
          <input value={d.pin} onChange={(e) => setD({ ...d, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })} inputMode="numeric" placeholder="••••" style={{ maxWidth: 140, letterSpacing: '0.3em' }} />
          {hasPin && onClearPin && <button type="button" className="ghost danger" onClick={onClearPin}>Remove PIN</button>}
        </div>
      </label>
      {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
      <button className="primary" disabled={!d.name.trim() || (d.pin.length > 0 && d.pin.length < 4)}>{submitLabel}</button>
    </form>
  );
}

function KidCard({ kid, onChange }: { kid: Kid; onChange: () => Promise<void> }) {
  const { base, home, toast } = useApp();
  const icon = home?.pointsIcon ?? '✨';
  const [goals, reloadGoals] = useLoad<Goal[]>(`${base}/kids/${kid.id}/goals?all=1`);
  const [ledger, reloadLedger] = useLoad<{ balance: number; entries: LedgerEntry[] }>(`${base}/kids/${kid.id}/ledger?limit=15`);
  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState({ title: '', targetPoints: 20, reward: '' });
  const [bonus, setBonus] = useState({ amount: 1, reason: '' });
  const [showLedger, setShowLedger] = useState(false);

  const refreshAll = async () => { await Promise.all([reloadGoals(), reloadLedger(), onChange()]); };
  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    try { await fn(); if (msg) toast(msg); await refreshAll(); } catch (e) { toast((e as Error).message); }
  };

  return (
    <div className="card stack" style={{ borderTop: `6px solid ${kid.color}` }}>
      <div className="row">
        <RaccoonAvatar variant={kid.avatar} size={64} />
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0 }}>{kid.name}</h2>
          <span className="muted">{kid.balance} {icon} {home?.pointsName}{kid.hasPin && ' · 🔒 PIN'}</span>
        </div>
        <Link className="btn" to={`/kids/${kid.id}`}>Board</Link>
        <button onClick={() => setEditing(true)}>Edit</button>
      </div>

      <h3 style={{ margin: 0 }}>Goals</h3>
      {goals?.map((g) => (
        <div key={g.id} className="goal">
          <div className="row">
            <strong style={{ flex: 1 }}>{g.status === 'redeemed' ? '🎁' : g.reached ? '🏆' : '🎯'} {g.title}{g.reward && <span className="small muted"> · {g.reward}</span>}</strong>
            <span className="small muted">{g.status === 'redeemed' ? `redeemed ${g.redeemedAt?.slice(0, 10)}` : `${g.progress} / ${g.targetPoints} ${icon}`}</span>
            {g.status === 'active' && g.reached && (
              <button className="primary" onClick={() => {
                if (confirm(`Give ${kid.name} “${g.reward ?? g.title}”? This spends ${g.targetPoints} ${home?.pointsName}.`)) void run(() => api(`${base}/goals/${g.id}/redeem`, { body: {} }), 'Reward redeemed 🎉');
              }}>Redeem</button>
            )}
            {g.status === 'active' && <button className="ghost danger" onClick={() => { if (confirm(`Delete the goal “${g.title}”?`)) void run(() => api(`${base}/goals/${g.id}`, { method: 'DELETE' })); }}>✕</button>}
          </div>
          {g.status === 'active' && <ProgressBar percent={g.percent} color={g.reached ? 'var(--ok)' : kid.color} />}
        </div>
      ))}
      <form className="row" onSubmit={(e) => { e.preventDefault(); void run(() => api(`${base}/kids/${kid.id}/goals`, { body: goal }), 'Goal added').then(() => setGoal({ title: '', targetPoints: 20, reward: '' })); }}>
        <input placeholder="New goal, e.g. Trip to the zoo" value={goal.title} onChange={(e) => setGoal({ ...goal, title: e.target.value })} style={{ flex: 2, minWidth: 180 }} />
        <input type="number" min={1} value={goal.targetPoints} onChange={(e) => setGoal({ ...goal, targetPoints: Number(e.target.value) })} style={{ width: 100 }} aria-label="Points needed" />
        <input placeholder="Reward (optional)" value={goal.reward} onChange={(e) => setGoal({ ...goal, reward: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
        <button disabled={!goal.title.trim() || goal.targetPoints < 1}>Add goal</button>
      </form>

      <h3 style={{ margin: 0 }}>Bonus or take-back</h3>
      <form className="row" onSubmit={(e) => {
        e.preventDefault();
        void run(() => api(`${base}/kids/${kid.id}/points`, { body: bonus }), bonus.amount > 0 ? `+${bonus.amount} ${icon} for ${kid.name}` : 'Points adjusted')
          .then(() => setBonus({ amount: 1, reason: '' }));
      }}>
        <input type="number" value={bonus.amount} onChange={(e) => setBonus({ ...bonus, amount: Math.round(Number(e.target.value)) })} style={{ width: 100 }} aria-label="Points" />
        <input placeholder="Why? e.g. Helped a neighbor" value={bonus.reason} onChange={(e) => setBonus({ ...bonus, reason: e.target.value })} style={{ flex: 1, minWidth: 180 }} />
        <button disabled={!bonus.amount}>{bonus.amount < 0 ? 'Take back' : 'Give'}</button>
      </form>

      <button className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowLedger(!showLedger)}>{showLedger ? '▾' : '▸'} Points history</button>
      {showLedger && (
        <table>
          <tbody>
            {ledger?.entries.map((e) => (
              <tr key={e.id}>
                <td className="small muted">{shortDate(e.date)}</td>
                <td>{e.reason}</td>
                <td className="small muted">{e.by}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: e.amount < 0 ? 'var(--danger)' : 'var(--ok)' }}>{e.amount > 0 ? '+' : ''}{e.amount}</td>
              </tr>
            ))}
            {!ledger?.entries.length && <tr><td className="muted">Nothing yet.</td></tr>}
          </tbody>
        </table>
      )}

      {editing && (
        <Modal onClose={() => setEditing(false)}>
          <div className="stack">
            <h2 style={{ margin: 0 }}>Edit {kid.name}</h2>
            <KidForm initial={{ name: kid.name, avatar: kid.avatar, color: kid.color, pin: '' }} hasPin={kid.hasPin} submitLabel="Save"
              onClearPin={() => void run(() => api(`${base}/kids/${kid.id}`, { method: 'PATCH', body: { pin: null } }), 'PIN removed').then(() => setEditing(false))}
              onSubmit={async (d) => {
                await api(`${base}/kids/${kid.id}`, { method: 'PATCH', body: { name: d.name, avatar: d.avatar, color: d.color, ...(d.pin ? { pin: d.pin } : {}) } });
                setEditing(false);
                toast('Saved');
                await refreshAll();
              }} />
            <button className="danger" onClick={async () => {
              if (prompt(`This deletes ${kid.name} with all their chores, goals and ${home?.pointsName}. Type their name to confirm:`) !== kid.name) return;
              await api(`${base}/kids/${kid.id}`, { method: 'DELETE' });
              setEditing(false);
              await onChange();
            }}>Delete {kid.name}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Kids() {
  const { home, base, refreshHome, toast } = useApp();
  const [adding, setAdding] = useState(false);
  const count = home?.kids.length ?? 0;
  return (
    <div className="stack">
      <div className="topbar">
        <h1>Kids</h1>
        <button className="primary" onClick={() => setAdding(true)}>＋ Add a kid</button>
      </div>
      {home?.kids.map((k) => <KidCard key={k.id} kid={k} onChange={refreshHome} />)}
      {home && !count && (
        <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <RaccoonAvatar variant="crown" size={96} />
          <p className="muted" style={{ margin: 0 }}>Add your kids. Each gets a raccoon to tap on the family tablet, and an optional PIN.</p>
          <button className="primary" onClick={() => setAdding(true)}>＋ Add a kid</button>
        </div>
      )}
      {adding && (
        <Modal onClose={() => setAdding(false)}>
          <div className="stack">
            <h2 style={{ margin: 0 }}>Add a kid</h2>
            <KidForm initial={{ name: '', avatar: AVATARS[count % AVATARS.length], color: KID_COLORS[count % KID_COLORS.length], pin: '' }} submitLabel="Add"
              onSubmit={async (d) => {
                await api(`${base}/kids`, { body: { ...d, pin: d.pin || null } });
                setAdding(false);
                toast(`${d.name} is in!`);
                await refreshHome();
              }} />
          </div>
        </Modal>
      )}
    </div>
  );
}
