import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { AdminSignIn, AdminUserActions, SecurityCard } from './Security.tsx';
import { AVATARS, AVATAR_LABELS, POINT_ICONS } from '../../../shared/catalog.ts';
import { ThemePicker } from '../components/ThemePicker.tsx';
import { CalendarsCard } from './Calendars.tsx';
import { AiCard } from '../components/Ideas.tsx';

function Profile() {
  const { who, home, refresh, toast } = useApp();
  const user = who!.user!;
  const [name, setName] = useState(user.name);
  const [pair, setPair] = useState<string | null>(null);
  const update = async (body: object) => { await api('/api/me', { method: 'PATCH', body }); await refresh(); };

  return (
    <div className="card stack">
      <h2>You</h2>
      <form className="row" onSubmit={async (e) => { e.preventDefault(); await update({ name }); toast('Saved'); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
        <button>Save name</button>
      </form>
      {user.email && <p className="small muted" style={{ margin: 0 }}>Signed in with Google as {user.email}</p>}
      <h3>Raccoon avatar</h3>
      <div className="chips">
        {AVATARS.map((a) => (
          <button key={a} className={`chip avatar-chip${user.avatar === a ? ' on' : ''}`} onClick={() => update({ avatar: a })}>
            <RaccoonAvatar variant={a} size={52} />
            <span className="small">{AVATAR_LABELS[a]}</span>
          </button>
        ))}
      </div>
      <h3>Your theme</h3>
      <ThemePicker value={user.theme === 'home' ? null : user.theme} onPick={(t) => void update({ theme: t ?? 'home' })}
        inherit={{ label: 'Same as the home', theme: home?.theme ?? 'sunny' }} />
      <h3>Your phone or tablet</h3>
      <p className="small muted" style={{ margin: 0 }}>Sign yourself in on another device without typing your password: get a code here, then choose “I have a pairing code” there.</p>
      <div className="row">
        <button onClick={async () => setPair((await api<{ code: string }>('/api/auth/pair-code', { body: {} })).code)}>📱 Pair a device</button>
        {pair && <span className="pair-code">{pair}</span>}
        {pair && <span className="small muted">valid for 10 minutes</span>}
      </div>
      <div className="row">
        <span className="spacer" />
        <button className="danger" onClick={async () => { await api('/api/auth/logout', { body: {} }); location.href = '/'; }}>Sign out</button>
      </div>
    </div>
  );
}

function FamilyTablets() {
  const { base, homeId, who, refresh, toast } = useApp();
  const [devices, reload] = useLoad<{ id: string; name: string; lastSeenAt: string | null; current: boolean }[]>(`${base}/devices`);
  const [code, setCode] = useState<string | null>(null);
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Family tablets</h2>
      <p className="small muted" style={{ margin: 0 }}>
        A family tablet shows every kid's raccoon. Kids tap theirs (and type their PIN if they have one) to see and tick off their chores.
        It never signs in as you, so kids can't approve their own chores.
      </p>
      <div className="row">
        <button className="primary" onClick={async () => setCode((await api<{ code: string }>('/api/auth/pair-code', { body: { kind: 'device', homeId } })).code)}>
          📟 Get a tablet code
        </button>
        {code && <span className="pair-code">{code}</span>}
        {code && <span className="small muted">On the tablet, open this site, choose “I have a pairing code” and type it. Valid 10 minutes.</span>}
      </div>
      {!who?.device && (
        <button style={{ alignSelf: 'flex-start' }} onClick={async () => {
          if (!confirm('Turn this device into the family tablet? You will be signed out here, and it will show the kids\' screen.')) return;
          await api(`${base}/devices`, { body: { name: 'Family tablet' } });
          await api('/api/auth/logout', { body: {} });
          location.href = '/';
        }}>Make this device the family tablet</button>
      )}
      {devices?.map((d) => (
        <div key={d.id} className="row">
          <span style={{ flex: 1 }}>📟 {d.name} {d.current && <span className="pill ok">this device</span>} <span className="small muted">{d.lastSeenAt ? `last used ${d.lastSeenAt}` : 'never used'}</span></span>
          <button className="ghost danger" onClick={async () => {
            if (!confirm(`Unpair ${d.name}? Kids on it get signed out.`)) return;
            await api(`${base}/devices/${d.id}`, { method: 'DELETE' });
            toast('Tablet unpaired');
            await Promise.all([reload(), refresh()]);
          }}>Unpair</button>
        </div>
      ))}
    </div>
  );
}

function HomeSettings() {
  const { who, home, base, homeId, setHome, refresh, refreshHome, toast } = useApp();
  const [tokens, reloadTokens] = useLoad<{ id: string; name: string; scope: string; last_used_at: string | null }[]>(`${base}/tokens`);
  const [newToken, setNewToken] = useState<string | null>(null);
  if (!home) return null;
  const patch = async (body: object, msg = 'Saved') => {
    try { await api(base, { method: 'PATCH', body }); toast(msg); } catch (e) { toast((e as Error).message); }
    await Promise.all([refreshHome(), refresh()]);
  };
  const me = who!.user!;

  return (
    <div className="card stack">
      <div className="row">
        <h2 style={{ flex: 1, margin: 0 }}>Home</h2>
        {who!.homes.length > 1 && (
          <select value={homeId ?? ''} onChange={(e) => setHome(e.target.value)} style={{ width: 'auto' }}>
            {who!.homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        )}
        <Link className="btn" to="/home/new">＋ Add or join a home</Link>
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void patch({ name: (e.currentTarget.elements.namedItem('hn') as HTMLInputElement).value }, 'Renamed'); }}>
        <input name="hn" defaultValue={home.name} key={home.name} style={{ flex: 1 }} />
        <button>Rename</button>
      </form>

      <h3>Points</h3>
      <p className="small muted" style={{ margin: 0 }}>Call them whatever your family likes: Shinies, Acorns, Stars, Bucks…</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void patch({ pointsName: (e.currentTarget.elements.namedItem('pn') as HTMLInputElement).value }); }}>
        <input name="pn" defaultValue={home.pointsName} key={home.pointsName} style={{ flex: 1, maxWidth: 260 }} />
        <button>Save name</button>
      </form>
      <div className="chips">
        {POINT_ICONS.map((i) => <button key={i} className={`chip icon-chip${home.pointsIcon === i ? ' on' : ''}`} onClick={() => void patch({ pointsIcon: i })}>{i}</button>)}
      </div>

      <h3>Taking points away</h3>
      <label className="row" style={{ fontWeight: 600 }}>
        <input type="checkbox" checked={!!home.allowNegative} onChange={(e) => void patch({ allowNegative: e.target.checked })} style={{ width: 24, minHeight: 24 }} />
        Let balances go below zero
      </label>
      <p className="small muted" style={{ margin: 0 }}>Off by default: a penalty takes what's there and stops at zero.</p>

      <h3>Home theme</h3>
      <p className="small muted" style={{ margin: 0 }}>Used on the family tablet and by anyone who hasn't picked their own. Each kid can have their own in Kids → Edit.</p>
      <ThemePicker value={home.theme} onPick={(t) => t && void patch({ theme: t }, 'Theme changed')} />

      <h3>Calendar</h3>
      <div className="row">
        <span>Weeks start on</span>
        <div className="chips">
          {[[0, 'Sunday'], [1, 'Monday']].map(([v, l]) => (
            <button key={v} className={`chip${home.weekStart === v ? ' on' : ''}`} onClick={() => void patch({ weekStart: v })}>{l}</button>
          ))}
        </div>
      </div>
      <div className="row">
        <span>Time zone: <strong>{home.timezone}</strong></span>
        {home.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone && (
          <button onClick={() => void patch({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}>Use {Intl.DateTimeFormat().resolvedOptions().timeZone}</button>
        )}
      </div>

      <h3>Parents</h3>
      <div className="row">
        <span>Join code for another parent:</span>
        <strong className="pair-code" style={{ fontSize: '1.4rem' }}>{home.joinCode}</strong>
        <button onClick={async () => { await api(`${base}/join-code`, { body: {} }); await refreshHome(); }}>New code</button>
      </div>
      <div className="list">
        {home.parents?.map((p) => (
          <div key={p.id} className="list-item">
            <RaccoonAvatar variant={p.avatar} size={40} />
            <span style={{ flex: 1 }}>{p.name}{p.userId === me.id && ' (you)'}</span>
            <button className="ghost danger" onClick={async () => {
              const self = p.userId === me.id;
              if (!confirm(self ? 'Leave this home?' : `Remove ${p.name}?`)) return;
              try { await api(`${base}/parents/${p.id}`, { method: 'DELETE' }); } catch (err) { toast((err as Error).message); return; }
              if (self) await refresh(); else await refreshHome();
            }}>{p.userId === me.id ? 'Leave' : 'Remove'}</button>
          </div>
        ))}
      </div>

      <h3>Home Assistant and automations</h3>
      <p className="small muted" style={{ margin: 0 }}>
        Home Assistant reads <code>{base}/ha/summary</code> for per-kid sensors ({home.pointsName}, chores left, waiting for review, streak, level).
        A <strong>read</strong> token can only look. A <strong>control</strong> token can also mark chores done, approve them, and give or take points.
        See <code>docs/home-assistant.md</code> for ready-to-paste YAML.
      </p>
      <p className="small" style={{ margin: 0 }}>Home ID: <code>{home.id}</code></p>
      <form className="row" onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const el = form.elements.namedItem('tn') as HTMLInputElement;
        const scope = (form.elements.namedItem('ts') as HTMLSelectElement).value;
        setNewToken((await api<{ token: string }>(`${base}/tokens`, { body: { name: el.value, scope } })).token);
        el.value = '';
        await reloadTokens();
      }}>
        <input name="tn" placeholder="Token name, e.g. Home Assistant" style={{ flex: 1, minWidth: 200 }} required />
        <select name="ts" defaultValue="read" style={{ width: 'auto' }} aria-label="What the token may do">
          <option value="read">Read only</option>
          <option value="control">Read and control</option>
        </select>
        <button>Create token</button>
      </form>
      {newToken && <div className="card" style={{ background: 'var(--surface-2)' }}><strong>Copy this now, it won't be shown again:</strong><br /><code style={{ wordBreak: 'break-all' }}>{newToken}</code></div>}
      <form className="row" onSubmit={(e) => { e.preventDefault(); void patch({ haWebhookUrl: (e.currentTarget.elements.namedItem('wh') as HTMLInputElement).value }, 'Webhook saved'); }}>
        <input name="wh" defaultValue={home.haWebhookUrl ?? ''} key={home.haWebhookUrl ?? ''} placeholder="Webhook for events, e.g. http://homeassistant.local:8123/api/webhook/daytime-ninja" style={{ flex: 1, minWidth: 260 }} />
        <button>Save webhook</button>
      </form>
      <p className="small muted" style={{ margin: 0 }}>Optional. Daytime Ninja POSTs an event there when a chore is marked done or approved, points change, or a goal is reached or redeemed.</p>
      {tokens?.map((t) => (
        <div key={t.id} className="row">
          <span style={{ flex: 1 }}>{t.name} <span className="pill">{t.scope === 'control' ? 'read + control' : 'read only'}</span> <span className="small muted">{t.last_used_at ? `last used ${t.last_used_at}` : 'never used'}</span></span>
          <button className="ghost danger" onClick={async () => { await api(`${base}/tokens/${t.id}`, { method: 'DELETE' }); await reloadTokens(); }}>Revoke</button>
        </div>
      ))}

      <h3>Danger zone</h3>
      <button className="danger" style={{ alignSelf: 'flex-start' }} onClick={async () => {
        if (prompt(`This deletes the home with every kid, chore and point, forever. Type the home name to confirm: ${home.name}`) !== home.name) return;
        await api(base, { method: 'DELETE' });
        await refresh();
      }}>Delete home</button>
    </div>
  );
}

interface Overview {
  users: { id: string; name: string; username: string | null; email: string | null; is_admin: number; disabled: number; totp_enabled: number; has_password: number; has_google: number; passkeys: number; homes: number }[];
  homes: { id: string; name: string; parents: number; kids: number; chores: number }[];
}

function Admin() {
  const { who, toast } = useApp();
  const [data, reload] = useLoad<Overview>('/api/admin/overview');
  if (!data) return null;
  const me = who!.user!;
  return (
    <div className="card stack">
      <h2>Server admin</h2>
      <AdminSignIn />
      <h3>People</h3>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Person</th><th>Sign-in</th><th>Homes</th><th>Admin</th><th /></tr></thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}{!!u.disabled && <span className="pill bad"> off</span>}<div className="small muted">{u.username ?? u.email}</div></td>
                <td className="small">{[u.has_password && 'password', u.has_google && 'Google', u.passkeys && 'passkey', u.totp_enabled && '2FA'].filter(Boolean).join(', ') || 'quick only'}</td>
                <td>{u.homes}</td>
                <td>
                  <input type="checkbox" checked={!!u.is_admin} disabled={u.id === me.id} style={{ width: 24, minHeight: 24 }}
                    onChange={async (e) => { await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { isAdmin: e.target.checked } }); await reload(); }} />
                </td>
                <td>{u.id !== me.id && (
                  <span className="row" style={{ gap: 4 }}>
                    <AdminUserActions user={u} onChange={() => void reload()} />
                    <button className="ghost danger" onClick={async () => { if (confirm(`Delete ${u.name}'s account?`)) { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); await reload(); toast('Deleted'); } }}>Delete</button>
                  </span>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Homes on this server</h3>
      <ul>{data.homes.map((h) => <li key={h.id}>{h.name} <span className="muted small">{h.parents} parents · {h.kids} kids · {h.chores} chores</span></li>)}</ul>
    </div>
  );
}

export function Settings() {
  const { who } = useApp();
  return (
    <div className="stack" style={{ maxWidth: 960 }}>
      <div className="topbar"><h1>Settings</h1></div>
      <FamilyTablets />
      <HomeSettings />
      <CalendarsCard />
      <AiCard />
      <Profile />
      <SecurityCard />
      {who?.user?.isAdmin && <Admin />}
      <p className="small muted">Daytime Ninja is open source under the MIT license.</p>
    </div>
  );
}
