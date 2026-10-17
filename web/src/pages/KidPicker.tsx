import { useState } from 'react';
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

/** The family tablet's front screen: every kid's raccoon, tap yours. */
export function KidPicker() {
  const { refresh } = useApp();
  const [data] = useLoad<Kiosk>('/api/kiosk');
  const [picked, setPicked] = useState<Kid | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(kid: Kid, pin?: string) {
    setError(null);
    try {
      await api('/api/kiosk/kid', { body: { memberId: kid.id, pin } });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

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
          <button key={k.id} className="kid-card" style={{ background: k.color }} onClick={() => (k.hasPin ? setPicked(k) : void signIn(k))}>
            <span className="kid-face"><RaccoonAvatar variant={k.avatar} size={120} /></span>
            <span className="kid-name">{k.name}</span>
            <span className="kid-balance">{k.balance} {data.home.pointsIcon}</span>
          </button>
        ))}
        {data && !data.kids.length && <div className="card">No kids yet. A parent can add them in <strong>Kids</strong>.</div>}
      </div>
      {error && !picked && <p style={{ color: 'var(--danger)', textAlign: 'center' }}>{error}</p>}
      <footer className="kiosk-foot">
        <Link to="/login" className="btn ghost">🔒 Parents</Link>
      </footer>
      {picked && (
        <Modal onClose={() => { setPicked(null); setError(null); }}>
          <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
            <RaccoonAvatar variant={picked.avatar} size={96} />
            <h2 style={{ margin: 0 }}>Hi {picked.name}! What's your PIN?</h2>
            <PinPad onDone={(pin) => void signIn(picked, pin)} error={error} />
          </div>
        </Modal>
      )}
    </div>
  );
}
