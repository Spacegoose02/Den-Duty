import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { RaccoonAvatar } from './Raccoon.tsx';

export interface Tip {
  date: string; area: 'speech' | 'ot'; disclaimer: string; cached: boolean;
  tip: { title: string; activity: string; minutes: number; why: string };
  goals: { title: string; why: string }[];
}

const AREA_TITLE = { speech: '🗣️ Speech practice idea', ot: '✋ OT practice idea' };
const HELPER_AREA_GOALS = { speech: ['speech'], ot: ['motor', 'sensory', 'selfcare'] };

/**
 * Daily tip and goal ideas for one kid and area, on the Therapy page. Hidden unless AI ideas are on.
 * Parents can save the tip as a step on one of their goals, or turn a suggested goal into a real one.
 */
export function TherapyHelperCard({ kidId, area, goals, onChange }: {
  kidId: string; area: 'speech' | 'ot'; goals: { id: string; area: string; title: string; status: string }[]; onChange: () => Promise<void>;
}) {
  const { base, toast } = useApp();
  const [ai] = useLoad<{ enabled: boolean }>(`${base}/ai`);
  const [tip, setTip] = useState<Tip | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ai?.enabled) return null;
  const mine = goals.filter((g) => g.status === 'active' && HELPER_AREA_GOALS[area].includes(g.area));
  const t = `${base}/kids/${kidId}/therapy`;

  const load = async (refresh: boolean) => {
    setBusy(true);
    setError(null);
    try { setTip(await api<Tip>(`${t}/helper/${area}${refresh ? '?refresh=1' : ''}`)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="card stack helper-card">
      <div className="row">
        <h3 style={{ margin: 0, flex: 1 }}>{AREA_TITLE[area]}</h3>
        {tip ? <button className="ghost" disabled={busy} onClick={() => void load(true)}>{busy ? 'Thinking…' : '🔄 Another idea'}</button>
          : <button className="primary" disabled={busy} onClick={() => void load(false)}>{busy ? 'Thinking…' : "💡 Today's idea"}</button>}
      </div>
      {!tip && !error && (
        <p className="small muted" style={{ margin: 0 }}>
          {mine.length ? `Uses your ${mine.length} ${area === 'speech' ? 'speech' : 'OT'} goal${mine.length === 1 ? '' : 's'} and their age.` : 'No goals here yet; you\'ll get gentle starting points for their age.'}
        </p>
      )}
      {error && <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
      {tip && (
        <>
          <div className="tip">
            <strong>{tip.tip.title}</strong> <span className="pill">about {tip.tip.minutes} min</span>
            <p style={{ margin: '6px 0' }}>{tip.tip.activity}</p>
            <span className="small muted">{tip.tip.why}</span>
          </div>
          {mine.length > 0 && (
            <div className="row">
              <span className="small">Save as a step for:</span>
              {mine.map((g) => (
                <button key={g.id} className="chip" onClick={async () => {
                  try {
                    await api(`${t}/notes`, { body: { goalId: g.id, body: `Try: ${tip.tip.title}. ${tip.tip.activity}`, noReward: true } });
                    toast('Saved to the goal');
                    await onChange();
                  } catch (e) { toast((e as Error).message); }
                }}>{g.title}</button>
              ))}
            </div>
          )}
          {tip.goals.length > 0 && (
            <details>
              <summary className="small">Goal ideas to discuss with the therapist ({tip.goals.length})</summary>
              {tip.goals.map((g) => (
                <div key={g.title} className="row small" style={{ padding: '4px 0' }}>
                  <span style={{ flex: 1 }}><strong>{g.title}</strong> · <span className="muted">{g.why}</span></span>
                  <button className="ghost" onClick={async () => {
                    try {
                      await api(`${t}/goals`, { body: { area: area === 'speech' ? 'speech' : 'motor', title: g.title, description: g.why } });
                      toast('Goal added');
                      await onChange();
                    } catch (e) { toast((e as Error).message); }
                  }}>＋ Add as goal</button>
                </div>
              ))}
            </details>
          )}
          <p className="small disclaimer">ⓘ {tip.disclaimer}</p>
        </>
      )}
    </section>
  );
}

interface HomeTip extends Partial<Tip> { kidId: string; kidName: string; kidAvatar: string; area: 'speech' | 'ot'; error?: string }

/** Parent home: today's practice idea per kid and area (only for areas with goals). Nothing shows while AI is off. */
export function TodaysTipsCard() {
  const { base } = useApp();
  const [tips] = useLoad<HomeTip[]>(`${base}/therapy/tips`);
  const ok = tips?.filter((t) => t.tip) ?? [];
  if (!ok.length) return null;
  return (
    <section className="card stack">
      <div className="row"><h2 style={{ margin: 0, flex: 1 }}>Today's practice ideas</h2><Link to="/doctors" className="btn ghost">Doctors →</Link></div>
      {ok.map((t) => (
        <div key={`${t.kidId}-${t.area}`} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <RaccoonAvatar variant={t.kidAvatar} size={36} />
          <div style={{ flex: 1 }}>
            <strong>{t.kidName} · {t.area === 'speech' ? '🗣️ Speech' : '✋ OT'}: {t.tip!.title}</strong> <span className="small muted">~{t.tip!.minutes} min</span>
            <div className="small">{t.tip!.activity}</div>
          </div>
        </div>
      ))}
      <p className="small disclaimer">ⓘ {ok[0].disclaimer}</p>
    </section>
  );
}
