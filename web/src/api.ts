import type { ScheduleKind } from '../../shared/schedule.ts';
import type { Achievement, LevelInfo } from '../../shared/progress.ts';
import type { DoctorArea, KidPage, PracticeIdea } from '../../shared/pages.ts';

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
  /** Pages and Doctors sections a parent switched off for this kid. */
  pagesOff: KidPage[]; doctorAreasOff: DoctorArea[];
  /** Daily practice ideas switched off (anger starts off). */
  ideasOff: PracticeIdea[];
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
  startDate: string; describe: string; memberIds: string[]; bonus: boolean; claimLimit: 'each' | 'one'; category: 'room' | null;
}

export type ItemStatus = 'pending' | 'submitted' | 'approved' | 'rejected' | 'planned';

export interface AgendaItem {
  id: string | null; choreId: string | null; memberId: string; date: string; title: string; icon: string; points: number;
  status: ItemStatus; note: string | null; started: boolean;
}

export interface ExternalItem { date: string; time: string | null; title: string; feed: string; kind: string }

export interface DutyItem { id: string; title: string; kidId: string | null; kidName: string | null; dueDate: string | null; status: string }

export interface PracticeItem { goalId: string; memberId: string; title: string; area: string; time: string | null; done: boolean; points: number }
export interface AppointmentItem { id: string; memberId: string; kind: string; title: string; provider: string | null; time: string; status: string }
export interface Day { date: string; items: AgendaItem[]; external?: ExternalItem[]; duty?: DutyItem[]; practices?: PracticeItem[]; appointments?: AppointmentItem[] }

export interface Goal {
  id: string; memberId: string; title: string; targetPoints: number; reward: string | null; status: 'active' | 'redeemed';
  redeemedAt: string | null; progress: number; percent: number; reached: boolean;
}

export interface KidWeek { balance: number; pointsThisWeek: number; choresDone: number; choresWaiting: number; choresDue: number; leftToday: number }

export interface Streak { current: number; best: number }

export interface BonusOffer { choreId: string; title: string; icon: string; points: number; claimLimit: 'each' | 'one'; instanceId: string | null; takenBy: string | null }

export interface Board {
  today: string; weekStart: string; kid: Kid; stats: KidWeek; todayItems: AgendaItem[]; week: Day[]; goals: Goal[];
  bonus: BonusOffer[]; level: LevelInfo; streak: Streak; achievements: Achievement[]; recent: LedgerEntry[]; timeouts: Timeout[];
  /** Present only when a parent shares the kid's therapy goals with them. */
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
  /** Parents only, when Doctors is on. */
  doctors: DoctorsStats | null;
  /** When Goals & rewards is on. */
  goalStats: GoalStats | null;
}
export interface DoctorsStats {
  weeks: string[]; perWeek: { area: string; values: number[] }[]; streak: number; practicesInRange: number;
  goals: { id: string; title: string; area: string; progress: number; status: string }[];
  goalsReached: number; goalsReachedInRange: number; appointments: { attended: number; missed: number; upcoming: number };
}
export interface GoalStats {
  active: { id: string; title: string; target: number; progress: number; percent: number; reached: boolean }[];
  weeks: string[]; reachedPerWeek: number[]; redeemedPerWeek: number[]; reachedTotal: number; redeemedTotal: number;
  averageDays: number | null; recent: { title: string; days: number }[];
}

export interface ReviewItem extends AgendaItem { submittedAt: string; kid: { name: string; avatar: string; color: string } }

export interface TimeoutRequest { id: string; timeoutId: string; units: number; minutes: number; points: number; status: string; createdAt: string }
export interface Timeout {
  id: string; memberId: string; what: string; reason: string | null; startsAt: string; endsAt: string; endedAt: string | null;
  state: 'upcoming' | 'active' | 'over'; minutesLeft: number;
  buy: { unit: 'hour' | 'day'; price: number; maxMinutes: number; boughtMinutes: number; unitsLeft: number } | null;
  pending: TimeoutRequest | null;
}
export type HomeTimeout = Timeout & { kid: { name: string; avatar: string; color: string } };

export interface Summary { today: string; weekStart: string; weekEnd: string; waiting: number; timeouts: HomeTimeout[]; kids: (Kid & KidWeek & { goals: Goal[]; streak: Streak; level: LevelInfo })[] }

export interface LedgerEntry { id: number; amount: number; kind: string; reason: string; date: string; by: string | null; createdAt: string }
