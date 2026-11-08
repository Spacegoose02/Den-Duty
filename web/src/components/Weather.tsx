// Today's weather from the family's Weather Scout server: a card on each kid's board (what to wear, the recess
// light, weather alerts in kid words) and a strip on the family wall.
import { useEffect, useState } from 'react';
import { useApp, useLoad } from '../state.tsx';
import { SpeakButton } from './Speak.tsx';

export type WeatherIcon = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'sleet' | 'snow' | 'thunder';
export interface HomeWeatherData {
  place: string | null; tempUnit: string;
  now: { temp: number | null; feelsLike: number | null; icon: WeatherIcon; isDay: boolean; label: string; kidLabel: string };
  today: { high: number | null; low: number | null; rainChance: number | null };
  outfit: string[];
  mood: 'happy' | 'worried' | 'shivering' | 'hot';
  /** Weather Scout can draw Rocky in today's outfit. */
  rocky: boolean;
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

/** How Rocky's outfit pieces read in a sentence. */
const PIECES: Record<string, string> = {
  raincoat: 'raincoat', 'winter-coat': 'winter coat', jacket: 'jacket', 't-shirt': 'T-shirt', pants: 'pants', shorts: 'shorts',
  'swim-trunks': 'swim trunks', mittens: 'mittens', boots: 'rain boots', 'snow-boots': 'snow boots', sunglasses: 'sunglasses',
  beanie: 'warm hat', 'sun-hat': 'sun hat',
};
const MOOD_WORDS: Record<string, string> = { shivering: "Brrr, he's chilly!", hot: "Phew, he's hot!", worried: 'He hears thunder.' };

/** "Rocky is wearing his raincoat and rain boots." */
export function rockySays(outfit: string[], mood: string): string {
  const names = outfit.map((k) => PIECES[k]).filter(Boolean);
  const list = names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const wear = list ? `Rocky is wearing his ${list}.` : 'Rocky says it’s a nice day!';
  return MOOD_WORDS[mood] ? `${wear} ${MOOD_WORDS[mood]}` : wear;
}

/** Rocky the raccoon from Weather Scout, dressed for today. Hides itself if the picture can't load. */
function Rocky({ base, w, size }: { base: string; w: HomeWeatherData; size: number }) {
  const v = `${w.outfit.join(',')}|${w.mood}`;
  const [failed, setFailed] = useState<string | null>(null);
  if (!w.rocky || failed === v) return null;
  return (
    <img
      className="wx-rocky" src={`${base}/weather/rocky.svg?v=${encodeURIComponent(v)}`} alt={rockySays(w.outfit, w.mood)}
      width={size} height={Math.round(size * 910 / 710)} decoding="async" onError={() => setFailed(v)}
    />
  );
}

/** What the 🔊 button reads out. */
function sayWeather(w: HomeWeatherData, simple: boolean): string {
  const parts = [`It's ${w.now.temp ?? ''} degrees and ${w.now.kidLabel.toLowerCase()}.`];
  if (w.rocky) parts.push(rockySays(w.outfit, w.mood));
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
        <Rocky base={base} w={w} size={simple ? 110 : 96} />
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
      {w.rocky && !simple && <div className="wx-rocky-says">🦝 {rockySays(w.outfit, w.mood)}</div>}
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
  const { base } = useApp();
  if (!weather?.now) return null;
  const w = weather;
  return (
    <div className="wall-day wx-wall">
      <Rocky base={base} w={w} size={64} />
      <div className="wall-day-title">{weatherIcon(w.now.icon, w.now.isDay)} {deg(w.now.temp)} · {w.now.kidLabel}</div>
      <div className="wall-line">{LIGHT[w.recess.rating]} Recess: {w.recess.label}</div>
      {w.checklist.length > 0 && <div className="wall-line">{w.checklist.map((c) => `${c.emoji} ${c.label}`).join(' · ')}</div>}
      {w.alerts.slice(0, 2).map((a) => <div key={a.id} className="wall-note">⚠️ <strong>{a.event}</strong> · {a.kid}</div>)}
      <div className="wall-sub">High {deg(w.today.high)} · Low {deg(w.today.low)}{w.stale ? ' · from earlier' : ''}</div>
    </div>
  );
}
