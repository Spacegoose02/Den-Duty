// Calendar dates and chore schedules. Dates are plain 'YYYY-MM-DD' strings in the home's time zone,
// so "today" means the same thing for the server, the tablet and the tests.

export type ScheduleKind = 'daily' | 'weekly' | 'once' | 'interval' | 'monthly';
export const SCHEDULE_KINDS: ScheduleKind[] = ['daily', 'weekly', 'once', 'interval', 'monthly'];

export interface Schedule {
  schedule: ScheduleKind;
  /** 0 = Sunday ... 6 = Saturday. Used by 'weekly'. */
  weekdays: number[];
  /** Used by 'once'. */
  dueDate: string | null;
  /** The schedule never applies before this date. 'interval' counts from it. */
  startDate: string;
  /** 'interval': every this many days (2 to 365), counting from startDate. */
  everyDays?: number | null;
  /** 'monthly': this day of the month (1 to 31; short months use their last day). */
  monthDay?: number | null;
}

/** How chores move between kids: everyone each time, or one kid at a time taking turns. */
export type RotateKind = 'daily' | 'weekly';

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
    case 'interval': return daysBetween(s.startDate, date) % Math.max(1, s.everyDays ?? 1) === 0;
    case 'monthly': {
      const [y, m, d] = date.split('-').map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return d === Math.min(s.monthDay ?? 1, last);
    }
  }
}

/** Whole calendar months from one date's month to another's. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * How many times the schedule came up before `date` (0 for the first time). Turn-taking uses it, so a Mon/Wed/Fri
 * chore with two kids goes Ava, Ben, Ava, Ben... instead of following the calendar's day numbers.
 */
export function occurrenceIndex(s: Schedule, date: string): number {
  if (date <= s.startDate) return 0;
  const days = daysBetween(s.startDate, date);
  switch (s.schedule) {
    case 'daily': return days;
    case 'once': return 0;
    case 'interval': return Math.floor(days / Math.max(1, s.everyDays ?? 1));
    case 'monthly': {
      // Months since the first one on or after the start date (later in the start month, or the month after).
      const [y, m, d] = s.startDate.split('-').map(Number);
      const target = Math.min(s.monthDay ?? 1, new Date(Date.UTC(y, m, 0)).getUTCDate());
      return Math.max(0, monthsBetween(s.startDate, date) - (d > target ? 1 : 0));
    }
    case 'weekly': {
      const set = new Set(s.weekdays);
      if (!set.size) return 0;
      const weeks = Math.floor(days / 7);
      let n = weeks * set.size;
      for (let d = addDays(s.startDate, weeks * 7); d < date; d = addDays(d, 1)) if (set.has(weekdayOf(d))) n++;
      return n;
    }
  }
}

/** Whose turn it is on a date: one kid from the list (in order), or everyone when the chore isn't taking turns. */
export function turnFor(s: Schedule, rotate: RotateKind | null | undefined, memberIds: string[], date: string, weekStart = 0): string[] {
  if (!rotate || memberIds.length < 2) return memberIds;
  const n = rotate === 'weekly'
    ? Math.max(0, Math.round(daysBetween(startOfWeek(s.startDate, weekStart), startOfWeek(date, weekStart)) / 7))
    : occurrenceIndex(s, date);
  return [memberIds[n % memberIds.length]];
}

export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** 'HH:MM' on a 24-hour clock. */
export function isClockTime(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** '19:30' as '7:30 pm'. */
export function clockText(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** Short human description, e.g. "Every day", "Mon, Wed, Fri", "Once on 2026-10-20". */
export function describeSchedule(s: Pick<Schedule, 'schedule' | 'weekdays' | 'dueDate' | 'everyDays' | 'monthDay'>): string {
  if (s.schedule === 'daily') return 'Every day';
  if (s.schedule === 'interval') return s.everyDays === 7 ? 'Every week' : s.everyDays === 14 ? 'Every 2 weeks' : `Every ${s.everyDays ?? 1} days`;
  if (s.schedule === 'monthly') return `Monthly on the ${ordinal(s.monthDay ?? 1)}`;
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

/** How a Doctors appointment repeats: every N days, weeks or months, optionally until a date or for a number of visits. */
export type RepeatUnit = 'day' | 'week' | 'month';
export const REPEAT_UNITS: RepeatUnit[] = ['day', 'week', 'month'];
export interface RepeatRule { every: number; unit: RepeatUnit; endDate: string | null; count: number | null }

/** The date of visit number i (0 = the first) of a repeating appointment. Months keep the first visit's day where they can. */
export function repeatDate(start: string, every: number, unit: RepeatUnit, i: number): string {
  if (unit === 'month') return addMonths(start, every * i);
  return addDays(start, (unit === 'week' ? 7 : 1) * every * i);
}

/** "Weekly", "Every 2 weeks", "Monthly", "Every 3 days", plus how it ends. */
export function describeRepeat(r: RepeatRule): string {
  const word = { day: 'day', week: 'week', month: 'month' }[r.unit];
  const base = r.every === 1 ? { day: 'Daily', week: 'Weekly', month: 'Monthly' }[r.unit] : `Every ${r.every} ${word}s`;
  if (r.count) return `${base}, ${r.count} times`;
  if (r.endDate) return `${base} until ${r.endDate}`;
  return base;
}
