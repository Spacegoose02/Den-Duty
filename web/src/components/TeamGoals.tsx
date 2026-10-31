// Family team goals: one shared goal that every kid's earned points fill, drawn as a bar split into each kid's color.
import { useState } from 'react';
import { api, type TeamGoal } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from './Raccoon.tsx';
import { confetti } from './Confetti.ts';

const TEAM_ICONS = ['🏕️', '🦁', '🎢', '🍕', '🎬', '🏖️', '🎳', '⛸️', '🏊', '🚲', '🎮', '🐶', '🌮', '🧁'];

/** The bar: each kid's share in their own color, so everyone can see what they added. */
export function TeamBar({ goal }: { goal: TeamGoal }) {
  const scale = Math.max(goal.target, goal.progress);
  return (
    <div className="team-bar" role="img" aria-label={`${goal.progress} of ${goal.target}`}>
      {goal.contributions.filter((c) => c.points > 0).map((c) => (
        <span key={c.memberId} className="team-bar-part" style={{ width: `${(c.points / scale) * 100}%`, background: c.color }} title={`${c.name}: ${c.points}`} />
      ))}
    </div>
  );
}

export function TeamGoalCard({ goal, onDone }: { goal: TeamGoal; onDone?: () => void }) {
  const { home } = useApp();
  const icon = home?.pointsIcon ?? '✨';
  const left = Math.max(0, goal.target - goal.progress);
  return (
    <div className={`team-goal${goal.reached ? ' reached' : ''}`}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <span className="team-icon" aria-hidden>{goal.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>{goal.title}</strong>
          <div className="small muted">
            {goal.status === 'done' ? '🎉 We did it together!' : goal.reached ? '🎉 The family made it! Time to celebrate.' : `${goal.progress} / ${goal.target} ${icon} · ${left} to go, together`}
          </div>
        </div>
        {onDone && goal.reached && goal.status === 'active' && <button className="primary" onClick={onDone}>We did it! 🎉</button>}
      </div>
      <TeamBar goal={goal} />
      <div className="team-kids">
        {goal.contributions.map((c) => (
          <span key={c.memberId} className="team-kid" style={{ ['--kid' as string]: c.color }}>
            <RaccoonAvatar variant={c.avatar} size={28} /> {c.name} <strong>+{c.points}</strong>
          </span>
        ))}
      </div>
      {goal.reward && <div className="small">🎁 {goal.reward}</div>}
    </div>
  );
}

/** On a kid's board: the family's goals, if there are any. */
export function KidTeamGoals() {
  const { base } = useApp();
  const [goals] = useLoad<TeamGoal[]>(`${base}/team-goals`);
  if (!goals?.length) return null;
  return (
    <section className="card stack pg-goals">
      <h2 style={{ margin: 0 }}>🤝 Family goal{goals.length > 1 ? 's' : ''}</h2>
      {goals.map((g) => <TeamGoalCard key={g.id} goal={g} />)}
    </section>
  );
}

/** Rewards page: set family goals and mark them celebrated. */
export function TeamGoalManager() {
  const { base, home, toast } = useApp();
  const [goals, reload] = useLoad<TeamGoal[]>(`${base}/team-goals`);
  const blank = { title: '', icon: '🏕️', target: 200, reward: '' };
  const [d, setD] = useState(blank);
  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>🤝 Family goals</h2>
      <p className="small muted" style={{ margin: 0 }}>
        One goal the whole family works toward. Every {home?.pointsName ?? 'point'} a kid earns from now on fills it, and nobody's points get spent.
      </p>
      {goals?.map((g) => (
        <div key={g.id} className="stack" style={{ gap: 4 }}>
          <TeamGoalCard goal={g} onDone={async () => {
            await api(`${base}/team-goals/${g.id}/done`, { body: {} });
            confetti({ colors: g.contributions.map((c) => c.color), count: 220 });
            await reload();
          }} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="ghost danger small" onClick={async () => { if (confirm(`Remove "${g.title}"?`)) { await api(`${base}/team-goals/${g.id}`, { method: 'DELETE' }); await reload(); } }}>Remove</button>
          </div>
        </div>
      ))}
      <form className="row" onSubmit={async (e) => {
        e.preventDefault();
        try { await api(`${base}/team-goals`, { body: d }); setD(blank); await reload(); } catch (err) { toast((err as Error).message); }
      }}>
        <select value={d.icon} onChange={(e) => setD({ ...d, icon: e.target.value })} style={{ width: 80 }} aria-label="Icon">
          {TEAM_ICONS.map((i) => <option key={i}>{i}</option>)}
        </select>
        <input placeholder="e.g. Trip to the zoo" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
        <input type="number" min={1} value={d.target} onChange={(e) => setD({ ...d, target: Math.max(1, Math.round(Number(e.target.value))) })} style={{ width: 100 }} aria-label="Points together" />
        <input placeholder="Reward (optional)" value={d.reward} onChange={(e) => setD({ ...d, reward: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
        <button disabled={!d.title.trim()}>Add</button>
      </form>
    </section>
  );
}
