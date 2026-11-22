// Holiday mode on the boards, the family wall, the parent home and Settings: a countdown with snow, the elf of the day
// and their small kind task, the nice meter and elf log, Santa's sleigh tracker and the North Pole cams. The ideas, the
// elves, the news and the route come from Nordpol Card by DKAnord (MIT); see shared/holiday.ts.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api.ts';
import { useApp, useLoad } from '../state.tsx';
import { Modal } from './Bits.tsx';
import { RaccoonAvatar } from './Raccoon.tsx';
import { SpeakButton } from './Speak.tsx';
import { confetti } from './Confetti.ts';
import { useLang, useT } from '../i18n.tsx';
import {
  HOLIDAY_DEFAULTS, NICE_LEVELS, camClips, camPeriod, countdown, demoMinute, holidayText, mapXY, routePath, sleighAt, sleighMinute,
  sleighRoute, type CamPeriod, type ElfOfDay, type HolidaySettings,
} from '../../../shared/holiday.ts';
import { WORLD_LAND } from '../../../shared/holiday-data.ts';
import { todayIn } from '../../../shared/schedule.ts';

/** What boards and the wall get from the server while Holiday mode is showing. */
export interface HolidayView {
  today: string;
  timezone: string;
  settings: Pick<HolidaySettings, 'day' | 'time' | 'title' | 'snow' | 'elf' | 'nice' | 'sleigh' | 'eta' | 'place' | 'cams' | 'camUrl' | 'camLabels' | 'camLook'>;
}
interface ElfTask { id: string; memberId: string; date: string; task: string; elf: string; points: number; status: 'waiting' | 'done' | 'rejected'; paid: boolean; note: string | null }
interface NiceView {
  score: number; level: number; naughty: number; nicePoints: number;
  /** Under the home's cutoff (naughtyBelow), the kid is on the naughty list. */
  onNaughty: boolean; naughtyBelow: number;
  /** Ledger lines, naughty points (naughty: true) and nice points (nicePoints: true), newest first. */
  log: NiceLine[];
}
interface NiceLine { id: string; date: string; at: string; amount: number; reason: string; naughty: boolean; nicePoints: boolean }
interface KidHoliday {
  elf: (ElfOfDay & { points: number; needsOk: boolean; done: ElfTask | null }) | null;
  nice: NiceView | null;
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A clock that ticks every `ms`, paused while the page is hidden. */
function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') setNow(new Date()); }, ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/** Holiday mode for this home, checked again every ten minutes (so it turns itself on at midnight on the start date). */
export function useHoliday(): HolidayView | null {
  const { base } = useApp();
  const [data, reload] = useLoad<{ holiday: HolidayView | null }>(`${base}/holiday`, [base]);
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, 10 * 60e3);
    return () => window.clearInterval(t);
  }, [reload]);
  return data?.holiday ?? null;
}

// ---------- snow ----------

/** Falling snow over the whole page. Doesn't catch taps, and stays still for people who ask for less motion. */
export function Snow() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || reducedMotion()) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const resize = () => { cv.width = window.innerWidth; cv.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);
    const n = Math.min(90, Math.round((cv.width * cv.height) / 14000));
    const flakes = Array.from({ length: n }, () => ({ x: Math.random() * cv.width, y: Math.random() * cv.height, r: Math.random() * 2.6 + 0.8, s: Math.random() * 0.7 + 0.3, w: Math.random() * 6.28 }));
    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      for (const f of flakes) {
        f.y += f.s * 1.2; f.w += 0.01; f.x += Math.sin(f.w) * 0.4;
        if (f.y > cv.height + 5) { f.y = -5; f.x = Math.random() * cv.width; }
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283); ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} className="holiday-snow" aria-hidden />;
}

// ---------- countdown ----------

/** The countdown to the big day: days, hours, minutes and seconds, or sleeps on the picture board. */
export function HolidayHero({ h, simple = false, compact = false }: { h: HolidayView; simple?: boolean; compact?: boolean }) {
  const t = useT();
  const now = useNow(1000);
  const today = todayIn(h.timezone, now);
  const c = countdown(h.settings, h.timezone, today, now);
  const said = c.party ? t('🎉 Merry Christmas! 🎉')
    : c.sleeps === 0 ? t("It's tonight! 🎅") : c.sleeps === 1 ? t('Only 1 more sleep! 😴') : t('{n} more sleeps', { n: c.sleeps });
  return (
    <section className={`holiday-card holiday-hero${compact ? ' compact' : ''}`} aria-label={h.settings.title}>
      <div className="holiday-hero-title">{h.settings.title}</div>
      {c.party ? (
        <div className="holiday-party">{said}<div className="holiday-sub">{t('Santa has been here. Look under the tree! 🎁')}</div></div>
      ) : simple ? (
        <div className="holiday-sleeps" aria-label={said}>
          <span className="holiday-moons" aria-hidden>{'🌙'.repeat(Math.min(c.sleeps, 10))}{c.sleeps > 10 ? ' …' : ''}</span>
          <strong>{said}</strong>
        </div>
      ) : (
        <>
          <div className="holiday-count" role="timer">
            {([[c.days, t('days')], [c.hours, t('hours')], [c.minutes, t('min')], [c.seconds, t('sec')]] as const).map(([n, label]) => (
              <div key={label} className="holiday-unit"><span className="holiday-num">{String(n).padStart(2, '0')}</span><span className="holiday-sub">{label}</span></div>
            ))}
          </div>
          <div className="holiday-sub" style={{ textAlign: 'center' }}>{said}</div>
        </>
      )}
    </section>
  );
}

// ---------- elf of the day ----------

function ElfCard({ memberId, elf, asParent, readAloud, onChange }: { memberId: string; elf: NonNullable<KidHoliday['elf']>; asParent: boolean; readAloud: boolean; onChange: () => void }) {
  const t = useT();
  const { base, toast, home } = useApp();
  const [answer, setAnswer] = useState(false);
  const [busy, setBusy] = useState(false);
  const done = elf.done;
  const tick = async () => {
    setBusy(true);
    try {
      const r = await api<{ task: ElfTask; paid: number }>(`${base}/kids/${memberId}/holiday/elf`, { body: {} });
      if (r.task.status === 'done') confetti();
      toast(r.task.status === 'waiting' ? t('Nice work! Sent to a grown-up.') : r.paid ? `🧝 +${r.paid} ${home?.pointsIcon ?? ''}` : t('The elves saw that! ⭐'));
      onChange();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const undo = async () => {
    try { await api(`${base}/kids/${memberId}/holiday/elf`, { method: 'DELETE' }); onChange(); } catch (e) { toast((e as Error).message); }
  };
  const say = `${elf.name}. ${elf.joke.question} ${elf.joke.answer} ${t('Elf task of the day:')} ${elf.task}`;
  return (
    <section className="holiday-card stack" aria-label={t('🧝 Elf of the day')}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <h2 className="holiday-h" style={{ flex: 1 }}>{t('🧝 Elf of the day')}</h2>
        {readAloud && <SpeakButton text={say} />}
      </div>
      <div className="holiday-elf">
        <span className="holiday-elf-face" aria-hidden>🧝</span>
        <div style={{ minWidth: 0 }}>
          <div className="holiday-elf-name">{elf.name}</div>
          <div className="holiday-sub">{elf.trial ? t('Trial elf (the real elves arrive on the 1st)') : t('On duty today, day {n}', { n: elf.dayOfMonth ?? '' })}</div>
        </div>
      </div>
      <button type="button" className="holiday-joke" onClick={() => setAnswer((a) => !a)} aria-expanded={answer}>
        <span>😂 {elf.joke.question}</span>
        <strong>{answer ? elf.joke.answer : t('(tap for the answer)')}</strong>
      </button>
      <div className="holiday-task">
        <div className="holiday-sub">{t('Elf task of the day:')}</div>
        <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>✨ {elf.task}{elf.points > 0 && <span className="holiday-points"> +{elf.points} {home?.pointsIcon ?? ''}</span>}</div>
        {done?.status === 'done' ? <span className="pill ok" style={{ alignSelf: 'flex-start' }}>{t('✓ Done! The elves are proud.')}</span>
          : done?.status === 'waiting' ? (
            <div className="row">
              <span className="pill warn">{t('Waiting for a grown-up')}</span>
              {!asParent && <button className="ghost" onClick={() => void undo()}>{t('Not yet')}</button>}
            </div>
          ) : (
            <>
              {done?.status === 'rejected' && <span className="small">🙈 {done.note ?? t('Try again')}</span>}
              <button className="primary holiday-btn" disabled={busy} onClick={() => void tick()}>{t('🧝 I did it!')}</button>
            </>
          )}
      </div>
    </section>
  );
}

// ---------- nice meter ----------

const NICE_EMOJI = ['📣', '👀', '🙂', '⭐', '🌟'];

/**
 * The meter's fill. Its red-to-green colors are pinned to the whole track, not stretched over the fill, so a low score
 * stays red and only a high score reaches green.
 */
const meterFill = (score: number) => ({
  width: `${score}%`,
  backgroundSize: `auto, ${score > 0 ? 10000 / score : 100}% 100%`,
});

/** Which list a kid is on, as a badge beside their name. */
function ListBadge({ onNaughty }: { onNaughty: boolean }) {
  const t = useT();
  return <span className={`list-badge ${onNaughty ? 'naughty' : 'nice'}`}>{t(onNaughty ? '😈 Naughty' : '😇 Nice')}</span>;
}

/** Where the naughty list ends on a meter, as a thin line. */
function NaughtyLine({ below }: { below: number }) {
  if (below <= 0 || below >= 100) return null;
  return <span className="holiday-meter-cut" style={{ left: `${below}%` }} title={`Under ${below} is the naughty list`} aria-hidden />;
}

type MarkKind = 'naughty' | 'nice';
/** Naughty points take a few off the nice meter, nice points add a few. Neither ever touches the kid's points. */
const MARKS: Record<MarkKind, { emoji: string; label: string; sign: string; verb: (n: number) => string; done: (n: number) => string; back: string }> = {
  naughty: { emoji: '😈', label: 'Naughty points', sign: '−', verb: (n) => `Take ${n} off the nice list`, done: (n) => `😈 −${n} on the nice list`, back: 'Naughty points taken back' },
  nice: { emoji: '😇', label: 'Nice points', sign: '+', verb: (n) => `Add ${n} to the nice list`, done: (n) => `😇 +${n} on the nice list`, back: 'Nice points taken back' },
};
const MARK_PICKS = [1, 2, 3, 5, 10];
/** Which kind of mark an elf log line is, or null for a points ledger line. */
const markOf = (e: NiceLine): MarkKind | null => (e.naughty ? 'naughty' : e.nicePoints ? 'nice' : null);

/** A grown-up's naughty or nice points: a few points off (or onto) the nice meter, with a reason. The kid's points don't change. */
function MarkForm({ kind, memberId, onDone }: { kind: MarkKind; memberId: string; onDone: () => void }) {
  const { base, toast } = useApp();
  const m = MARKS[kind];
  const [points, setPoints] = useState(3);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const give = async () => {
    setBusy(true);
    try {
      await api(`${base}/kids/${memberId}/holiday/${kind}`, { body: { points, reason } });
      toast(m.done(points));
      setReason('');
      onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className={`holiday-${kind} stack`}>
      <div className="holiday-sub">
        {kind === 'naughty'
          ? '😈 Naughty points come off the nice list only. Points, allowance and stats stay the same.'
          : '😇 Nice points go on the nice list only. Points, allowance and stats stay the same.'}
      </div>
      <div className="row">
        {MARK_PICKS.map((n) => (
          <button key={n} type="button" className={points === n ? 'primary' : 'ghost'} aria-pressed={points === n} onClick={() => setPoints(n)}>{m.sign}{n}</button>
        ))}
      </div>
      <input type="text" maxLength={120} value={reason} placeholder="Why? (the kid sees this in the elf log)" aria-label="Why?"
        onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void give(); }} />
      <button className="primary" disabled={busy} onClick={() => void give()}>{m.emoji} {m.verb(points)}</button>
    </div>
  );
}

export function NiceMeter({ nice, compact = false, memberId, asParent = false, onChange }: {
  nice: NiceView; compact?: boolean; memberId?: string; asParent?: boolean; onChange?: () => void;
}) {
  const t = useT();
  const { base, home, toast } = useApp();
  const [open, setOpen] = useState<MarkKind | null>(null);
  const canMark = asParent && !compact && !!memberId;
  const takeBack = async (kind: MarkKind, id: string) => {
    try { await api(`${base}/holiday/${kind}/${id}`, { method: 'DELETE' }); toast(MARKS[kind].back); onChange?.(); }
    catch (e) { toast((e as Error).message); }
  };
  const toggle = (kind: MarkKind) => setOpen((v) => (v === kind ? null : kind));
  return (
    <section className={`holiday-card stack${compact ? ' compact' : ''}`} aria-label={t(nice.onNaughty ? '😈 Naughty list' : '⭐ Nice list')}>
      <div className="row">
        <h2 className="holiday-h" style={{ whiteSpace: 'nowrap' }}>{t(nice.onNaughty ? '😈 Naughty list' : '⭐ Nice list')}</h2>
        <ListBadge onNaughty={nice.onNaughty} />
        <span style={{ flex: 1 }} />
        {canMark && (['nice', 'naughty'] as const).map((kind) => (
          <button key={kind} className="ghost nice-naughty-btn" aria-expanded={open === kind} title={MARKS[kind].label} aria-label={MARKS[kind].label}
            onClick={() => toggle(kind)}>{MARKS[kind].emoji}</button>
        ))}
      </div>
      <div className="holiday-meter" role="meter" aria-valuenow={nice.score} aria-valuemin={0} aria-valuemax={100} aria-label={t(NICE_LEVELS[nice.level])}>
        <i style={meterFill(nice.score)} />
        <NaughtyLine below={nice.naughtyBelow} />
        <span className="holiday-meter-pin" style={{ left: `${nice.score}%` }} aria-hidden>{nice.onNaughty ? '😈' : NICE_EMOJI[nice.level]}</span>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{t(NICE_LEVELS[nice.level])}</strong>
        <span className="holiday-sub">{nice.score} / 100</span>
      </div>
      {canMark && open && <MarkForm key={open} kind={open} memberId={memberId} onDone={() => { setOpen(null); onChange?.(); }} />}
      {!compact && nice.log.length > 0 && (
        <div className="holiday-log">
          <div className="holiday-sub">{t('📜 Elf log')}</div>
          {nice.log.map((e) => {
            const mk = markOf(e);
            return (
              <div key={e.id} className="row small" style={{ flexWrap: 'nowrap' }}>
                <span style={{ flex: 1, minWidth: 0 }}>{mk ? `${MARKS[mk].emoji} ${e.reason || t(MARKS[mk].label)}` : e.reason}</span>
                <strong className={e.amount > 0 ? 'holiday-plus' : 'holiday-minus'}>
                  {e.amount > 0 ? '+' : ''}{e.amount} {mk ? '⭐' : home?.pointsIcon ?? ''}
                </strong>
                {canMark && mk && (
                  <button className="ghost holiday-undo" aria-label={`Take these ${MARKS[mk].label.toLowerCase()} back`} title="Take back" onClick={() => void takeBack(mk, e.id)}>✕</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------- sleigh tracker ----------

/** Hold a button down for a moment. */
function useLongPress(ms: number, fn: () => void) {
  const timer = useRef<number | null>(null);
  const stop = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; } };
  return {
    onPointerDown: () => { stop(); timer.current = window.setTimeout(() => { timer.current = null; fn(); }, ms); },
    onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}

export function SleighTracker({ h, compact = false }: { h: HolidayView; compact?: boolean }) {
  const t = useT();
  const lang = useLang();
  const text = holidayText(lang);
  const now = useNow(compact ? 5000 : 1000);
  const today = todayIn(h.timezone, now);
  const route = useMemo(() => sleighRoute(h.settings, h.timezone, today, lang), [h.settings, h.timezone, today, lang]);
  const [demo, setDemo] = useState<number | null>(null);
  const [, force] = useState(0);
  useEffect(() => {
    if (demo == null) return;
    const i = window.setInterval(() => force((n) => n + 1), 200);
    return () => window.clearInterval(i);
  }, [demo]);
  const press = useLongPress(900, () => setDemo((d) => (d == null ? Date.now() : null)));

  let min = sleighMinute(route, now);
  if (demo != null) {
    const m = demoMinute(route, (Date.now() - demo) / 1000);
    if (m > route.stops[route.stops.length - 1].t + 10) window.setTimeout(() => setDemo(null), 0);
    else min = m;
  }
  const p = sleighAt(route, min);
  const live = demo != null || p.state === 'pre' || p.state === 'fly' || p.state === 'done';
  const R = route.stops;
  const [sx, sy] = live ? mapXY(p.lat, p.lon) : mapXY(R[0].lat, R[0].lon);
  const donePts: [number, number][] = live && p.state !== 'pre' ? [...R.slice(0, p.i + 1).map((s) => [s.lat, s.lon] as [number, number]), ...(p.state === 'fly' ? [[p.lat, p.lon] as [number, number]] : [])] : [];
  const home = R.find((s) => s.home)!;
  const nightLabel = new Date(`${route.night}T12:00:00Z`).toLocaleDateString(lang, { month: 'long', day: 'numeric', timeZone: 'UTC' });
  const eta = new Date(Date.parse(`${route.night}T00:00:00Z`) + route.homeT * 60e3).toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit', timeZone: h.timezone });
  const stopName = (i: number) => (R[i].northPole ? t('North Pole') : R[i].home ? route.homeName : R[i].name);

  let info: ReactNode;
  if (!live) {
    // Parked at the North Pole: the workshop status, filling up as the night gets closer.
    const after = p.state === 'after' && min < R[R.length - 1].t + 7 * 1440;
    const q = Math.max(0.03, Math.min(0.995, 1 - (route.homeT - min) / (53 * 1440)));
    const values = [20 + 79 * q, 35 + 64 * Math.min(1, q * 1.2), 50 + 49 * q, 10 + 88 * q * q, 5 + 94 * q].map(Math.round);
    const rows = after ? text.afterRows.map((k) => [k, 100] as const) : text.rows.map((k, i) => [k, values[i]] as const);
    const news = text.news[(now.getDate() * 24 + now.getHours()) % text.news.length];
    info = (
      <>
        {!compact && (
          <div className="sleigh-rows">
            {rows.map(([k, v]) => (
              <div key={k} className="sleigh-row"><span>{k}</span><div className="sleigh-bar"><i style={{ width: `${v}%` }} /></div><b>{v}%</b></div>
            ))}
          </div>
        )}
        <div className="sleigh-big">{after ? t('🎅 Santa is back home sleeping in. Thanks for this year! 💤') : `🛠️ ${news}`}</div>
        {!after && <div className="holiday-sub">{t('🛷 The sleigh is parked at the North Pole. On {date} you can follow it here. It should reach {home} around {eta}.', { date: nightLabel, home: route.homeName, eta })}</div>}
      </>
    );
  } else {
    const toHome = p.toHome;
    const where = p.state === 'pre' ? t('🛷 The sleigh is being loaded at the North Pole…')
      : p.state === 'done' ? t('🏁 Santa is back at the North Pole. Good night! 💤')
        : toHome <= 1 && toHome > -20 ? t('🎅🏠 Santa is at {home} right now! Look out the window ✨', { home: route.homeName })
          : p.f < 0.15 ? t('📍 Santa is landing in {a}', { a: stopName(p.i) })
            : t('✈️ Flying from {a} to {b}', { a: stopName(p.i), b: stopName(p.i + 1) });
    const etaText = toHome > 60 ? t('in {h} h {m} min', { h: Math.floor(toHome / 60), m: Math.floor(toHome % 60) })
      : toHome > 5 ? t('in {m} min!', { m: Math.ceil(toHome) }) : toHome > -20 ? t('NOW! 👀') : t('Already been here ✔');
    info = (
      <>
        <div className="sleigh-big">{where}<div className="holiday-sub">🎁 {t('{n} million presents', { n: p.presents.toLocaleString(lang) })} · 🦌 {t('Rudolph: shining bright')}</div></div>
        <div className="sleigh-eta"><span>🏠 {route.homeName}</span><span>{etaText}</span></div>
      </>
    );
  }

  return (
    <section className={`holiday-card stack sleigh${compact ? ' compact' : ''}`}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <h2 className="holiday-h" style={{ flex: 1, userSelect: 'none' }} {...press}>{t('🛷 Sleigh tracker')}</h2>
        <span className="holiday-sub">{demo != null ? t('TEST FLIGHT') : live ? t('LIVE') : t('Elf radar')}</span>
      </div>
      <div className="sleigh-map">
        <svg viewBox="0 0 360 180" preserveAspectRatio="none" role="img" aria-label={t('🛷 Sleigh tracker')}>
          {Array.from({ length: 13 }, (_, i) => <line key={`x${i}`} x1={i * 30} y1={0} x2={i * 30} y2={180} className="sleigh-grid" />)}
          {Array.from({ length: 7 }, (_, i) => <line key={`y${i}`} x1={0} y1={i * 30} x2={360} y2={i * 30} className="sleigh-grid" />)}
          <path d={WORLD_LAND} className="sleigh-land" />
          <path d={routePath(R.map((s) => [s.lat, s.lon]))} className="sleigh-route" />
          {donePts.length > 1 && <path d={routePath(donePts)} className="sleigh-done" />}
          {R.filter((s) => !s.northPole).map((s, i) => {
            const [x, y] = mapXY(s.lat, s.lon);
            return <circle key={i} cx={x} cy={y} r={s.home ? 2.6 : 1.4} className={s.home ? 'sleigh-home' : 'sleigh-stop'} />;
          })}
          <text x={mapXY(home.lat, home.lon)[0] + 3} y={mapXY(home.lat, home.lon)[1] - 3} className="sleigh-label">{route.homeName}</text>
          <g transform={`translate(${sx},${sy})`}>
            <circle r={6} className="sleigh-glow" />
            <text fontSize={12} textAnchor="middle" dy={4}>🛷</text>
          </g>
        </svg>
      </div>
      {info}
      {!compact && (
        <button className="ghost small" style={{ alignSelf: 'flex-end' }} onClick={() => setDemo((d) => (d == null ? Date.now() : null))}>
          {demo != null ? t('⏹ Stop the test flight') : t('✈️ Test flight')}
        </button>
      )}
    </section>
  );
}

// ---------- North Pole cams ----------

/** TV static for a cam that can't play. */
function Static() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const draw = () => {
      if (document.visibilityState !== 'visible') return;
      const img = ctx.createImageData(cv.width, cv.height);
      for (let i = 0; i < img.data.length; i += 4) { const v = (Math.random() * 255) | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      ctx.putImageData(img, 0, 0);
    };
    draw();
    if (reducedMotion()) return;
    const i = window.setInterval(draw, 90);
    return () => window.clearInterval(i);
  }, []);
  return <canvas ref={ref} width={96} height={54} className="cam-static" aria-hidden />;
}

function CamTile({ src, label, clock, look, onOpen }: { src: string; label: string; clock: string; look: 'minimal' | 'cctv'; onOpen?: () => void }) {
  const t = useT();
  const [lost, setLost] = useState(false);
  useEffect(() => { setLost(false); }, [src]);
  return (
    <button type="button" className={`cam-tile ${look}`} onClick={onOpen} disabled={!onOpen} aria-label={label}>
      {lost ? <Static /> : <video src={src} muted playsInline loop autoPlay preload="auto" onError={() => setLost(true)} />}
      {look === 'cctv' && <span className="cam-scan" aria-hidden />}
      <span className="cam-rec"><i />REC</span>
      <span className="cam-clock">{clock}</span>
      <span className="cam-label">{label}</span>
      {lost && <span className="cam-lost">{t('⚠ SIGNAL LOST')}<small>{t('reconnecting…')}</small></span>}
    </button>
  );
}

export function CamWall({ h, compact = false }: { h: HolidayView; compact?: boolean }) {
  const t = useT();
  const now = useNow(1000);
  const [open, setOpen] = useState<number | null>(null);
  const local = Number(new Intl.DateTimeFormat('en-GB', { timeZone: h.timezone, hour: '2-digit', hourCycle: 'h23' }).format(now)) * 60
    + Number(new Intl.DateTimeFormat('en-GB', { timeZone: h.timezone, minute: '2-digit' }).format(now));
  const period: CamPeriod = camPeriod(local);
  const clips = camClips(h.settings, period);
  const clock = new Intl.DateTimeFormat(undefined, { timeZone: h.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now);
  const periodLabel = { morning: t('🌅 morning'), day: t('☀️ day'), evening: t('🌙 evening') }[period];
  if (!clips.length) return null;
  return (
    <section className={`holiday-card stack${compact ? ' compact' : ''}`}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <h2 className="holiday-h" style={{ flex: 1 }}>{t('📹 North Pole cams')}</h2>
        <span className="holiday-sub">{t('● LIVE')} · {periodLabel}</span>
      </div>
      <div className="cam-grid">
        {clips.map((src, i) => <CamTile key={src} src={src} label={h.settings.camLabels[i]} clock={clock} look={h.settings.camLook} onOpen={() => setOpen(i)} />)}
      </div>
      {!compact && <div className="holiday-sub" style={{ textAlign: 'center' }}>{t('🔒 Secret elf cam · nice kids only')}</div>}
      {open != null && (
        <Modal wide onClose={() => setOpen(null)}>
          <div className="cam-full">
            <CamTile src={clips[open]} label={h.settings.camLabels[open]} clock={clock} look={h.settings.camLook} />
            <button className="ghost" onClick={() => setOpen(null)}>{t('Close')}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

// ---------- on a kid's board ----------

export function KidHoliday({ memberId, simple, readAloud, asParent }: { memberId: string; simple: boolean; readAloud: boolean; asParent: boolean }) {
  const t = useT();
  const { base } = useApp();
  const h = useHoliday();
  const [data, reload] = useLoad<{ holiday: KidHoliday | null }>(h ? `${base}/kids/${memberId}/holiday` : null, [base, memberId, !!h]);
  const [show, setShow] = useState<'sleigh' | 'cams' | null>(null);
  const close = useCallback(() => setShow(null), []);
  if (!h) return null;
  const k = data?.holiday;
  return (
    <>
      {h.settings.snow && <Snow />}
      <HolidayHero h={h} simple={simple} />
      {k && (k.elf || k.nice) && (
        <div className="grid-2">
          {k.elf && <ElfCard memberId={memberId} elf={k.elf} asParent={asParent} readAloud={readAloud} onChange={() => void reload()} />}
          {k.nice && <NiceMeter nice={k.nice} memberId={memberId} asParent={asParent} onChange={() => void reload()} />}
        </div>
      )}
      {(h.settings.sleigh || h.settings.cams !== 'off') && (
        <div className="row holiday-buttons">
          {h.settings.sleigh && <button className="holiday-btn" onClick={() => setShow('sleigh')}>{t('🛷 Where is Santa?')}</button>}
          {h.settings.cams !== 'off' && <button className="holiday-btn" onClick={() => setShow('cams')}>{t('📹 North Pole cams')}</button>}
        </div>
      )}
      {show && (
        <Modal wide onClose={close}>
          <div className="stack">
            {show === 'sleigh' ? <SleighTracker h={h} /> : <CamWall h={h} />}
            <button className="ghost" style={{ alignSelf: 'flex-end' }} onClick={close}>{t('Close')}</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------- on the family wall ----------

/** The wall's holiday row: the countdown, and the sleigh on the big night or the cams the rest of the time. */
export function WallHoliday({ h }: { h: HolidayView | null | undefined }) {
  const now = useNow(60e3);
  if (!h) return null;
  const today = todayIn(h.timezone, now);
  const route = h.settings.sleigh ? sleighRoute(h.settings, h.timezone, today) : null;
  const min = route ? sleighMinute(route, now) : 0;
  // The sleigh takes over from a few hours before take-off until it's home.
  const bigNight = !!route && min > route.stops[0].t - 240 && min < route.stops[route.stops.length - 1].t + 30;
  return (
    <section className="wall-holiday">
      {h.settings.snow && <Snow />}
      <HolidayHero h={h} compact />
      {bigNight || (h.settings.sleigh && h.settings.cams === 'off') ? <SleighTracker h={h} compact /> : h.settings.cams !== 'off' ? <CamWall h={h} compact /> : null}
    </section>
  );
}

/** A kid's nice meter on their wall card, as a small line. */
export function WallNice({ nice }: { nice: { score: number; level: number; onNaughty?: boolean } | null | undefined }) {
  const t = useT();
  if (!nice) return null;
  return <div className="wall-note">{nice.onNaughty ? '😈' : NICE_EMOJI[nice.level]} {t(nice.onNaughty ? 'Naughty list' : 'Nice list')}: {nice.score}%</div>;
}

// ---------- the parent home ----------

export function HolidayReviewCard() {
  const { base, toast, home } = useApp();
  const [items, reload] = useLoad<(ElfTask & { kid: { name: string; avatar: string; color: string } })[]>(`${base}/holiday/waiting`);
  if (!items?.length) return null;
  const act = async (e: ElfTask, ok: boolean) => {
    try {
      if (ok) {
        const r = await api<{ paid: number }>(`${base}/holiday/elf/${e.id}/approve`, { body: {} });
        toast(`🧝 ${e.task}: approved${r.paid ? `, +${r.paid} ${home?.pointsIcon ?? ''}` : ''}`);
      } else {
        const note = prompt('A kind note for the kid (optional)', 'Let me see it first!');
        if (note === null) return;
        await api(`${base}/holiday/elf/${e.id}/reject`, { body: { note } });
      }
      await reload();
    } catch (err) { toast((err as Error).message); }
  };
  return (
    <section className="card stack review-card has-items">
      <h2 style={{ margin: 0 }}>🧝 Elf tasks to check <span className="pill">{items.length}</span></h2>
      {items.map((e) => (
        <div key={e.id} className="list-item">
          <RaccoonAvatar variant={e.kid.avatar} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{e.task}</div>
            <div className="small muted">{e.kid.name} · {e.elf}{e.points ? ` · +${e.points} ${home?.pointsIcon ?? ''}` : ''}</div>
          </div>
          <button className="ghost" onClick={() => void act(e, false)}>Not yet</button>
          <button className="primary" onClick={() => void act(e, true)}>Approve</button>
        </div>
      ))}
    </section>
  );
}

/** The family Nice list: every kid's bar, 😇 and 😈 buttons each for nice and naughty points, and one elf log with names. */
export function FamilyNiceList() {
  const { base, home, toast } = useApp();
  const h = useHoliday();
  const [data, reload] = useLoad<{ nice: { naughtyBelow: number; kids: { id: string; name: string; avatar: string; color: string; score: number; level: number; onNaughty: boolean; naughty: number; nicePoints: number }[]; log: (NiceLine & { kid: string })[] } | null }>(
    h?.settings.nice ? `${base}/holiday/nice` : null, [base, !!h?.settings.nice]);
  const [marking, setMarking] = useState<{ id: string; kind: MarkKind } | null>(null);
  const nice = data?.nice;
  if (!h || !nice?.kids.length) return null;
  const takeBack = async (kind: MarkKind, id: string) => {
    try { await api(`${base}/holiday/${kind}/${id}`, { method: 'DELETE' }); toast(MARKS[kind].back); await reload(); }
    catch (e) { toast((e as Error).message); }
  };
  const isOpen = (id: string, kind: MarkKind) => marking?.id === id && marking.kind === kind;
  return (
    <section className="holiday-card stack" aria-label="Nice list">
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <h2 className="holiday-h" style={{ flex: 1 }}>⭐ Nice list</h2>
        <span className="holiday-sub">Santa's notebook</span>
      </div>
      {nice.kids.map((k) => (
        <div key={k.id} className="nice-kid">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <RaccoonAvatar variant={k.avatar} size={48} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                <span className="row" style={{ gap: 8, flexWrap: 'nowrap', minWidth: 0 }}>
                  <strong className="nice-kid-name">{k.name}</strong>
                  <ListBadge onNaughty={k.onNaughty} />
                </span>
                <span className={`nice-label nice-l${k.level}`}>{NICE_LEVELS[k.level]}</span>
              </div>
              <div className="holiday-meter" role="meter" aria-valuenow={k.score} aria-valuemin={0} aria-valuemax={100} aria-label={`${k.name}: ${NICE_LEVELS[k.level]}`}>
                <i style={meterFill(k.score)} />
                <NaughtyLine below={nice.naughtyBelow} />
                <span className="holiday-meter-pin" style={{ left: `${k.score}%` }} aria-hidden>{k.onNaughty ? '😈' : '⭐'}</span>
              </div>
            </div>
            {(['nice', 'naughty'] as const).map((kind) => (
              <button key={kind} className="ghost nice-naughty-btn" aria-expanded={isOpen(k.id, kind)}
                title={`${MARKS[kind].label} for ${k.name}`} aria-label={`${MARKS[kind].label} for ${k.name}`}
                onClick={() => setMarking(isOpen(k.id, kind) ? null : { id: k.id, kind })}>{MARKS[kind].emoji}</button>
            ))}
          </div>
          {marking?.id === k.id && <MarkForm key={marking.kind} kind={marking.kind} memberId={k.id} onDone={() => { setMarking(null); void reload(); }} />}
        </div>
      ))}
      {nice.log.length > 0 && (
        <div className="holiday-log">
          <div className="holiday-sub">📜 Elf log</div>
          {nice.log.map((e) => {
            const mk = markOf(e);
            return (
              <div key={e.id} className="row small" style={{ flexWrap: 'nowrap' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {mk ? MARKS[mk].emoji : '✏️'} {e.kid}{' '}
                  <strong className={e.amount > 0 ? 'holiday-plus' : 'holiday-minus'}>{e.amount > 0 ? '+' : ''}{e.amount}{mk ? ' ⭐' : ` ${home?.pointsIcon ?? ''}`}</strong>
                  : {e.reason || (mk ? MARKS[mk].label : '')}
                </span>
                {mk && <button className="ghost holiday-undo" aria-label={`Take back ${e.kid}'s ${MARKS[mk].label.toLowerCase()}`} title="Take back" onClick={() => void takeBack(mk, e.id)}>✕</button>}
              </div>
            );
          })}
        </div>
      )}
      <div className="holiday-sub">
        {nice.naughtyBelow > 0 ? `Under ${nice.naughtyBelow} is the naughty list. ` : ''}😇 adds to the nice meter and 😈 takes off it. Points, allowance and stats never change.
      </div>
    </section>
  );
}

// ---------- Settings ----------

export function HolidaySettingsCard() {
  const { base, toast, home } = useApp();
  const [data, reload] = useLoad<{ settings: HolidaySettings; activeToday: boolean; today: string }>(`${base}/holiday-settings`);
  const [draft, setDraft] = useState<HolidaySettings | null>(null);
  const [preview, setPreview] = useState<'sleigh' | 'cams' | null>(null);
  useEffect(() => { if (data) setDraft(data.settings); }, [data]);
  if (!data || !draft) return null;
  const s = draft;
  const set = (patch: Partial<HolidaySettings>) => setDraft({ ...s, ...patch });
  const save = async (next: HolidaySettings = s) => {
    try {
      const r = await api<{ activeToday: boolean }>(`${base}/holiday-settings`, { method: 'PUT', body: next });
      toast(next.mode === 'off' ? 'Holiday mode is off' : r.activeToday ? 'Holiday mode is on 🎄' : 'Saved. Holiday mode turns itself on on the start date 🎄');
      await reload();
    } catch (e) { toast((e as Error).message); }
  };
  const locate = () => {
    if (!navigator.geolocation) { toast("This device can't share its location"); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => set({ place: { name: s.place?.name ?? 'Home', lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 } }),
      () => toast("Couldn't get this device's location. Type it in instead."),
    );
  };
  const view: HolidayView = { today: data.today, timezone: home?.timezone ?? 'UTC', settings: s };
  return (
    <div className="card stack" id="holiday">
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>🎄 Holiday mode</h2>
        <span className={`pill${data.activeToday ? ' ok' : ''}`}>{data.activeToday ? 'Showing today' : 'Not showing today'}</span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        A Christmas countdown with snow, an elf of the day with a joke and a small kind task, a nice list meter, Santa's sleigh tracker on
        the big night and the North Pole cams, on every kid's board and the family wall. Ideas, elves and route from{' '}
        <a href="https://github.com/DKAnord/nordpol-card" target="_blank" rel="noreferrer">Nordpol Card</a>.
      </p>
      <div className="chips" role="radiogroup" aria-label="When Holiday mode shows">
        {([['off', 'Off'], ['on', 'On now'], ['dates', 'On between dates']] as const).map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={s.mode === id} className={`chip${s.mode === id ? ' on' : ''}`} onClick={() => set({ mode: id })}>{label}</button>
        ))}
      </div>
      {s.mode === 'dates' && (
        <div className="row">
          <label className="stack small" style={{ gap: 4 }}>Turns on<input type="date" value={s.from ?? ''} onChange={(e) => set({ from: e.target.value || null })} /></label>
          <label className="stack small" style={{ gap: 4 }}>Turns off after<input type="date" value={s.to ?? ''} onChange={(e) => set({ to: e.target.value || null })} /></label>
          <button type="button" className="ghost" onClick={() => {
            const y = Number(data.today.slice(0, 4));
            set({ from: `${y}-12-01`, to: `${y + 1}-01-01` });
          }}>Dec 1 to Jan 1</button>
        </div>
      )}
      {s.mode !== 'off' && (
        <>
          <h3 style={{ margin: '6px 0 0' }}>⏳ Countdown</h3>
          <div className="row">
            <label className="stack small" style={{ gap: 4, flex: 2, minWidth: 180 }}>Title<input value={s.title} maxLength={60} onChange={(e) => set({ title: e.target.value })} /></label>
            <label className="stack small" style={{ gap: 4 }}>The big day
              <input type="date" value={`${data.today.slice(0, 4)}-${s.day}`} onChange={(e) => e.target.value && set({ day: e.target.value.slice(5) })} />
            </label>
            <label className="stack small" style={{ gap: 4 }}>Counts down to<input type="time" value={s.time} onChange={(e) => e.target.value && set({ time: e.target.value })} /></label>
          </div>
          <label className="row small check-row"><input type="checkbox" checked={s.snow} onChange={(e) => set({ snow: e.target.checked })} /> ❄️ Falling snow</label>

          <h3 style={{ margin: '6px 0 0' }}>🧝 Elf of the day</h3>
          <label className="row small check-row"><input type="checkbox" checked={s.elf} onChange={(e) => set({ elf: e.target.checked })} /> Show an elf with a joke and a small kind task each day (30 elves, one per day of December)</label>
          {s.elf && (
            <div className="row">
              <label className="row small">Points for the task
                <input type="number" min={0} max={100} value={s.elfPoints} style={{ width: 80 }} onChange={(e) => set({ elfPoints: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} />
              </label>
              <label className="row small check-row"><input type="checkbox" checked={s.elfNeedsOk} onChange={(e) => set({ elfNeedsOk: e.target.checked })} /> A grown-up checks it first</label>
            </div>
          )}

          <h3 style={{ margin: '6px 0 0' }}>⭐ Nice list</h3>
          <label className="row small check-row"><input type="checkbox" checked={s.nice} onChange={(e) => set({ nice: e.target.checked })} /> Show a nice meter and elf log on each board and the wall</label>
          {s.nice && (
            <label className="row small">😈 Naughty list below
              <input type="number" min={0} max={100} value={s.naughtyBelow} style={{ width: 80 }}
                onChange={(e) => set({ naughtyBelow: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} />
              <span className="muted">out of 100 (0 = no naughty list)</span>
            </label>
          )}
          {s.nice && <p className="small muted" style={{ margin: 0 }}>It reads the points ledger: chores done over the last two weeks make most of it, bonus chores, quick rewards and elf tasks push it up, penalties pull it down a little. You can also give nice or naughty points from the Nice list on the parent home or a kid's board: each nice point adds one to the nice meter and each naughty point takes one off, for two weeks, with a reason the kid sees, and never touches their points, allowance or stats.</p>}

          <h3 style={{ margin: '6px 0 0' }}>🛷 Sleigh tracker</h3>
          <label className="row small check-row"><input type="checkbox" checked={s.sleigh} onChange={(e) => set({ sleigh: e.target.checked })} /> Follow Santa across the world on the night before the big day</label>
          {s.sleigh && (
            <div className="row">
              <label className="stack small" style={{ gap: 4 }}>Reaches home at<input type="time" value={s.eta} onChange={(e) => e.target.value && set({ eta: e.target.value })} /></label>
              <label className="stack small" style={{ gap: 4 }}>Place name<input value={s.place?.name ?? ''} placeholder="Home" maxLength={40} style={{ width: 140 }}
                onChange={(e) => set({ place: { lat: s.place?.lat ?? 40, lon: s.place?.lon ?? -75, name: e.target.value } })} /></label>
              <label className="stack small" style={{ gap: 4 }}>Latitude<input type="number" step="0.01" value={s.place?.lat ?? ''} style={{ width: 100 }}
                onChange={(e) => set({ place: { name: s.place?.name || 'Home', lon: s.place?.lon ?? 0, lat: Number(e.target.value) } })} /></label>
              <label className="stack small" style={{ gap: 4 }}>Longitude<input type="number" step="0.01" value={s.place?.lon ?? ''} style={{ width: 100 }}
                onChange={(e) => set({ place: { name: s.place?.name || 'Home', lat: s.place?.lat ?? 0, lon: Number(e.target.value) } })} /></label>
              <button type="button" className="ghost" onClick={locate}>📍 Use this device's location</button>
            </div>
          )}
          {s.sleigh && !s.place && <p className="small muted" style={{ margin: 0 }}>No place yet: the sleigh lands somewhere on your time zone. Rounded to a town, it's only kept on your server.</p>}

          <h3 style={{ margin: '6px 0 0' }}>📹 North Pole cams</h3>
          <div className="chips" role="radiogroup" aria-label="North Pole cams">
            {([['hosted', 'Stream the scenes'], ['local', 'My own copies'], ['off', 'No cams']] as const).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={s.cams === id} className={`chip${s.cams === id ? ' on' : ''}`} onClick={() => set({ cams: id })}>{label}</button>
            ))}
          </div>
          {s.cams === 'hosted' && (
            <p className="small muted" style={{ margin: 0 }}>
              Twelve looping scenes (four cams, morning, day and evening) play straight from Nordpol Card's release on GitHub. They aren't copied into
              Den Duty; they're AI-made clips its author shares for personal family dashboards, so keep them at home.
            </p>
          )}
          {s.cams === 'local' && (
            <>
              <label className="stack small" style={{ gap: 4 }}>Where the clips are
                <input value={s.camUrl} onChange={(e) => set({ camUrl: e.target.value })} placeholder={HOLIDAY_DEFAULTS.camUrl} />
              </label>
              <p className="small muted" style={{ margin: 0 }}>
                Put <code>cam1_morning.mp4</code> … <code>cam4_evening.mp4</code> in a <code>holiday-cams</code> folder inside Den Duty's data folder and
                restart, then leave this as <code>/holiday-cams</code>. Or point it at any web address that has them.
              </p>
            </>
          )}
          {s.cams !== 'off' && (
            <div className="row">
              {s.camLabels.map((l, i) => (
                <input key={i} value={l} maxLength={40} aria-label={`Cam ${i + 1} name`} style={{ flex: 1, minWidth: 180 }}
                  onChange={(e) => set({ camLabels: s.camLabels.map((x, j) => (j === i ? e.target.value : x)) })} />
              ))}
              <label className="row small check-row"><input type="checkbox" checked={s.camLook === 'cctv'} onChange={(e) => set({ camLook: e.target.checked ? 'cctv' : 'minimal' })} /> Security-camera look (scanlines)</label>
            </div>
          )}
        </>
      )}
      <div className="row">
        <button className="primary" onClick={() => void save()}>Save</button>
        {s.mode !== 'off' && s.sleigh && <button className="ghost" onClick={() => setPreview('sleigh')}>Preview the sleigh</button>}
        {s.mode !== 'off' && s.cams !== 'off' && <button className="ghost" onClick={() => setPreview('cams')}>Preview the cams</button>}
      </div>
      {preview && (
        <Modal wide onClose={() => setPreview(null)}>
          <div className="stack">
            {preview === 'sleigh' ? <SleighTracker h={view} /> : <CamWall h={view} />}
            <button className="ghost" style={{ alignSelf: 'flex-end' }} onClick={() => setPreview(null)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
