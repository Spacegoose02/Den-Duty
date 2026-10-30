// The rewards shop: kids spend points on rewards their parents set up, and a grown-up hands them over.
import { useState } from 'react';
import { api, type Kid, type ShopItem, type ShopOrder } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { Modal, ProgressBar } from './Bits.tsx';
import { RaccoonAvatar } from './Raccoon.tsx';
import { confetti } from './Confetti.ts';

const SHOP_ICONS = ['🎁', '🍦', '🍕', '🎬', '🎮', '📱', '🛝', '🧁', '🍩', '🎨', '📚', '🧸', '⚽', '🌙', '🏊', '🎟️', '🍿', '🚲', '🦖', '💵'];

/** The shop on a kid's board. A kid buys with a big confirm step so a stray tap doesn't spend their points. */
export function KidShop({ kid, asParent, onBought }: { kid: Kid; asParent: boolean; onBought: () => void }) {
  const { base, home, toast } = useApp();
  const [items, reloadItems] = useLoad<ShopItem[]>(`${base}/shop`);
  const [orders, reloadOrders] = useLoad<ShopOrder[]>(`${base}/shop/orders`);
  const [buying, setBuying] = useState<ShopItem | null>(null);
  const [busy, setBusy] = useState(false);
  const icon = home?.pointsIcon ?? '✨';
  if (!items?.length) return null;
  const mine = (orders ?? []).filter((o) => o.memberId === kid.id && o.status === 'waiting');

  async function buy(item: ShopItem) {
    setBusy(true);
    try {
      await api(`${base}/kids/${kid.id}/shop/${item.id}/buy`, { body: {} });
      setBuying(null);
      confetti({ colors: [kid.color], count: 160 });
      toast(`${item.icon} ${item.title} is yours! A grown-up will hand it over.`);
      await Promise.all([reloadItems(), reloadOrders()]);
      onBought();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="card stack pg-goals">
      <h2 style={{ margin: 0 }}>🛍️ Rewards shop</h2>
      <div className="shop-grid">
        {items.map((it) => {
          const afford = kid.balance >= it.price;
          const soldOut = it.stock === 0;
          return (
            <button key={it.id} className={`shop-item${afford && !soldOut ? ' can-buy' : ''}`} disabled={soldOut} onClick={() => setBuying(it)}>
              <span className="shop-icon" aria-hidden>{it.icon}</span>
              <span className="shop-title">{it.title}</span>
              <span className="shop-price">{it.price} {icon}</span>
              {soldOut ? <span className="small muted">Sold out</span>
                : afford ? <span className="small" style={{ color: 'var(--ok)', fontWeight: 700 }}>You can get this!</span>
                  : <span className="shop-progress"><ProgressBar percent={(kid.balance / it.price) * 100} color={kid.color} /><span className="small muted">{it.price - kid.balance} to go</span></span>}
              {it.stock != null && it.stock > 0 && <span className="small muted">{it.stock} left</span>}
            </button>
          );
        })}
      </div>
      {mine.length > 0 && (
        <p className="small" style={{ margin: 0 }}>
          ⏳ Waiting for a grown-up: {mine.map((o) => `${o.icon} ${o.title}`).join(', ')}
        </p>
      )}
      {buying && (
        <Modal onClose={() => setBuying(null)}>
          <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
            <span style={{ fontSize: '4.5rem', lineHeight: 1 }}>{buying.icon}</span>
            <h2 style={{ margin: 0 }}>{buying.title}</h2>
            {kid.balance >= buying.price ? (
              <>
                <p style={{ margin: 0 }}>{asParent ? `Spend ${buying.price} ${icon} of ${kid.name}'s points on this?` : `Spend ${buying.price} ${icon} on this?`}
                  <br /><span className="small muted">{kid.balance - buying.price} {icon} left after</span></p>
                <div className="row" style={{ justifyContent: 'center' }}>
                  <button className="ghost" onClick={() => setBuying(null)}>Not now</button>
                  <button className="primary" disabled={busy} onClick={() => void buy(buying)}>Yes, get it! 🎉</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ margin: 0 }}>You need <strong>{buying.price - kid.balance} {icon}</strong> more. Keep going!</p>
                <ProgressBar percent={(kid.balance / buying.price) * 100} color={kid.color} />
                <button onClick={() => setBuying(null)}>OK</button>
              </>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}

/** Parent home: rewards kids bought that are waiting to be handed over. */
export function ShopOrdersCard({ kids, onChange }: { kids: Kid[]; onChange: () => void }) {
  const { base, home, toast } = useApp();
  const [orders, reload] = useLoad<ShopOrder[]>(`${base}/shop/orders`);
  const waiting = orders?.filter((o) => o.status === 'waiting') ?? [];
  if (!waiting.length) return null;
  const icon = home?.pointsIcon ?? '✨';
  const act = async (o: ShopOrder, what: 'given' | 'refund') => {
    if (what === 'refund' && !confirm(`Give ${o.kidName} their ${o.price} ${icon} back for ${o.title}?`)) return;
    try { await api(`${base}/shop/orders/${o.id}/${what}`, { body: {} }); } catch (e) { toast((e as Error).message); }
    await reload();
    onChange();
  };
  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>🛍️ Rewards to hand over <span className="pill warn">{waiting.length}</span></h2>
      {waiting.map((o) => (
        <div key={o.id} className="list-item">
          <RaccoonAvatar variant={kids.find((k) => k.id === o.memberId)?.avatar} size={44} />
          <span className="review-icon" aria-hidden>{o.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{o.title}</div>
            <div className="small muted">{o.kidName} bought it · {o.price} {icon}</div>
          </div>
          <button className="ghost danger" onClick={() => void act(o, 'refund')}>Refund</button>
          <button className="primary" onClick={() => void act(o, 'given')}>Handed over</button>
        </div>
      ))}
    </section>
  );
}

/** Rewards page: stock the shop. */
export function ShopManager() {
  const { base, home, toast } = useApp();
  const [items, reload] = useLoad<ShopItem[]>(`${base}/shop`);
  const [orders] = useLoad<ShopOrder[]>(`${base}/shop/orders`);
  const blank = { title: '', icon: '🎁', price: 20, stock: '' };
  const [d, setD] = useState(blank);
  const icon = home?.pointsIcon ?? '✨';
  const save = async (it: ShopItem, patch: Partial<{ price: number; stock: number | string | null }>) => {
    try { await api(`${base}/shop/${it.id}`, { method: 'PATCH', body: patch }); } catch (e) { toast((e as Error).message); }
    await reload();
  };
  const recent = orders?.filter((o) => o.status !== 'waiting').slice(0, 8) ?? [];
  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>🛍️ Rewards shop</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Rewards kids can buy with their {home?.pointsName ?? 'points'} on their own board. The points come off when they buy, and the reward shows up on Home for you to hand over (or refund).
      </p>
      {items?.map((it) => (
        <div key={it.id} className="row">
          <span style={{ fontSize: '1.6rem' }} aria-hidden>{it.icon}</span>
          <strong style={{ flex: 1, minWidth: 140 }}>{it.title}</strong>
          <label className="row small" style={{ gap: 4 }}>
            <input type="number" min={1} defaultValue={it.price} style={{ width: 80 }} aria-label={`Price of ${it.title}`}
              onBlur={(e) => { const v = Math.round(Number(e.target.value)); if (v >= 1 && v !== it.price) void save(it, { price: v }); }} /> {icon}
          </label>
          <input type="number" min={0} placeholder="∞" defaultValue={it.stock ?? ''} style={{ width: 70 }} aria-label={`How many of ${it.title} (blank for unlimited)`}
            title="How many are left (blank for unlimited)"
            onBlur={(e) => { const v = e.target.value === '' ? null : Math.round(Number(e.target.value)); if (v !== it.stock) void save(it, { stock: v }); }} />
          <button className="ghost danger" aria-label={`Remove ${it.title}`}
            onClick={async () => { if (confirm(`Take ${it.title} out of the shop?`)) { await api(`${base}/shop/${it.id}`, { method: 'DELETE' }); await reload(); } }}>✕</button>
        </div>
      ))}
      {items && !items.length && <p className="muted" style={{ margin: 0 }}>The shop is empty. Add a few rewards, from small treats to big ones worth saving up for.</p>}
      <form className="row" onSubmit={async (e) => {
        e.preventDefault();
        try { await api(`${base}/shop`, { body: { ...d, stock: d.stock === '' ? null : Number(d.stock) } }); setD(blank); await reload(); } catch (err) { toast((err as Error).message); }
      }}>
        <select value={d.icon} onChange={(e) => setD({ ...d, icon: e.target.value })} style={{ width: 80 }} aria-label="Icon">
          {SHOP_ICONS.map((i) => <option key={i}>{i}</option>)}
        </select>
        <input placeholder="e.g. Stay up 30 minutes late" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} style={{ flex: 1, minWidth: 180 }} />
        <input type="number" min={1} value={d.price} onChange={(e) => setD({ ...d, price: Math.max(1, Math.round(Number(e.target.value))) })} style={{ width: 90 }} aria-label="Price" />
        <input type="number" min={0} placeholder="∞ left" value={d.stock} onChange={(e) => setD({ ...d, stock: e.target.value })} style={{ width: 90 }} aria-label="How many (blank for unlimited)" />
        <button disabled={!d.title.trim()}>Add</button>
      </form>
      {recent.length > 0 && (
        <details>
          <summary className="small">Recently bought</summary>
          <div className="list">
            {recent.map((o) => (
              <div key={o.id} className="row small" style={{ padding: '4px 0' }}>
                <span>{o.icon}</span><span style={{ flex: 1 }}>{o.kidName}: {o.title}</span>
                <span className={`pill${o.status === 'given' ? ' ok' : ''}`}>{o.status === 'given' ? 'Handed over' : 'Refunded'}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
