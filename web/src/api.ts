import type { ScheduleKind } from '../../shared/schedule.ts';
import type { Achievement, LevelInfo } from '../../shared/progress.ts';

export type { Achievement, LevelInfo };

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

export interface Kid {
  id: string; name: string; avatar: string; color: string; theme: string | null; hasPin: boolean; balance: number;
  birthdate: string | null; age: number | null; pictureModeSetting: 'auto' | 'on' | 'off'; pictureMode: boolean;
}

export interface HomeDetail {
  id: string; name: string; pointsName: string; pointsIcon: string; theme: string; timezone: string; weekStart: 0 | 1; allowNegative?: boolean;
  viewer: 'parent' | 'kid' | 'device' | 'token';
  kids: Kid[];
  joinCode?: string;
  parents?: { id: string; userId: string; name: string; avatar: string; joinedAt: string }[];
  haWebhookUrl?: string | null;
}

export interface Chore {
  id: string; title: string; icon: string; points: number; schedule: ScheduleKind; weekdays: number[]; dueDate: string | null;
  startDate: string; describe: string; memberIds: string[]; bonus: boolean; claimLimit: 'each' | 'one';
}

export type ItemStatus = 'pending' | 'submitted' | 'approved' | 'rejected' | 'planned';

export interface AgendaItem {
  id: string | null; choreId: string | null; memberId: string; date: string; title: string; icon: string; points: number;
  status: ItemStatus; note: string | null; started: boolean;
}

export interface ExternalItem { date: string; time: string | null; title: string; feed: string; kind: string }

export interface Day { date: string; items: AgendaItem[]; external?: ExternalItem[] }

export interface Goal {
  id: string; memberId: string; title: string; targetPoints: number; reward: string | null; status: 'active' | 'redeemed';
  redeemedAt: string | null; progress: number; percent: number; reached: boolean;
}

export interface KidWeek { balance: number; pointsThisWeek: number; choresDone: number; choresWaiting: number; choresDue: number; leftToday: number }

export interface Streak { current: number; best: number }

export interface BonusOffer { choreId: string; title: string; icon: string; points: number; claimLimit: 'each' | 'one'; instanceId: string | null; takenBy: string | null }

export interface Board {
  today: string; weekStart: string; kid: Kid; stats: KidWeek; todayItems: AgendaItem[]; week: Day[]; goals: Goal[];
  bonus: BonusOffer[]; level: LevelInfo; streak: Streak; achievements: Achievement[]; recent: LedgerEntry[];
  /** Present only when a parent shares the kid's therapy goals with them. */
  /** The kid's room board (Den Duty). */
  den: { id: string; title: string; icon: string | null; status: 'todo' | 'doing' | 'done'; points: number; repeatDaily: boolean; checked: boolean }[];
  therapy: { goals: { id: string; area: string; title: string; progress: number; rewardStep: number; rewardMet: number }[]; upcoming: { id: string; kind: string; title: string; provider: string | null; startsAt: string }[] } | null;
}

export interface QuickReward { id: string; title: string; icon: string; amount: number }

export interface Poll {
  id: string; title: string; status: 'open' | 'closed'; winnerOptionId: string | null; createdAt: string; closedAt: string | null;
  myVote: string | null; totalVotes: number;
  /** votes is null for kids while the vote is open. voters only for parents. */
  options: { id: string; title: string; icon: string; votes: number | null; voters?: string[] }[];
}

export interface DayStat { date: string; points: number; done: number; due: number }
export interface WeekStat { weekStart: string; points: number; done: number; due: number }
export interface KidStats {
  from: string; daily: DayStat[]; weekly: WeekStat[]; streak: Streak; level: LevelInfo; lifetime: number;
  byChore: { title: string; icon: string; due: number; done: number; points: number }[];
}

export interface ReviewItem extends AgendaItem { submittedAt: string; kid: { name: string; avatar: string; color: string } }

export interface Summary { today: string; weekStart: string; weekEnd: string; waiting: number; kids: (Kid & KidWeek & { goals: Goal[]; streak: Streak; level: LevelInfo })[] }

export interface LedgerEntry { id: number; amount: number; kind: string; reason: string; date: string; by: string | null; createdAt: string }
