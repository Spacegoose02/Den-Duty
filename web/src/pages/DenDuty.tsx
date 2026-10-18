import { useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from '../components/Raccoon.tsx';
import { HoneyDo } from './HoneyDo.tsx';
import { ROOM_TEMPLATES } from '../../../shared/catalog.ts';

export interface DenCard {
  id: string; title: string; icon: string | null; kidId: string | null; status: 'todo' | 'doing' | 'done';
  points: number; repeatDaily: boolean; checked: boolean;
}

const COLS = [
  { id: 'todo', title: 'To do' },
  { id: 'doing', title: 'Doing' },
  { id: 'done', title: 'Done' },
] as const;
const NEXT = { todo: 'doing', doing: 'done', done: null } as const;
const PREV = { todo: null, doing: 'todo', done: 'doing' } as const;

/** One kid's room board, as a parent: add cards (from templates or your own), move them, and check finished ones. */
function RoomBoard({ kidId }: { kidId: string }) {
  const { base, home, toast } = useApp();
  const [cards, reload] = useLoad<DenCard[]>(`${base}/den?kid=${kidId}`, [kidId]);
  const [draft, setDraft] = useState({ title: '', icon: '🧹', points: 1, repeatDaily: true });
  const icon = home?.pointsIcon ?? '✨';
  const have = new Set(cards?.map((c) => c.title.toLowerCase()));
  const run = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); if (msg) toast(msg); await reload(); } catch (e) { toast((e as Error).message); } };
  const add = (title: string, cardIcon: string, pts = draft.points, repeatDaily = draft.repeatDaily) =>
    run(() => api(`${base}/den`, { body: { kidId, title, icon: cardIcon, points: pts, repeatDaily } }));

  return (
    <div className="stack">
      <div className="card stack">
        <strong>Add room chores</strong>
        <div className="chips">
          {ROOM_TEMPLATES.filter((t) => !have.has(t.title.toLowerCase())).map((t) => (
            <button key={t.title} className="chip" onClick={() => void add(t.title, t.icon)}>{t.icon} {t.title}</button>
          ))}
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void add(draft.title, draft.icon).then(() => setDraft({ ...draft, title: '' })); }}>
          <input value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} style={{ width: 64, textAlign: 'center' }} aria-label="Icon" />
          <input placeholder="Or your own, e.g. Feed the fish" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
          <label className="small row" style={{ gap: 4 }}>{icon}<input type="number" min={0} value={draft.points} onChange={(e) => setDraft({ ...draft, points: Math.max(0, Math.round(Number(e.target.value) || 0)) })} style={{ width: 80 }} aria-label="Points" /></label>
          <label className="small row" style={{ gap: 4 }}><input type="checkbox" checked={draft.repeatDaily} onChange={(e) => setDraft({ ...draft, repeatDaily: e.target.checked })} style={{ width: 20, minHeight: 20 }} /> Every day</label>
          <button disabled={!draft.title.trim()}>Add</button>
        </form>
        <p className="small muted" style={{ margin: 0 }}>Templates use the points and “every day” setting above. Daily cards go back to “To do” each morning. Points are paid when you check a finished card.</p>
      </div>
      <div className="kanban honeydo">
        {COLS.map((col) => {
          const list = cards?.filter((c) => c.status === col.id) ?? [];
          return (
            <div key={col.id} className="kanban-col">
              <div className="kanban-head">{col.title} <span className="pill">{list.length}</span></div>
              {list.map((c) => (
                <div key={c.id} className={`kanban-card honey${c.status === 'done' ? ' approved' : ''}`}>
                  <span className="kanban-icon" aria-hidden>{c.icon ?? '🧹'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="kanban-title">{c.title}</div>
                    <div className="small muted">{c.points ? `+${c.points} ${icon}` : 'no points'}{c.repeatDaily ? ' · daily' : ''}{c.checked ? ' · ✅ checked' : ''}</div>
                  </div>
                  <div className="kanban-actions" style={{ flexDirection: 'row' }}>
                    {PREV[c.status] && <button aria-label="Move back" onClick={() => void run(() => api(`${base}/den/${c.id}`, { method: 'PATCH', body: { status: PREV[c.status] } }))}>◀</button>}
                    {NEXT[c.status] && <button aria-label="Move forward" onClick={() => void run(() => api(`${base}/den/${c.id}`, { method: 'PATCH', body: { status: NEXT[c.status] } }))}>▶</button>}
                    {c.status === 'done' && !c.checked && (
                      <button className="primary" onClick={() => void run(async () => {
                        const r = await api<{ awarded: number }>(`${base}/den/${c.id}/check`, { body: {} });
                        if (r.awarded) toast(`+${r.awarded} ${icon}`);
                      })}>✓ Looks good</button>
                    )}
                    <button className="ghost danger" aria-label="Delete" onClick={() => { if (confirm(`Remove “${c.title}”?`)) void run(() => api(`${base}/den/${c.id}`, { method: 'DELETE' })); }}>✕</button>
                  </div>
                </div>
              ))}
              {!list.length && <p className="small muted" style={{ margin: 0 }}>Nothing here.</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Den Duty: each kid's room board (kids see theirs on the tablet), plus the parents' own to-do list. */
export function DenDuty() {
  const { home } = useApp();
  const [tab, setTab] = useState<string | null>(null);
  const kids = home?.kids ?? [];
  const current = tab ?? kids[0]?.id ?? 'parents';
  return (
    <div className="stack">
      <div className="topbar"><h1>🦝 Den Duty</h1></div>
      <p className="small muted" style={{ margin: 0 }}>A raccoon's den is their room. Give each kid a room board they can see and move on the family tablet.</p>
      <div className="chips">
        {kids.map((k) => (
          <button key={k.id} className={`chip${current === k.id ? ' on' : ''}`} onClick={() => setTab(k.id)}>
            <RaccoonAvatar variant={k.avatar} size={26} /> {k.name}'s den
          </button>
        ))}
        <button className={`chip${current === 'parents' ? ' on' : ''}`} onClick={() => setTab('parents')}>📝 Parents' list</button>
      </div>
      {current === 'parents' ? <HoneyDo embedded /> : <RoomBoard key={current} kidId={current} />}
    </div>
  );
}
