// Shared family lists: the parents' Lists page, a card on the family wall, and the kid-board card.
// Everyone ticks things off; kids and the wall add to the lists that allow it.
import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';

export interface ListItem { id: string; text: string; note: string | null; done: boolean; by: string | null; byMemberId: string | null }
export interface FamilyList { id: string; name: string; icon: string; kidsCanAdd: boolean; onWall: boolean; items: ListItem[] }

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
  const [text, setText] = useState('');
  const [showDone, setShowDone] = useState(false);
  const canAdd = mode === 'parent' || list.kidsCanAdd;
  const open = list.items.filter((i) => !i.done);
  const done = list.items.filter((i) => i.done);
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); onChange(); } catch (e) { toast((e as Error).message); } };
  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    void run(async () => {
      const r = await api<{ duplicate: boolean }>(`${base}/lists/${list.id}/items`, { body: { text: t } });
      if (r.duplicate) toast(`${t} is already on the list`);
    });
  };
  const tick = (i: ListItem) => run(() => api(`${base}/list-items/${i.id}`, { method: 'PATCH', body: { done: !i.done } }));
  const remove = (i: ListItem) => run(() => api(`${base}/list-items/${i.id}`, { method: 'DELETE' }));
  const canRemove = (i: ListItem) => mode === 'parent' || (mode === 'kid' && i.byMemberId === memberId);
  const row = (i: ListItem) => (
    <li key={i.id} className={`list-item${i.done ? ' done' : ''}`}>
      <button className="list-tick" aria-label={i.done ? `Put back ${i.text}` : `Tick off ${i.text}`} onClick={() => void tick(i)}>{i.done ? '✓' : ''}</button>
      <span style={{ flex: 1 }}>{i.text}{i.note && <span className="small muted"> · {i.note}</span>}</span>
      {!compact && i.by && <span className="small muted">{i.by}</span>}
      {canRemove(i) && <button className="ghost small" aria-label={`Remove ${i.text}`} onClick={() => void remove(i)}>✕</button>}
    </li>
  );
  return (
    <div className="stack list-card">
      {canAdd && (
        <form className="row" onSubmit={add} style={{ flexWrap: 'nowrap' }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === 'kid' ? 'We need…' : 'Add something'} maxLength={120} aria-label={`Add to ${list.name}`} style={{ flex: 1 }} />
          <button className="primary" disabled={!text.trim()}>Add</button>
        </form>
      )}
      {!open.length && <p className="small muted" style={{ margin: 0 }}>Nothing on the list.</p>}
      <ul className="list-items">{open.map(row)}</ul>
      {done.length > 0 && !compact && (
        <div className="row">
          <button className="ghost small" onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide' : 'Show'} {done.length} ticked off</button>
          {mode === 'parent' && <button className="ghost small" onClick={() => void run(() => api(`${base}/lists/${list.id}/clear-done`, { body: {} }))}>Clear ticked</button>}
        </div>
      )}
      {showDone && !compact && <ul className="list-items">{done.map(row)}</ul>}
    </div>
  );
}

/** Parents: every list, plus making and setting up lists. */
export function ListsPage() {
  const { base, toast } = useApp();
  const [lists, reload] = useLoad<FamilyList[]>(`${base}/lists`);
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
              <h2 style={{ margin: 0, flex: 1 }}>{l.icon} {l.name} <span className="pill">{l.items.filter((i) => !i.done).length}</span></h2>
              <button className="ghost small" onClick={() => setEditing(editing?.id === l.id ? null : l)} aria-label={`Set up ${l.name}`}>⚙️</button>
            </div>
            {editing?.id === l.id && (
              <div className="stack" style={{ gap: 6 }}>
                <label className="row check-row"><input type="checkbox" checked={l.kidsCanAdd} onChange={(e) => void patch(l, { kidsCanAdd: e.target.checked })} /> Kids and the tablet can add and tick off</label>
                <label className="row check-row"><input type="checkbox" checked={l.onWall} onChange={(e) => void patch(l, { onWall: e.target.checked })} /> Show on the family wall</label>
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
  if (!mine.length) return null;
  const cur = mine.find((l) => l.id === open) ?? mine[0];
  return (
    <section className="card stack pg-lists">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>📝 Family lists</h2>
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
