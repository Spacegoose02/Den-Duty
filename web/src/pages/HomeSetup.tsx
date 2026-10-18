import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.ts';
import { useApp } from '../state.tsx';
import { SunnyScene } from '../components/Raccoon.tsx';

/** Create a new home or join one with a code. Shown on first sign-in and from Settings. */
export function HomeSetup({ inline = false }: { inline?: boolean }) {
  const { who, refresh, setHome } = useApp();
  const nav = useNavigate();
  const [name, setName] = useState(who?.user ? `The ${who.user.name.split(' ').pop()} Den` : '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function go(path: string, body: unknown) {
    setError(null);
    try {
      const { id } = await api<{ id: string }>(path, { body });
      await refresh();
      setHome(id);
      nav(path === '/api/homes' ? '/kids' : '/');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const content = (
    <div className="stack" style={{ maxWidth: 720, width: '100%' }}>
      {!inline && <SunnyScene variant={who?.user?.avatar ?? 'ninja'} />}
      <h1>{inline ? 'Add a home' : `Welcome, ${who?.user?.name}!`}</h1>
      <p className="muted">A home is your family: its parents, kids, chores and rewards. Start a new one, or join your partner's with their code.</p>
      <div className="grid-2">
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); void go('/api/homes', { name, timezone }); }}>
          <h2>🏡 Create a home</h2>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Home name" />
          <button className="primary" disabled={!name.trim()}>Create</button>
        </form>
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); void go('/api/homes/join', { code }); }}>
          <h2>🔑 Join a home</h2>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Join code" autoCapitalize="characters" />
          <button disabled={code.length < 6}>Join</button>
        </form>
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
  return inline ? content : <div className="center-screen">{content}</div>;
}
