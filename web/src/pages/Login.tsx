import { useEffect, useState } from 'react';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { useNavigate } from 'react-router-dom';
import { api, type Whoami } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';

interface AuthConfig { google: boolean; oidc: { name: string } | null; local: boolean; passwords: boolean; passkeys: boolean; signup: 'first' | 'open' | 'invite' | 'closed' }
type Mode = 'signin' | 'register' | 'pair' | 'quick' | 'mfa';

const SIGNIN_ERRORS: Record<string, string> = {
  expired: 'That Google sign-in took too long. Try again.',
  invite: 'This server is invite-only. Enter a join code from a home first, then sign in with Google.',
  closed: 'New accounts are turned off on this server. Ask the admin.',
  disabled: 'That account is turned off. Ask the admin.',
};

/** Parent sign-in. On a family tablet (onTablet) it signs a parent in on top, and "back" returns to the kids. */
export function Login({ onTablet = false }: { onTablet?: boolean }) {
  const { refresh } = useApp();
  const nav = useNavigate();
  const [cfg] = useLoad<AuthConfig>('/api/auth/config');
  const params = new URLSearchParams(location.search);
  const [mode, setMode] = useState<Mode>(params.get('mfa') ? 'mfa' : 'signin');
  const [ticket, setTicket] = useState<string | null>(params.get('mfa'));
  const [f, setF] = useState({ username: '', password: '', name: '', joinCode: '', code: '', pair: '', quick: '' });
  const [error, setError] = useState<string | null>(params.get('signin') ? SIGNIN_ERRORS[params.get('signin')!] ?? null : null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (params.get('mfa') || params.get('signin')) history.replaceState(null, '', '/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (cfg?.signup === 'first') setMode('register');
  }, [cfg?.signup]);

  async function finish() {
    // If the browser refused the sign-in cookie, say so instead of silently staying on this screen.
    const who = await api<Whoami>('/api/whoami').catch(() => null);
    if (!who?.user && !who?.device) {
      setError("The server accepted you, but this browser didn't keep the sign-in. If the server uses https, open it with its https address.");
      return;
    }
    if (onTablet) nav('/');
    await refresh();
  }

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const signIn = () => run(async () => {
    const r = await api<{ mfaRequired?: boolean; ticket?: string }>('/api/auth/login', { body: { username: f.username, password: f.password } });
    if (r.mfaRequired) { setTicket(r.ticket!); setMode('mfa'); return; }
    await finish();
  });

  const passkey = () => run(async () => {
    const options = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/api/auth/passkey/login-options', { body: {} });
    const response = await startAuthentication({ optionsJSON: options });
    await api('/api/auth/passkey/login', { body: { response } });
    await finish();
  });

  const sso = (provider: 'google' | 'oidc') => run(async () => {
    if (f.joinCode.trim()) await api('/api/auth/invite', { body: { code: f.joinCode } });
    location.href = `/api/auth/${provider}`;
  });

  const canRegister = cfg && cfg.signup !== 'closed';
  const needsCode = cfg?.signup === 'invite';

  return (
    <div className="center-screen">
      <div className="card login-card">
        <div><RaccoonAvatar variant="ninja" size={110} /></div>
        <h1>Den Duty</h1>
        {onTablet && <p className="muted" style={{ margin: 0 }}>Parent sign-in on the family tablet</p>}

        {mode === 'signin' && (
          <>
            {cfg?.passkeys && browserSupportsWebAuthn() && (
              <button className="primary" onClick={passkey} disabled={busy}>🔑 Sign in with a passkey</button>
            )}
            <form className="stack" onSubmit={(e) => { e.preventDefault(); void signIn(); }}>
              <input placeholder="Username" value={f.username} onChange={set('username')} autoComplete="username webauthn" autoCapitalize="none" />
              <input placeholder="Password" type="password" value={f.password} onChange={set('password')} autoComplete="current-password" />
              <button disabled={busy || !f.username || !f.password}>Sign in</button>
            </form>
            {cfg?.oidc && <button onClick={() => sso('oidc')} disabled={busy}>Sign in with {cfg.oidc.name}</button>}
            {cfg?.google && <button onClick={() => sso('google')} disabled={busy}>Sign in with Google</button>}
            <div className="row" style={{ justifyContent: 'center' }}>
              {canRegister && <button className="ghost" onClick={() => setMode('register')}>Create an account</button>}
              <button className="ghost" onClick={() => setMode('pair')}>I have a pairing code</button>
              {cfg?.local && <button className="ghost" onClick={() => setMode('quick')}>Quick sign-in</button>}
            </div>
          </>
        )}

        {mode === 'register' && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/auth/register', { body: f }); await finish(); }); }}>
            <p className="muted" style={{ margin: 0 }}>
              {cfg?.signup === 'first' ? "You're the first one here, so you'll be the admin." : needsCode ? 'You need a join code from someone in your household.' : 'Make your account.'}
            </p>
            {needsCode && <input placeholder="Join code" value={f.joinCode} onChange={(e) => setF({ ...f, joinCode: e.target.value.toUpperCase() })} autoCapitalize="characters" />}
            <input placeholder="Your name" value={f.name} onChange={set('name')} autoComplete="name" />
            <input placeholder="Username" value={f.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" />
            <input placeholder="Password (10+ characters)" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" />
            <button className="primary" disabled={busy || !f.username || f.password.length < 10 || (needsCode && !f.joinCode)}>Create account</button>
            {cfg?.oidc && (needsCode ? !!f.joinCode : true) && <button type="button" onClick={() => sso('oidc')} disabled={busy}>Use {cfg.oidc.name} instead</button>}
            {cfg?.google && (needsCode ? !!f.joinCode : true) && <button type="button" onClick={() => sso('google')} disabled={busy}>Use Google instead</button>}
            {cfg?.signup !== 'first' && <button type="button" className="ghost" onClick={() => setMode('signin')}>Back to sign in</button>}
          </form>
        )}

        {mode === 'mfa' && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/auth/login/2fa', { body: { ticket, code: f.code } }); await finish(); }); }}>
            <p className="muted" style={{ margin: 0 }}>Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
            <input value={f.code} onChange={set('code')} inputMode="numeric" autoComplete="one-time-code" autoFocus style={{ textAlign: 'center', letterSpacing: '0.3em', fontSize: '1.4rem' }} />
            <button className="primary" disabled={busy || f.code.length < 6}>Verify</button>
            <button type="button" className="ghost" onClick={() => { setMode('signin'); setTicket(null); }}>Start over</button>
          </form>
        )}

        {mode === 'pair' && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/auth/pair', { body: { code: f.pair } }); await finish(); }); }}>
            <p className="small muted" style={{ margin: 0 }}>On a device where a parent is signed in, open Settings and tap “Pair a device” or “Set up a family tablet”.</p>
            <input placeholder="8-letter code" value={f.pair} onChange={(e) => setF({ ...f, pair: e.target.value.toUpperCase() })} autoCapitalize="characters" style={{ textAlign: 'center', letterSpacing: '0.3em', fontSize: '1.4rem' }} />
            <button className="primary" disabled={busy || f.pair.replace(/\W/g, '').length < 6}>Pair this device</button>
            <button type="button" className="ghost" onClick={() => setMode('signin')}>Back</button>
          </form>
        )}

        {mode === 'quick' && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/api/auth/local', { body: { name: f.quick } }); await finish(); }); }}>
            <p className="small muted" style={{ margin: 0 }}>Just your name, no password. Only works at home, and only for accounts without a password or passkey.</p>
            <input placeholder="Your name" value={f.quick} onChange={set('quick')} autoComplete="nickname" />
            <button className="primary" disabled={busy || !f.quick.trim()}>Continue</button>
            <button type="button" className="ghost" onClick={() => setMode('signin')}>Back</button>
          </form>
        )}

        {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        {onTablet && <button className="ghost" onClick={() => nav('/')}>← Back to the kids</button>}
        {!onTablet && <a href="/download" className="small" style={{ textAlign: 'center' }}>📲 Get the Windows or Android app</a>}
      </div>
    </div>
  );
}
