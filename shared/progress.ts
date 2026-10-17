// Raccoon levels and achievements. Plain data plus a couple of pure helpers, shared by the server and the app.

export interface Level { level: number; name: string; badge: string; min: number }

/** Level points = everything a kid has ever earned (chores and bonuses, minus take-backs of approvals) + 20 per redeemed goal. */
export const LEVELS: Level[] = [
  { level: 1, name: 'Kit', badge: '🐾', min: 0 },
  { level: 2, name: 'Scout', badge: '🌱', min: 50 },
  { level: 3, name: 'Sneak', badge: '🍃', min: 150 },
  { level: 4, name: 'Shadow', badge: '🌙', min: 300 },
  { level: 5, name: 'Ninja', badge: '🥷', min: 600 },
  { level: 6, name: 'Master Ninja', badge: '⭐', min: 1000 },
  { level: 7, name: 'Legend', badge: '👑', min: 2000 },
];

export const GOAL_LEVEL_BONUS = 20;

export interface LevelInfo extends Level {
  points: number;
  next: Level | null;
  /** 0-100 toward the next level (100 at the top). */
  percent: number;
}

export function levelFor(points: number): LevelInfo {
  let i = 0;
  while (i + 1 < LEVELS.length && points >= LEVELS[i + 1].min) i++;
  const cur = LEVELS[i];
  const next = LEVELS[i + 1] ?? null;
  const percent = next ? Math.floor(((points - cur.min) / (next.min - cur.min)) * 100) : 100;
  return { ...cur, points, next, percent };
}

export type Metric = 'chores' | 'points' | 'streak' | 'goals' | 'bonus';

export interface AchievementDef { id: string; title: string; icon: string; description: string; metric: Metric; target: number }

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-chore', title: 'First sweep', icon: '🧹', description: 'Finish your first chore', metric: 'chores', target: 1 },
  { id: 'chores-10', title: 'Busy paws', icon: '🐾', description: 'Finish 10 chores', metric: 'chores', target: 10 },
  { id: 'chores-50', title: 'Chore champ', icon: '🏅', description: 'Finish 50 chores', metric: 'chores', target: 50 },
  { id: 'chores-100', title: 'Century', icon: '💯', description: 'Finish 100 chores', metric: 'chores', target: 100 },
  { id: 'chores-250', title: 'Unstoppable', icon: '🏆', description: 'Finish 250 chores', metric: 'chores', target: 250 },
  { id: 'streak-3', title: 'Warming up', icon: '🔥', description: 'All chores done 3 days in a row', metric: 'streak', target: 3 },
  { id: 'streak-7', title: 'Week of fire', icon: '🔥', description: 'All chores done 7 days in a row', metric: 'streak', target: 7 },
  { id: 'streak-14', title: 'Two-week wonder', icon: '⚡', description: 'All chores done 14 days in a row', metric: 'streak', target: 14 },
  { id: 'streak-30', title: 'Volcano', icon: '🌋', description: 'All chores done 30 days in a row', metric: 'streak', target: 30 },
  { id: 'points-100', title: 'Shiny collector', icon: '✨', description: 'Earn 100 points', metric: 'points', target: 100 },
  { id: 'points-500', title: 'Treasure trove', icon: '💎', description: 'Earn 500 points', metric: 'points', target: 500 },
  { id: 'points-1000', title: 'Dragon hoard', icon: '🌟', description: 'Earn 1000 points', metric: 'points', target: 1000 },
  { id: 'first-goal', title: 'Goal getter', icon: '🎁', description: 'Reach and redeem a goal', metric: 'goals', target: 1 },
  { id: 'goals-5', title: 'Dream big', icon: '🎉', description: 'Redeem 5 goals', metric: 'goals', target: 5 },
  { id: 'first-bonus', title: 'Extra mile', icon: '💪', description: 'Do a bonus chore', metric: 'bonus', target: 1 },
  { id: 'bonus-10', title: 'Super helper', icon: '🦸', description: 'Do 10 bonus chores', metric: 'bonus', target: 10 },
];

export interface Achievement extends AchievementDef { progress: number; earned: boolean }

export function achievementsFor(m: Record<Metric, number>): Achievement[] {
  return ACHIEVEMENTS.map((a) => ({ ...a, progress: Math.min(m[a.metric], a.target), earned: m[a.metric] >= a.target }));
}
