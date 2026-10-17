import { useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { shortDate } from '../components/Bits.tsx';

type Status = 'todo' | 'doing' | 'done';
interface Card { id: string; title: string; notes: string | null; assigneeId: string | null; status: Status; dueDate: string | null; position: number; doneAt: string | null }

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

/** The parents' own kanban: house projects, errands, goals. Drag cards on a computer, or use the arrows on a tablet. */
export function HoneyDo() {
  const { base, home, toast } = useApp();
  const [cards, reload] = useLoad<Card[]>(`${base}/honeydo`);
  const [draft, setDraft] = useState({ title: '', assigneeId: '', dueDate: '' });
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const parents = home?.parents ?? [];
  const today = localToday();

  const move = async (id: string, status: Status) => {
    try { await api(`${base}/honeydo/${id}`, { method: 'PATCH', body: { status } }); await reload(); } catch (e) { toast((e as Error).message); }
  };

  return (
    <div className="stack">
      <div className="topbar"><h1>Honey-do</h1><span className="pill">🔒 Parents only</span></div>
      <form className="row card" onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`${base}/honeydo`, { body: { title: draft.title, assigneeId: draft.assigneeId || null, dueDate: draft.dueDate || null } });
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
              <div className="kanban-head">{col.title} <span className="pill">{list.length}</span></div>
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
                      <button className="ghost danger" aria-label="Delete" onClick={async () => {
                        if (!confirm(`Delete “${c.title}”?`)) return;
                        await api(`${base}/honeydo/${c.id}`, { method: 'DELETE' });
                        await reload();
                      }}>✕</button>
                    </div>
                  </div>
                );
              })}
              {!list.length && <p className="small muted" style={{ margin: 0 }}>{col.id === 'done' ? 'Finished cards show here for 30 days.' : 'Nothing here.'}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
