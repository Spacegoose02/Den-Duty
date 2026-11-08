// Shared family lists: the parents' Lists page, a card on the family wall, and the kid-board card.
// Everyone ticks things off; kids and the wall add to the lists that allow it. On a list linked to Nighttime Ninja,
// what kids pick is an ask: a grown-up says yes there (onto the shopping list they choose) or no, and it shows here.
import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { useT } from '../i18n.tsx';

export interface ListItem {
  id: string; text: string; note: string | null; done: boolean; by: string | null; byMemberId: string | null;
  request: { status: 'sending' | 'waiting' | 'approved' | 'declined'; list: string | null } | null;
}
export interface FamilyList { id: string; name: string; icon: string; kidsCanAdd: boolean; onWall: boolean; ninjaRequests: boolean; items: ListItem[] }

const asking = (i: ListItem) => i.request?.status === 'sending' || i.request?.status === 'waiting';

/** Tap-to-ask tiles: the home's usual groceries (from Nighttime Ninja), not already on the list. */
function Picks({ list, onPick }: { list: FamilyList; onPick: (name: string) => void }) {
  const { base } = useApp();
  const [picks] = useLoad<{ name: string; icon: string }[]>(`${base}/lists/${list.id}/picks`);
  const t = useT();
  const open = new Set(list.items.filter((i) => !i.done).map((i) => i.text.toLowerCase()));
  const left = picks?.filter((p) => !open.has(p.name.toLowerCase())) ?? [];
  if (!left.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <p className="small muted" style={{ margin: 0 }}>{t('Tap what you want. A grown-up says yes or no.')}</p>
      <div className="grocery-picks">
        {left.map((p) => (
          <button key={p.name} className="grocery-pick" onClick={() => onPick(p.name)}>
            <span aria-hidden="true">{p.icon}</span>{p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Where an ask stands, in kid words. */
function RequestTag({ item }: { item: ListItem }) {
  const t = useT();
  const r = item.request;
  if (!r) return null;
  if (r.status === 'approved') return <span className="pill ok">{r.list ? t('Yes! On {list} ✅', { list: r.list }) : t('Yes! ✅')}</span>;
  if (r.status === 'declined') return <span className="pill">{t('Not this time')}</span>;
  return <span className="pill warn">{t('Asked ⏳')}</span>;
}

const TEMPLATES = [
  { name: 'Groceries', icon: '🛒', kidsCanAdd: true },
  { name: 'To-do', icon: '✅', kidsCanAdd: false },
  { name: 'Packing', icon: '🧳', kidsCanAdd: true },
  { name: 'Wish list', icon: '🎁', kidsCanAdd: true },
];

/** One list: add box, items to tick, and (for parents) remove and clear. */
export function ListCard({ list, mode, memberId, onChange, compact }: {
  list: FamilyList; mode: 'parent' | 'kid' | 'wall'; memberId?: string; onChange: (l?: FamilyList) => void; compact?: boolean;
}) {
  const { base, toast } = useApp();
  const t = useT();
  const [text, setText] = useState('');
  const [showDone, setShowDone] = useState(false);
  const canAdd = mode === 'parent' || list.kidsCanAdd;
  // Kids' adds on a request list are asks for a grown-up in Nighttime Ninja.
  const asks = list.ninjaRequests && mode !== 'parent';
  const open = list.items.filter((i) => !i.done);
  const done = list.items.filter((i) => i.done);
  // Kids see the latest answers without opening the ticked-off ones.
  const answers = asks ? done.filter((i) => i.request && !asking(i)).slice(0, compact ? 0 : 5) : [];
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); onChange(); } catch (e) { toast((e as Error).message); } };
  const put = (item: string) => run(async () => {
    const r = await api<{ duplicate: boolean; request?: boolean }>(`${base}/lists/${list.id}/items`, { body: { text: item } });
    if (r.duplicate) toast(asks ? t('{item} is already asked for', { item }) : `${item} is already on the list`);
    else if (r.request) toast(t('Asked a grown-up for {item}', { item }));
  });
  const add = (e: FormEvent) => {
    e.preventDefault();
    const item = text.trim();
    if (!item) return;
    setText('');
    void put(item);
  };
  const tick = (i: ListItem) => run(() => api(`${base}/list-items/${i.id}`, { method: 'PATCH', body: { done: !i.done } }));
  const remove = (i: ListItem) => run(() => api(`${base}/list-items/${i.id}`, { method: 'DELETE' }));
  const canRemove = (i: ListItem) => mode === 'parent' || (mode === 'kid' && i.byMemberId === memberId);
  // A kid can't tick off their own ask: that's the grown-up's yes or no.
  // Answered asks stay as they are for kids: the answer is the grown-up's, not something to un-tick.
  const canTick = (i: ListItem) => mode === 'parent' || !i.request;
  const row = (i: ListItem) => (
    <li key={i.id} className={`list-item${i.done ? ' done' : ''}${i.request ? ' asked' : ''}`}>
      {canTick(i)
        ? <button className="list-tick" aria-label={i.done ? `Put back ${i.text}` : `Tick off ${i.text}`} onClick={() => void tick(i)}>{i.done ? '✓' : ''}</button>
        : <span className={`list-tick${asking(i) ? ' waiting' : i.request?.status === 'declined' ? ' declined' : ''}`} aria-hidden="true">
          {asking(i) ? '⏳' : i.request?.status === 'declined' ? '✕' : '✓'}
        </span>}
      <span style={{ flex: 1 }}>{i.text}{i.note && <span className="small muted"> · {i.note}</span>}</span>
      <RequestTag item={i} />
      {!compact && i.by && <span className="small muted">{i.by}</span>}
      {canRemove(i) && <button className="ghost small" aria-label={`Remove ${i.text}`} onClick={() => void remove(i)}>✕</button>}
    </li>
  );
  return (
    <div className="stack list-card">
      {canAdd && (
        <form className="row" onSubmit={add} style={{ flexWrap: 'nowrap' }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === 'parent' ? 'Add something' : t('We need…')} maxLength={120} aria-label={`Add to ${list.name}`} style={{ flex: 1 }} />
          <button className="primary" disabled={!text.trim()}>{t('Add')}</button>
        </form>
      )}
      {asks && canAdd && !compact && <Picks list={list} onPick={(name) => void put(name)} />}
      {!open.length && <p className="small muted" style={{ margin: 0 }}>{t('Nothing on the list.')}</p>}
      <ul className="list-items">{open.map(row)}</ul>
      {answers.length > 0 && <ul className="list-items">{answers.map(row)}</ul>}
      {done.length > answers.length && !compact && (
        <div className="row">
          <button className="ghost small" onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide' : 'Show'} {done.length - answers.length} ticked off</button>
          {mode === 'parent' && <button className="ghost small" onClick={() => void run(() => api(`${base}/lists/${list.id}/clear-done`, { body: {} }))}>Clear ticked</button>}
        </div>
      )}
      {showDone && !compact && <ul className="list-items">{done.filter((i) => !answers.includes(i)).map(row)}</ul>}
    </div>
  );
}

/** Parents: every list, plus making and setting up lists. */
export function ListsPage() {
  const { base, toast } = useApp();
  const [lists, reload] = useLoad<FamilyList[]>(`${base}/lists`);
  const [ninja] = useLoad<{ linked: boolean }>(`${base}/ninja`);
  const [editing, setEditing] = useState<FamilyList | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📝');
  if (!lists) return null;
  const make = async (body: object) => { try { await api(`${base}/lists`, { body }); setName(''); await reload(); } catch (e) { toast((e as Error).message); } };
  const patch = async (l: FamilyList, body: object) => { try { await api(`${base}/lists/${l.id}`, { method: 'PATCH', body }); await reload(); } catch (e) { toast((e as Error).message); } };
  const missing = TEMPLATES.filter((t) => !lists.some((l) => l.name.toLowerCase() === t.name.toLowerCase()));
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>🛒 Lists</h1>
      <p className="muted" style={{ margin: 0 }}>Groceries, packing and to-dos for the whole family. Kids can add from their board and the family tablet, on the lists you allow.</p>
      <div className="lists-grid">
        {lists.map((l) => (
          <section key={l.id} className="card stack">
            <div className="row">
              <h2 style={{ margin: 0, flex: 1 }}>{l.icon} {l.name} <span className="pill">{l.items.filter((i) => !i.done).length}</span>{l.ninjaRequests && <span className="pill warn" title="Kids' picks go to Nighttime Ninja for a yes or no"> 🦝 Requests</span>}</h2>
              <button className="ghost small" onClick={() => setEditing(editing?.id === l.id ? null : l)} aria-label={`Set up ${l.name}`}>⚙️</button>
            </div>
            {editing?.id === l.id && (
              <div className="stack" style={{ gap: 6 }}>
                <label className="row check-row"><input type="checkbox" checked={l.kidsCanAdd} onChange={(e) => void patch(l, { kidsCanAdd: e.target.checked })} /> Kids and the tablet can add and tick off</label>
                <label className="row check-row"><input type="checkbox" checked={l.onWall} onChange={(e) => void patch(l, { onWall: e.target.checked })} /> Show on the family wall</label>
                <label className="row check-row">
                  <input type="checkbox" checked={l.ninjaRequests} disabled={!l.ninjaRequests && !ninja?.linked} onChange={(e) => void patch(l, { ninjaRequests: e.target.checked })} />
                  🦝 Kids' picks are requests: you say yes or no in Nighttime Ninja, and yes puts it on the shopping list you choose
                </label>
                {!ninja?.linked && !l.ninjaRequests && <p className="small muted" style={{ margin: 0 }}>Link Nighttime Ninja in <a href="/settings#ninja">Settings</a> to turn this on.</p>}
                <button className="ghost danger" onClick={async () => { if (!confirm(`Delete the ${l.name} list?`)) return; await api(`${base}/lists/${l.id}`, { method: 'DELETE' }); setEditing(null); await reload(); }}>Delete list</button>
              </div>
            )}
            <ListCard list={l} mode="parent" onChange={() => void reload()} />
          </section>
        ))}
      </div>
      <section className="card stack">
        <h2 style={{ margin: 0 }}>New list</h2>
        {missing.length > 0 && <div className="row">{missing.map((t) => <button key={t.name} onClick={() => void make(t)}>{t.icon} {t.name}</button>)}</div>}
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void make({ name: name.trim(), icon }); }}>
          <input value={icon} onChange={(e) => setIcon(e.target.value)} aria-label="Icon" style={{ width: 64, textAlign: 'center' }} maxLength={8} />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, like Camping trip" maxLength={60} style={{ flex: 1 }} />
          <button className="primary" disabled={!name.trim()}>Make list</button>
        </form>
      </section>
    </div>
  );
}

/** A kid's board: the lists kids can add to. */
export function KidLists({ memberId }: { memberId: string }) {
  const { base } = useApp();
  const [lists, reload] = useLoad<FamilyList[]>(`${base}/lists`);
  const mine = lists?.filter((l) => l.kidsCanAdd) ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const t = useT();
  if (!mine.length) return null;
  const cur = mine.find((l) => l.id === open) ?? mine[0];
  return (
    <section className="card stack pg-lists">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>{t('📝 Family lists')}</h2>
        {mine.length > 1 && <div className="seg" role="group" aria-label="Lists">{mine.map((l) => <button key={l.id} className={l.id === cur.id ? 'on' : ''} onClick={() => setOpen(l.id)}>{l.icon} {l.name}</button>)}</div>}
      </div>
      <ListCard list={cur} mode="kid" memberId={memberId} onChange={() => void reload()} />
    </section>
  );
}

/** The family wall: lists marked for the wall, tap to tick off or add. */
export function WallLists({ lists, onChange }: { lists: FamilyList[]; onChange: () => void }) {
  return (
    <>
      {lists.map((l) => (
        <div key={l.id} className="wall-day wall-list">
          <div className="wall-day-title">{l.icon} {l.name}</div>
          <ListCard list={l} mode="wall" onChange={onChange} compact />
        </div>
      ))}
    </>
  );
}
