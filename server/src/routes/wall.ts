// The family wall: the family tablet's home page, showing every kid at once for a glance from across the room.
// No sign-in to look (the tablet is already paired). A shared wall is careful by default: no Doctors goals, no
// penalties and no time-out details unless a parent turns them on, and appointments only when shared with that kid.
import type { FastifyInstance } from 'fastify';
import { teamGoals } from '../team.ts';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, parseJson } from '../util.ts';
import { agenda, balance, goalsFor, homeInfo, homeToday, todayList } from '../chores.ts';
import { badgesToday, levelOf, streaks } from '../progress.ts';
import { externalBetween, refreshStale } from '../calendar.ts';
import { roomMessage } from '../roommessage.ts';
import { kidTherapyView, doctorsCalendar } from './therapy.ts';
import { kidTimeouts } from './timeouts.ts';
import { listKids } from './homes.ts';
import { lootdenWall } from './lootden.ts';
import { addDays } from '../../../shared/schedule.ts';

export interface WallSettings {
  /** What a paired family tablet opens to: the family wall or the avatar picker. */
  landing: 'wall' | 'picker';
  /** Dim the wall between these local times (e.g. 21:00 to 06:30). */
  dim: { on: boolean; from: string; to: string };
  /** Extra things a parent may allow on the shared wall. */
  show: { doctors: boolean; penalties: boolean; timeouts: boolean };
}

export const WALL_DEFAULTS: WallSettings = {
  landing: 'wall', dim: { on: false, from: '21:00', to: '06:30' }, show: { doctors: false, penalties: false, timeouts: false },
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function wallSettings(db: DatabaseSync, homeId: string): WallSettings {
  const raw = parseJson<Partial<WallSettings>>((db.prepare('SELECT wall_settings FROM homes WHERE id = ?').get(homeId) as Row | undefined)?.wall_settings, {});
  return {
    landing: raw.landing === 'picker' ? 'picker' : 'wall',
    dim: {
      on: !!raw.dim?.on,
      from: TIME.test(String(raw.dim?.from)) ? raw.dim!.from : WALL_DEFAULTS.dim.from,
      to: TIME.test(String(raw.dim?.to)) ? raw.dim!.to : WALL_DEFAULTS.dim.to,
    },
    show: { doctors: !!raw.show?.doctors, penalties: !!raw.show?.penalties, timeouts: !!raw.show?.timeouts },
  };
}

/** Everything the wall shows, for one home. */
export async function wallData(db: DatabaseSync, homeId: string) {
  const home = homeInfo(db, homeId);
  const today = homeToday(home);
  const tomorrow = addDays(today, 1);
  const settings = wallSettings(db, homeId);
  const kids = listKids(db, homeId);
  const on = (k: (typeof kids)[number], page: string) => !k.pagesOff.includes(page as never);
  const choreKids = kids.filter((k) => on(k, 'chores'));
  const days = agenda(db, homeId, choreKids.map((k) => k.id), today, 2, today);
  // forKid = true: only what a parent shares with each kid, and each kid's items stay under their own name.
  const docs = doctorsCalendar(db, kids.map((k) => k.id), today, tomorrow, true);
  await refreshStale(db, homeId).catch(() => { /* feeds being down must not blank the wall */ });
  const lunch = (externalBetween(db, homeId, today, today, true).get(today) ?? []).filter((x) => x.kind === 'lunch');

  const kidCards = await Promise.all(kids.map(async (k) => {
    const items = on(k, 'chores') ? todayList(db, homeId, k.id, today) : [];
    const goal = on(k, 'goals') ? goalsFor(db, k.id).find((g) => !g.reached) ?? goalsFor(db, k.id)[0] ?? null : null;
    const level = levelOf(db, k.id);
    const penalties = settings.show.penalties
      ? (db.prepare("SELECT reason, amount FROM points_ledger WHERE member_id = ? AND date = ? AND kind = 'adjust' AND amount < 0 ORDER BY id").all(k.id, today) as Row[])
        .map((r) => ({ reason: r.reason as string, amount: r.amount as number }))
      : [];
    const therapy = settings.show.doctors && on(k, 'doctors') ? kidTherapyView(db, k.id, today) : null;
    return {
      id: k.id, name: k.name, avatar: k.avatar, color: k.color, theme: k.theme, hasPin: k.hasPin, pagesOff: k.pagesOff,
      balance: balance(db, k.id),
      level: on(k, 'stats') ? { level: level.level, name: level.name, badge: level.badge } : null,
      chores: on(k, 'chores') ? { done: items.filter((i) => i.status === 'approved').length, waiting: items.filter((i) => i.status === 'submitted').length, total: items.length } : null,
      goal: goal ? { title: goal.title, percent: goal.percent, progress: goal.progress, target: goal.targetPoints, reached: goal.reached } : null,
      streak: on(k, 'stats') ? streaks(db, k.id, today).current : null,
      badgesToday: on(k, 'stats') ? badgesToday(db, k.id, today).map((a) => ({ id: a.id, icon: a.icon, title: a.title })) : [],
      denMessage: on(k, 'chores') ? (await roomMessage(db, homeId, { id: k.id, name: k.name, age: k.age }, today).catch(() => null))?.text ?? null : null,
      timeouts: settings.show.timeouts && on(k, 'timeout')
        ? kidTimeouts(db, k.id).map((t) => ({ id: t.id, what: t.what, state: t.state, endsAt: t.endsAt, startsAt: t.startsAt, minutesLeft: t.minutesLeft }))
        : [],
      penalties,
      doctorGoals: therapy?.goals.map((g) => ({ id: g.id, title: g.title, area: g.area, progress: g.progress })) ?? [],
    };
  }));

  const family = [today, tomorrow].map((date) => {
    const d = days.find((x) => x.date === date);
    const doc = docs.get(date);
    return {
      date,
      kids: kids.map((k) => {
        const items = d?.items.filter((i) => i.memberId === k.id) ?? [];
        return {
          kidId: k.id, chores: items.length, done: items.filter((i) => i.status === 'approved').length,
          practices: settings.show.doctors ? doc?.practices.filter((p) => p.memberId === k.id).length ?? 0 : 0,
          appointments: (doc?.appointments.filter((a) => a.memberId === k.id) ?? []).map((a) => ({ id: a.id, kind: a.kind, title: a.title, time: a.time })),
        };
      }),
    };
  });

  // Open reward votes: options and how many have voted, never who picked what.
  const polls = (db.prepare("SELECT * FROM polls WHERE home_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 3").all(homeId) as Row[]).map((p) => ({
    id: p.id as string, title: p.title as string,
    options: (db.prepare('SELECT id, title, icon FROM poll_options WHERE poll_id = ? ORDER BY position').all(p.id as string) as Row[])
      .map((o) => ({ id: o.id as string, title: o.title as string, icon: o.icon as string })),
    voted: (db.prepare('SELECT COUNT(*) AS n FROM poll_votes WHERE poll_id = ?').get(p.id as string) as Row).n as number,
  }));

  return {
    home: { name: home.name, pointsName: home.pointsName, pointsIcon: home.pointsIcon, theme: home.theme, timezone: home.timezone },
    today, tomorrow, settings: { landing: settings.landing, dim: settings.dim },
    kids: kidCards, family, lunch: lunch.map((x) => ({ title: x.title, time: x.time })), polls,
    teamGoals: teamGoals(db, homeId).filter((g) => g.status === 'active'),
    // LootDen, the family's game library: who's playing, the next game night and screenshots (when linked).
    lootden: await lootdenWall(db, homeId),
  };
}

export function wallRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // The tablet itself: paired devices only (a kid signed in on it counts too).
  app.get('/api/kiosk/wall', async (req) => {
    if (!req.device) throw new HttpError(401, 'This device is not set up as a family tablet');
    return wallData(db, req.device.homeId);
  });

  // Parents: preview the wall, and its settings.
  app.get('/api/homes/:homeId/wall', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return (req.query as { view?: string }).view === '1' ? wallData(db, ctx.homeId) : wallSettings(db, ctx.homeId);
  });

  app.patch('/api/homes/:homeId/wall', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Partial<WallSettings>;
    const cur = wallSettings(db, ctx.homeId);
    if (b.landing != null && b.landing !== 'wall' && b.landing !== 'picker') throw new HttpError(400, 'landing is wall or picker');
    for (const t of [b.dim?.from, b.dim?.to]) if (t != null && !TIME.test(String(t))) throw new HttpError(400, 'Times look like 21:00');
    const next: WallSettings = {
      landing: b.landing ?? cur.landing,
      dim: { on: b.dim?.on ?? cur.dim.on, from: b.dim?.from ?? cur.dim.from, to: b.dim?.to ?? cur.dim.to },
      show: {
        doctors: b.show?.doctors ?? cur.show.doctors, penalties: b.show?.penalties ?? cur.show.penalties, timeouts: b.show?.timeouts ?? cur.show.timeouts,
      },
    };
    next.dim.on = !!next.dim.on;
    next.show = { doctors: !!next.show.doctors, penalties: !!next.show.penalties, timeouts: !!next.show.timeouts };
    db.prepare('UPDATE homes SET wall_settings = ? WHERE id = ?').run(JSON.stringify(next), ctx.homeId);
    return next;
  });
}
