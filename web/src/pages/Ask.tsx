// The Ask page (parents only): Judge Trash Panda settles kids' arguments, Dr. Bandit chats about everyday health, and
// Coach Ringtail helps with behavior and time-out calls. Everything here needs AI ideas turned on in Settings.
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type Kid } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { DoctorRaccoon, JudgeRaccoon, RaccoonAvatar } from '../components/Raccoon.tsx';
import { SpeakButton } from '../components/Speak.tsx';
import { avatarId } from '../../../shared/catalog.ts';
import { COACH_NAME, DOCTOR_NAME, JUDGE_NAME } from '../../../shared/pages.ts';

type Tab = 'judge' | 'doctor' | 'parenting';
const TABS: { id: Tab; label: string }[] = [
  { id: 'judge', label: `⚖️ ${JUDGE_NAME}` },
  { id: 'doctor', label: `🩺 ${DOCTOR_NAME}` },
  { id: 'parenting', label: `🧩 ${COACH_NAME}` },
];
const COACH_AVATAR = avatarId('raccoon', 'cap');

export function Ask() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'judge') as Tab;
  const { base } = useApp();
  const [ai] = useLoad<{ enabled: boolean }>(`${base}/ai`);
  return (
    <div className="stack">
      <div className="topbar">
        <h1>Ask</h1>
        <div className="chips" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`chip${tab === t.id ? ' on' : ''}`} onClick={() => setParams({ tab: t.id }, { replace: true })}>{t.label}</button>
          ))}
        </div>
      </div>
      {ai && !ai.enabled && (
        <div className="card row">
          <JudgeRaccoon size={56} badge />
          <span style={{ flex: 1 }}>The judge, the doctor and the coach all use AI ideas, which are off. Turn them on with your own Anthropic key in <Link to="/settings">Settings</Link>.</span>
        </div>
      )}
      {ai?.enabled && (tab === 'judge' ? <Judge /> : <Chat key={tab} kind={tab} />)}
    </div>
  );
}

// ---------- Judge Trash Panda ----------

interface Side { kidId: string | null; name: string; avatar: string | null; story: string }
interface Ruling {
  winner: string; headline: string; reasoning: string; fix: string; readAloud: string;
  sides: { who: string; heard: string; nextTime: string }[];
}
interface Case { id: string; at: string; about: string | null; parentSaw: string | null; sides: Side[]; ruling: Ruling }

interface Draft { kidId: string | null; guest: boolean; name: string; age: string; story: string }
const emptySide = (kidId: string | null = null): Draft => ({ kidId, guest: false, name: '', age: '', story: '' });

function Judge() {
  const { base, home, toast } = useApp();
  const kids: Kid[] = (home?.kids ?? []).filter((k) => k.aiOn);
  const [info, reload] = useLoad<{ history: Case[] }>(`${base}/judge`);
  const [about, setAbout] = useState('');
  const [saw, setSaw] = useState('');
  const [sides, setSides] = useState<Draft[]>(() => [emptySide(kids[0]?.id ?? null), emptySide(kids[1]?.id ?? null)]);
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<Case | null>(null);

  const set = (i: number, patch: Partial<Draft>) => setSides(sides.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const who = (s: Draft) => (s.guest ? s.name.trim() : kids.find((k) => k.id === s.kidId)?.name) || 'this side';
  const ready = sides.every((s) => s.story.trim() && (s.guest ? s.name.trim() : s.kidId));

  const hear = async () => {
    setBusy(true);
    try {
      const c = await api<Case>(`${base}/judge`, {
        body: {
          about, parentSaw: saw,
          sides: sides.map((s) => (s.guest ? { name: s.name, age: s.age || null, story: s.story } : { kidId: s.kidId, story: s.story })),
        },
      });
      setLatest(c);
      setAbout(''); setSaw(''); setSides(sides.map((s) => ({ ...s, story: '' })));
      await reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      <section className="card stack judge-card">
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <JudgeRaccoon size={96} />
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0 }}>Order in the den!</h2>
            <span className="small muted">Tell {JUDGE_NAME} each side, in the kids' own words if you can. He'll make the fairest call and a plan to fix it. Kids' names stay here: only their ages and the stories are sent.</span>
          </div>
        </div>
        <label className="stack" style={{ gap: 4 }}>
          <strong className="small">What's the argument about?</strong>
          <input placeholder="e.g. The scooter, the front seat, who gets the last cookie" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={200} />
        </label>
        {sides.map((s, i) => (
          <div key={i} className="judge-side stack">
            <div className="row">
              <strong>Side {i + 1}</strong>
              <div className="chips" style={{ flex: 1 }}>
                {kids.map((k) => (
                  <button key={k.id} type="button" className={`chip${!s.guest && s.kidId === k.id ? ' on' : ''}`}
                    disabled={sides.some((o, j) => j !== i && !o.guest && o.kidId === k.id)} onClick={() => set(i, { kidId: k.id, guest: false })}>
                    <RaccoonAvatar variant={k.avatar} size={26} /> {k.name}
                  </button>
                ))}
                <button type="button" className={`chip${s.guest ? ' on' : ''}`} onClick={() => set(i, { guest: true, kidId: null })}>🙋 Someone else</button>
              </div>
              {sides.length > 2 && <button type="button" className="ghost" aria-label={`Remove side ${i + 1}`} onClick={() => setSides(sides.filter((_, j) => j !== i))}>✕</button>}
            </div>
            {s.guest && (
              <div className="row">
                <input placeholder="Name (a cousin, a friend)" value={s.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={40} style={{ flex: 1, minWidth: 160 }} />
                <input placeholder="Age" inputMode="numeric" value={s.age} onChange={(e) => set(i, { age: e.target.value.replace(/\D/g, '').slice(0, 2) })} style={{ width: 80 }} />
              </div>
            )}
            <textarea rows={2} placeholder={`What does ${who(s)} say happened?`} value={s.story} onChange={(e) => set(i, { story: e.target.value })} maxLength={800} />
          </div>
        ))}
        {sides.length < 4 && <button type="button" className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setSides([...sides, emptySide()])}>＋ Add a side</button>}
        <label className="stack" style={{ gap: 4 }}>
          <strong className="small">What did you see? (optional)</strong>
          <textarea rows={2} placeholder="Anything a grown-up noticed" value={saw} onChange={(e) => setSaw(e.target.value)} maxLength={600} />
        </label>
        <button className="primary" disabled={busy || !ready} onClick={() => void hear()}>{busy ? 'The judge is thinking…' : '🔨 Hear the case'}</button>
        <span className="small disclaimer">ⓘ A playful helper for everyday squabbles. You're the real judge: change the ruling if it doesn't fit.</span>
      </section>

      {latest && <RulingCard c={latest} open />}

      {info && info.history.filter((c) => c.id !== latest?.id).length > 0 && (
        <section className="card stack">
          <div className="row">
            <h2 style={{ margin: 0, flex: 1 }}>Past rulings</h2>
            <button className="ghost danger" onClick={async () => {
              if (!confirm('Clear all of the judge\'s past rulings?')) return;
              await api(`${base}/judge`, { method: 'DELETE' });
              setLatest(null);
              await reload();
            }}>Clear</button>
          </div>
          {info.history.filter((c) => c.id !== latest?.id).map((c) => <RulingCard key={c.id} c={c} />)}
        </section>
      )}
    </>
  );
}

function verdict(c: Case): string {
  const w = Number(c.ruling.winner);
  return w ? `🏆 ${c.sides[w - 1]?.name ?? 'One side'} wins this one` : '🤝 A tie: everyone has a point';
}

function RulingCard({ c, open = false }: { c: Case; open?: boolean }) {
  const body = (
    <div className="stack ruling">
      <div className="bubble-row">
        <JudgeRaccoon size={44} badge />
        <div className="bubble">
          <strong>{c.ruling.headline}</strong>
          {c.ruling.readAloud && (
            <div className="row read-aloud">
              <em style={{ flex: 1 }}>“{c.ruling.readAloud}”</em>
              <SpeakButton text={c.ruling.readAloud} label="Read the verdict out loud" />
            </div>
          )}
        </div>
      </div>
      {c.ruling.fix && <div><strong>🛠️ How we fix it now:</strong> {c.ruling.fix}</div>}
      <div className="judge-sides">
        {c.ruling.sides.map((s) => {
          const side = c.sides[Number(s.who) - 1];
          if (!side) return null;
          return (
            <div key={s.who} className="judge-heard">
              <div className="row" style={{ gap: 6 }}>
                {side.avatar ? <RaccoonAvatar variant={side.avatar} size={28} /> : <span aria-hidden>🙋</span>}
                <strong>{side.name}</strong>
                {c.ruling.winner === s.who && <span className="pill">🏆</span>}
              </div>
              <div className="small">👂 {s.heard}</div>
              <div className="small">🌱 Next time: {s.nextTime}</div>
            </div>
          );
        })}
      </div>
      {c.ruling.reasoning && <details><summary className="small">Why this call (for grown-ups)</summary><p className="small">{c.ruling.reasoning}</p></details>}
      <details>
        <summary className="small">What each side said</summary>
        {c.about && <p className="small"><strong>About:</strong> {c.about}</p>}
        {c.sides.map((s, i) => <p key={i} className="small"><strong>{s.name}:</strong> {s.story}</p>)}
        {c.parentSaw && <p className="small"><strong>A grown-up saw:</strong> {c.parentSaw}</p>}
      </details>
    </div>
  );
  if (open) return <section className="card stack"><h2 style={{ margin: 0 }}>{verdict(c)}</h2>{body}</section>;
  return (
    <details className="past-ruling">
      <summary><strong>{verdict(c)}</strong> <span className="small muted">· {c.sides.map((s) => s.name).join(' vs ')}{c.about ? ` · ${c.about}` : ''} · {new Date(c.at.replace(' ', 'T') + (c.at.includes('Z') ? '' : 'Z')).toLocaleDateString()}</span></summary>
      {body}
    </details>
  );
}

// ---------- the open chats ----------

interface Msg { id: string; role: 'user' | 'assistant'; content: string; urgent: boolean; at: string }
interface ChatInfo { name: string; disclaimer: string; urgentNote: string; starters: { icon: string; label: string; ask: string }[]; messages: Msg[] }

function ChatAvatar({ kind, size }: { kind: 'doctor' | 'parenting'; size: number }) {
  return kind === 'doctor' ? <DoctorRaccoon size={size} title={DOCTOR_NAME} /> : <RaccoonAvatar variant={COACH_AVATAR} size={size} title={COACH_NAME} />;
}

function Chat({ kind }: { kind: 'doctor' | 'parenting' }) {
  const { base, home, toast } = useApp();
  const kids: Kid[] = (home?.kids ?? []).filter((k) => k.aiOn);
  const [info, setInfo] = useState<ChatInfo | null>(null);
  const [text, setText] = useState('');
  const [kidId, setKidId] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { api<ChatInfo>(`${base}/chat/${kind}`).then(setInfo, (e) => toast((e as Error).message)); }, [base, kind]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [info?.messages.length, pending]);

  const send = async () => {
    const message = text.trim();
    if (!message) return;
    setBusy(true); setPending(message); setText('');
    try {
      setInfo(await api<ChatInfo>(`${base}/chat/${kind}`, { body: { message, kidId: kidId || null } }));
    } catch (e) { toast((e as Error).message); setText(message); } finally { setBusy(false); setPending(null); }
  };

  if (!info) return null;
  const intro = kind === 'doctor'
    ? 'Ask about anything health-related: sleep, eating, colds, growth, development, therapy. Not tied to one kid.'
    : 'Talk through behavior: tantrums, not listening, sibling fights, and whether something deserves a time-out (and how long).';
  return (
    <section className="card stack chat-card">
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <ChatAvatar kind={kind} size={64} />
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0 }}>Chat with {info.name}</h2>
          <span className="small muted">{intro} Only parents see this chat.</span>
        </div>
      </div>
      <div className="chat-log" aria-live="polite">
        {!info.messages.length && !pending && (
          <div className="bubble-row"><ChatAvatar kind={kind} size={36} /><div className="bubble">Hi! What's on your mind today?</div></div>
        )}
        {info.messages.map((m) => (m.role === 'user'
          ? <div key={m.id} className="bubble-row me"><div className="bubble">{m.content}</div></div>
          : (
            <div key={m.id} className="bubble-row">
              <ChatAvatar kind={kind} size={36} />
              <div className={`bubble${m.urgent ? ' urgent' : ''}`}>
                {m.urgent && <div className="urgent-note">⚠️ {info.urgentNote}</div>}
                {m.content}
              </div>
            </div>
          )))}
        {pending && (
          <>
            <div className="bubble-row me"><div className="bubble">{pending}</div></div>
            <div className="bubble-row"><ChatAvatar kind={kind} size={36} /><div className="bubble muted">Thinking…</div></div>
          </>
        )}
        <div ref={end} />
      </div>
      {info.starters.length > 0 && (
        <div className="chips">
          {info.starters.map((s) => (
            <button key={s.label} type="button" className="chip" disabled={busy} onClick={() => { setText(s.ask); input.current?.focus(); }}>{s.icon} {s.label}</button>
          ))}
        </div>
      )}
      <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea ref={input} rows={3} value={text} maxLength={1500} placeholder={kind === 'doctor' ? 'e.g. How much sleep does a 6-year-old need?' : 'e.g. He hit his sister over a toy. Time-out, and how long?'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <div className="row">
          {kids.length > 0 && (
            <label className="row small" style={{ gap: 6 }}>
              About
              <select value={kidId} onChange={(e) => setKidId(e.target.value)}>
                <option value="">anyone</option>
                {kids.map((k) => <option key={k.id} value={k.id}>{k.name}{k.age != null ? ` (${k.age})` : ''}</option>)}
              </select>
            </label>
          )}
          <span style={{ flex: 1 }} />
          {info.messages.length > 0 && (
            <button type="button" className="ghost danger" onClick={async () => {
              if (!confirm(`Clear the chat with ${info.name}?`)) return;
              await api(`${base}/chat/${kind}`, { method: 'DELETE' });
              setInfo({ ...info, messages: [] });
            }}>Clear chat</button>
          )}
          <button className="primary" disabled={busy || !text.trim()}>{busy ? 'Thinking…' : 'Send'}</button>
        </div>
      </form>
      <p className="small urgent-note">⚠️ {info.urgentNote}</p>
      <span className="small disclaimer">ⓘ {info.disclaimer} Picking a kid sends only their age; what you type is sent as written.</span>
    </section>
  );
}
