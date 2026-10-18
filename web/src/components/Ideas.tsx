import { useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';

export interface Idea { title: string; points: number; detail: string }

/**
 * "💡 Ideas" next to a form. Shows nothing unless a parent turned AI ideas on in Settings.
 * Tapping an idea fills the form through onPick.
 */
export function IdeasButton({ kind, kidId, onPick }: { kind: 'goal' | 'penalty' | 'chore'; kidId?: string; onPick: (idea: Idea) => void }) {
  const { base, home, toast } = useApp();
  const [ai] = useLoad<{ enabled: boolean }>(home?.viewer === 'parent' ? `${base}/ai` : null);
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState('');
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Hidden while AI is off for the home, or for this kid.
  if (!ai?.enabled || (kidId && home?.kids.find((k) => k.id === kidId)?.aiOn === false)) return null;

  const ask = async () => {
    setBusy(true);
    try {
      setIdeas((await api<{ ideas: Idea[] }>(`${base}/ai/ideas`, { body: { kind, kidId, hint } })).ideas);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return <button type="button" className="ghost" onClick={() => setOpen(true)}>💡 Ideas</button>;
  return (
    <div className="ideas card stack">
      <div className="row">
        <input placeholder={kind === 'goal' ? 'What do they love? (optional)' : kind === 'penalty' ? 'What happened? (optional)' : 'Anything to focus on? (optional)'}
          value={hint} onChange={(e) => setHint(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <button type="button" className="primary" disabled={busy} onClick={() => void ask()}>{busy ? 'Thinking…' : ideas ? 'More ideas' : 'Get ideas'}</button>
        <button type="button" className="ghost" onClick={() => setOpen(false)}>✕</button>
      </div>
      {ideas?.map((i) => (
        <button key={i.title} type="button" className="idea" onClick={() => { onPick(i); setOpen(false); }}>
          <strong>{i.title}</strong> <span className="pill">{kind === 'penalty' ? '−' : ''}{i.points} {home?.pointsIcon}</span>
          <span className="small muted">{i.detail}</span>
        </button>
      ))}
      <span className="small muted">Ideas from Claude. Kids' names aren't sent.</span>
    </div>
  );
}

/** Settings card: off by default; nothing is sent until a parent turns it on with their own key. */
export function AiCard() {
  const { base, toast } = useApp();
  const [s, reload] = useLoad<{ enabled: boolean; hasKey: boolean; keyHint: string | null; model: string }>(`${base}/ai`);
  const [key, setKey] = useState('');
  if (!s) return null;
  const save = async (body: object, msg: string) => {
    try { await api(`${base}/ai`, { method: 'PATCH', body }); toast(msg); await reload(); } catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="card stack" id="ai">
      <h2 style={{ margin: 0 }}>💡 AI ideas</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Get ideas for goals, chores and gentle penalties from Claude. Off until you turn it on with your own Anthropic API key
        (from console.anthropic.com; you pay Anthropic for what you use). When you ask, the server sends your points name, a typical
        week's points, existing goal or chore titles, and anything you type. Kids' names are never sent.
      </p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void save({ apiKey: key }, 'Key saved').then(() => setKey('')); }}>
        <input type="password" placeholder={s.hasKey ? `Saved key ${s.keyHint}` : 'sk-ant-…'} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" style={{ flex: 1, minWidth: 220 }} />
        <button disabled={!key.trim()}>Save key</button>
        {s.hasKey && <button type="button" className="ghost danger" onClick={() => void save({ apiKey: '', enabled: false }, 'Key removed')}>Remove key</button>}
      </form>
      <label className="row" style={{ fontWeight: 600 }}>
        <input type="checkbox" checked={s.enabled} disabled={!s.hasKey} style={{ width: 24, minHeight: 24 }}
          onChange={(e) => void save({ enabled: e.target.checked }, e.target.checked ? 'AI ideas on' : 'AI ideas off')} />
        Show “💡 Ideas” on the goal, chore and penalty forms
      </label>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void save({ model: (e.currentTarget.elements.namedItem('m') as HTMLInputElement).value }, 'Model saved'); }}>
        <span className="small">Model</span>
        <input name="m" defaultValue={s.model} key={s.model} style={{ width: 220 }} />
        <button className="ghost">Save</button>
      </form>
    </div>
  );
}
