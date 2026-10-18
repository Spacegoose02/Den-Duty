import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type Kid } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { Modal, PinPad } from '../components/Bits.tsx';

interface Kiosk { home: { id: string; name: string; pointsName: string; pointsIcon: string }; kids: Kid[] }

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning!';
  if (h < 17) return 'Good afternoon!';
  return 'Good evening!';
}

/** A kid signs in on the family tablet: straight in, or with their PIN first. Shared by the picker and the family wall. */
export function useKidSignIn(): { start: (kid: Pick<Kid, 'id' | 'name' | 'avatar' | 'hasPin'>) => void; error: string | null; modal: ReactNode } {
  const { refresh } = useApp();
  const [picked, setPicked] = useState<Pick<Kid, 'id' | 'name' | 'avatar' | 'hasPin'> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(kid: Pick<Kid, 'id'>, pin?: string) {
    setError(null);
    try {
      await api('/api/kiosk/kid', { body: { memberId: kid.id, pin } });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return {
    start: (kid) => (kid.hasPin ? setPicked(kid) : void signIn(kid)),
    error: picked ? null : error,
    modal: picked && (
      <Modal onClose={() => { setPicked(null); setError(null); }}>
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <RaccoonAvatar variant={picked.avatar} size={96} />
          <h2 style={{ margin: 0 }}>Hi {picked.name}! What's your PIN?</h2>
          <PinPad onDone={(pin) => void signIn(picked, pin)} error={error} />
        </div>
      </Modal>
    ),
  };
}

/** Every kid's raccoon, tap yours. The family tablet's front screen when a parent picks it over the family wall. */
export function KidPicker({ wallLink = false }: { wallLink?: boolean }) {
  const [data] = useLoad<Kiosk>('/api/kiosk');
  const sign = useKidSignIn();

  return (
    <div className="kiosk">
      <header className="kiosk-head">
        <div>
          <h1>{greeting()}</h1>
          <p className="muted" style={{ margin: 0 }}>{data?.home.name} · Who's doing chores?</p>
        </div>
      </header>
      <div className="kid-grid">
        {data?.kids.map((k) => (
          <button key={k.id} className="kid-card" style={{ background: k.color }} onClick={() => sign.start(k)}>
            <span className="kid-face"><RaccoonAvatar variant={k.avatar} size={120} /></span>
            <span className="kid-name">{k.name}</span>
            <span className="kid-balance">{k.balance} {data.home.pointsIcon}</span>
          </button>
        ))}
        {data && !data.kids.length && <div className="card">No kids yet. A parent can add them in <strong>Kids</strong>.</div>}
      </div>
      {sign.error && <p style={{ color: 'var(--danger)', textAlign: 'center' }}>{sign.error}</p>}
      <footer className="kiosk-foot row">
        {wallLink && <Link to="/" className="btn ghost">🏠 Family wall</Link>}
        <Link to="/login" className="btn ghost">🔒 Parents</Link>
      </footer>
      {sign.modal}
    </div>
  );
}
