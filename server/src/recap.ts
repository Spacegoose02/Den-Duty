// The weekly recap: how last week went for each kid next to the week before, the family's totals and a few
// highlights worth cheering about (or working on). Parents see it on Home when a new week starts.
import type { DatabaseSync } from 'node:sqlite';
import type { Row } from './db.ts';
import { kidsWithPageOff, type HomeInfo } from './chores.ts';
import { computeWeek } from './archive.ts';
import { listKids } from './routes/homes.ts';
import { addDays, startOfWeek } from '../../shared/schedule.ts';

export interface KidRecap {
  id: string; name: string; avatar: string; color: string;
  points: number; prevPoints: number; done: number; due: number; prevDone: number; prevDue: number;
  /** Percent of chores done (null when nothing was due). */
  rate: number | null; prevRate: number | null;
  perfectDays: number; streak: number; bonusDone: number; late: number; spent: number;
  best: { title: string; icon: string; done: number } | null;
  /** The chore most often missed (at least two missed). */
  missed: { title: string; icon: string; missed: number } | null;
}

const rateOf = (done: number, due: number) => (due ? Math.round((done / due) * 100) : null);

export function lastWeekStart(home: HomeInfo, today: string): string {
  return addDays(startOfWeek(today, home.weekStart), -7);
}

export function recap(db: DatabaseSync, home: HomeInfo, today: string, weekStart = lastWeekStart(home, today)) {
  const weekEnd = addDays(weekStart, 6);
  const off = kidsWithPageOff(db, home.id, 'chores');
  const kids: KidRecap[] = listKids(db, home.id).filter((k) => !off.has(k.id)).map((k) => {
    const w = computeWeek(db, home, k.id, weekStart, today);
    const p = computeWeek(db, home, k.id, addDays(weekStart, -7), today);
    const late = Number((db.prepare('SELECT COUNT(*) AS n FROM chore_instances WHERE member_id = ? AND date BETWEEN ? AND ? AND late = 1').get(k.id, weekStart, weekEnd) as Row).n);
    const best = [...w.chores].filter((c) => c.done > 0).sort((a, b) => b.done - a.done)[0];
    const missed = [...w.chores].map((c) => ({ ...c, missed: c.due - c.done })).filter((c) => c.missed >= 2).sort((a, b) => b.missed - a.missed)[0];
    return {
      id: k.id, name: k.name, avatar: k.avatar, color: k.color,
      points: w.points, prevPoints: p.points, done: w.done, due: w.due, prevDone: p.done, prevDue: p.due,
      rate: rateOf(w.done, w.due), prevRate: rateOf(p.done, p.due),
      perfectDays: w.perfectDays, streak: w.streak, bonusDone: w.bonusDone, late, spent: w.spent,
      best: best ? { title: best.title, icon: best.icon, done: best.done } : null,
      missed: missed ? { title: missed.title, icon: missed.icon, missed: missed.missed } : null,
    };
  });
  const total = kids.reduce((s, k) => ({ points: s.points + k.points, done: s.done + k.done, due: s.due + k.due, prevPoints: s.prevPoints + k.prevPoints }), { points: 0, done: 0, due: 0, prevPoints: 0 });
  const highlights: string[] = [];
  const ranked = kids.filter((k) => k.rate != null).sort((a, b) => b.rate! - a.rate! || b.points - a.points);
  if (ranked.length > 1 && ranked[0].rate! > 0) highlights.push(`🏅 ${ranked[0].name} did the most of their chores: ${ranked[0].rate}%`);
  for (const k of kids) {
    if (k.rate != null && k.prevRate != null && k.rate - k.prevRate >= 15) highlights.push(`📈 ${k.name} went from ${k.prevRate}% to ${k.rate}% of chores done`);
    if (k.perfectDays >= 5) highlights.push(`🌟 ${k.name} had ${k.perfectDays} perfect days`);
    if (k.streak >= 7) highlights.push(`🔥 ${k.name} is on a ${k.streak}-day streak`);
    if (k.bonusDone >= 3) highlights.push(`💪 ${k.name} took on ${k.bonusDone} bonus chores`);
  }
  const workOn = kids.filter((k) => k.missed || (k.rate != null && k.prevRate != null && k.prevRate - k.rate >= 15) || k.late >= 3).map((k) => {
    if (k.missed) return `${k.missed.icon} ${k.name} missed “${k.missed.title}” ${k.missed.missed} times`;
    if (k.late >= 3) return `⏰ ${k.name} finished ${k.late} chores late`;
    return `📉 ${k.name} dipped from ${k.prevRate}% to ${k.rate}%`;
  });
  return { weekStart, weekEnd, kids, total: { ...total, rate: rateOf(total.done, total.due) }, highlights, workOn };
}

/** A new recap a parent hasn't opened yet (only once there's something in it). */
export function recapWaiting(db: DatabaseSync, home: HomeInfo, today: string): string | null {
  const week = lastWeekStart(home, today);
  const seen = (db.prepare('SELECT recap_seen FROM homes WHERE id = ?').get(home.id) as Row).recap_seen as string | null;
  if (seen && seen >= week) return null;
  const any = db.prepare('SELECT 1 FROM chore_instances WHERE home_id = ? AND date BETWEEN ? AND ? LIMIT 1').get(home.id, week, addDays(week, 6));
  return any ? week : null;
}
