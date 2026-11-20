// Holiday mode: a seasonal layer over the board and the family wall. A countdown with snow, an elf of the day with a
// small kind task, a nice meter read from the points ledger, Santa's sleigh tracker on the big night and the North Pole
// camera wall. The ideas (and the elves, news and route in holiday-data.ts) come from Nordpol Card by DKAnord (MIT).
// Everything here is pure and takes "now" as an argument, so the server, the tablet and the tests agree.
import { HOLIDAY_TEXT, SLEIGH_STOPS, STOP_NAMES } from './holiday-data.ts';
import type { Lang } from './languages.ts';
import { addDays, daysBetween, isIsoDate } from './schedule.ts';

export type HolidayMode = 'off' | 'on' | 'dates';
export type CamSource = 'hosted' | 'local' | 'off';

export interface HolidaySettings {
  /** Off (the default), on, or on only between `from` and `to`. */
  mode: HolidayMode;
  from: string | null;
  to: string | null;
  /** The big day as MM-DD and the moment the countdown ends, in the home's time zone. */
  day: string;
  time: string;
  /** "Christmas morning", shown over the countdown. */
  title: string;
  snow: boolean;
  /** Elf of the day: points for the elf's task (0 = just for fun) and whether a grown-up checks it first. */
  elf: boolean;
  elfPoints: number;
  elfNeedsOk: boolean;
  /** The nice meter and elf log on boards. */
  nice: boolean;
  /** The sleigh tracker: it lands at `place` at `eta` (local time) on the night before the big day. */
  sleigh: boolean;
  eta: string;
  place: { name: string; lat: number; lon: number } | null;
  /** The North Pole cams: the scenes hosted with Nordpol Card's release, your own copies, or no cams. */
  cams: CamSource;
  /** For 'local': where cam1_morning.mp4 … cam4_evening.mp4 live (a path on this server or an https:// address). */
  camUrl: string;
  camLabels: string[];
  /** Scanlines and muted colors on top of the scenes, or just the REC dot, clock and label. */
  camLook: 'minimal' | 'cctv';
}

export const HOSTED_CAMS = 'https://github.com/DKAnord/nordpol-card/releases/download/media';
export const LOCAL_CAMS = '/holiday-cams';
export const CAM_PERIODS = [{ name: 'morning', from: 5 * 60 }, { name: 'day', from: 8 * 60 }, { name: 'evening', from: 17 * 60 }] as const;
export type CamPeriod = (typeof CAM_PERIODS)[number]['name'];

export const HOLIDAY_DEFAULTS: HolidaySettings = {
  mode: 'off', from: null, to: null, day: '12-25', time: '07:00', title: '🎄 Christmas morning', snow: true,
  elf: true, elfPoints: 5, elfNeedsOk: true, nice: true, sleigh: true, eta: '23:59', place: null,
  cams: 'hosted', camUrl: LOCAL_CAMS, camLabels: ['CAM 01 – REINDEER PADDOCK', 'CAM 02 – TOY WORKSHOP', 'CAM 03 – MAILROOM', 'CAM 04 – BAKERY'],
  camLook: 'minimal',
};

const MD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Settings from storage or a parent's form: anything missing or odd falls back to the default. */
export function cleanHoliday(raw: unknown): HolidaySettings {
  const b = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const d = HOLIDAY_DEFAULTS;
  const bool = (k: keyof HolidaySettings) => (typeof b[k] === 'boolean' ? b[k] as boolean : d[k] as boolean);
  const pts = Number(b.elfPoints);
  const place = b.place && typeof b.place === 'object' ? b.place as Record<string, unknown> : null;
  const lat = Number(place?.lat), lon = Number(place?.lon);
  const labels = Array.isArray(b.camLabels) ? b.camLabels.slice(0, 4).map((x, i) => text(x, 40) ?? d.camLabels[i]) : d.camLabels;
  const camUrl = text(b.camUrl, 300)?.replace(/\/+$/, '') ?? d.camUrl;
  return {
    mode: b.mode === 'on' || b.mode === 'dates' ? b.mode : 'off',
    from: isIsoDate(b.from) ? b.from : null,
    to: isIsoDate(b.to) ? b.to : null,
    day: typeof b.day === 'string' && MD.test(b.day) ? b.day : d.day,
    time: typeof b.time === 'string' && HM.test(b.time) ? b.time : d.time,
    title: text(b.title, 60) ?? d.title,
    snow: bool('snow'), elf: bool('elf'), elfNeedsOk: bool('elfNeedsOk'), nice: bool('nice'), sleigh: bool('sleigh'),
    elfPoints: Number.isInteger(pts) && pts >= 0 && pts <= 100 ? pts : d.elfPoints,
    eta: typeof b.eta === 'string' && HM.test(b.eta) ? b.eta : d.eta,
    place: place && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
      ? { name: text(place.name, 40) ?? 'Home', lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 } : null,
    cams: b.cams === 'local' || b.cams === 'off' ? b.cams : 'hosted',
    // Only a path on this server or a web address: never javascript: or data: in a <video src>.
    camUrl: /^(\/[^\s]*|https?:\/\/[^\s]+)$/i.test(camUrl) ? camUrl : d.camUrl,
    camLabels: [...labels, ...d.camLabels.slice(labels.length)],
    camLook: b.camLook === 'cctv' ? 'cctv' : 'minimal',
  };
}

/** Is Holiday mode showing today (the home's date)? */
export function holidayActive(s: Pick<HolidaySettings, 'mode' | 'from' | 'to'>, today: string): boolean {
  if (s.mode === 'on') return true;
  if (s.mode !== 'dates' || (!s.from && !s.to)) return false;
  return (!s.from || today >= s.from) && (!s.to || today <= s.to);
}

// ---------- time zones ----------

/** The home's UTC offset in minutes at a moment (e.g. -300 for New York in winter). */
export function tzOffsetMin(timeZone: string, at: Date): number {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(at).map((x) => [x.type, x.value]));
    return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(at.getTime() / 60e3) * 60e3) / 60e3);
  } catch {
    return 0;
  }
}

/** A wall-clock moment in the home's time zone as a real instant. */
export function zonedTime(date: string, time: string, timeZone: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const off = tzOffsetMin(timeZone, guess);
  const first = new Date(guess.getTime() - off * 60e3);
  // Right next to a clock change the offset can differ by an hour: ask again at the corrected time.
  const off2 = tzOffsetMin(timeZone, first);
  return off2 === off ? first : new Date(guess.getTime() - off2 * 60e3);
}

// ---------- countdown ----------

/** The big day this moment belongs to: this year's, until a week after it has passed. */
export function bigDayDate(s: Pick<HolidaySettings, 'day'>, today: string): string {
  const y = Number(today.slice(0, 4));
  const thisYear = `${y}-${s.day}`;
  return addDays(thisYear, 7) < today ? `${y + 1}-${s.day}` : thisYear;
}

export interface Countdown {
  /** The big day (YYYY-MM-DD) and when the countdown ends. */
  date: string;
  target: string;
  /** Milliseconds left (0 once it's here). */
  msLeft: number;
  days: number; hours: number; minutes: number; seconds: number;
  /** Sleeps until the big day: 0 on the day itself. */
  sleeps: number;
  /** It's the big day or the few days after it. */
  party: boolean;
}

export function countdown(s: Pick<HolidaySettings, 'day' | 'time'>, timeZone: string, today: string, now: Date): Countdown {
  const date = bigDayDate(s, today);
  const target = zonedTime(date, s.time, timeZone);
  const msLeft = Math.max(0, target.getTime() - now.getTime());
  const sec = Math.floor(msLeft / 1000);
  return {
    date, target: target.toISOString(), msLeft,
    days: Math.floor(sec / 86400), hours: Math.floor(sec / 3600) % 24, minutes: Math.floor(sec / 60) % 60, seconds: sec % 60,
    sleeps: Math.max(0, daysBetween(today, date)), party: today >= date || msLeft === 0,
  };
}

// ---------- elf of the day ----------

export interface ElfOfDay {
  /** 0 to 29. */
  index: number;
  name: string;
  joke: { question: string; answer: string };
  task: string;
  /** Before the big day's month starts, a trial elf fills in. */
  trial: boolean;
  /** Day of the month in the advent calendar (1 to 31), when not a trial. */
  dayOfMonth: number | null;
}

/** Jokes are written "question? answer". */
export function splitJoke(joke: string): { question: string; answer: string } {
  const i = joke.indexOf('?');
  return i < 0 ? { question: joke, answer: '' } : { question: joke.slice(0, i + 1).trim(), answer: joke.slice(i + 1).trim() };
}

/** Day 1 of the big day's month is elf 1, day 2 elf 2 … (day 31 starts over). Other days get a trial elf. */
export function elfFor(s: Pick<HolidaySettings, 'day'>, date: string, lang: Lang = 'en'): ElfOfDay {
  const elves = (HOLIDAY_TEXT[lang] ?? HOLIDAY_TEXT.en).elves;
  const inMonth = date.slice(5, 7) === s.day.slice(0, 2);
  const dom = Number(date.slice(8, 10));
  const yearDay = daysBetween(`${date.slice(0, 4)}-01-01`, date);
  const index = inMonth ? (dom - 1) % elves.length : yearDay % elves.length;
  const [name, joke, task] = elves[index];
  return { index, name, joke: splitJoke(joke), task, trial: !inMonth, dayOfMonth: inMonth ? dom : null };
}

// ---------- nice meter ----------

export interface NiceInput {
  /** Chores done and due over the last two weeks (or since Holiday mode started). */
  done: number; due: number;
  /** Extra good things: approved bonus chores, quick rewards, elf tasks. */
  kind: number;
  /** Penalties in the same time. */
  penalties: number;
}

/**
 * A 0–100 meter. Doing your chores is most of it; kind extras push it up and penalties pull it down a little.
 * Nobody starts at the bottom: with nothing due yet it sits at 75, like Nordpol Card's starting score.
 */
export function niceScore(n: NiceInput): number {
  const base = n.due > 0 ? 40 + Math.round((60 * Math.min(n.done, n.due)) / n.due) : 75;
  return Math.max(0, Math.min(100, base + 3 * n.kind - 5 * n.penalties));
}

/** 0 to 4: cheering you on, watching, almost nice, nice, super nice. */
export const niceLevel = (score: number): number => (score >= 90 ? 4 : score >= 75 ? 3 : score >= 55 ? 2 : score >= 35 ? 1 : 0);
export const NICE_LEVELS = ['The elves are cheering you on 📣', 'The elves are watching 👀', 'Almost nice 🙂', 'Nice ⭐', 'SUPER nice 🌟'];

// ---------- sleigh ----------

export interface SleighStop { name: string; lat: number; lon: number; /** Minutes after 00:00 UTC on the sleigh's night. */ t: number; home?: boolean; northPole?: boolean }

export interface SleighRoute {
  /** The night Santa flies (the day before the big day), YYYY-MM-DD. */
  night: string;
  stops: SleighStop[];
  /** Minutes after 00:00 UTC that night when Santa reaches home. */
  homeT: number;
  homeName: string;
}

const hm = (s: string): number => {
  const plus = s.endsWith('+');
  const [h, m] = s.replace('+', '').split(':').map(Number);
  return h * 60 + (m || 0) + (plus ? 1440 : 0);
};

const gcdKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const r = Math.PI / 180;
  const c = Math.sin(a.lat * r) * Math.sin(b.lat * r) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.cos((a.lon - b.lon) * r);
  return Math.acos(Math.max(-1, Math.min(1, c))) * 6371;
};

/** Without a saved place: somewhere on the home's time zone line, at a middling latitude. */
export function guessPlace(timeZone: string, at: Date): { name: string; lat: number; lon: number } {
  const off = tzOffsetMin(timeZone, at) / 60;
  return { name: 'Home', lat: 40, lon: Math.max(-170, Math.min(170, off * 15)) };
}

/**
 * Santa's route for the night before the big day, east to west. Every stop is reached at the same local clock time
 * as home (shifted with the ETA), so the route always runs east to west whatever the ETA. Stops too close to home,
 * or that would need an impossible hop, are dropped. Ported from Nordpol Card's sleigh tracker.
 */
export function sleighRoute(s: Pick<HolidaySettings, 'day' | 'eta' | 'place'>, timeZone: string, today: string, lang: Lang = 'en'): SleighRoute {
  const night = addDays(bigDayDate(s, today), -1);
  const etaMin = hm(s.eta) + (hm(s.eta) < 12 * 60 ? 1440 : 0);
  const homeAt = new Date(Date.parse(`${night}T00:00:00Z`) + etaMin * 60e3);
  const place = s.place ?? guessPlace(timeZone, homeAt);
  const offH = tzOffsetMin(timeZone, homeAt) / 60;
  const homeT = etaMin - offH * 60;
  const shift = etaMin - 1439;
  const names = STOP_NAMES[lang] ?? {};
  let route: SleighStop[] = SLEIGH_STOPS
    .map(([name, lat, lon, off, local]) => ({ name: names[name] ?? name, lat, lon, t: hm(local) + shift - off * 60 }))
    .filter((x) => Math.abs(x.t - homeT) >= 8 && Math.hypot(x.lat - place.lat, x.lon - place.lon) >= 4 && x.name.toLowerCase() !== place.name.toLowerCase());
  route.push({ name: place.name, lat: place.lat, lon: place.lon, t: homeT, home: true });
  route.sort((a, b) => a.t - b.t);
  // Drop stops that would need a hop faster than the reindeer go (~6,500 km a minute… it's magic, but not that magic).
  for (let guard = 0; guard < 40; guard++) {
    let rm = -1;
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i], b = route[i + 1];
      if (gcdKm(a, b) / Math.max(b.t - a.t, 1) > 6500 / 60) { rm = b.home ? i : a.home ? i + 1 : i; break; }
    }
    if (rm < 0) break;
    route.splice(rm, 1);
  }
  route = [
    { name: 'North Pole', lat: 84, lon: 179.5, t: route[0].t - 45, northPole: true },
    ...route,
    { name: 'North Pole', lat: 84, lon: -170, t: route[route.length - 1].t + 90, northPole: true },
  ];
  return { night, stops: route, homeT, homeName: place.name };
}

export interface SleighPosition {
  state: 'parked' | 'pre' | 'fly' | 'done' | 'after';
  /** The leg: from stops[i] to stops[i + 1], `f` of the way. */
  i: number; f: number; lat: number; lon: number;
  /** Minutes until Santa reaches home (negative once he has been). */
  toHome: number;
  /** Millions of presents delivered so far. */
  presents: number;
}

/** Minutes after 00:00 UTC on the sleigh's night. */
export const sleighMinute = (r: Pick<SleighRoute, 'night'>, now: Date): number => (now.getTime() - Date.parse(`${r.night}T00:00:00Z`)) / 60e3;

export function sleighAt(r: SleighRoute, min: number): SleighPosition {
  const R = r.stops;
  const first = R[0], last = R[R.length - 1];
  const presents = Math.max(0, Math.min(2400, Math.round((2400 * (min - R[1].t)) / Math.max(1, R[R.length - 2].t - R[1].t))));
  const base = { toHome: r.homeT - min, presents };
  if (min < first.t - 120) return { ...base, state: 'parked', i: 0, f: 0, lat: first.lat, lon: first.lon, presents: 0 };
  if (min <= first.t) return { ...base, state: 'pre', i: 0, f: 0, lat: first.lat, lon: first.lon, presents: 0 };
  for (let i = 0; i < R.length - 1; i++) {
    const a = R[i], b = R[i + 1];
    if (min <= b.t) {
      const f = (min - a.t) / Math.max(1, b.t - a.t);
      let dl = b.lon - a.lon;
      if (dl > 180) dl -= 360;
      if (dl < -180) dl += 360;
      let lon = a.lon + dl * f;
      if (lon > 180) lon -= 360;
      if (lon < -180) lon += 360;
      return { ...base, state: 'fly', i, f, lat: a.lat + (b.lat - a.lat) * f, lon };
    }
  }
  const after = min > last.t + 30;
  return { ...base, state: after ? 'after' : 'done', i: R.length - 1, f: 1, lat: last.lat, lon: last.lon, presents: 2400 };
}

/** A test flight: the whole night squeezed into a minute, slowing down around home. */
export function demoMinute(r: SleighRoute, elapsedSec: number): number {
  const R = r.stops;
  const a = R[0].t - 15, b = r.homeT - 30, c = r.homeT + 20, d = R[R.length - 1].t + 10;
  if (elapsedSec < 30) return a + ((b - a) * elapsedSec) / 30;
  if (elapsedSec < 45) return b + ((c - b) * (elapsedSec - 30)) / 15;
  return c + ((d - c) * (elapsedSec - 45)) / 15;
}

/** Equirectangular map position (viewBox 0 0 360 180). */
export const mapXY = (lat: number, lon: number): [number, number] => [lon + 180, 90 - lat];

/** An SVG path through points, split where it crosses the date line so it doesn't streak across the map. */
export function routePath(pts: [number, number][]): string {
  let d = '';
  pts.forEach(([la, lo], i) => {
    if (i === 0) { const [x, y] = mapXY(la, lo); d += `M${x},${y}`; return; }
    const [pla, plo] = pts[i - 1];
    const dl = lo - plo;
    if (Math.abs(dl) > 180) {
      const west = dl > 0;
      const edge = west ? -180 : 180;
      const span = west ? plo + 180 + (180 - lo) : 180 - plo + (lo + 180);
      const lat = pla + ((la - pla) * Math.abs(edge - plo)) / span;
      const [x1, y1] = mapXY(lat, edge);
      const [x2, y2] = mapXY(lat, -edge);
      d += `L${x1},${y1}M${x2},${y2}`;
    }
    const [x, y] = mapXY(la, lo);
    d += `L${x},${y}`;
  });
  return d;
}

// ---------- cams ----------

/** Which scene the cams show at a local time (minutes after midnight). */
export function camPeriod(localMin: number): CamPeriod {
  let cur: CamPeriod = 'evening';
  for (const p of CAM_PERIODS) if (localMin >= p.from) cur = p.name;
  return cur;
}

/** The four cam clips for a period, or [] when the cams are off. */
export function camClips(s: Pick<HolidaySettings, 'cams' | 'camUrl'>, period: CamPeriod): string[] {
  if (s.cams === 'off') return [];
  const dir = s.cams === 'local' ? s.camUrl : HOSTED_CAMS;
  return [1, 2, 3, 4].map((n) => `${dir}/cam${n}_${period}.mp4`);
}

export const holidayText = (lang: Lang) => HOLIDAY_TEXT[lang] ?? HOLIDAY_TEXT.en;
