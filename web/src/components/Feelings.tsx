// Feelings check-in: big faces on a kid's board, and everyone's week on the parent home.
import { useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { dayName } from './Bits.tsx';
import { RaccoonAvatar } from './Raccoon.tsx';
import { speak } from './Speak.tsx';
import { useT } from '../i18n.tsx';
import { FEELINGS, FEELING_REASONS, feelingOf, type FeelingId, type FeelingReason } from '../../../shared/feelings.ts';

interface Feeling { date: string; feeling: FeelingId; reasons: FeelingReason[]; note: string | null }

export function KidFeelings({ memberId, kidName, asParent, readAloud, picture }: { memberId: string; kidName: string; asParent: boolean; readAloud: boolean; picture: boolean }) {
  const { base, toast } = useApp();
  const [data, reload] = useLoad<{ on: boolean; today: Feeling | null; days: Feeling[] }>(`${base}/kids/${memberId}/feelings`, [memberId]);
  const [picking, setPicking] = useState(false);
  const [reasons, setReasons] = useState<FeelingReason[]>([]);
  const [note, setNote] = useState('');
  const t = useT();
  if (!data?.on) return null;
  const today = data.today;
  const save = async (feeling: FeelingId, rs: FeelingReason[] = reasons, n = note) => {
    try {
      await api(`${base}/kids/${memberId}/feelings`, { method: 'PUT', body: { feeling, reasons: rs, note: n } });
      await reload();
    } catch (e) { toast((e as Error).message); }
  };
  if (asParent) {
    return (
      <section className="card stack">
        <h2 style={{ margin: 0 }}>💛 How {kidName} has felt</h2>
        <FeelingStrip days={data.days} />
        {today?.note && <p className="small" style={{ margin: 0 }}>Today: “{today.note}”</p>}
      </section>
    );
  }
  const asking = !today || picking;
  const f = today ? feelingOf(today.feeling) : null;
  return (
    <section className="card stack feelings-card">
      <h2 style={{ margin: 0 }}>{asking ? t('💛 How are you feeling?') : `${f?.icon} ${t("You're feeling {f} today", { f: t(f?.label ?? '').toLowerCase() })}`}</h2>
      {asking ? (
        <div className="feelings-grid">
          {FEELINGS.map((x) => (
            <button key={x.id} className={`feeling${today?.feeling === x.id ? ' on' : ''}`} aria-label={t(x.label)}
              onClick={() => { if (readAloud) speak(t(x.label)); setPicking(false); setReasons([]); setNote(''); void save(x.id, [], ''); }}>
              <span className="feeling-face" aria-hidden>{x.icon}</span>
              <span>{t(x.label)}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          {f?.alert && <p style={{ margin: 0 }}>{t('Thanks for telling us.')} {t(picture ? 'A grown-up can give you a hug. 🤗' : 'It helps to talk about it with a grown-up. 🤗')}</p>}
          <div className="row" style={{ gap: 6 }}>
            <span className="small muted">{t('Because of…')}</span>
            {FEELING_REASONS.map((r) => {
              const on = today!.reasons.includes(r.id);
              return (
                <button key={r.id} type="button" className={`chip${on ? ' on' : ''}`} aria-pressed={on}
                  onClick={() => void save(today!.feeling, on ? today!.reasons.filter((x) => x !== r.id) : [...today!.reasons, r.id], today!.note ?? '')}>
                  {r.icon} {t(r.label)}
                </button>
              );
            })}
          </div>
          {!picture && (
            <div className="row">
              <input placeholder={t('Want to say more? (only grown-ups see it)')} value={note || today!.note || ''} onChange={(e) => setNote(e.target.value)} style={{ flex: 1 }} maxLength={300} />
              <button disabled={!note.trim()} onClick={() => void save(today!.feeling, today!.reasons, note).then(() => toast(t('Sent to your grown-ups 💛')))}>{t('Send')}</button>
            </div>
          )}
          <button className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPicking(true)}>{t('I feel different now')}</button>
        </>
      )}
    </section>
  );
}

function FeelingStrip({ days }: { days: Feeling[] }) {
  if (!days.length) return <p className="small muted" style={{ margin: 0 }}>No check-ins yet this week.</p>;
  return (
    <div className="row" style={{ gap: 8 }}>
      {days.map((d) => {
        const f = feelingOf(d.feeling);
        const why = d.reasons.map((r) => FEELING_REASONS.find((x) => x.id === r)?.label).filter(Boolean).join(', ');
        return (
          <span key={d.date} className={`feeling-chip${f?.alert ? ' hard' : ''}`} title={`${dayName(d.date)}: ${f?.label}${why ? ` (${why})` : ''}${d.note ? `: “${d.note}”` : ''}`}>
            <span aria-hidden>{f?.icon}</span><span className="small">{dayName(d.date)}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Parent home: each kid's check-ins this week, with notes and the "buzz me" switch. */
export function FeelingsCard() {
  const { base, toast } = useApp();
  const [data, reload] = useLoad<{ today: string; alert: boolean; kids: { id: string; name: string; avatar: string; days: Feeling[] }[] }>(`${base}/feelings`);
  if (!data || !data.kids.some((k) => k.days.length)) return null;
  return (
    <section className="card stack">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>💛 Feelings this week</h2>
        <label className="row small"><input type="checkbox" checked={data.alert} style={{ width: 20, minHeight: 20 }}
          onChange={async (e) => { try { await api(`${base}/feelings`, { method: 'PATCH', body: { alert: e.target.checked } }); await reload(); } catch (err) { toast((err as Error).message); } }} />
          Buzz me for sad, angry, worried or scared</label>
      </div>
      {data.kids.map((k) => {
        const t = k.days.find((d) => d.date === data.today);
        return (
          <div key={k.id} className="row" style={{ alignItems: 'flex-start' }}>
            <RaccoonAvatar variant={k.avatar} size={36} />
            <div style={{ flex: 1 }}>
              <strong>{k.name}</strong>{t && <span className="small muted"> · today {feelingOf(t.feeling)?.icon} {feelingOf(t.feeling)?.label}</span>}
              <FeelingStrip days={k.days} />
              {t?.note && <p className="small" style={{ margin: '4px 0 0' }}>“{t.note}”</p>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
