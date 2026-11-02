// Today's weather from the family's Weather Scout server: a card on each kid's board (what to wear, the recess
// light, weather alerts in kid words) and a strip on the family wall.
import { useEffect } from 'react';
import { useApp, useLoad } from '../state.tsx';
import { SpeakButton } from './Speak.tsx';

export type WeatherIcon = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'sleet' | 'snow' | 'thunder';
export interface HomeWeatherData {
  place: string | null; tempUnit: string;
  now: { temp: number | null; feelsLike: number | null; icon: WeatherIcon; isDay: boolean; label: string; kidLabel: string };
  today: { high: number | null; low: number | null; rainChance: number | null };
  outfit: string[];
  checklist: { id: string; emoji: string; label: string; why: string }[];
  recess: { rating: 'green' | 'yellow' | 'red'; label: string; emoji: string; reasons: string[] };
  sunset: string | null;
  alerts: { id: string; event: string; severity: string; kid: string; ends: string | null }[];
  updatedAt: string;
}
/** null: not linked. now null: linked, but Weather Scout can't be reached. */
export type HomeWeather = (HomeWeatherData & { stale: boolean }) | { now: null; stale: true } | null;

const ICONS: Record<WeatherIcon, [string, string]> = {
  clear: ['☀️', '🌙'], 'partly-cloudy': ['⛅', '☁️'], cloudy: ['☁️', '☁️'], fog: ['🌫️', '🌫️'], drizzle: ['🌦️', '🌧️'],
  rain: ['🌧️', '🌧️'], sleet: ['🧊', '🧊'], snow: ['🌨️', '🌨️'], thunder: ['⛈️', '⛈️'],
};
export const weatherIcon = (icon: WeatherIcon, isDay = true) => (ICONS[icon] ?? ICONS.cloudy)[isDay ? 0 : 1];
const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const deg = (n: number | null) => (n == null ? '–' : `${n}°`);
const LIGHT: Record<string, string> = { green: '🟢', yellow: '🟡', red: '🔴' };

/** What the 🔊 button reads out. */
function sayWeather(w: HomeWeatherData, simple: boolean): string {
  const parts = [`It's ${w.now.temp ?? ''} degrees and ${w.now.kidLabel.toLowerCase()}.`];
  if (w.alerts[0]) parts.push(w.alerts[0].kid);
  parts.push(`Recess check: ${w.recess.label}.`);
  if (w.checklist.length) parts.push(`${simple ? 'Bring' : 'Before you go, grab'}: ${w.checklist.map((c) => c.label).join(', ')}.`);
  return parts.join(' ');
}

/** "Sunset at 5:30 PM": Weather Scout sends the home's local wall-clock time. */
function sunsetText(t: string | null): string | null {
  const m = t ? /T(\d{2}):(\d{2})/.exec(t) : null;
  if (!m) return null;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** On a kid's board: today's weather, refreshed every five minutes. */
export function KidWeatherCard({ simple, readAloud, color }: { simple: boolean; readAloud: boolean; color: string }) {
  const { base } = useApp();
  const [data, reload] = useLoad<{ weather: HomeWeather }>(`${base}/weather`, [base]);
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, 5 * 60e3);
    return () => window.clearInterval(t);
  }, [reload]);
  const w = data?.weather ?? null;
  if (!w) return null;
  if (!w.now) {
    return (
      <section className="card stack wx-card">
        <h2 style={{ margin: 0 }}>🌦️ Today's weather</h2>
        <p className="muted" style={{ margin: 0 }}>Can't check the sky right now. Look out the window! 🪟</p>
      </section>
    );
  }
  const sunset = sunsetText(w.sunset);
  return (
    <section className="card stack wx-card" style={{ ['--kid' as string]: color }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>🌦️ Today's weather</h2>
        <div className="row" style={{ gap: 6 }}>
          {w.stale && <span className="pill warn">From {TIME_FMT.format(new Date(w.updatedAt))}</span>}
          {readAloud && <SpeakButton text={sayWeather(w, simple)} />}
        </div>
      </div>
      {w.alerts.map((a) => (
        <div key={a.id} className={`wx-alert ${a.severity === 'Extreme' || a.severity === 'Severe' ? 'bad' : 'warn'}`} role="alert">
          <strong>⚠️ {a.event}</strong> <span>{a.kid}</span>
        </div>
      ))}
      <div className="wx-now">
        <span className="wx-icon" aria-hidden>{weatherIcon(w.now.icon, w.now.isDay)}</span>
        <div>
          <div className="wx-temp">{deg(w.now.temp)}</div>
          <div className="wx-label">{w.now.kidLabel}</div>
          {!simple && <div className="small muted">Feels like {deg(w.now.feelsLike)} · High {deg(w.today.high)} · Low {deg(w.today.low)}{w.today.rainChance != null && w.today.rainChance >= 20 ? ` · ☔ ${w.today.rainChance}%` : ''}</div>}
        </div>
        <div className={`wx-recess ${w.recess.rating}`}>
          <div className="wx-light" aria-hidden>{LIGHT[w.recess.rating]}</div>
          <div><strong>{simple ? w.recess.emoji : `Recess: ${w.recess.label}`}</strong>{!simple && w.recess.reasons[0] && <div className="small">{w.recess.reasons[0]}</div>}</div>
        </div>
      </div>
      {w.checklist.length > 0 && (
        <div className="wx-gear" aria-label="What to bring">
          {w.checklist.map((c) => (
            <span key={c.id} className="wx-chip" title={c.why}><span aria-hidden>{c.emoji}</span> {simple ? null : c.label}</span>
          ))}
        </div>
      )}
      {!simple && sunset && <div className="small muted">🌇 Sunset at {sunset}</div>}
    </section>
  );
}

/** On the family wall: one compact block for the whole family. */
export function WallWeather({ weather }: { weather: HomeWeather | undefined }) {
  if (!weather?.now) return null;
  const w = weather;
  return (
    <div className="wall-day wx-wall">
      <div className="wall-day-title">{weatherIcon(w.now.icon, w.now.isDay)} {deg(w.now.temp)} · {w.now.kidLabel}</div>
      <div className="wall-line">{LIGHT[w.recess.rating]} Recess: {w.recess.label}</div>
      {w.checklist.length > 0 && <div className="wall-line">{w.checklist.map((c) => `${c.emoji} ${c.label}`).join(' · ')}</div>}
      {w.alerts.slice(0, 2).map((a) => <div key={a.id} className="wall-note">⚠️ <strong>{a.event}</strong> · {a.kid}</div>)}
      <div className="wall-sub">High {deg(w.today.high)} · Low {deg(w.today.low)}{w.stale ? ' · from earlier' : ''}</div>
    </div>
  );
}
