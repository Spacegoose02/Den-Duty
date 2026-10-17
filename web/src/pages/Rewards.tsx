import { useState } from 'react';
import { api, type Poll, type QuickReward } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';

const REWARD_ICONS = ['🌟', '🤝', '🧠', '🎒', '💖', '🧘', '🦁', '🎨', '📚', '🍽️', '😊', '🙌'];
const VOTE_ICONS = ['🍕', '🎬', '🍦', '🎳', '🏞️', '🎮', '🍩', '🏊', '🎨', '🛝', '🧁', '🎁'];

function QuickRewards() {
  const { base, home, toast } = useApp();
  const [list, reload] = useLoad<QuickReward[]>(`${base}/quick-rewards`);
  const [d, setD] = useState({ title: '', icon: '🌟', amount: 2 });
  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>Quick rewards</h2>
      <p className="small muted" style={{ margin: 0 }}>One-tap bonuses for good moments. Hand them out from the kid cards on Home.</p>
      <div className="chips">
        {list?.map((r) => (
          <span key={r.id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {r.icon} {r.title} <strong>+{r.amount} {home?.pointsIcon}</strong>
            <button className="ghost danger" style={{ minHeight: 30, padding: '0 6px' }} aria-label={`Remove ${r.title}`}
              onClick={async () => { await api(`${base}/quick-rewards/${r.id}`, { method: 'DELETE' }); await reload(); }}>✕</button>
          </span>
        ))}
      </div>
      <form className="row" onSubmit={async (e) => {
        e.preventDefault();
        try { await api(`${base}/quick-rewards`, { body: d }); setD({ title: '', icon: '🌟', amount: 2 }); await reload(); } catch (err) { toast((err as Error).message); }
      }}>
        <select value={d.icon} onChange={(e) => setD({ ...d, icon: e.target.value })} style={{ width: 80 }} aria-label="Icon">
          {REWARD_ICONS.map((i) => <option key={i}>{i}</option>)}
        </select>
        <input placeholder="e.g. Kind to a sibling" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} style={{ flex: 1, minWidth: 180 }} />
        <input type="number" min={1} value={d.amount} onChange={(e) => setD({ ...d, amount: Math.max(1, Math.round(Number(e.target.value))) })} style={{ width: 90 }} aria-label="Points" />
        <button disabled={!d.title.trim()}>Add</button>
      </form>
    </section>
  );
}

function Votes() {
  const { base, toast } = useApp();
  const [polls, reload] = useLoad<Poll[]>(`${base}/polls`);
  const [title, setTitle] = useState('What should our next family reward be?');
  const [options, setOptions] = useState([{ title: '', icon: '🍕' }, { title: '', icon: '🎬' }]);
  const setOpt = (i: number, patch: Partial<{ title: string; icon: string }>) => setOptions(options.map((o, k) => (k === i ? { ...o, ...patch } : o)));

  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>Reward votes</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Suggest a few rewards; kids vote on the family tablet. They don't see the counts until you pick a winner, so nobody just follows the crowd.
      </p>
      {polls?.map((p) => {
        const max = Math.max(1, ...p.options.map((o) => o.votes ?? 0));
        return (
          <div key={p.id} className="card stack" style={{ background: 'var(--surface-2)' }}>
            <div className="row">
              <strong style={{ flex: 1 }}>{p.title}</strong>
              <span className={`pill${p.status === 'open' ? ' warn' : ' ok'}`}>{p.status === 'open' ? `Open · ${p.totalVotes} vote${p.totalVotes === 1 ? '' : 's'}` : 'Decided'}</span>
              <button className="ghost danger" onClick={async () => { if (confirm('Delete this vote?')) { await api(`${base}/polls/${p.id}`, { method: 'DELETE' }); await reload(); } }}>Delete</button>
            </div>
            {p.options.map((o) => (
              <div key={o.id} className="row">
                <span style={{ fontSize: '1.4rem' }}>{o.icon}</span>
                <span style={{ flex: 1, fontWeight: p.winnerOptionId === o.id ? 800 : 500 }}>{o.title}{p.winnerOptionId === o.id && ' 🏆'}</span>
                <span className="bar-track" style={{ width: 120 }}><span className="bar-fill" style={{ width: `${((o.votes ?? 0) / max) * 100}%`, background: 'var(--primary)' }} /></span>
                <span className="small muted" style={{ minWidth: 90 }} title={o.voters?.join(', ')}>{o.votes} {o.voters?.length ? `(${o.voters.join(', ')})` : ''}</span>
                {p.status === 'open' && <button onClick={async () => { await api(`${base}/polls/${p.id}/pick`, { body: { optionId: o.id } }); toast(`${o.title} wins!`); await reload(); }}>Pick</button>}
              </div>
            ))}
          </div>
        );
      })}
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`${base}/polls`, { body: { title, options: options.filter((o) => o.title.trim()) } });
          setOptions([{ title: '', icon: '🍕' }, { title: '', icon: '🎬' }]);
          toast('Vote started');
          await reload();
        } catch (err) { toast((err as Error).message); }
      }}>
        <h3 style={{ margin: 0 }}>Start a vote</h3>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
        {options.map((o, i) => (
          <div key={i} className="row">
            <select value={o.icon} onChange={(e) => setOpt(i, { icon: e.target.value })} style={{ width: 80 }} aria-label="Icon">
              {VOTE_ICONS.map((ic) => <option key={ic}>{ic}</option>)}
            </select>
            <input placeholder={`Choice ${i + 1}, e.g. ${['Pizza night', 'Movie night', 'Ice cream trip', 'Bowling'][i % 4]}`} value={o.title} onChange={(e) => setOpt(i, { title: e.target.value })} style={{ flex: 1 }} />
          </div>
        ))}
        <div className="row">
          {options.length < 8 && <button type="button" className="ghost" onClick={() => setOptions([...options, { title: '', icon: VOTE_ICONS[options.length % VOTE_ICONS.length] }])}>＋ Another choice</button>}
          <span className="spacer" />
          <button className="primary" disabled={!title.trim() || options.filter((o) => o.title.trim()).length < 2}>Start the vote</button>
        </div>
      </form>
    </section>
  );
}

export function Rewards() {
  return (
    <div className="stack">
      <div className="topbar"><h1>Rewards</h1></div>
      <QuickRewards />
      <Votes />
    </div>
  );
}
