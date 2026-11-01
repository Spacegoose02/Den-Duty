import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Goal, type Kid, type LedgerEntry } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { AvatarPicker, RaccoonAvatar } from '../components/Raccoon.tsx';
import { Modal, ProgressBar, shortDate } from '../components/Bits.tsx';
import { defaultAvatar, KID_COLORS } from '../../../shared/catalog.ts';
import { ThemePicker } from '../components/ThemePicker.tsx';
import { IdeasButton } from '../components/Ideas.tsx';
import { DOCTOR_AREAS, IDEAS_OFF_DEFAULT, KID_PAGES, PRACTICE_IDEAS, type DoctorArea, type KidPage, type PracticeIdea } from '../../../shared/pages.ts';

interface KidDraft {
  name: string; avatar: string; color: string; pin: string; theme: string | null; birthdate: string; pictureMode: 'auto' | 'on' | 'off'; readAloud: 'auto' | 'on' | 'off';
  pagesOff: KidPage[]; doctorAreasOff: DoctorArea[]; ideasOff: PracticeIdea[]; aiOn: boolean;
}

/** Name, raccoon, color and PIN. Used to add a kid and to edit one. */
function KidForm({ initial, onSubmit, submitLabel, hasPin, onClearPin }: {
  initial: KidDraft; onSubmit: (d: KidDraft) => Promise<void>; submitLabel: string; hasPin?: boolean; onClearPin?: () => void;
}) {
  const { home, base, toast } = useApp();
  const homeTheme = home?.theme ?? 'sunny';
  const [d, setD] = useState(initial);
  const [ai] = useLoad<{ enabled: boolean; hasKey: boolean }>(`${base}/ai`);
  // Why AI features can't show for anyone right now, if that's the case.
  const aiProblem = !ai ? null : !ai.hasKey ? 'AI ideas need an Anthropic API key first.' : !ai.enabled ? 'AI ideas are turned off for the whole home.' : null;
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      setError(null);
      try { await onSubmit(d); } catch (err) { setError((err as Error).message); }
    }}>
      <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Name" autoFocus />
      <AvatarPicker value={d.avatar} onPick={(avatar) => setD({ ...d, avatar })} />
      <div className="chips">
        {KID_COLORS.map((c) => (
          <button key={c} type="button" className={`swatch${d.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setD({ ...d, color: c })} aria-label={`Color ${c}`} />
        ))}
      </div>
      <div className="row">
        <label className="field" style={{ flex: '0 0 auto' }}>Birthday (optional)
          <input type="date" value={d.birthdate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setD({ ...d, birthdate: e.target.value })} style={{ width: 200 }} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 220 }}>Tablet screen
          <div className="chips">
            {([['auto', 'By age'], ['on', '🖼️ Pictures first'], ['off', '🔤 Words']] as const).map(([v, l]) => (
              <button key={v} type="button" className={`chip${d.pictureMode === v ? ' on' : ''}`} onClick={() => setD({ ...d, pictureMode: v })}>{l}</button>
            ))}
          </div>
        </label>
        <label className="field" style={{ flex: 1, minWidth: 220 }}>🔊 Read out loud
          <div className="chips">
            {([['auto', 'With pictures'], ['on', 'Always'], ['off', 'Never']] as const).map(([v, l]) => (
              <button key={v} type="button" className={`chip${d.readAloud === v ? ' on' : ''}`} onClick={() => setD({ ...d, readAloud: v })}>{l}</button>
            ))}
          </div>
        </label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>The age tailors chore ideas and AI suggestions (only the age is ever sent, never the name). “By age” shows big pictures for kids under 6.</p>
      <div className="field">
        <span>Pages for {d.name.trim() || 'this kid'}</span>
        <div className="switch-grid">
          {KID_PAGES.map((p) => {
            const on = !d.pagesOff.includes(p.id);
            return (
              <button key={p.id} type="button" className={`switch${on ? ' on' : ''}`} aria-pressed={on}
                onClick={() => setD((cur) => ({ ...cur, pagesOff: on ? [...cur.pagesOff, p.id] : cur.pagesOff.filter((x) => x !== p.id) }))}>
                <span className="switch-knob" aria-hidden />
                <span><strong>{p.icon} {p.label}</strong><br /><span className="small muted">{p.hint}</span></span>
              </button>
            );
          })}
        </div>
        <span className="small muted" style={{ fontWeight: 400 }}>Off hides the page for this kid: on their tablet, in your views, stats, calendar links and Home Assistant. Nothing is deleted; switch it back on any time.</span>
      </div>
      <div className="field">
        <div className="switch-grid">
          <button type="button" className={`switch${d.aiOn ? ' on' : ''}`} aria-pressed={d.aiOn} onClick={() => setD((cur) => ({ ...cur, aiOn: !cur.aiOn }))}>
            <span className="switch-knob" aria-hidden />
            <span><strong>💡 AI ideas for {d.name || 'this kid'}</strong><br />
              <span className="small muted">Goal, chore and penalty ideas, daily practice ideas, the den message and Ask Dr. Bandit. Off: built-ins only, nothing is sent.</span></span>
          </button>
        </div>
        {aiProblem && <span className="small chip-reason">{aiProblem} <Link to="/settings#ai">Open Settings → AI ideas</Link></span>}
      </div>
      {!d.pagesOff.includes('doctors') && (
        <div className="field">
          <span>Doctors sections</span>
          <div className="chips">
            {DOCTOR_AREAS.map((a) => {
              const on = !d.doctorAreasOff.includes(a.id);
              return (
                <button key={a.id} type="button" className={`chip${on ? ' on' : ''}`} aria-pressed={on}
                  onClick={() => setD((cur) => ({ ...cur, doctorAreasOff: on ? [...cur.doctorAreasOff, a.id] : cur.doctorAreasOff.filter((x) => x !== a.id) }))}>
                  {a.icon} {a.label}
                </button>
              );
            })}
          </div>
          <span>Daily practice ideas</span>
          {aiProblem && (
            <p className="small chip-reason" style={{ margin: 0 }}>
              {aiProblem} <Link to="/settings#ai">Open Settings → AI ideas</Link>
            </p>
          )}
          {!aiProblem && !d.aiOn && <p className="small chip-reason" style={{ margin: 0 }}>AI ideas are off for {d.name || 'this kid'} (switch above), so these won't show.</p>}
          <div className="idea-chips">
            {PRACTICE_IDEAS.map((p) => {
              const on = !d.ideasOff.includes(p.id);
              const sectionOff = d.doctorAreasOff.includes(p.section);
              const section = DOCTOR_AREAS.find((a) => a.id === p.section)!;
              return (
                <div key={p.id} className="idea-chip">
                  <button type="button" className={`chip${on ? ' on' : ''}`} aria-pressed={on}
                    onClick={() => {
                      // Turning an idea on also turns on the Doctors section it needs.
                      if (!on && sectionOff) toast(`Also turned on the ${section.label} section`);
                      setD((cur) => ({
                        ...cur,
                        ideasOff: on ? [...cur.ideasOff, p.id] : cur.ideasOff.filter((x) => x !== p.id),
                        doctorAreasOff: !on ? cur.doctorAreasOff.filter((x) => x !== p.section) : cur.doctorAreasOff,
                      }));
                    }}>
                    {p.icon} {p.label}
                  </button>
                  {on && sectionOff && (
                    <span className="small chip-reason">
                      Needs the {section.icon} {section.label} section.{' '}
                      <button type="button" className="link" onClick={() => setD((cur) => ({ ...cur, doctorAreasOff: cur.doctorAreasOff.filter((x) => x !== p.section) }))}>Turn it on</button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <label className="field">Their theme on the tablet
        <ThemePicker value={d.theme} onPick={(theme) => setD({ ...d, theme })} inherit={{ label: 'Same as the home', theme: homeTheme }} />
      </label>
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
          <span className="muted">{kid.age != null && `Age ${kid.age} · `}{kid.balance} {icon} {home?.pointsName}{kid.hasPin && ' · 🔒 PIN'}{kid.pictureMode && ' · 🖼️ pictures'}</span>
        </div>
        <Link className="btn" to={`/kids/${kid.id}`}>Board</Link>
        <button onClick={() => setEditing(true)}>Edit</button>
      </div>

      {!kid.pagesOff.includes('goals') && (<>
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
      <IdeasButton kind="goal" kidId={kid.id} onPick={(i) => setGoal({ title: i.title, targetPoints: i.points, reward: i.detail.slice(0, 200) })} />
      </>)}
      {kid.pagesOff.length > 0 && <p className="small muted" style={{ margin: 0 }}>Turned off for {kid.name}: {kid.pagesOff.map((p) => KID_PAGES.find((x) => x.id === p)?.label).join(', ')} (Edit to change).</p>}

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
            <KidForm initial={{ name: kid.name, avatar: kid.avatar, color: kid.color, pin: '', theme: kid.theme, birthdate: kid.birthdate ?? '', pictureMode: kid.pictureModeSetting, readAloud: kid.readAloudSetting, pagesOff: kid.pagesOff, doctorAreasOff: kid.doctorAreasOff, ideasOff: kid.ideasOff, aiOn: kid.aiOn }} hasPin={kid.hasPin} submitLabel="Save"
              onClearPin={() => void run(() => api(`${base}/kids/${kid.id}`, { method: 'PATCH', body: { pin: null } }), 'PIN removed').then(() => setEditing(false))}
              onSubmit={async (d) => {
                await api(`${base}/kids/${kid.id}`, { method: 'PATCH', body: { name: d.name, avatar: d.avatar, color: d.color, theme: d.theme, birthdate: d.birthdate, pictureMode: d.pictureMode, readAloud: d.readAloud, pagesOff: d.pagesOff, doctorAreasOff: d.doctorAreasOff, ideasOff: d.ideasOff, aiOn: d.aiOn, ...(d.pin ? { pin: d.pin } : {}) } });
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
            <KidForm initial={{ name: '', avatar: defaultAvatar(count), color: KID_COLORS[count % KID_COLORS.length], pin: '', theme: null, birthdate: '', pictureMode: 'auto', readAloud: 'auto', pagesOff: [], doctorAreasOff: [], ideasOff: IDEAS_OFF_DEFAULT, aiOn: true }} submitLabel="Add"
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
