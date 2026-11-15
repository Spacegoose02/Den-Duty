import { useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { Modal } from './Bits.tsx';

interface SsoView {
  provider: {
    name: string; issuer: string; clientId: string; hasSecret: boolean; extraScopes: string;
    autoCreate: boolean; showOnLogin: boolean; source: 'settings' | 'env';
  } | null;
  callbackUrl: string;
  publicUrl: string;
}
type TestResult = { ok: true; issuer: string; authorizationEndpoint: string; tokenEndpoint: string; warnings: string[] } | { ok: false; error: string };

/** Server admin: the OpenID Connect provider behind the "Sign in with …" button (TinyAuth, Authentik, Authelia...). */
export function SsoProviderCard() {
  const { toast } = useApp();
  const [view, reload] = useLoad<SsoView>('/api/admin/sso');
  const [editing, setEditing] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  if (!view) return null;
  const p = view.provider;

  const runTest = async () => {
    setTesting(true);
    try { setTest(await api<TestResult>('/api/admin/sso/test', { body: {} })); } finally { setTesting(false); }
  };

  return (
    <div className="card stack" id="sign-in-provider">
      <h2 style={{ margin: 0 }}>🔑 Single sign-on</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Let parents sign in with your own OpenID Connect provider, such as TinyAuth, Authentik, Authelia, Keycloak or Pocket ID.
      </p>
      <label className="field">Redirect URL to register at your provider
        <span className="row" style={{ gap: 6 }}>
          <input readOnly value={view.callbackUrl} style={{ flex: 1, minWidth: 220, fontFamily: 'monospace' }} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(view.callbackUrl); toast('Copied'); }}>Copy</button>
        </span>
      </label>
      {!/^https:/.test(view.publicUrl) && (
        <p className="small chip-reason" style={{ margin: 0 }}>
          PUBLIC_URL is {view.publicUrl}. Set it to the https address people use for Den Duty, or the provider will send them to the wrong place.
        </p>
      )}
      {p ? (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <strong>{p.name}</strong> {p.showOnLogin ? <span className="pill">on the sign-in page</span> : <span className="pill">hidden</span>}
            {p.autoCreate && <span className="pill"> makes accounts</span>}
            <div className="small muted" style={{ wordBreak: 'break-all' }}>{p.issuer} · client {p.clientId}{p.hasSecret ? '' : ' · no secret saved'}</div>
            {p.source === 'env' && <div className="small muted">From the OIDC_* environment variables. Saving here takes over from them.</div>}
          </div>
          <span className="row" style={{ gap: 6 }}>
            <button onClick={() => void runTest()} disabled={testing}>{testing ? 'Testing…' : 'Test'}</button>
            <button className="primary" onClick={() => setEditing(true)}>Edit</button>
          </span>
        </div>
      ) : (
        <button className="primary" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing(true)}>Add a provider</button>
      )}
      {test && (test.ok ? (
        <div className="small" style={{ margin: 0 }}>
          ✅ Found {test.issuer}. Sign-in goes to {test.authorizationEndpoint}.
          {test.warnings.map((w) => <div key={w} className="chip-reason">{w}</div>)}
        </div>
      ) : (
        <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>Couldn't read the provider's settings: {test.error}</p>
      ))}
      {editing && <ProviderEditor view={view} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); setTest(null); await reload(); }} />}
    </div>
  );
}

function ProviderEditor({ view, onClose, onSaved }: { view: SsoView; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useApp();
  const p = view.provider;
  const [f, setF] = useState({
    name: p?.name ?? 'TinyAuth', issuer: p?.issuer ?? '', clientId: p?.clientId ?? '', clientSecret: '',
    extraScopes: p?.extraScopes ?? '', autoCreate: p?.autoCreate ?? false, showOnLogin: p?.showOnLogin ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api('/api/admin/sso', { method: 'PUT', body: f });
      toast('Saved');
      await onSaved();
    } catch (err) { setError((err as Error).message); }
  };
  const remove = async () => {
    if (!confirm(`Remove ${p?.name ?? 'this provider'}? People who sign in with it will need another way in.`)) return;
    await api('/api/admin/sso', { method: 'DELETE' });
    toast('Removed');
    await onSaved();
  };

  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <h2 style={{ margin: 0 }}>{p ? `Edit ${p.name}` : 'Add a sign-in provider'}</h2>
        <label className="field">Name on the sign-in button
          <input value={f.name} onChange={set('name')} maxLength={40} required />
        </label>
        <label className="field">Issuer URL
          <input value={f.issuer} onChange={set('issuer')} placeholder="https://auth.example.com" inputMode="url" autoComplete="off" spellCheck={false} required />
        </label>
        <label className="field">Client ID
          <input value={f.clientId} onChange={set('clientId')} autoComplete="off" spellCheck={false} required />
        </label>
        <label className="field">Client secret
          <input type="password" value={f.clientSecret} onChange={set('clientSecret')} autoComplete="new-password"
            placeholder={p?.hasSecret ? 'Saved; leave empty to keep it' : ''} />
        </label>
        <label className="field">Extra scopes (optional)
          <input value={f.extraScopes} onChange={set('extraScopes')} placeholder="openid, profile and email are always asked for" spellCheck={false} />
        </label>
        <label className="row" style={{ gap: 8, fontWeight: 600 }}>
          <input type="checkbox" checked={f.autoCreate} onChange={set('autoCreate')} style={{ width: 22, minHeight: 22 }} />
          Create an account for anyone who signs in with it
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          Only turn this on for a provider that just lets in people you trust, like your own TinyAuth or Authelia. They skip the join code
          and still have to create a home or join one. Off, new people follow “Who can make an account”.
        </p>
        <label className="row" style={{ gap: 8, fontWeight: 600 }}>
          <input type="checkbox" checked={f.showOnLogin} onChange={set('showOnLogin')} style={{ width: 22, minHeight: 22 }} />
          Show on the sign-in page
        </label>
        <p className="small muted" style={{ margin: 0 }}>Register this redirect URL at the provider: <code style={{ wordBreak: 'break-all' }}>{view.callbackUrl}</code></p>
        {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {p?.source === 'settings' && <button type="button" className="ghost danger" style={{ marginRight: 'auto' }} onClick={() => void remove()}>Remove</button>}
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
