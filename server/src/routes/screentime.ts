// Screen-time bank routes: the kid's bank and sessions, swapping points for minutes, parents granting minutes,
// and the home's settings. Home Assistant can stop a session with a control token (POST /ha/screen-time/stop).
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx, isParent, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, requireStr, str } from '../util.ts';
import { balance, homeInfo, homeToday, writeLedger } from '../chores.ts';
import { emit } from '../events.ts';
import { getKid, listKids, pageOn } from './homes.ts';
import { byOf } from './chores.ts';
import {
  activeSession, bankRoom, endSession, screenBalance, screenSettings, usedOn, writeScreen, SCREEN_DEFAULTS, type ScreenSettings,
} from '../screentime.ts';

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : dflt;
};

export function screenView(db: DatabaseSync, homeId: string, memberId: string) {
  const s = screenSettings(db, homeId);
  const today = homeToday(homeInfo(db, homeId));
  const a = activeSession(db, memberId);
  const used = usedOn(db, memberId, today);
  const bank = screenBalance(db, memberId);
  return {
    settings: s, bank, usedToday: used,
    leftToday: s.dailyMax ? Math.max(s.dailyMax - used, 0) : null,
    points: balance(db, memberId),
    session: a ? { id: a.id as string, minutes: a.minutes as number, startedAt: `${a.started_at}Z`, endsAt: `${a.ends_at}Z` } : null,
    recent: (db.prepare('SELECT minutes, kind, reason, date, by_name FROM screen_ledger WHERE member_id = ? ORDER BY id DESC LIMIT 10').all(memberId) as Row[])
      .map((r) => ({ minutes: r.minutes as number, kind: r.kind as string, reason: r.reason as string, date: r.date as string, by: r.by_name as string | null })),
  };
}

export function screenTimeRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const forKid = (ctx: HomeCtx, memberId: string) => {
    assertCanActFor(ctx, memberId);
    getKid(db, ctx, memberId);
    if (ctx.actor.kind !== 'kid' && !isParent(ctx)) throw new HttpError(403, 'Pick your raccoon first');
    if (!screenSettings(db, ctx.homeId).on) throw new HttpError(403, 'The screen-time bank is off');
    if (!pageOn(db, memberId, 'screentime')) throw new HttpError(403, 'Screen time is switched off for this kid');
  };

  app.get('/api/homes/:homeId/kids/:memberId/screen-time', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    getKid(db, ctx, memberId);
    if (!screenSettings(db, ctx.homeId).on || !pageOn(db, memberId, 'screentime')) return null;
    return screenView(db, ctx.homeId, memberId);
  });

  app.post('/api/homes/:homeId/kids/:memberId/screen-time/start', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    forKid(ctx, memberId);
    const minutes = clampInt((req.body as Row | undefined)?.minutes, 1, 480, 0);
    if (!minutes) throw new HttpError(400, 'How many minutes?');
    const s = screenSettings(db, ctx.homeId);
    const today = homeToday(homeInfo(db, ctx.homeId));
    const id = newId();
    tx(db, () => {
      if (activeSession(db, memberId)) throw new HttpError(400, 'Screen time is already running');
      const bank = screenBalance(db, memberId);
      if (bank < minutes) throw new HttpError(400, `You have ${bank} minutes in the bank`);
      if (s.dailyMax && usedOn(db, memberId, today) + minutes > s.dailyMax) {
        throw new HttpError(400, `That's more than today's ${s.dailyMax} minutes. ${Math.max(s.dailyMax - usedOn(db, memberId, today), 0)} left today.`);
      }
      db.prepare("INSERT INTO screen_sessions (id, home_id, member_id, minutes, ends_at) VALUES (?, ?, ?, ?, datetime('now', ?))").run(id, ctx.homeId, memberId, minutes, `+${minutes} minutes`);
      writeScreen(db, { homeId: ctx.homeId, memberId, minutes: -minutes, kind: 'use', reason: 'Screen time', date: today, sessionId: id, by: isParent(ctx) ? ctx.user?.name ?? null : null });
      const ends = (db.prepare('SELECT ends_at FROM screen_sessions WHERE id = ?').get(id) as Row).ends_at as string;
      emit(db, ctx.homeId, 'screen_time_started', memberId, { session_id: id, minutes, ends_at: `${ends.replace(' ', 'T')}Z`, balance: screenBalance(db, memberId) });
    });
    return screenView(db, ctx.homeId, memberId);
  });

  app.post('/api/homes/:homeId/screen-time/:id/stop', async (req) => {
    const ctx = homeCtx(db, req);
    const s = db.prepare('SELECT * FROM screen_sessions WHERE id = ? AND home_id = ?').get((req.params as { id: string }).id, ctx.homeId) as Row | undefined;
    if (!s) throw new HttpError(404, 'No such screen time');
    assertCanActFor(ctx, s.member_id as string);
    if (ctx.actor.kind !== 'kid' && !isParent(ctx)) throw new HttpError(403, 'Pick your raccoon first');
    if (!s.ended_at) endSession(db, s, isParent(ctx) ? 'parent' : 'stopped', homeToday(homeInfo(db, ctx.homeId)));
    return screenView(db, ctx.homeId, s.member_id as string);
  });

  // Swap points for minutes (a 'redeem' row, so levels never drop).
  app.post('/api/homes/:homeId/kids/:memberId/screen-time/swap', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    forKid(ctx, memberId);
    const s = screenSettings(db, ctx.homeId);
    if (!s.perPoint) throw new HttpError(400, "Swapping points for screen time is off");
    const points = clampInt((req.body as Row | undefined)?.points, 1, 1000, 0);
    if (!points) throw new HttpError(400, 'How many points?');
    const today = homeToday(homeInfo(db, ctx.homeId));
    const home = homeInfo(db, ctx.homeId);
    tx(db, () => {
      if (balance(db, memberId) < points) throw new HttpError(400, `You have ${balance(db, memberId)} ${home.pointsName}`);
      const minutes = points * s.perPoint;
      if (bankRoom(db, ctx.homeId, memberId) < minutes) throw new HttpError(400, `Your bank only holds ${s.bankMax} minutes`);
      writeLedger(db, {
        homeId: ctx.homeId, memberId, amount: -points, kind: 'redeem', reason: `📺 ${minutes} minutes of screen time`, date: today,
        by: isParent(ctx) ? byOf(ctx) : { userId: null, name: 'Screen-time bank' },
      });
      writeScreen(db, { homeId: ctx.homeId, memberId, minutes, kind: 'swap', reason: `Swapped ${points} ${home.pointsName}`, date: today });
    });
    return screenView(db, ctx.homeId, memberId);
  });

  // A parent adds (or takes away) minutes.
  app.post('/api/homes/:homeId/kids/:memberId/screen-time/grant', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const { memberId } = req.params as { memberId: string };
    getKid(db, ctx, memberId);
    const b = (req.body ?? {}) as Row;
    let minutes = clampInt(b.minutes, -600, 600, 0);
    if (!minutes) throw new HttpError(400, 'How many minutes?');
    if (minutes < 0) minutes = -Math.min(-minutes, Math.max(screenBalance(db, memberId), 0));
    writeScreen(db, {
      homeId: ctx.homeId, memberId, minutes, kind: 'grant', reason: str(b.reason, 120) ?? (minutes > 0 ? 'From a grown-up' : 'Taken away'),
      date: homeToday(homeInfo(db, ctx.homeId)), by: ctx.user?.name ?? null,
    });
    return screenView(db, ctx.homeId, memberId);
  });

  app.get('/api/homes/:homeId/screen-time', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const s = screenSettings(db, ctx.homeId);
    return { settings: s, kids: s.on ? listKids(db, ctx.homeId).filter((k) => !k.pagesOff.includes('screentime')).map((k) => ({ id: k.id, name: k.name, avatar: k.avatar, ...screenView(db, ctx.homeId, k.id) })) : [] };
  });

  app.put('/api/homes/:homeId/screen-time', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Partial<ScreenSettings>;
    const cur = screenSettings(db, ctx.homeId);
    const next: ScreenSettings = {
      on: typeof b.on === 'boolean' ? b.on : cur.on,
      perChorePoint: b.perChorePoint !== undefined ? clampInt(b.perChorePoint, 0, 60, SCREEN_DEFAULTS.perChorePoint) : cur.perChorePoint,
      perPoint: b.perPoint !== undefined ? clampInt(b.perPoint, 0, 60, SCREEN_DEFAULTS.perPoint) : cur.perPoint,
      dailyMax: b.dailyMax !== undefined ? clampInt(b.dailyMax, 0, 1440, SCREEN_DEFAULTS.dailyMax) : cur.dailyMax,
      bankMax: b.bankMax !== undefined ? clampInt(b.bankMax, 0, 10000, SCREEN_DEFAULTS.bankMax) : cur.bankMax,
    };
    db.prepare('UPDATE homes SET screen_time = ? WHERE id = ?').run(JSON.stringify(next), ctx.homeId);
    return next;
  });

  // Home Assistant: "stop Ava's screen time" (or a parent's button), with a control token.
  app.post('/api/homes/:homeId/ha/screen-time/stop', async (req) => {
    const ctx = homeCtx(db, req);
    if (!(isParent(ctx) || (ctx.actor.kind === 'token' && ctx.actor.scope === 'control'))) throw new HttpError(403, 'This needs a control token');
    const kidKey = requireStr((req.body as Row | undefined)?.kid, 'Kid', 60).toLowerCase();
    const k = listKids(db, ctx.homeId).find((x) => x.id === kidKey || x.name.toLowerCase().startsWith(kidKey));
    if (!k) throw new HttpError(404, 'No such kid');
    const s = activeSession(db, k.id);
    if (!s) return { stopped: false, speech: `${k.name} isn't using screen time right now.` };
    endSession(db, s, 'parent', homeToday(homeInfo(db, ctx.homeId)));
    return { stopped: true, speech: `Stopped ${k.name}'s screen time.` };
  });
}
