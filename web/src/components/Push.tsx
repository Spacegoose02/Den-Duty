// Turning push notifications on for this browser: as a parent, or as the family tablet (kid nudges).
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../state.tsx';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js');
}

export function PushSettings() {
  const { base, who, toast } = useApp();
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = supported();

  useEffect(() => {
    if (!ok) return;
    void navigator.serviceWorker.getRegistration('/').then((r) => r?.pushManager.getSubscription()).then((s) => setEndpoint(s?.endpoint ?? null));
  }, [ok]);

  async function turnOn(as: 'me' | 'tablet') {
    setBusy(true);
    try {
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site in the browser settings');
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const { publicKey } = await api<{ publicKey: string }>('/api/push/key');
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      await api(`${base}/push`, { body: { subscription: sub.toJSON(), as } });
      setEndpoint(sub.endpoint);
      await api(`${base}/push/test`, { body: { endpoint: sub.endpoint } });
      toast('Notifications are on. A test one is on its way.');
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { await api(`${base}/push/remove`, { body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
      setEndpoint(null);
      toast('Notifications are off on this device');
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>🔔 Notifications</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Parents get a buzz when a chore is waiting, a kid asks for help or buys a reward, a reminder comes due, and when the weekly recap is ready.
        The family tablet gets friendly nudges 15 minutes before a chore's due time, and the big celebrations.
      </p>
      {!ok ? <p className="small" style={{ margin: 0 }}>This browser can't do notifications. On an iPhone or iPad, add Den Duty to the home screen first (Share → Add to Home Screen) and open it from there.</p>
        : endpoint ? (
          <div className="row">
            <span className="pill ok">On for this device</span>
            <button disabled={busy} onClick={() => void api(`${base}/push/test`, { body: { endpoint } }).then(() => toast('Test sent'), (e: Error) => toast(e.message))}>Send a test</button>
            <button className="ghost danger" disabled={busy} onClick={() => void turnOff()}>Turn off</button>
          </div>
        ) : (
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => void turnOn('me')}>Turn on for me on this device</button>
            {who?.device && <button disabled={busy} onClick={() => void turnOn('tablet')}>Turn on as the family tablet</button>}
          </div>
        )}
    </section>
  );
}
