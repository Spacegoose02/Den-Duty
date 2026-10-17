import { useState } from 'react';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';

interface SecurityInfo {
  username: string | null; hasPassword: boolean; google: boolean; email: string | null; totpEnabled: boolean;
  recoveryCodesLeft: number; passkeys: { id: string; name: string; createdAt: string; lastUsedAt: string | null }[]; passkeyOrigin: string;
}
interface SessionRow { id: string; current: boolean; userAgent: string | null; ip: string | null; method: string; createdAt: string; lastSeenAt: string | null }

function deviceName(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const os = /Android/.test(ua) ? 'Android' : /iPad|iPhone/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  const app = /Electron/.test(ua) ? 'Desktop app' : /wv\)/.test(ua) ? 'Android app' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return [app, os && `on ${os}`].filter(Boolean).join(' ');
}

const when = (s: string | null) => (s ? new Date(`${s.replace(' ', 'T')}Z`).toLocaleString() : '');

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="card stack" style={{ background: 'var(--surface-2)' }}>
      <strong>Save these recovery codes somewhere safe. Each one works once if you lose your phone. They won't be shown again.</strong>
      <code style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, fontSize: '1.1rem' }}>{codes.map((c) => <span key={c}>{c}</span>)}</code>
      <div className="row">
        <button onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>Copy</button>
        <button className="primary" onClick={onDone}>I saved them</button>
      </div>
    </div>
  );
}

export function SecurityCard() {
  const { toast } = useApp();
  const [info, reload] = useLoad<SecurityInfo>('/api/auth/security');
  const [sessions, reloadSessions] = useLoad<SessionRow[]>('/api/auth/sessions');
  const [pw, setPw] = useState({ username: '', currentPassword: '', newPassword: '' });
  const [totp, setTotp] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState('');
  const [reauth, setReauth] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); }
  }
  // Sensitive actions need the current password, or a 2FA code when there's no password.
  const proof = () => (info?.hasPassword ? { currentPassword: reauth } : { code: reauth });
  const needsProof = !!(info?.hasPassword || info?.totpEnabled);

  if (!info) return null;
  return (
    <div className="card stack">
      <h2>Sign-in and security</h2>
      {needsProof && (
        <label className="field">{info.hasPassword ? 'Current password (needed for changes below)' : 'Two-factor code (needed for changes below)'}
          <input type="password" value={reauth} onChange={(e) => setReauth(e.target.value)} autoComplete={info.hasPassword ? 'current-password' : 'one-time-code'} />
        </label>
      )}

      <h3>{info.hasPassword ? 'Change password' : 'Set a password'}</h3>
      {!info.hasPassword && <p className="small muted" style={{ margin: 0 }}>Quick sign-in only works at home. Set a username and password to sign in from anywhere.</p>}
      <form className="row" onSubmit={(e) => { e.preventDefault(); void run(async () => {
        const r = await api<{ username: string }>('/api/auth/password', { body: { ...proof(), username: pw.username, newPassword: pw.newPassword } });
        setPw({ username: '', currentPassword: '', newPassword: '' });
        toast(`Password saved for ${r.username}. Other devices were signed out.`);
        await Promise.all([reload(), reloadSessions()]);
      }); }}>
        {info.username ? <span className="pill">Username: {info.username}</span> : (
          <input placeholder="Choose a username" value={pw.username} onChange={(e) => setPw({ ...pw, username: e.target.value })} autoComplete="username" style={{ flex: 1 }} />
        )}
        <input placeholder="New password (10+ characters)" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" style={{ flex: 1 }} />
        <button disabled={pw.newPassword.length < 10}>Save</button>
      </form>

      <h3>Two-factor codes</h3>
      {info.totpEnabled ? (
        <>
          <p style={{ margin: 0 }}><span className="pill ok">On</span> <span className="small muted">{info.recoveryCodesLeft} recovery codes left</span></p>
          <div className="row">
            <input placeholder="Code from your app" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" style={{ maxWidth: 220 }} />
            <button onClick={() => run(async () => { setCodes((await api<{ recoveryCodes: string[] }>('/api/auth/recovery-codes', { body: { code } })).recoveryCodes); setCode(''); await reload(); })}>New recovery codes</button>
            <button className="danger" onClick={() => run(async () => { await api('/api/auth/totp/disable', { body: { code } }); setCode(''); toast('Two-factor is off'); await reload(); })}>Turn off</button>
          </div>
        </>
      ) : totp ? (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden, Aegis…), then type the 6-digit code it shows.</p>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ background: '#fff', padding: 8, borderRadius: 12, width: 236 }} dangerouslySetInnerHTML={{ __html: totp.qrSvg }} />
            <div className="stack" style={{ flex: 1 }}>
              <span className="small muted">Can't scan? Enter this key:</span>
              <code style={{ wordBreak: 'break-all' }}>{totp.secret}</code>
              <input placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
              <button className="primary" disabled={code.length < 6} onClick={() => run(async () => {
                setCodes((await api<{ recoveryCodes: string[] }>('/api/auth/totp/enable', { body: { code } })).recoveryCodes);
                setTotp(null); setCode(''); await reload();
              })}>Turn on</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="row">
          <span className="pill">Off</span>
          <button onClick={() => run(async () => setTotp(await api('/api/auth/totp/setup', { body: proof() })))}>Set up two-factor</button>
        </div>
      )}
      {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}

      <h3>Passkeys</h3>
      <p className="small muted" style={{ margin: 0 }}>Sign in with your fingerprint, face or phone instead of a password. Passkeys only work at {info.passkeyOrigin}.</p>
      {info.passkeys.map((p) => (
        <div key={p.id} className="row">
          <span style={{ flex: 1 }}>🔑 {p.name} <span className="small muted">added {when(p.createdAt)}{p.lastUsedAt && `, last used ${when(p.lastUsedAt)}`}</span></span>
          <button className="ghost danger" onClick={() => run(async () => { await api(`/api/auth/passkeys/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); await reload(); })}>Remove</button>
        </div>
      ))}
      {browserSupportsWebAuthn() ? (
        <button style={{ alignSelf: 'flex-start' }} onClick={() => run(async () => {
          const options = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/auth/passkey/register-options', { body: proof() });
          const response = await startRegistration({ optionsJSON: options });
          const name = prompt('Name this passkey', deviceName(navigator.userAgent)) ?? 'Passkey';
          await api('/api/auth/passkey/register', { body: { response, name } });
          toast('Passkey added');
          await reload();
        })}>＋ Add a passkey</button>
      ) : <p className="small muted">This browser doesn't support passkeys.</p>}

      <h3>Signed-in devices</h3>
      <div className="list">
        {sessions?.map((s) => (
          <div key={s.id} className="list-item">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{deviceName(s.userAgent)} {s.current && <span className="pill ok">this device</span>}</div>
              <div className="small muted">{s.method} · {s.ip} · last active {when(s.lastSeenAt ?? s.createdAt)}</div>
            </div>
            {!s.current && <button className="ghost danger" onClick={() => run(async () => { await api(`/api/auth/sessions/${s.id}`, { method: 'DELETE' }); await reloadSessions(); })}>Sign out</button>}
          </div>
        ))}
      </div>
      {(sessions?.length ?? 0) > 1 && (
        <button style={{ alignSelf: 'flex-start' }} onClick={() => run(async () => { await api('/api/auth/sessions/sign-out-others', { body: {} }); await reloadSessions(); toast('Signed out everywhere else'); })}>Sign out all other devices</button>
      )}
      {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
    </div>
  );
}

export function AdminSignIn() {
  const { toast } = useApp();
  const [s, reload] = useLoad<{ signupMode: string; localLogin: string; google: boolean; publicUrl: string }>('/api/admin/settings');
  if (!s) return null;
  const save = async (body: object) => { await api('/api/admin/settings', { method: 'PATCH', body }); await reload(); toast('Saved'); };
  return (
    <div className="stack">
      <h3>Who can make an account</h3>
      <div className="chips">
        {[['invite', 'Invite only (needs a home join code)'], ['open', 'Anyone'], ['closed', 'Nobody new']].map(([v, l]) => (
          <button key={v} className={`chip${s.signupMode === v ? ' on' : ''}`} onClick={() => save({ signupMode: v })}>{l}</button>
        ))}
      </div>
      <h3>Quick sign-in (name only, no password)</h3>
      <div className="chips">
        {[['lan', 'Home network only'], ['off', 'Off'], ['anywhere', 'Anywhere (not safe on the internet)']].map(([v, l]) => (
          <button key={v} className={`chip${s.localLogin === v ? ' on' : ''}`} onClick={() => save({ localLogin: v })}>{l}</button>
        ))}
      </div>
      <p className="small muted" style={{ margin: 0 }}>Public address: {s.publicUrl}. Google sign-in is {s.google ? 'on' : 'off'}.</p>
    </div>
  );
}

/** Admin actions to help someone who's locked out. */
export function AdminUserActions({ user, onChange }: { user: { id: string; name: string; disabled: number; totp_enabled: number }; onChange: () => void }) {
  const { toast } = useApp();
  const act = async (body: object, msg: string) => {
    const r = await api<{ username?: string; tempPassword?: string }>(`/api/admin/users/${user.id}/security`, { body });
    if (r.tempPassword) alert(`Give ${user.name} these to sign in, then have them change the password in Settings:\n\nUsername: ${r.username}\nPassword: ${r.tempPassword}`);
    else toast(msg);
    onChange();
  };
  return (
    <span className="row" style={{ gap: 4 }}>
      <button className="ghost" onClick={() => act({ tempPassword: true }, '')}>Temp password</button>
      {!!user.totp_enabled && <button className="ghost" onClick={() => act({ resetTwoFactor: true }, 'Two-factor cleared')}>Clear 2FA</button>}
      <button className="ghost" onClick={() => act({ signOut: true }, 'Signed out everywhere')}>Sign out</button>
      <button className="ghost danger" onClick={() => act({ disabled: !user.disabled }, user.disabled ? 'Turned back on' : 'Turned off')}>{user.disabled ? 'Turn on' : 'Turn off'}</button>
    </span>
  );
}
