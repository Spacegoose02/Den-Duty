// Offline tablet: when the Wi-Fi drops, the service worker shows the last copy of each page, and a kid's taps
// ("I did it!", practice logged, how I feel) wait in an outbox here and send themselves when the internet is back.
// Only those few kid actions queue; everything else says it's offline, because a stale parent edit is worse than none.
import { useEffect, useState } from 'react';

export interface Queued { id: string; method: string; path: string; body: unknown; at: number }

const KEY = 'den-duty-outbox';
const EVENT = 'den-duty-outbox';
/** Kid actions that are safe to send later: they only add something, and a duplicate is refused by the server. */
const QUEUEABLE: [string, RegExp][] = [
  ['POST', /\/api\/homes\/[^/]+\/instances\/[^/]+\/done$/],
  ['POST', /\/api\/homes\/[^/]+\/habits\/[^/]+\/log$/],
  ['PUT', /\/api\/homes\/[^/]+\/kids\/[^/]+\/feelings$/],
];

export class QueuedError extends Error {
  constructor() { super("No internet right now. It's saved and will send when the Wi-Fi is back."); }
}

let offline = typeof navigator !== 'undefined' && navigator.onLine === false;
const changed = () => window.dispatchEvent(new Event(EVENT));

export function isQueueable(method: string, path: string): boolean {
  return QUEUEABLE.some(([m, re]) => m === method && re.test(path));
}

export function outbox(): Queued[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Queued[]; } catch { return []; }
}
function save(list: Queued[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked: nothing we can do */ }
  changed();
}

export function enqueue(method: string, path: string, body: unknown): void {
  const list = outbox().filter((q) => !(q.method === method && q.path === path && method === 'POST' && /\/done$/.test(path)));
  list.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, method, path, body, at: Date.now() });
  save(list);
}

export function setOffline(v: boolean): void {
  if (offline === v) return;
  offline = v;
  changed();
}

let flushing = false;
/** Send what's waiting, oldest first. Stops at the first network failure; drops anything the server refuses. */
export async function flushOutbox(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const q of outbox()) {
      let res: Response;
      try {
        res = await fetch(q.path, {
          method: q.method, credentials: 'same-origin',
          headers: q.body === undefined ? {} : { 'content-type': 'application/json' },
          body: q.body === undefined ? undefined : JSON.stringify(q.body),
        });
      } catch {
        setOffline(true);
        break;
      }
      setOffline(false);
      // A 5xx might work next time; a 4xx (already done, kid switched, chore gone) never will.
      if (res.status >= 500) break;
      save(outbox().filter((x) => x.id !== q.id));
      if (res.ok) sent++;
    }
  } finally { flushing = false; }
  if (sent) window.dispatchEvent(new CustomEvent('den-duty-synced', { detail: sent }));
  return sent;
}

/** Start the service worker and the outbox timer. */
export function startOffline(): void {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  window.addEventListener('online', () => { setOffline(false); void flushOutbox(); });
  window.addEventListener('offline', () => setOffline(true));
  window.setInterval(() => { if (outbox().length) void flushOutbox(); }, 20_000);
  void flushOutbox();
}

export function useOffline(): { offline: boolean; waiting: Queued[] } {
  const [state, setState] = useState(() => ({ offline, waiting: outbox() }));
  useEffect(() => {
    const on = () => setState({ offline, waiting: outbox() });
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on); };
  }, []);
  return state;
}

/** Chore ids whose "I did it!" is waiting to send. */
export function useQueuedDone(): Set<string> {
  const { waiting } = useOffline();
  return new Set(waiting.map((q) => /\/instances\/([^/]+)\/done$/.exec(q.path)?.[1]).filter((x): x is string => !!x));
}

export function OfflineBanner() {
  const { offline: off, waiting } = useOffline();
  const [synced, setSynced] = useState(0);
  useEffect(() => {
    const on = (e: Event) => { setSynced((e as CustomEvent<number>).detail); window.setTimeout(() => setSynced(0), 3000); };
    window.addEventListener('den-duty-synced', on);
    return () => window.removeEventListener('den-duty-synced', on);
  }, []);
  if (synced && !off) return <div className="offline-banner ok" role="status">✅ Back online. Sent {synced === 1 ? 'the thing that was' : `the ${synced} things that were`} waiting.</div>;
  if (!off && !waiting.length) return null;
  return (
    <div className="offline-banner" role="status">
      📶 {off ? 'No internet. Showing what we saved earlier.' : 'Sending what was saved…'}
      {waiting.length > 0 && ` ${waiting.length} thing${waiting.length === 1 ? ' is' : 's are'} waiting to send.`}
    </div>
  );
}
