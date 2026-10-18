// Calendar dates and chore schedules. Dates are plain 'YYYY-MM-DD' strings in the home's time zone,
// so "today" means the same thing for the server, the tablet and the tests.

export type ScheduleKind = 'daily' | 'weekly' | 'once';

export interface Schedule {
  schedule: ScheduleKind;
  /** 0 = Sunday ... 6 = Saturday. Used by 'weekly'. */
  weekdays: number[];
  /** Used by 'once'. */
  dueDate: string | null;
  /** The schedule never applies before this date. */
  startDate: string;
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Today's date in a time zone, e.g. todayIn('America/New_York'). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Wall-clock time 'HH:MM' in a time zone. */
export function timeIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  } catch {
    return now.toISOString().slice(11, 16);
  }
}

/** Adds months to a date, keeping the day where it can (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function isTimeZone(v: unknown): v is string {
  if (typeof v !== 'string' || !v) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** First day of the week containing `iso`. weekStart 0 = Sunday, 1 = Monday. */
export function startOfWeek(iso: string, weekStart = 0): string {
  return addDays(iso, -((weekdayOf(iso) - weekStart + 7) % 7));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
}

/** Every date from `from` to `to`, inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Whether a chore with this schedule is due on a date. */
export function isScheduledOn(s: Schedule, date: string): boolean {
  if (date < s.startDate) return false;
  switch (s.schedule) {
    case 'daily': return true;
    case 'weekly': return s.weekdays.includes(weekdayOf(date));
    case 'once': return s.dueDate === date;
  }
}

/** Short human description, e.g. "Every day", "Mon, Wed, Fri", "Once on 2026-10-20". */
export function describeSchedule(s: Pick<Schedule, 'schedule' | 'weekdays' | 'dueDate'>): string {
  if (s.schedule === 'daily') return 'Every day';
  if (s.schedule === 'once') return s.dueDate ? `Once on ${s.dueDate}` : 'Once';
  const days = [...s.weekdays].sort();
  if (days.length === 7) return 'Every day';
  if (days.join() === '1,2,3,4,5') return 'Weekdays';
  if (days.join() === '0,6') return 'Weekends';
  return days.map((d) => WEEKDAY_SHORT[d]).join(', ') || 'Never';
}

/** Cleans a weekday list from user input: unique integers 0-6, sorted. */
export function cleanWeekdays(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
}
