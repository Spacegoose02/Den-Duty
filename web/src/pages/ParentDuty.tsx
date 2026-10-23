import { useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { shortDate } from '../components/Bits.tsx';

type Status = 'todo' | 'doing' | 'done';
interface Card {
  id: string; title: string; notes: string | null; assigneeId: string | null; status: Status; dueDate: string | null; position: number;
  doneAt: string | null; closedAt: string | null; closeNote: string | null;
}
type ClosedCard = Card & { closedBy: string | null };

const COLS: { id: Status; title: string }[] = [
  { id: 'todo', title: '📝 To do' },
  { id: 'doing', title: '🔨 Doing' },
  { id: 'done', title: '✅ Done' },
];
const NEXT: Record<Status, Status | null> = { todo: 'doing', doing: 'done', done: null };
const PREV: Record<Status, Status | null> = { todo: null, doing: 'todo', done: 'doing' };

function localToday(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** One board: the things to do for one kid, or the general list (kidId null). Drag cards on a computer, or use the arrows. */
function DutyBoard({ kidId, kidName }: { kidId: string | null; kidName?: string }) {
  const { base, home, toast } = useApp();
  const [cards, reload] = useLoad<Card[]>(`${base}/parent-duty?kid=${kidId ?? 'general'}`, [kidId]);
  const [draft, setDraft] = useState({ title: '', assigneeId: '', dueDate: '' });
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const parents = home?.parents ?? [];
  const today = localToday();

  const move = async (id: string, status: Status) => {
    try { await api(`${base}/parent-duty/${id}`, { method: 'PATCH', body: { status } }); await reload(); } catch (e) { toast((e as Error).message); }
  };
  // Closing a finished card files it away; closing one that isn't finished asks first, and it's filed as not done.
  const close = async (c: Card) => {
    const finished = c.status === 'done';
    const note = prompt(finished ? `Close “${c.title}” and move it to history? Add a note if you like.` : `Close “${c.title}” without finishing it? It moves to history. Add a note if you like (why it's not needed).`, '');
    if (note == null) return;
    try {
      await api(`${base}/parent-duty/${c.id}/close`, { body: { note: note.trim() || null, done: finished } });
      toast('Moved to history');
      await reload();
    } catch (e) { toast((e as Error).message); }
  };
  const closeAllDone = async (list: Card[]) => {
    if (!confirm(`Move ${list.length} finished card${list.length === 1 ? '' : 's'} to history?`)) return;
    try {
      for (const c of list) await api(`${base}/parent-duty/${c.id}/close`, { body: {} });
      toast('Moved to history');
    } catch (e) { toast((e as Error).message); }
    await reload();
  };

  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>{kidName ? `Things to help ${kidName} with: forms to sign, things to buy, projects, appointments to book. Due dates show on your calendar.` : 'Everything else: house projects, errands, your own goals.'}</p>
      <form className="row card" onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`${base}/parent-duty`, { body: { title: draft.title, kidId, assigneeId: draft.assigneeId || null, dueDate: draft.dueDate || null } });
          setDraft({ title: '', assigneeId: '', dueDate: '' });
          await reload();
        } catch (err) { toast((err as Error).message); }
      }}>
        <input placeholder="Add something, e.g. Fix the squeaky door" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={{ flex: 2, minWidth: 220 }} />
        <select value={draft.assigneeId} onChange={(e) => setDraft({ ...draft, assigneeId: e.target.value })} style={{ width: 'auto' }} aria-label="Who">
          <option value="">Anyone</option>
          {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} style={{ width: 'auto' }} aria-label="Due" />
        <button className="primary" disabled={!draft.title.trim()}>Add</button>
      </form>

      <div className="kanban honeydo">
        {COLS.map((col) => {
          const list = cards?.filter((c) => c.status === col.id) ?? [];
          return (
            <div key={col.id} className={`kanban-col${over === col.id ? ' drop' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(col.id); }}
              onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); if (dragging) void move(dragging, col.id); setDragging(null); }}>
              <div className="kanban-head"><span>{col.title} <span className="pill">{list.length}</span></span>
                {col.id === 'done' && list.length > 0 && <button className="ghost small" onClick={() => void closeAllDone(list)}>📦 Close all</button>}
              </div>
              {list.map((c) => {
                const who = parents.find((p) => p.id === c.assigneeId);
                const late = c.dueDate && c.status !== 'done' && c.dueDate < today;
                return (
                  <div key={c.id} className={`kanban-card honey ${c.status === 'done' ? 'approved' : ''}`} draggable
                    onDragStart={() => setDragging(c.id)} onDragEnd={() => setDragging(null)}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="kanban-title" style={c.status === 'done' ? { textDecoration: 'line-through', opacity: 0.7 } : undefined}>{c.title}</div>
                      <div className="small muted row" style={{ gap: 6 }}>
                        {who && <><RaccoonAvatar variant={who.avatar} size={20} /> {who.name}</>}
                        {c.dueDate && <span className={late ? 'pill bad' : 'pill'}>{late ? '⏰ ' : ''}{shortDate(c.dueDate)}</span>}
                      </div>
                    </div>
                    <div className="kanban-actions" style={{ flexDirection: 'row' }}>
                      {PREV[c.status] && <button onClick={() => void move(c.id, PREV[c.status]!)} aria-label="Move back">◀</button>}
                      {NEXT[c.status] && <button className="primary" onClick={() => void move(c.id, NEXT[c.status]!)} aria-label="Move forward">▶</button>}
                      <button className={c.status === 'done' ? 'primary' : 'ghost'} onClick={() => void close(c)} aria-label="Close and move to history" title="Close and move to history">📦</button>
                      <button className="ghost danger" aria-label="Delete" onClick={async () => {
                        if (!confirm(`Delete “${c.title}”?`)) return;
                        await api(`${base}/parent-duty/${c.id}`, { method: 'DELETE' });
                        await reload();
                      }}>✕</button>
                    </div>
                  </div>
                );
              })}
              {!list.length && <p className="small muted" style={{ margin: 0 }}>{col.id === 'done' ? 'Finished cards wait here until you close them (📦), or 30 days.' : 'Nothing here.'}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Closed cards for one board, newest first: search them, reopen one, or delete it for good. */
function DutyHistory({ kidId }: { kidId: string | null }) {
  const { base, toast } = useApp();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [cards, reload] = useLoad<ClosedCard[]>(`${base}/parent-duty/history?kid=${kidId ?? 'general'}${search ? `&q=${encodeURIComponent(search)}` : ''}`, [kidId, search]);
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast(msg); await reload(); } catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="stack">
      <form className="row" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
        <input placeholder="Search history" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 180 }} aria-label="Search history" />
        <button>Search</button>
        {search && <button type="button" className="ghost" onClick={() => { setQ(''); setSearch(''); }}>Clear</button>}
      </form>
      {cards && !cards.length && <p className="muted" style={{ margin: 0 }}>{search ? 'Nothing matches.' : 'Nothing closed yet. Close a card (📦) and it lands here.'}</p>}
      {cards?.map((c) => (
        <div key={c.id} className="card row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="kanban-title">{c.status === 'done' ? '✅' : '⏹️'} {c.title}</div>
            <div className="small muted">
              {c.status === 'done' ? 'Done' : 'Closed unfinished'} · {shortDate(c.closedAt!.slice(0, 10))}{c.closedBy ? ` by ${c.closedBy}` : ''}
              {c.dueDate ? ` · was due ${shortDate(c.dueDate)}` : ''}
            </div>
            {c.closeNote && <div className="small">“{c.closeNote}”</div>}
            {c.notes && <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</div>}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button onClick={() => void act(() => api(`${base}/parent-duty/${c.id}/reopen`, { body: {} }), 'Back on the board')}>↩ Reopen</button>
            <button className="ghost danger" aria-label="Delete for good" onClick={() => {
              if (confirm(`Delete “${c.title}” for good?`)) void act(() => api(`${base}/parent-duty/${c.id}`, { method: 'DELETE' }), 'Deleted');
            }}>✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Parent Duty: a board per kid of what you need to do for them, plus a general list. Parents only. */
export function ParentDuty() {
  const { home } = useApp();
  const [tab, setTab] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const kids = (home?.kids ?? []).filter((k) => !k.pagesOff.includes('parentduty'));
  const current = tab ?? kids[0]?.id ?? 'general';
  const kid = kids.find((k) => k.id === current);
  return (
    <div className="stack">
      <div className="topbar"><h1>📝 Parent Duty</h1><span className="pill">🔒 Parents only</span></div>
      <div className="chips">
        {kids.map((k) => (
          <button key={k.id} className={`chip${current === k.id ? ' on' : ''}`} onClick={() => setTab(k.id)}>
            <RaccoonAvatar variant={k.avatar} size={26} /> For {k.name}
          </button>
        ))}
        <button className={`chip${current === 'general' ? ' on' : ''}`} onClick={() => setTab('general')}>🏡 General</button>
      </div>
      <div className="chips">
        <button className={`chip${!showHistory ? ' on' : ''}`} onClick={() => setShowHistory(false)}>📋 Board</button>
        <button className={`chip${showHistory ? ' on' : ''}`} onClick={() => setShowHistory(true)}>📜 History</button>
      </div>
      {showHistory
        ? <DutyHistory key={current} kidId={kid ? kid.id : null} />
        : <DutyBoard key={current} kidId={kid ? kid.id : null} kidName={kid?.name} />}
    </div>
  );
}
