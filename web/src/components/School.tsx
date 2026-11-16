// School work: homework, tests and projects with due dates. The due list on a kid's board, the parent's editor, the
// "School this week" card on the parent home, and the lines on the calendar.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { Modal, ProgressBar, dayName, shortDate } from './Bits.tsx';
import { RaccoonAvatar } from './Raccoon.tsx';
import { confetti } from './Confetti.ts';
import { SpeakButton } from './Speak.tsx';
import { SCHOOL_KINDS, SUBJECTS, subjectIcon, type DueState, type SchoolKind } from '../../../shared/school.ts';

export interface SchoolItem {
  id: string; memberId: string; kind: SchoolKind; icon: string; title: string; subject: string | null; dueDate: string; notes: string | null;
  steps: { text: string; done: boolean }[]; studied: string[]; studiedToday: boolean; status: 'todo' | 'waiting' | 'done'; done: boolean;
  state: DueState | 'waiting'; daysLeft: number; points: number; paid: boolean; score: string | null; eventId: string | null; stepsDone: number;
  kid?: { name: string; avatar: string; color: string };
}
interface Suggestion { eventId: string; title: string; date: string; kind: SchoolKind; subject: string | null }

/** "Due today", "Tomorrow", "In 3 days (Fri)", "2 days late". */
export function dueText(s: SchoolItem): string {
  if (s.kind === 'test' && s.done) return s.score ? `Score: ${s.score}` : `Was ${dayName(s.dueDate)} ${shortDate(s.dueDate)}`;
  if (s.status === 'done') return 'Done ✅';
  if (s.state === 'waiting') return 'Waiting for a grown-up';
  const when = s.kind === 'test' ? '' : 'Due ';
  if (s.daysLeft < 0) return `${-s.daysLeft} day${s.daysLeft === -1 ? '' : 's'} late`;
  if (s.daysLeft === 0) return s.kind === 'test' ? 'Test today!' : 'Due today';
  if (s.daysLeft === 1) return `${when}tomorrow`.replace(/^t/, 'T');
  return `${when}${s.daysLeft <= 7 ? dayName(s.dueDate) : shortDate(s.dueDate)} · in ${s.daysLeft} days`;
}

export function KidSchool({ memberId, kidName, color, asParent, readAloud }: { memberId: string; kidName: string; color: string; asParent: boolean; readAloud: boolean }) {
  const { base, toast, home } = useApp();
  const [data, reload] = useLoad<{ items: SchoolItem[]; suggestions: Suggestion[] }>(`${base}/kids/${memberId}/school`, [memberId]);
  const [editing, setEditing] = useState<SchoolItem | Partial<SchoolItem> | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data || (!data.items.length && !asParent)) return null;
  const icon = home?.pointsIcon ?? '✨';
  const open = data.items.filter((s) => !s.done && s.status !== 'done');
  const soon = open.filter((s) => s.daysLeft <= 2 || s.status === 'waiting');
  const later = open.filter((s) => !soon.includes(s));
  const finished = data.items.filter((s) => s.done || s.status === 'done');
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); await reload(); } catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  };
  const post = (path: string, body: object = {}) => api(`${base}${path}`, { body });
  const done = (s: SchoolItem) => act(s.id, async () => {
    const r = await post(`/school/${s.id}/done`) as { item: SchoolItem; paid: number };
    confetti({ colors: [color], count: 120 });
    toast(r.item.status === 'waiting' ? `${s.title}: sent to a grown-up!` : `${s.title}: done!${r.paid ? ` +${r.paid} ${icon}` : ''}`);
  });

  const row = (s: SchoolItem) => {
    const studiedToday = s.studiedToday;
    return (
      <div key={s.id} className={`school-row ${s.state}`}>
        <span className="kanban-icon" aria-hidden>{s.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="kanban-title">
            {s.title} {readAloud && !asParent && <SpeakButton text={`${s.title}. ${dueText(s)}.`} />}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <span className={`due-chip ${s.state}`}>{dueText(s)}</span>
            {s.subject && <span className="small muted">{subjectIcon(s.subject)} {s.subject}</span>}
            {s.points > 0 && <span className="small muted">+{s.points} {icon}</span>}
            {s.kind === 'test' && s.studied.length > 0 && <span className="small muted">📖 studied {s.studied.length} day{s.studied.length === 1 ? '' : 's'}</span>}
          </div>
          {s.notes && <div className="small muted">{s.notes}</div>}
          {s.steps.length > 0 && (
            <div className="stack" style={{ gap: 4, marginTop: 6 }}>
              <ProgressBar percent={(s.stepsDone / s.steps.length) * 100} color={color} />
              {s.steps.map((st, n) => (
                <label key={n} className={`school-step${st.done ? ' done' : ''}`}>
                  <input type="checkbox" checked={st.done} disabled={busy === s.id || s.status === 'done'} onChange={(e) => void act(s.id, () => post(`/school/${s.id}/steps/${n}`, { done: e.target.checked }))} />
                  {st.text}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="school-actions">
          {asParent && <button className="ghost" onClick={() => setEditing(s)} aria-label={`Edit ${s.title}`}>✏️</button>}
          {s.kind === 'test' && !s.done && (
            <button className={studiedToday ? 'on-study' : ''} disabled={busy === s.id} onClick={() => void act(s.id, async () => {
              await post(`/school/${s.id}/studied`, { studied: !studiedToday });
              if (!studiedToday) { confetti({ colors: [color], count: 60 }); toast('Studying counts! 📖'); }
            })}>{studiedToday ? '📖 Studied today ✓' : '📖 I studied'}</button>
          )}
          {s.kind !== 'test' && s.status === 'todo' && <button className="primary" disabled={busy === s.id} onClick={() => void done(s)}>{asParent ? '✓ Done' : '🙌 Turned in!'}</button>}
          {s.status === 'waiting' && (asParent
            ? <button className="primary" disabled={busy === s.id} onClick={() => void act(s.id, () => post(`/school/${s.id}/approve`))}>Approve</button>
            : <button disabled={busy === s.id} onClick={() => void act(s.id, () => post(`/school/${s.id}/undo`))}>Not yet</button>)}
          {asParent && s.status === 'done' && s.kind !== 'test' && <button className="ghost" disabled={busy === s.id} onClick={() => void act(s.id, () => post(`/school/${s.id}/undo`))}>Undo</button>}
        </div>
      </div>
    );
  };

  return (
    <section className="card stack pg-school school-card">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>🎒 {asParent ? 'School work' : 'My school work'}</h2>
        {asParent && <button onClick={() => setEditing({ kind: 'homework' })}>＋ School work</button>}
      </div>
      {asParent && data.suggestions.length > 0 && (
        <div className="school-suggest">
          <span className="small muted">On the calendar. Track it here?</span>
          {data.suggestions.map((g) => (
            <button key={g.eventId} className="chip" disabled={busy === g.eventId} onClick={() => void act(g.eventId, async () => {
              await post(`/kids/${memberId}/school`, { eventId: g.eventId });
              toast(`${g.title} added as ${SCHOOL_KINDS.find((k) => k.id === g.kind)?.label.toLowerCase()}`);
            })}>
              {SCHOOL_KINDS.find((k) => k.id === g.kind)?.icon} {g.title} · {dayName(g.date)} {shortDate(g.date)} ＋
            </button>
          ))}
        </div>
      )}
      {!data.items.length && <p className="small muted" style={{ margin: 0 }}>Homework, tests and projects with due dates. {kidName} sees a due list here and on their calendar, and ticks things off when they're turned in.</p>}
      {soon.length > 0 && <><div className="school-group">⏰ {asParent ? 'Coming up fast' : 'Do these first'}</div>{soon.map(row)}</>}
      {later.length > 0 && <><div className="school-group">📅 Later</div>{later.map(row)}</>}
      {!open.length && data.items.length > 0 && <p className="small muted" style={{ margin: 0 }}>{asParent ? 'Nothing due right now.' : 'All caught up! 🎉'}</p>}
      {finished.length > 0 && (
        <>
          <button className="ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowDone(!showDone)}>{showDone ? '▾' : '▸'} Done lately ({finished.length})</button>
          {showDone && finished.map(row)}
        </>
      )}
      {editing && <SchoolForm memberId={memberId} item={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void reload(); }} />}
    </section>
  );
}

export function SchoolForm({ memberId, item, kids, onClose, onDone }: {
  memberId?: string; item: SchoolItem | Partial<SchoolItem>; kids?: { id: string; name: string }[]; onClose: () => void; onDone: () => void;
}) {
  const { base, toast, home } = useApp();
  const existing = 'id' in item && item.id ? item as SchoolItem : null;
  const [kid, setKid] = useState(memberId ?? existing?.memberId ?? kids?.[0]?.id ?? '');
  const [d, setD] = useState({
    kind: (item.kind ?? 'homework') as SchoolKind, title: item.title ?? '', subject: item.subject ?? '', dueDate: item.dueDate ?? '',
    points: item.points ?? 0, notes: item.notes ?? '', steps: (item.steps ?? []).map((s) => s.text).join('\n'), score: item.score ?? '',
  });
  const save = async () => {
    try {
      const old = existing?.steps ?? [];
      const steps = d.steps.split('\n').map((s) => s.trim()).filter(Boolean).map((text) => ({ text, done: old.find((o) => o.text === text)?.done ?? false }));
      const body = { kind: d.kind, title: d.title, subject: d.subject || null, dueDate: d.dueDate, points: Number(d.points) || 0, notes: d.notes || null, steps, score: d.score || null };
      if (existing) await api(`${base}/school/${existing.id}`, { method: 'PATCH', body });
      else await api(`${base}/kids/${kid}/school`, { body });
      onDone();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2 style={{ margin: 0 }}>{existing ? 'Edit school work' : 'New school work'}</h2>
        {kids && !existing && kids.length > 1 && (
          <div className="row" style={{ gap: 6 }}>
            {kids.map((k) => <button key={k.id} type="button" className={`chip${kid === k.id ? ' on' : ''}`} onClick={() => setKid(k.id)}>{k.name}</button>)}
          </div>
        )}
        <div className="help-picks school-kinds">
          {SCHOOL_KINDS.map((k) => (
            <button key={k.id} type="button" className={`help-pick${d.kind === k.id ? ' on' : ''}`} onClick={() => setD({ ...d, kind: k.id })}>
              <span className="help-pick-icon">{k.icon}</span>{k.label}
            </button>
          ))}
        </div>
        <input aria-label="Name" placeholder={d.kind === 'test' ? 'Math test: multiplication' : d.kind === 'project' ? 'Volcano model' : 'Reading log'} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} autoFocus />
        <div className="row" style={{ gap: 6 }}>
          {SUBJECTS.map((s) => <button key={s.id} type="button" className={`chip${d.subject === s.id ? ' on' : ''}`} onClick={() => setD({ ...d, subject: d.subject === s.id ? '' : s.id })}>{s.icon} {s.id}</button>)}
        </div>
        <label className="row">{d.kind === 'test' ? 'Test day' : 'Due'} <input type="date" value={d.dueDate} onChange={(e) => setD({ ...d, dueDate: e.target.value })} style={{ maxWidth: 200 }} /></label>
        {d.kind !== 'test' && <label className="row">{home?.pointsName ?? 'Points'} when it's turned in <input type="number" min={0} max={1000} value={d.points} onChange={(e) => setD({ ...d, points: Number(e.target.value) })} style={{ width: 90 }} /></label>}
        {d.kind !== 'test' && d.points > 0 && <p className="small muted" style={{ margin: 0 }}>With points, a kid's “Turned in!” waits for you to approve it, like a chore.</p>}
        {d.kind === 'project' && (
          <label className="field">Steps (one per line)
            <textarea rows={4} placeholder={'Pick a topic\nGather supplies\nBuild it\nPractice presenting'} value={d.steps} onChange={(e) => setD({ ...d, steps: e.target.value })} />
          </label>
        )}
        <label className="field">Notes
          <textarea rows={2} placeholder={d.kind === 'test' ? 'Chapters 4 and 5, study guide in the blue folder' : 'Pages 12 to 14'} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
        </label>
        {existing && d.kind === 'test' && <label className="row">Score <input placeholder="92% or 18/20" value={d.score} onChange={(e) => setD({ ...d, score: e.target.value })} style={{ maxWidth: 160 }} /></label>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {existing && <button type="button" className="ghost danger" onClick={() => confirm(`Remove ${existing.title}?`) && void api(`${base}/school/${existing.id}`, { method: 'DELETE' }).then(onDone)}>Remove</button>}
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!d.title.trim() || !d.dueDate || !kid}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

/** Parent home: school work overdue, due this week, or waiting for a check, for every kid. */
export function SchoolCard() {
  const { base, toast, home } = useApp();
  const [items, reload] = useLoad<SchoolItem[]>(`${base}/school`);
  const [adding, setAdding] = useState(false);
  const kids = (home?.kids ?? []).filter((k) => !k.pagesOff.includes('school'));
  if (!items || !kids.length) return null;
  const approve = async (s: SchoolItem) => {
    try {
      const r = await api<{ paid: number }>(`${base}/school/${s.id}/approve`, { body: {} });
      toast(`${s.title}: approved${r.paid ? `, +${r.paid} ${home?.pointsIcon ?? ''}` : ''}`);
      await reload();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <section className={`card stack${items.some((s) => s.status === 'waiting') ? ' review-card has-items' : ''}`}>
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>🎒 School this week {items.length > 0 && <span className="pill">{items.length}</span>}</h2>
        <button onClick={() => setAdding(true)}>＋ School work</button>
      </div>
      {!items.length && <p className="small muted" style={{ margin: 0 }}>Nothing due in the next week. Add homework, tests and projects and they show on each kid's board and the calendar.</p>}
      {items.map((s) => (
        <div key={s.id} className="list-item">
          {s.kid && <RaccoonAvatar variant={s.kid.avatar} size={36} />}
          <span className="review-icon" aria-hidden>{s.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{s.title}</div>
            <div className="small muted">{s.kid?.name} · <span className={`due-chip ${s.state}`}>{dueText(s)}</span>{s.subject ? ` · ${s.subject}` : ''}{s.kind === 'test' && s.studied.length ? ` · studied ${s.studied.length}×` : ''}{s.steps.length ? ` · ${s.stepsDone}/${s.steps.length} steps` : ''}</div>
          </div>
          {s.status === 'waiting' ? <button className="primary" onClick={() => void approve(s)}>Approve</button> : <Link className="btn ghost" to={`/kids/${s.memberId}`}>Open</Link>}
        </div>
      ))}
      {adding && <SchoolForm item={{ kind: 'homework' }} kids={kids} onClose={() => setAdding(false)} onDone={() => { setAdding(false); void reload(); }} />}
    </section>
  );
}

/** One school item on a calendar day. */
export function SchoolLine({ s, kidName, color, onEdit }: { s: SchoolItem; kidName?: string; color?: string; onEdit?: (s: SchoolItem) => void }) {
  const inner = (
    <>
      <span aria-hidden>{s.icon}</span>
      <span style={{ flex: 1 }}>{kidName ? `${kidName}: ` : ''}{s.title}{s.subject && <span className="small muted"> · {s.subject}</span>}
        {s.status === 'done' || (s.kind === 'test' && s.done) ? ' ✓' : s.status === 'waiting' ? ' ⏳' : ''}{s.score && <span className="small muted"> · {s.score}</span>}</span>
      {onEdit && <span aria-hidden className="small">✏️</span>}
    </>
  );
  const cls = `agenda-ext school-line ${s.state}`;
  return onEdit
    ? <button className={`${cls} as-button`} style={{ borderLeftColor: color }} onClick={() => onEdit(s)} title="Edit school work">{inner}</button>
    : <div className={cls} style={{ borderLeftColor: color }}>{inner}</div>;
}
