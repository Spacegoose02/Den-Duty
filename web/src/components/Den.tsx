// Rocky's den on a kid's board: their own little room. Furniture is bought with points (levels unlock fancier things),
// and the room is sparkling, tidy or messy depending on how chores went the last three days.
import { useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { Modal } from './Bits.tsx';
import { RaccoonAvatar } from './Raccoon.tsx';
import { confetti } from './Confetti.ts';
import { SpeakButton } from './Speak.tsx';
import { MESS, TIDY_TEXT, type DenSpot, type Tidiness } from '../../../shared/den.ts';

interface DenItem { id: string; icon: string; name: string; price: number; level: number; spot: DenSpot; owned: boolean; placed: boolean; locked: boolean; affordable: boolean }
interface Den { tidiness: Tidiness; share: number | null; level: number; balance: number; items: DenItem[] }

const MESS_COUNT: Record<Tidiness, number> = { sparkling: 0, tidy: 0, messy: 3, 'very-messy': 6 };

export function KidDen({ memberId, avatar, color, asParent, readAloud, onChange }: {
  memberId: string; avatar: string; color: string; asParent: boolean; readAloud: boolean; onChange: () => void;
}) {
  const { base, toast, home } = useApp();
  const [den, reload] = useLoad<Den | null>(`${base}/kids/${memberId}/den`);
  const [shop, setShop] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!den) return null;
  const icon = home?.pointsIcon ?? '✨';
  const out = den.items.filter((i) => i.owned && i.placed);
  const at = (spot: DenSpot) => out.filter((i) => i.spot === spot);
  const mess = MESS.slice(0, MESS_COUNT[den.tidiness]);

  const act = async (path: string, body: object, done?: string) => {
    setBusy(true);
    try {
      await api(`${base}/kids/${memberId}/den/${path}`, { body });
      await reload();
      if (done) { confetti({ count: 60 }); toast(done); onChange(); }
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="card stack pg-den">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>🏡 Rocky's den</h2>
        <span className={`pill ${den.tidiness === 'sparkling' ? 'ok' : den.tidiness === 'tidy' ? '' : 'warn'}`}>{TIDY_TEXT[den.tidiness]}</span>
        {readAloud && <SpeakButton text={`Your den is ${TIDY_TEXT[den.tidiness]}`} />}
        <button onClick={() => setShop(true)}>🛒 Decorate</button>
      </div>
      <div className={`den-room den-${den.tidiness}`} style={{ ['--kid' as string]: color }}>
        <div className="den-ceiling">{at('ceiling').map((i) => <span key={i.id} title={i.name}>{i.icon}</span>)}</div>
        <div className="den-wall">
          {at('window').map((i) => <span key={i.id} className="den-window" title={i.name}>{i.icon}</span>)}
          {at('wall').map((i) => <span key={i.id} title={i.name}>{i.icon}</span>)}
        </div>
        <div className="den-floor">
          {at('corner').map((i) => <span key={i.id} title={i.name}>{i.icon}</span>)}
          <span className="den-rocky"><RaccoonAvatar variant={avatar} size={72} /></span>
          {at('floor').map((i) => <span key={i.id} title={i.name}>{i.icon}</span>)}
        </div>
        {mess.map((m, n) => <span key={n} className="den-mess" style={{ left: `${8 + n * 15}%`, rotate: `${(n % 3 - 1) * 20}deg` }} aria-hidden>{m}</span>)}
      </div>
      {den.tidiness === 'messy' || den.tidiness === 'very-messy'
        ? <p className="small muted" style={{ margin: 0 }}>Finish your chores and Rocky will tidy up!</p>
        : !out.length && <p className="small muted" style={{ margin: 0 }}>It's a bit empty in here. Tap Decorate to buy something with your {home?.pointsName ?? 'points'}.</p>}

      {shop && (
        <Modal onClose={() => setShop(false)} wide>
          <div className="stack">
            <div className="row">
              <h2 style={{ margin: 0, flex: 1 }}>🛒 Decorate the den</h2>
              <span className="pill">{den.balance} {icon}</span>
            </div>
            <div className="den-shop">
              {den.items.map((i) => (
                <div key={i.id} className={`den-shop-item${i.locked ? ' locked' : ''}`}>
                  <span style={{ fontSize: '2.2rem' }}>{i.locked ? '🔒' : i.icon}</span>
                  <strong>{i.name}</strong>
                  {i.owned ? (
                    <button disabled={busy} onClick={() => void act('place', { itemId: i.id, placed: !i.placed })}>{i.placed ? 'Put away' : 'Put out'}</button>
                  ) : i.locked ? (
                    <span className="small muted">Level {i.level}</span>
                  ) : (
                    <button className="primary" disabled={busy || !i.affordable}
                      onClick={() => void act('buy', { itemId: i.id }, `${i.icon} ${i.name} is in your den!`)}>
                      {i.price} {icon}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
