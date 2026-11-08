// Trading chores between siblings: the offer form and the offers card on a kid's board, the parent's check on Home,
// and the setting.
import { useState } from 'react';
import { api, type AgendaItem } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { Modal } from './Bits.tsx';
import { RaccoonAvatar } from './Raccoon.tsx';
import { confetti } from './Confetti.ts';

type Mode = 'off' | 'ask' | 'free';
interface TradeChore { id: string; title: string; icon: string; points: number }
interface Trade {
  id: string; kind: 'swap' | 'help'; status: 'offered' | 'accepted' | string; date: string;
  from: { id: string; name: string }; to: { id: string; name: string }; chore: TradeChore | null; other: TradeChore | null; helperGets: number | null;
}
interface Sibling { id: string; name: string; avatar: string; color: string; chores: TradeChore[] }

export function useTrades(enabled: boolean) {
  const { base } = useApp();
  return useLoad<{ mode: Mode; trades: Trade[] }>(enabled ? `${base}/trades` : null);
}

/** "Swap or get help" for one of a kid's own chores. */
export function TradeForm({ item, onClose, onDone }: { item: AgendaItem; onClose: () => void; onDone: () => void }) {
  const { base, toast, home } = useApp();
  const [sibs] = useLoad<Sibling[]>(`${base}/trades/options`);
  const [sib, setSib] = useState<Sibling | null>(null);
  const [kind, setKind] = useState<'swap' | 'help' | null>(null);
  const icon = home?.pointsIcon ?? '✨';
  const send = async (body: object) => {
    try {
      await api(`${base}/trades`, { body: { instanceId: item.id, ...body } });
      toast(`Asked ${sib?.name}! They'll see it on their board.`);
      onDone();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <Modal onClose={onClose}>
      <div className="stack">
        <h2 style={{ margin: 0 }}>{item.icon} {item.title}</h2>
        {!sibs ? null : !sibs.length ? <p className="muted">There's nobody to trade with right now.</p> : !sib ? (
          <>
            <p style={{ margin: 0 }}>Who do you want to ask?</p>
            <div className="row">
              {sibs.map((s) => <button key={s.id} className="stack" style={{ alignItems: 'center', minWidth: 110 }} onClick={() => setSib(s)}><RaccoonAvatar variant={s.avatar} size={64} />{s.name}</button>)}
            </div>
          </>
        ) : !kind ? (
          <div className="stack">
            <button className="primary" style={{ minHeight: 64 }} onClick={() => setKind('help')}>🤝 Ask {sib.name} to help (you split the {home?.pointsName ?? 'points'})</button>
            <button style={{ minHeight: 64 }} disabled={!sib.chores.length} onClick={() => setKind('swap')}>🔁 Swap with one of {sib.name}'s chores{!sib.chores.length && ' (they have none left)'}</button>
          </div>
        ) : kind === 'help' ? (
          <div className="stack">
            <p style={{ margin: 0 }}>{sib.name} helps with {item.title}. When a grown-up approves it, {sib.name} gets +{Math.floor(item.points / 2)} {icon} and you get +{item.points - Math.floor(item.points / 2)} {icon}.</p>
            <button className="primary" onClick={() => void send({ kind: 'help', toMemberId: sib.id })}>🤝 Ask {sib.name}</button>
          </div>
        ) : (
          <div className="stack">
            <p style={{ margin: 0 }}>Which of {sib.name}'s chores would you do instead?</p>
            {sib.chores.map((c) => (
              <button key={c.id} className="row" style={{ justifyContent: 'flex-start' }} onClick={() => void send({ kind: 'swap', toMemberId: sib.id, otherInstanceId: c.id })}>
                <span style={{ fontSize: '1.6rem' }}>{c.icon}</span> {c.title} <span className="small muted">+{c.points} {icon}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** On a kid's board: offers they got (yes / no thanks) and offers they made (waiting, or call it off). */
export function KidTrades({ memberId, trades, mode, onChange }: { memberId: string; trades: Trade[]; mode: Mode; onChange: () => void }) {
  const { base, toast } = useApp();
  const [busy, setBusy] = useState(false);
  if (mode === 'off' || !trades.length) return null;
  const act = async (t: Trade, answer: string) => {
    setBusy(true);
    try {
      const r = await api<Trade>(`${base}/trades/${t.id}/${answer}`, { body: {} });
      if (r.status === 'done') { confetti({ count: 80 }); toast(t.kind === 'help' ? 'Teamwork! 🤝' : 'Swapped! 🔁'); }
      else if (r.status === 'accepted') toast('A grown-up will check it');
      onChange();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="card stack pg-chores">
      <h2 style={{ margin: 0 }}>🔁 Trades</h2>
      {trades.map((t) => {
        const toMe = t.to.id === memberId;
        const what = t.kind === 'help'
          ? `${toMe ? `${t.from.name} asks you` : `You asked ${t.to.name}`} to help with ${t.chore?.icon} ${t.chore?.title}${t.helperGets ? ` (+${t.helperGets} for the helper)` : ''}`
          : toMe ? `${t.from.name} wants your ${t.other?.icon} ${t.other?.title} for their ${t.chore?.icon} ${t.chore?.title}`
            : `You offered your ${t.chore?.icon} ${t.chore?.title} for ${t.to.name}'s ${t.other?.icon} ${t.other?.title}`;
        return (
          <div key={t.id} className="row">
            <span style={{ flex: 1 }}>{what}</span>
            {t.status === 'accepted' ? <span className="pill warn">⏳ A grown-up will check it</span>
              : toMe ? (<><button className="ghost" disabled={busy} onClick={() => void act(t, 'decline')}>No thanks</button><button className="primary" disabled={busy} onClick={() => void act(t, 'accept')}>Yes!</button></>)
                : (<><span className="pill">Waiting for {t.to.name}</span><button className="ghost" disabled={busy} onClick={() => void act(t, 'cancel')}>Call it off</button></>)}
          </div>
        );
      })}
    </section>
  );
}

/** Parent home: trades both kids said yes to, waiting for a grown-up. */
export function TradesWaitingCard() {
  const { base, toast } = useApp();
  const [data, reload] = useTrades(true);
  const waiting = data?.trades.filter((t) => t.status === 'accepted') ?? [];
  if (!waiting.length) return null;
  const act = async (t: Trade, answer: 'approve' | 'deny') => {
    try { await api(`${base}/trades/${t.id}/${answer}`, { body: {} }); await reload(); } catch (e) { toast((e as Error).message); }
  };
  return (
    <section className="card stack review-card has-items">
      <h2 style={{ margin: 0 }}>🔁 Chore trades <span className="pill warn">{waiting.length}</span></h2>
      {waiting.map((t) => (
        <div key={t.id} className="row">
          <span style={{ flex: 1 }}>
            {t.kind === 'help'
              ? <><strong>{t.to.name}</strong> will help <strong>{t.from.name}</strong> with {t.chore?.icon} {t.chore?.title} (split the points)</>
              : <><strong>{t.from.name}</strong> does {t.other?.icon} {t.other?.title}, <strong>{t.to.name}</strong> does {t.chore?.icon} {t.chore?.title}</>}
          </span>
          <button className="ghost danger" onClick={() => void act(t, 'deny')}>No</button>
          <button className="primary" onClick={() => void act(t, 'approve')}>OK</button>
        </div>
      ))}
    </section>
  );
}

/** Settings: whether kids can trade, and whether a parent checks each trade. */
export function TradeModeCard() {
  const { toast } = useApp();
  const [data, reload] = useTrades(true);
  const { base } = useApp();
  if (!data) return null;
  const set = async (mode: Mode) => { try { await api(`${base}/trades/mode`, { method: 'PUT', body: { mode } }); await reload(); toast('Saved'); } catch (e) { toast((e as Error).message); } };
  return (
    <div className="card stack" id="trades">
      <h2 style={{ margin: 0 }}>🔁 Trading chores</h2>
      <p className="small muted" style={{ margin: 0 }}>Kids can swap today's chores with a brother or sister, or ask one to help and split the points. The other kid says yes on their board.</p>
      <div className="seg" role="group" aria-label="Trading chores">
        <button className={data.mode === 'off' ? 'on' : ''} onClick={() => void set('off')}>Off</button>
        <button className={data.mode === 'ask' ? 'on' : ''} onClick={() => void set('ask')}>A parent checks each trade</button>
        <button className={data.mode === 'free' ? 'on' : ''} onClick={() => void set('free')}>Kids sort it out</button>
      </div>
    </div>
  );
}
