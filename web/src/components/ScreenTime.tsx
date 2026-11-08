// Screen-time bank: the card on a kid's board (bank, start a timer, swap points) and the settings card.
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { confetti } from './Confetti.ts';
import { SpeakButton } from './Speak.tsx';
import { RaccoonAvatar } from './Raccoon.tsx';
import { useT } from '../i18n.tsx';

interface Settings { on: boolean; perChorePoint: number; perPoint: number; dailyMax: number; bankMax: number }
interface View {
  settings: Settings; bank: number; usedToday: number; leftToday: number | null; points: number;
  session: { id: string; minutes: number; startedAt: string; endsAt: string } | null;
  recent: { minutes: number; kind: string; reason: string; date: string; by: string | null }[];
}

const mmss = (ms: number) => { const s = Math.max(Math.ceil(ms / 1000), 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function KidScreenTime({ memberId, asParent, readAloud, onChange }: { memberId: string; asParent: boolean; readAloud: boolean; onChange: () => void }) {
  const { base, toast, home } = useApp();
  const [v, reload] = useLoad<View | null>(`${base}/kids/${memberId}/screen-time`, [memberId]);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const t = useT();
  const running = v?.session;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.parse(running.endsAt) <= Date.now()) void reload();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, reload]);
  if (!v) return null;
  const icon = home?.pointsIcon ?? '✨';
  const can = Math.min(v.bank, v.leftToday ?? Infinity);
  const run = async (path: string, body: object, done?: string) => {
    setBusy(true);
    try { await api(`${base}${path}`, { body }); await reload(); if (done) toast(done); onChange(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const choices = [15, 30, 45, 60].filter((m) => m <= can);
  const swaps = [1, 2, 5, 10].filter((p) => v.settings.perPoint && p <= v.points && (!v.settings.bankMax || v.bank + p * v.settings.perPoint <= v.settings.bankMax));
  const say = running ? t('Screen time: {n} minutes left.', { n: Math.ceil((Date.parse(running.endsAt) - now) / 60000) }) : t('You have {n} minutes of screen time.', { n: v.bank });
  return (
    <section className="card stack pg-screentime">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>{t('📺 Screen time')}</h2>
        <span className="pill">{t('{n} min in the bank', { n: v.bank })}</span>
        {v.leftToday != null && <span className="pill">{t('{n} min left today', { n: v.leftToday })}</span>}
        {readAloud && !asParent && <SpeakButton text={say} />}
      </div>
      {running ? (
        <div className="row screen-running">
          <span className="screen-clock" aria-live="polite">{mmss(Date.parse(running.endsAt) - now)}</span>
          <span style={{ flex: 1 }}>{t('of {n} minutes', { n: running.minutes })}</span>
          <button disabled={busy} onClick={() => void run(`/screen-time/${running.id}/stop`, {}, t("Stopped. The minutes you didn't use went back in the bank."))}>{t('⏹ Stop and save the rest')}</button>
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {choices.length ? (
            <div className="row">
              <span>{t('Start')}</span>
              {choices.map((m) => <button key={m} className="primary" disabled={busy} onClick={() => void run(`/kids/${memberId}/screen-time/start`, { minutes: m }, t('{n} minutes, go! 🎮', { n: m }))}>{t('{n} min', { n: m })}</button>)}
              {can > 0 && !choices.includes(can) && can < 60 && <button className="primary" disabled={busy} onClick={() => void run(`/kids/${memberId}/screen-time/start`, { minutes: can })}>{can} min</button>}
            </div>
          ) : <p className="small muted" style={{ margin: 0 }}>{v.bank ? t("That's all the screen time for today.") : v.settings.perChorePoint ? t('Chores earn screen time: {n} minutes for each {icon}.', { n: v.settings.perChorePoint, icon }) : t('No minutes in the bank yet.')}</p>}
          {swaps.length > 0 && (
            <div className="row">
              <span className="small">{t('Swap {points}:', { points: home?.pointsName ?? 'points' })}</span>
              {swaps.map((p) => <button key={p} disabled={busy} onClick={() => { if (asParent || confirm(t('Swap {p} {icon} for {m} minutes?', { p, icon, m: p * v.settings.perPoint }))) void run(`/kids/${memberId}/screen-time/swap`, { points: p }, t('+{n} minutes', { n: p * v.settings.perPoint })).then(() => confetti({ count: 40 })); }}>{p} {icon} → {p * v.settings.perPoint} min</button>)}
            </div>
          )}
        </div>
      )}
      {asParent && (
        <div className="row">
          <span className="small muted">Grown-up:</span>
          {[15, 30].map((m) => <button key={m} className="ghost small" onClick={() => void run(`/kids/${memberId}/screen-time/grant`, { minutes: m }, `+${m} minutes`)}>＋{m} min</button>)}
          <button className="ghost small" onClick={() => void run(`/kids/${memberId}/screen-time/grant`, { minutes: -15 }, '−15 minutes')}>−15 min</button>
        </div>
      )}
    </section>
  );
}

export function ScreenTimeCard() {
  const { base, toast } = useApp();
  const [data, reload] = useLoad<{ settings: Settings; kids: ({ id: string; name: string; avatar: string } & View)[] }>(`${base}/screen-time`);
  if (!data) return null;
  const s = data.settings;
  const save = async (patch: Partial<Settings>) => { try { await api(`${base}/screen-time`, { method: 'PUT', body: patch }); await reload(); } catch (e) { toast((e as Error).message); } };
  const num = (label: string, key: keyof Omit<Settings, 'on'>, hint: string) => (
    <label className="field" style={{ minWidth: 180, flex: 1 }}>{label}
      <input type="number" min={0} defaultValue={s[key]} key={`${key}-${s[key]}`} onBlur={(e) => Number(e.target.value) !== s[key] && void save({ [key]: Number(e.target.value) })} />
      <span className="small muted">{hint}</span>
    </label>
  );
  return (
    <div className="card stack" id="screen-time">
      <h2 style={{ margin: 0 }}>📺 Screen-time bank</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Kids earn minutes from chores (or swap points for them) and start a timer on their board. Home Assistant gets
        <code> screen_time_started</code> and <code>screen_time_ended</code> to switch the TV, console or Wi-Fi on and off. See docs/screen-time.md.
      </p>
      <label className="row check-row"><input type="checkbox" checked={s.on} onChange={(e) => void save({ on: e.target.checked })} /> Use the screen-time bank</label>
      {s.on && (
        <>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {num('Minutes per chore point', 'perChorePoint', '0 = chores don\'t earn minutes')}
            {num('Minutes per swapped point', 'perPoint', '0 = no swapping')}
            {num('Most minutes a day', 'dailyMax', '0 = no limit')}
            {num('Most minutes in the bank', 'bankMax', '0 = no limit')}
          </div>
          {data.kids.map((k) => (
            <div key={k.id} className="row">
              <RaccoonAvatar variant={k.avatar} size={36} />
              <strong style={{ flex: 1 }}>{k.name}</strong>
              <span className="small">{k.bank} min in the bank · {k.usedToday} used today{k.session ? ' · 📺 on now' : ''}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
