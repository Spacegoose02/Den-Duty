// New words (Doctors → Speech): the words a kid is learning to say. Tap a word each time you hear it; milestones
// ("say it 10 times: 5 points") pay the kid. The list also goes on the visit summary and therapist share links.
import { useState } from 'react';
import { api, type Milestone, type SpeechWord, type WordsData } from '../../api.ts';
import { useApp, useLoad, usePoints } from '../../state.tsx';
import { Modal, ProgressBar, shortDate } from '../../components/Bits.tsx';
import { ColumnChart, LineChart } from '../../components/Charts.tsx';
import { confetti } from '../../components/Confetti.ts';

const DEFAULTS: Milestone[] = [{ times: 5, points: 2 }, { times: 10, points: 5 }, { times: 25, points: 10 }];
type Sort = 'new' | 'most' | 'az';
/** Monday-start week of a date. */
const weekOf = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export function milestoneText(ms: Milestone[], pts: (n: number, withName?: boolean) => string): string {
  return ms.length ? ms.map((m) => `${m.times}× → ${m.points ? pts(m.points, false) : 'no points'}`).join(' · ') : 'No milestones';
}

function MilestoneEditor({ value, onChange }: { value: Milestone[]; onChange: (v: Milestone[]) => void }) {
  const pts = usePoints();
  const set = (i: number, k: keyof Milestone, v: string) => onChange(value.map((m, j) => j === i ? { ...m, [k]: v === '' ? 0 : Math.max(0, Math.round(Number(v))) } : m));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {value.map((m, i) => (
        <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
          <span className="small">Said</span>
          <input type="number" min={1} max={1000} value={m.times || ''} onChange={(e) => set(i, 'times', e.target.value)} style={{ width: 90 }} aria-label="Times said" />
          <span className="small">times →</span>
          <input type="number" min={0} max={1000} value={m.points} onChange={(e) => set(i, 'points', e.target.value)} style={{ width: 90 }} aria-label="Points" />
          <span className="small">{pts(m.points).replace(/^\d+ /, '')}</span>
          <span className="spacer" />
          <button type="button" className="ghost danger" aria-label="Remove milestone" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      {value.length < 10 && (
        <button type="button" className="chip" style={{ alignSelf: 'flex-start' }}
          onClick={() => onChange([...value, { times: (value.reduce((a, m) => Math.max(a, m.times), 0) || 0) + 5, points: 5 }])}>＋ Add a milestone</button>
      )}
    </div>
  );
}

function MilestonesModal({ kidName, value, onSave, onClose }: { kidName: string; value: Milestone[]; onSave: (v: Milestone[] | null) => Promise<void>; onClose: () => void }) {
  const [ms, setMs] = useState(value);
  return (
    <Modal onClose={onClose}>
      <div className="stack">
        <h2 style={{ margin: 0 }}>🏁 Word milestones</h2>
        <p className="small muted" style={{ margin: 0 }}>Each word pays {kidName} when it's been said this many times. Words with their own milestones keep theirs. Changing these never takes back points already earned.</p>
        <MilestoneEditor value={ms} onChange={setMs} />
        <div className="row">
          <button type="button" className="ghost" onClick={() => void onSave(null)}>Back to defaults</button>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => void onSave(ms)}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

function EditWord({ word, kidDefault, today, onSave, onDelete, onClose }: {
  word: SpeechWord; kidDefault: Milestone[]; today: string;
  onSave: (b: Record<string, unknown>) => Promise<void>; onDelete: () => void; onClose: () => void;
}) {
  const [f, setF] = useState({ word: word.word, note: word.note ?? '', addedOn: word.addedOn, own: word.ownMilestones, milestones: word.ownMilestones ? word.milestones : kidDefault });
  return (
    <Modal onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void onSave({ word: f.word, note: f.note, addedOn: f.addedOn, milestones: f.own ? f.milestones : null }); }}>
        <h2 style={{ margin: 0 }}>✏️ {word.word}</h2>
        <label className="field">Word<input value={f.word} onChange={(e) => setF({ ...f, word: e.target.value })} maxLength={60} /></label>
        <label className="field">How it sounds, or a note (optional)<input value={f.note} placeholder='e.g. says "ba" for ball' onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} /></label>
        <label className="field">First heard<input type="date" max={today} value={f.addedOn} onChange={(e) => setF({ ...f, addedOn: e.target.value })} style={{ width: 180 }} /></label>
        <div className="small muted">Said {word.count} time{word.count === 1 ? '' : 's'}{word.lastSaid && `, last on ${shortDate(word.lastSaid)}`}.</div>
        <label className="row check-row"><input type="checkbox" checked={f.own} onChange={(e) => setF({ ...f, own: e.target.checked })} /> Give this word its own milestones (a harder word can pay more)</label>
        {f.own && <MilestoneEditor value={f.milestones} onChange={(m) => setF({ ...f, milestones: m })} />}
        <div className="row">
          <button type="button" className="ghost danger" onClick={onDelete}>Delete word</button>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!f.word.trim()}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

export function WordsTab({ kid, color }: { kid: { id: string; name: string }; color: string }) {
  const { base, toast } = useApp();
  const pts = usePoints();
  const url = `${base}/kids/${kid.id}/words`;
  const [data, reload] = useLoad<WordsData>(url, [url]);
  const [word, setWord] = useState('');
  const [saidNow, setSaidNow] = useState(true);
  const [sort, setSort] = useState<Sort>('new');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<SpeechWord | null>(null);
  const [editMs, setEditMs] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); if (msg) toast(msg); await reload(); } catch (e) { toast((e as Error).message); } };

  const add = () => run(async () => {
    const r = await api<SpeechWord & { awarded: number }>(url, { body: { word: word.trim(), saidNow } });
    setWord('');
    toast(r.awarded ? `“${r.word}” added · +${pts(r.awarded)} 🎉` : `“${r.word}” added`);
  });

  const say = async (w: SpeechWord, e: React.MouseEvent) => {
    if (busy) return;
    setBusy(w.id);
    try {
      const r = await api<{ count: number; awarded: number; milestone: Milestone | null }>(`${base}/words/${w.id}/say`, { method: 'POST' });
      if (r.milestone) {
        confetti({ origin: { x: e.clientX / innerWidth, y: e.clientY / innerHeight }, colors: [color, '#ffd43b'], count: 120 });
        toast(`🎉 “${w.word}” ${r.count} times!${r.awarded ? ` +${pts(r.awarded)} for ${kid.name}` : ''}`);
      }
      await reload();
    } catch (err) { toast((err as Error).message); } finally { setBusy(null); }
  };

  if (!data) return null;
  const words = data.words
    .filter((w) => !q.trim() || w.word.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => sort === 'az' ? a.word.localeCompare(b.word) : sort === 'most' ? b.count - a.count : b.addedOn.localeCompare(a.addedOn));

  // This month, and the charts: words on the list by week (last 13 weeks) and times heard each week.
  const monthStart = `${data.today.slice(0, 7)}-01`;
  const newThisMonth = data.words.filter((w) => w.addedOn >= monthStart).length;
  const weekStart = weekOf(data.today);
  const heardThisWeek = data.says.filter((d) => d.date >= weekStart).reduce((a, d) => a + d.count, 0);
  const weeks: string[] = [];
  for (let w = weekOf(plusDays(data.today, -7 * 12)); w <= data.today; w = plusDays(w, 7)) weeks.push(w);
  const onList = weeks.map((w) => data.words.filter((x) => x.addedOn <= plusDays(w, 6)).length);
  const heard = weeks.map((w) => data.says.filter((d) => weekOf(d.date) === w).reduce((a, d) => a + d.count, 0));

  return (
    <div className="stack">
      <section className="card stack">
        <h2 style={{ margin: 0 }}>🗣️ New words for {kid.name}</h2>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (word.trim()) void add(); }}>
          <input placeholder="A word they said, e.g. ball" value={word} onChange={(e) => setWord(e.target.value)} maxLength={60} style={{ flex: 1, minWidth: 180 }} aria-label="New word" />
          <button className="primary" disabled={!word.trim()}>＋ Add word</button>
        </form>
        <label className="row check-row small"><input type="checkbox" checked={saidNow} onChange={(e) => setSaidNow(e.target.checked)} /> Count this as the first time they said it</label>
        <div className="row small">
          <span className="muted">🏁 {milestoneText(data.milestones, pts)}{!data.custom && ' (defaults)'}</span>
          <button className="ghost" onClick={() => setEditMs(true)}>Change</button>
        </div>
      </section>

      {data.words.length > 0 && (
        <div className="chips">
          <span className="pill">📚 {data.words.length} word{data.words.length === 1 ? '' : 's'}</span>
          <span className="pill">🌱 {newThisMonth} new this month</span>
          <span className="pill">👂 heard {heardThisWeek}× this week</span>
          <span className="pill ok">⭐ {data.words.filter((w) => w.mastered).length} reached every milestone</span>
        </div>
      )}

      <section className="card stack">
        <div className="row">
          <h3 style={{ margin: 0, flex: 1 }}>Tap a word each time you hear it</h3>
          {data.words.length > 8 && <input placeholder="Find a word" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 160 }} aria-label="Find a word" />}
          <div className="seg">
            {([['new', 'Newest'], ['most', 'Most said'], ['az', 'A–Z']] as const).map(([id, label]) => <button key={id} className={sort === id ? 'on' : ''} onClick={() => setSort(id)}>{label}</button>)}
          </div>
        </div>
        {!data.words.length && <p className="muted" style={{ margin: 0 }}>No words yet. When {kid.name} says a new word, add it above. Then tap it every time you hear it again; milestones pay points along the way.</p>}
        <div className="word-grid">
          {words.map((w) => {
            const prev = w.milestones.filter((m) => m.times <= w.count).pop()?.times ?? 0;
            const pct = w.next ? Math.round(((w.count - prev) / (w.next.times - prev)) * 100) : 100;
            return (
              <div key={w.id} className={`word-tile${w.mastered ? ' mastered' : ''}`}>
                <button className="word-say" disabled={busy === w.id} onClick={(e) => void say(w, e)} aria-label={`${w.word}, said ${w.count} times. Tap to add one.`}>
                  <span className="word-text">{w.word}</span>
                  <span className="word-count">{w.count}<span className="small">×</span></span>
                </button>
                {w.note && <div className="small muted word-note">{w.note}</div>}
                <ProgressBar percent={pct} color={color} />
                <div className="row small" style={{ flexWrap: 'nowrap', gap: 4 }}>
                  <span className="muted" style={{ flex: 1 }}>
                    {w.next ? `${w.next.times - w.count} more → ${w.next.points ? `+${pts(w.next.points, false)}` : 'next milestone'}` : w.milestones.length ? '⭐ All milestones' : 'No milestones'}
                  </span>
                  <button className="ghost" title="Undo the last tap" aria-label={`Undo the last tap on ${w.word}`} disabled={!w.count}
                    onClick={() => void run(async () => {
                      const r = await api<{ reversed: number }>(`${base}/words/${w.id}/say`, { method: 'DELETE' });
                      toast(r.reversed ? `Undone, ${pts(r.reversed)} taken back` : 'Undone');
                    })}>↶</button>
                  <button className="ghost" aria-label={`Edit ${w.word}`} onClick={() => setEditing(w)}>✏️</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {data.words.length > 0 && (
        <div className="grid-2">
          <section className="card stack">
            <h3 style={{ margin: 0 }}>Words on the list</h3>
            <LineChart height={180} labels={weeks.map(shortDate)} series={[{ id: 'words', name: 'Words', color, values: onList }]} />
          </section>
          <section className="card stack">
            <h3 style={{ margin: 0 }}>Times heard each week</h3>
            <ColumnChart height={180} labels={weeks.map(shortDate)} segments={[{ id: 'heard', name: 'Times heard', color, values: heard }]} />
          </section>
        </div>
      )}
      <p className="small muted no-print">The word list and counts go on the visit summary, and on a therapist's share link when you tick “Include new words” in Summary &amp; sharing.</p>

      {editMs && (
        <MilestonesModal kidName={kid.name} value={data.custom ? data.milestones : DEFAULTS} onClose={() => setEditMs(false)}
          onSave={(v) => run(async () => { await api(`${url}/milestones`, { method: 'PUT', body: { milestones: v } }); setEditMs(false); }, 'Milestones saved')} />
      )}
      {editing && (
        <EditWord word={editing} kidDefault={data.milestones} today={data.today} onClose={() => setEditing(null)}
          onSave={(b) => run(async () => { await api(`${base}/words/${editing.id}`, { method: 'PATCH', body: b }); setEditing(null); }, 'Saved')}
          onDelete={() => { if (confirm(`Delete “${editing.word}” and its count? Points already earned stay.`)) void run(async () => { await api(`${base}/words/${editing.id}`, { method: 'DELETE' }); setEditing(null); }, 'Deleted'); }} />
      )}
    </div>
  );
}
