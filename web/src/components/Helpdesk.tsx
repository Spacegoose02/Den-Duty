import { useState, type ReactNode } from 'react';
import { api, type HelpRequest, type HomeHelpRequest } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { Modal, dayName, shortDate } from './Bits.tsx';
import { RaccoonAvatar } from './Raccoon.tsx';
import { HELP_PICKS, type HelpPick } from '../../../shared/pages.ts';
import { addDays, weekdayOf } from '../../../shared/schedule.ts';

const STATUS: Record<HelpRequest['status'], { mark: string; text: string; cls: string }> = {
  waiting: { mark: '⏳', text: 'Waiting for a grown-up', cls: '' },
  yes: { mark: '✅', text: "Yes! Added to the grown-ups' list", cls: 'ok' },
  doing: { mark: '🛠️', text: 'A grown-up is on it', cls: 'ok' },
  done: { mark: '🎉', text: 'Done!', cls: 'ok' },
  no: { mark: '💛', text: 'Not this time', cls: 'warn' },
  cancelled: { mark: '↩️', text: 'Taken back', cls: '' },
  closed: { mark: '📁', text: 'Closed', cls: '' },
};

const isOpen = (r: HelpRequest) => r.status === 'waiting' || r.status === 'yes' || r.status === 'doing';

const localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const whenText = (d: string | null) => (d ? (d === localToday() ? 'today' : d === addDays(localToday(), 1) ? 'tomorrow' : `${dayName(d)} ${shortDate(d)}`) : '');

function HelpRow({ r, children }: { r: HelpRequest; children?: ReactNode }) {
  const s = STATUS[r.status];
  return (
    <div className={`help-item ${r.status}`}>
      <span className="help-icon" aria-hidden>{r.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="help-title">{r.kind === 'other' ? r.text : r.label}{r.kind !== 'other' && r.text && <span className="muted">: {r.text}</span>}</div>
        {r.dueDate && <div className="small muted">By {whenText(r.dueDate)}</div>}
        <div className={`small help-status ${s.cls}`}>{s.mark} {s.text}{r.status === 'closed' && r.closedByKid ? ' by you' : ''}</div>
        {r.status === 'no' && r.note && <div className="help-note">“{r.note}”</div>}
        {r.status === 'closed' && r.closeNote && <div className="help-note">“{r.closeNote}”</div>}
      </div>
      {children}
    </div>
  );
}

/** A parent closes a ticket at any stage, with an optional note; a linked Parent Duty card is marked done unless unticked. */
function CloseTicket({ r, kidName, onClose, onDone }: { r: HelpRequest; kidName: string; onClose: () => void; onDone: () => void }) {
  const { base, toast } = useApp();
  const [note, setNote] = useState('');
  const [finish, setFinish] = useState(true);
  const [busy, setBusy] = useState(false);
  const hasCard = !!r.dutyId && (r.status === 'yes' || r.status === 'doing');
  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try { await api(`${base}/helpdesk/${r.id}/close`, { body: { note, finishCard: finish } }); toast('Closed'); onDone(); } catch (err) { toast((err as Error).message); } finally { setBusy(false); }
      }}>
        <h2 style={{ margin: 0 }}>Close “{r.kind === 'other' ? r.text : r.label}”</h2>
        <p className="small muted" style={{ margin: 0 }}>{kidName} sees “Closed” and your note, and it moves to their history.</p>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} autoFocus placeholder="A note (optional), e.g. All fixed!" />
        {hasCard && (
          <label className="row check-row"><input type="checkbox" checked={finish} onChange={(e) => setFinish(e.target.checked)} /> Also mark the Parent Duty card done</label>
        )}
        <div className="row"><span className="spacer" /><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Close it</button></div>
      </form>
    </Modal>
  );
}

/** The kid's 🛎️ Helpdesk on their board: big quick picks, optional words and "by when", and how each ask is going. */
export function KidHelpdesk({ memberId, kidName, picture, asParent }: { memberId: string; kidName: string; picture: boolean; asParent: boolean }) {
  const { base, toast } = useApp();
  const [items, reload] = useLoad<HelpRequest[]>(`${base}/kids/${memberId}/helpdesk`, [memberId]);
  const [asking, setAsking] = useState(false);
  const [pick, setPick] = useState<HelpPick | null>(null);
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<HelpRequest | null>(null);
  const open = items?.filter(isOpen) ?? [];
  const history = items?.filter((r) => !isOpen(r)) ?? [];
  const today = localToday();
  const sat = addDays(today, (6 - weekdayOf(today) + 7) % 7 || 7);
  const reset = () => { setAsking(false); setPick(null); setText(''); setDue(''); };

  const send = async () => {
    setBusy(true);
    try {
      await api(`${base}/kids/${memberId}/helpdesk`, { body: { kind: pick, text, dueDate: due || null } });
      toast(asParent ? 'Added' : 'Sent to a grown-up! 🛎️');
      reset();
      await reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="card stack pg-helpdesk">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>🛎️ Helpdesk</h2>
        <button className="primary" onClick={() => setAsking(true)}>{asParent ? `＋ Ask for ${kidName}` : '🛎️ Ask a grown-up'}</button>
      </div>
      {open.map((r) => (
        <HelpRow key={r.id} r={r}>
          {r.status === 'waiting' && !asParent && (
            <button className="ghost" onClick={async () => {
              try { await api(`${base}/helpdesk/${r.id}`, { method: 'DELETE' }); await reload(); } catch (e) { toast((e as Error).message); }
            }}>Never mind</button>
          )}
          {asParent
            ? <button className="ghost" onClick={() => setClosing(r)}>Close</button>
            : r.status !== 'waiting' && <button className="ghost" onClick={async () => {
              try { await api(`${base}/helpdesk/${r.id}/close`, { body: {} }); toast('Thanks for letting us know! 💛'); await reload(); } catch (e) { toast((e as Error).message); }
            }}>👍 All set, thanks!</button>}
        </HelpRow>
      ))}
      {items && !open.length && <p className="small muted" style={{ margin: 0 }}>Need help with something? Tap the bell and a grown-up will see it.</p>}
      {history.length > 0 && (
        <details className="help-history">
          <summary className="small">History ({history.length})</summary>
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            {history.map((r) => <HelpRow key={r.id} r={r}>{asParent && r.status !== 'closed' && <button className="ghost" onClick={() => setClosing(r)}>Close</button>}</HelpRow>)}
            {asParent && history.some((r) => r.status === 'closed') && (
              <button className="ghost danger" style={{ alignSelf: 'flex-start' }} onClick={async () => {
                if (!confirm(`Clear ${kidName}'s closed requests?`)) return;
                try { const r = await api<{ cleared: number }>(`${base}/kids/${memberId}/helpdesk/closed`, { method: 'DELETE' }); toast(`Cleared ${r.cleared}`); await reload(); } catch (e) { toast((e as Error).message); }
              }}>🧹 Clear closed</button>
            )}
          </div>
        </details>
      )}
      {closing && <CloseTicket r={closing} kidName={kidName} onClose={() => setClosing(null)} onDone={() => { setClosing(null); void reload(); }} />}

      {asking && (
        <Modal onClose={reset} wide>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <h2 style={{ margin: 0 }}>{asParent ? `What does ${kidName} need?` : 'What do you need help with?'}</h2>
            <div className={`help-picks${picture ? ' picture' : ''}`}>
              {HELP_PICKS.map((p) => (
                <button key={p.id} type="button" className={`help-pick${pick === p.id ? ' on' : ''}`} aria-pressed={pick === p.id} onClick={() => setPick(p.id)}>
                  <span className="help-pick-icon" aria-hidden>{p.icon}</span>
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
            {pick && (
              <>
                <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} autoFocus={pick === 'other'}
                  placeholder={pick === 'other' ? 'Tell us what you need' : 'Tell us more (if you want)'} />
                <div className="chips">
                  <span className="small" style={{ alignSelf: 'center' }}>By when?</span>
                  {[['', 'No rush'], [today, 'Today'], [addDays(today, 1), 'Tomorrow'], [sat, 'This weekend']].map(([v, l]) => (
                    <button key={l} type="button" className={`chip${due === v ? ' on' : ''}`} onClick={() => setDue(v)}>{l}</button>
                  ))}
                  <input type="date" value={due} min={today} onChange={(e) => setDue(e.target.value)} style={{ maxWidth: 180 }} aria-label="Pick a day" />
                </div>
              </>
            )}
            <div className="row">
              <span className="spacer" />
              <button type="button" className="ghost" onClick={reset}>Cancel</button>
              <button className="primary" disabled={busy || !pick || (pick === 'other' && !text.trim())}>🛎️ Send</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

/** Parent home: kids' waiting Helpdesk requests. Yes makes a Parent Duty card; "not this time" can carry a kind note. */
export function HelpdeskCard({ items, onChange }: { items: HomeHelpRequest[]; onChange: () => void }) {
  const { base, home, toast } = useApp();
  const [answering, setAnswering] = useState<{ r: HomeHelpRequest; yes: boolean } | null>(null);
  const [closing, setClosing] = useState<HomeHelpRequest | null>(null);
  const [f, setF] = useState({ title: '', dueDate: '', assigneeId: '', note: '' });
  const [busy, setBusy] = useState(false);
  if (!items.length) return null;
  const open = (r: HomeHelpRequest, yes: boolean) => {
    setF({ title: r.kind === 'other' ? r.text ?? '' : r.text ? `${r.label}: ${r.text}` : r.label, dueDate: r.dueDate ?? '', assigneeId: '', note: '' });
    setAnswering({ r, yes });
  };
  const submit = async () => {
    if (!answering) return;
    setBusy(true);
    try {
      if (answering.yes) {
        await api(`${base}/helpdesk/${answering.r.id}/approve`, { body: { title: f.title, dueDate: f.dueDate || null, assigneeId: f.assigneeId || null } });
        toast(`Added to ${answering.r.kid.name}'s Parent Duty`);
      } else {
        await api(`${base}/helpdesk/${answering.r.id}/deny`, { body: { note: f.note } });
        toast(`Told ${answering.r.kid.name} not this time`);
      }
      setAnswering(null);
      onChange();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>🛎️ Helpdesk <span className="pill warn">{items.length} waiting</span></h2>
      {items.map((r) => (
        <div key={r.id} className="list-item">
          <RaccoonAvatar variant={r.kid.avatar} size={40} />
          <span className="help-icon" aria-hidden>{r.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{r.kind === 'other' ? r.text : r.label}{r.kind !== 'other' && r.text && <span className="muted" style={{ fontWeight: 500 }}>: {r.text}</span>}</div>
            <div className="small muted">{r.kid.name}{r.dueDate && ` · by ${whenText(r.dueDate)}`}</div>
          </div>
          <button className="ghost" disabled={busy} onClick={() => setClosing(r)} title="Close without a yes or no">Close</button>
          <button className="ghost" disabled={busy} onClick={() => open(r, false)}>Not this time</button>
          <button className="primary" disabled={busy} onClick={() => open(r, true)}>Yes</button>
        </div>
      ))}
      {closing && <CloseTicket r={closing} kidName={closing.kid.name} onClose={() => setClosing(null)} onDone={() => { setClosing(null); onChange(); }} />}
      {answering && (
        <Modal onClose={() => setAnswering(null)}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            {answering.yes ? (
              <>
                <h2 style={{ margin: 0 }}>Yes, help {answering.r.kid.name}</h2>
                <p className="small muted" style={{ margin: 0 }}>Goes on {answering.r.kid.name}'s Parent Duty board; a due date also shows on your calendar.</p>
                <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={120} autoFocus />
                <label className="field">Due (optional)
                  <input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} style={{ maxWidth: 200 }} />
                </label>
                <label className="field">Who's on it
                  <select value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
                    <option value="">Anyone</option>
                    {home?.parents?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <>
                <h2 style={{ margin: 0 }}>Not this time</h2>
                <p className="small muted" style={{ margin: 0 }}>{answering.r.kid.name} sees “Not this time” and your note, if you add one.</p>
                <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} autoFocus placeholder="A kind note, e.g. Let's look at it this weekend" />
              </>
            )}
            <div className="row">
              <span className="spacer" />
              <button type="button" className="ghost" onClick={() => setAnswering(null)}>Cancel</button>
              <button className="primary" disabled={busy || (answering.yes && !f.title.trim())}>{answering.yes ? 'Add to Parent Duty' : 'Send'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
