// Two homes: when a kid is at the other parent's (or at camp, or on a trip), no chores are due here and their
// board says where they are. A repeating pattern (say "week on, week off" or "every other weekend") plus one-off dates.
import { addDays, daysBetween } from './schedule.ts';

export interface AwayPlan {
  /** What the board says, like "At Dad's". */
  label: string;
  /** The first day of the pattern. */
  anchor: string;
  /** One entry per day of the cycle, starting at the anchor: true = away. 7 or 14 days long, up to 28. */
  days: boolean[];
}
export interface AwayRange { id: string; start: string; end: string; label: string | null }

export const AWAY_PRESETS: { id: string; name: string; days: boolean[] }[] = [
  { id: 'week-on-off', name: 'Week on, week off', days: [...Array(7).fill(false), ...Array(7).fill(true)] },
  { id: 'every-other-weekend', name: 'Every other weekend (Fri–Sun)', days: [false, false, false, false, true, true, true, false, false, false, false, false, false, false] },
  { id: '2-2-3', name: '2-2-3', days: [false, false, true, true, false, false, false, true, true, false, false, true, true, true] },
  { id: 'weekends', name: 'Every weekend (Sat–Sun)', days: [false, false, false, false, false, true, true] },
];

/** Where a kid is on a date: the label when away, null when here. One-off dates win over the pattern. */
export function awayOn(plan: AwayPlan | null, ranges: AwayRange[], date: string): string | null {
  const r = ranges.find((x) => x.start <= date && date <= x.end);
  if (r) return r.label || plan?.label || 'Away';
  if (!plan || !plan.days.length || date < plan.anchor) return null;
  const n = plan.days.length;
  const i = daysBetween(plan.anchor, date) % n;
  return plan.days[i] ? plan.label || 'Away' : null;
}

/** The next day a kid is back (within 60 days), for "Back on Friday". */
export function backOn(plan: AwayPlan | null, ranges: AwayRange[], from: string): string | null {
  for (let i = 1; i <= 60; i++) {
    const d = addDays(from, i);
    if (!awayOn(plan, ranges, d)) return d;
  }
  return null;
}
