import type { ScheduleKind } from '../../shared/schedule.ts';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: opts.body === undefined ? {} : { 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? `Request failed (${res.status})`);
  return data as T;
}

function safeJson(t: string): unknown {
  try { return JSON.parse(t); } catch { return t; }
}

export interface User {
  id: string; name: string; username: string | null; email: string | null; avatar: string; theme: string; isAdmin: boolean; lastHomeId: string | null;
}

export interface Whoami {
  user: User | null;
  homes: { id: string; name: string; role: 'parent' }[];
  /** Set when this browser is a family tablet. */
  device: { id: string; homeId: string; name: string } | null;
  /** The kid who's signed in on this family tablet. */
  kid: { id: string; name: string; avatar: string; color: string; theme: string | null } | null;
}

export interface Kid { id: string; name: string; avatar: string; color: string; theme: string | null; hasPin: boolean; balance: number }

export interface HomeDetail {
  id: string; name: string; pointsName: string; pointsIcon: string; theme: string; timezone: string; weekStart: 0 | 1;
  viewer: 'parent' | 'kid' | 'device' | 'token';
  kids: Kid[];
  joinCode?: string;
  parents?: { id: string; userId: string; name: string; avatar: string; joinedAt: string }[];
}

export interface Chore {
  id: string; title: string; icon: string; points: number; schedule: ScheduleKind; weekdays: number[]; dueDate: string | null;
  startDate: string; describe: string; memberIds: string[];
}

export type ItemStatus = 'pending' | 'submitted' | 'approved' | 'rejected' | 'planned';

export interface AgendaItem {
  id: string | null; choreId: string | null; memberId: string; date: string; title: string; icon: string; points: number;
  status: ItemStatus; note: string | null;
}

export interface Day { date: string; items: AgendaItem[] }

export interface Goal {
  id: string; memberId: string; title: string; targetPoints: number; reward: string | null; status: 'active' | 'redeemed';
  redeemedAt: string | null; progress: number; percent: number; reached: boolean;
}

export interface KidWeek { balance: number; pointsThisWeek: number; choresDone: number; choresWaiting: number; choresDue: number; leftToday: number }

export interface Board { today: string; weekStart: string; kid: Kid; stats: KidWeek; todayItems: AgendaItem[]; week: Day[]; goals: Goal[] }

export interface ReviewItem extends AgendaItem { submittedAt: string; kid: { name: string; avatar: string; color: string } }

export interface Summary { today: string; weekStart: string; weekEnd: string; waiting: number; kids: (Kid & KidWeek & { goals: Goal[] })[] }

export interface LedgerEntry { id: number; amount: number; kind: string; reason: string; date: string; by: string | null; createdAt: string }
