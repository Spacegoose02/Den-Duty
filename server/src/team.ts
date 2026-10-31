// Family team goals: every kid's earned points fill one shared goal ("Trip to the zoo, 300 points together").
// Nothing is spent; a goal counts chore and bonus points earned since it was set, minus approvals that were undone.
import type { DatabaseSync } from 'node:sqlite';
import type { Row } from './db.ts';
import { emit } from './events.ts';

export interface TeamGoalView {
  id: string; title: string; icon: string; target: number; reward: string | null; status: 'active' | 'done';
  progress: number; percent: number; reached: boolean; reachedAt: string | null; doneAt: string | null; createdAt: string;
  /** Each kid's share, biggest first. */
  contributions: { memberId: string; name: string; color: string; avatar: string; points: number }[];
}

// Penalties ('adjust') don't come off a family goal: one kid's rough day shouldn't set everyone back.
const COUNTED = "('chore', 'bonus', 'reversal')";

function contributions(db: DatabaseSync, homeId: string, since: string) {
  return (db.prepare(`SELECT m.id, m.name, m.color, m.avatar, COALESCE(SUM(l.amount), 0) AS points
    FROM members m LEFT JOIN points_ledger l ON l.member_id = m.id AND l.kind IN ${COUNTED} AND l.created_at >= ?
    WHERE m.home_id = ? AND m.role = 'kid' GROUP BY m.id ORDER BY points DESC, m.name`).all(since, homeId) as Row[])
    .map((r) => ({ memberId: r.id as string, name: r.name as string, color: r.color as string, avatar: r.avatar as string, points: Math.max(0, r.points as number) }));
}

export function teamGoalView(db: DatabaseSync, g: Row): TeamGoalView {
  const parts = contributions(db, g.home_id as string, g.created_at as string);
  const progress = parts.reduce((n, p) => n + p.points, 0);
  const target = g.target as number;
  return {
    id: g.id as string, title: g.title as string, icon: g.icon as string, target, reward: (g.reward as string | null) ?? null,
    status: g.status as TeamGoalView['status'], progress, percent: Math.min(100, Math.round((progress / target) * 100)),
    reached: progress >= target, reachedAt: (g.reached_at as string | null) ?? null, doneAt: (g.done_at as string | null) ?? null,
    createdAt: g.created_at as string, contributions: parts,
  };
}

/** Active goals, then ones finished in the last two weeks. */
export function teamGoals(db: DatabaseSync, homeId: string): TeamGoalView[] {
  return (db.prepare(`SELECT * FROM team_goals WHERE home_id = ? AND (status = 'active' OR done_at > datetime('now', '-14 days'))
    ORDER BY status = 'active' DESC, created_at`).all(homeId) as Row[]).map((g) => teamGoalView(db, g));
}

/** After points come in: note (once) any family goal that just got there, and tell Home Assistant. */
export function checkTeamGoals(db: DatabaseSync, homeId: string): void {
  const open = db.prepare("SELECT * FROM team_goals WHERE home_id = ? AND status = 'active' AND reached_at IS NULL").all(homeId) as Row[];
  for (const g of open) {
    const v = teamGoalView(db, g);
    if (!v.reached) continue;
    db.prepare("UPDATE team_goals SET reached_at = datetime('now') WHERE id = ?").run(v.id);
    emit(db, homeId, 'team_goal_reached', null, { goal: v.title, goal_id: v.id, target: v.target, reward: v.reward, progress: v.progress });
  }
}
