import { useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { DoctorRaccoon } from './Raccoon.tsx';
import { DOCTOR_NAME } from '../../../shared/pages.ts';

interface Answer { id: string; question: string; answer: string; urgent: boolean; at?: string }
interface Topic { id: string; icon: string; label: string; ask: string }
interface AskInfo { name: string; disclaimer: string; urgentNote: string; history: Answer[]; topics: Topic[]; aiOn: boolean }

/**
 * "Ask Dr. Bandit" in Doctors: a parent asks about one kid. Only shows when AI ideas are on. The server sends just the
 * age, the Doctors sections turned on, active goal text and the question.
 */
export function AskDoctorCard({ kidId, kidName }: { kidId: string; kidName: string }) {
  const { base, toast } = useApp();
  const [ai] = useLoad<{ enabled: boolean }>(`${base}/ai`);
  const [info, reload] = useLoad<AskInfo>(`${base}/kids/${kidId}/doctors/ask`, [kidId]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  if (!ai?.enabled || !info || !info.aiOn) return null;

  const ask = async (topic?: string) => {
    setBusy(true);
    try {
      await api(`${base}/kids/${kidId}/doctors/ask`, { body: topic ? { topic } : { question } });
      if (!topic) setQuestion('');
      await reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="card stack ask-card">
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <DoctorRaccoon size={64} title={DOCTOR_NAME} />
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0 }}>Ask {DOCTOR_NAME}</h2>
          <span className="small muted">Questions about {kidName}, using their age and the sections you follow here. Only you see this.</span>
        </div>
      </div>
      {info.topics.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <strong className="small">🧩 Feelings and behavior: ideas for {kidName}'s age</strong>
          <div className="chips">
            {info.topics.map((t) => <button key={t.id} type="button" className="chip" disabled={busy} title={t.ask} onClick={() => void ask(t.id)}>{t.icon} {t.label}</button>)}
          </div>
        </div>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <input placeholder={`e.g. How can I help ${kidName} practice "s" sounds at bath time?`} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} style={{ flex: 1, minWidth: 220 }} />
        <button className="primary" disabled={busy || !question.trim()}>{busy ? 'Thinking…' : 'Ask'}</button>
      </form>
      <p className="small urgent-note">⚠️ {info.urgentNote}</p>
      {info.history.map((a) => (
        <div key={a.id} className="qa">
          <div className="q"><strong>You:</strong> {a.question}</div>
          <div className={`a${a.urgent ? ' urgent' : ''}`}>
            <DoctorRaccoon size={32} title={DOCTOR_NAME} />
            <div style={{ flex: 1 }}>
              <strong>{DOCTOR_NAME}:</strong>
              {a.urgent && <div className="urgent-note">⚠️ This may need a doctor soon. {info.urgentNote}</div>}
              <div style={{ whiteSpace: 'pre-wrap' }}>{a.answer}</div>
            </div>
          </div>
        </div>
      ))}
      <div className="row">
        <span className="small disclaimer" style={{ flex: 1 }}>ⓘ {info.disclaimer}</span>
        {info.history.length > 0 && (
          <button className="ghost danger" onClick={async () => {
            if (!confirm(`Clear ${kidName}'s questions and answers?`)) return;
            await api(`${base}/kids/${kidId}/doctors/ask`, { method: 'DELETE' });
            await reload();
          }}>Clear history</button>
        )}
      </div>
    </section>
  );
}
