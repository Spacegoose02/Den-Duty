import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { addParent, DEVICE_COOKIE, homeCtx, KID_COOKIE, requireAdmin, requireUser, startDevice, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { config } from '../config.ts';
import { HttpError, newId, randomToken, readableCode, requireStr, sha256, str } from '../util.ts';
import { hashPassword } from '../security.ts';
import { balance, homeInfo, homeToday } from '../chores.ts';
import { ageOn, pictureMode } from '../../../shared/ages.ts';
import { DOCTOR_AREA_IDS, IDEAS_OFF_DEFAULT, KID_PAGE_IDS, offList, PRACTICE_IDEA_IDS, type DoctorArea, type KidPage, type PracticeIdea } from '../../../shared/pages.ts';
import { AVATARS, isAvatar, isKidColor, KID_COLORS, POINT_ICONS } from '../../../shared/catalog.ts';
import { isIsoDate, isTimeZone } from '../../../shared/schedule.ts';
import { isThemeId } from '../../../shared/themes.ts';

export const STARTER_QUICK_REWARDS = [
  { title: 'Great attitude', icon: '🌟', amount: 2 },
  { title: 'Helped someone', icon: '🤝', amount: 3 },
  { title: 'Tried something hard', icon: '🧠', amount: 2 },
  { title: 'Ready on time', icon: '🎒', amount: 1 },
];

export function seedQuickRewards(db: DatabaseSync, homeId: string): void {
  const ins = db.prepare('INSERT INTO quick_rewards (id, home_id, title, icon, amount, position) VALUES (?, ?, ?, ?, ?, ?)');
  STARTER_QUICK_REWARDS.forEach((r, i) => ins.run(newId(), homeId, r.title, r.icon, r.amount, i));
}

export function createHome(db: DatabaseSync, user: { id: string; name: string; avatar: string }, name: string, timezone?: string | null): string {
  const id = newId();
  tx(db, () => {
    db.prepare('INSERT INTO homes (id, name, join_code, timezone) VALUES (?, ?, ?, ?)')
      .run(id, name, readableCode(8), isTimeZone(timezone) ? timezone : config.defaultTimezone);
    addParent(db, id, user);
    seedQuickRewards(db, id);
  });
  return id;
}

/** One emoji (or a couple of characters) for icons; keeps people from pasting paragraphs. */
export function cleanIcon(v: unknown, fallback: string): string {
  const s = str(v, 16);
  if (!s) return fallback;
  return [...new Intl.Segmenter().segment(s)].slice(0, 2).map((x) => x.segment).join('');
}

function cleanPin(v: unknown): string {
  const pin = String(v ?? '');
  if (!/^\d{4}$/.test(pin)) throw new HttpError(400, 'A PIN is exactly 4 digits');
  return pin;
}

/** What kids look like to anyone in the home: no PIN, just whether there is one. */
export function kidView(db: DatabaseSync, r: Row) {
  const birthdate = (r.birthdate as string | null) ?? null;
  const age = birthdate ? ageOn(birthdate, homeToday(homeInfo(db, r.home_id as string))) : null;
  const setting = (r.picture_mode as string | null) ?? 'auto';
  return {
    id: r.id as string, name: r.name as string, avatar: r.avatar as string, color: r.color as string,
    theme: (r.theme as string | null) ?? null, hasPin: !!r.pin_hash, balance: balance(db, r.id as string),
    birthdate, age, pictureModeSetting: setting, pictureMode: pictureMode(setting, age),
    pagesOff: offList(r.pages_off, KID_PAGE_IDS), doctorAreasOff: offList(r.doctor_areas_off, DOCTOR_AREA_IDS),
    ideasOff: r.ideas_off == null ? IDEAS_OFF_DEFAULT : offList(r.ideas_off, PRACTICE_IDEA_IDS),
    aiOn: !r.ai_off,
  };
}

/** Birthdate ('' clears it) and picture mode ('auto' follows the age), shared by add and edit. */
function applyKidProfile(db: DatabaseSync, id: string, b: Row, today: string): void {
  if ('birthdate' in b) {
    const v = b.birthdate == null || b.birthdate === '' ? null : String(b.birthdate);
    if (v && (!isIsoDate(v) || v > today)) throw new HttpError(400, 'Birthdays look like 2019-05-14 and can\'t be in the future');
    db.prepare('UPDATE members SET birthdate = ? WHERE id = ?').run(v, id);
  }
  // Page and Doctors-section switches: lists of what's turned off for this kid. Off hides, it never deletes.
  if ('pagesOff' in b) db.prepare('UPDATE members SET pages_off = ? WHERE id = ?').run(JSON.stringify(offList(b.pagesOff, KID_PAGE_IDS)), id);
  if ('doctorAreasOff' in b) db.prepare('UPDATE members SET doctor_areas_off = ? WHERE id = ?').run(JSON.stringify(offList(b.doctorAreasOff, DOCTOR_AREA_IDS)), id);
  if (typeof b.aiOn === 'boolean') db.prepare('UPDATE members SET ai_off = ? WHERE id = ?').run(b.aiOn ? 0 : 1, id);
  if ('ideasOff' in b) db.prepare('UPDATE members SET ideas_off = ? WHERE id = ?').run(JSON.stringify(offList(b.ideasOff, PRACTICE_IDEA_IDS)), id);
  if ('pictureMode' in b) {
    if (!['auto', 'on', 'off'].includes(String(b.pictureMode))) throw new HttpError(400, 'pictureMode must be auto, on or off');
    db.prepare('UPDATE members SET picture_mode = ? WHERE id = ?').run(String(b.pictureMode), id);
  }
}

export function listKids(db: DatabaseSync, homeId: string) {
  return (db.prepare("SELECT * FROM members WHERE home_id = ? AND role = 'kid' ORDER BY position, created_at").all(homeId) as Row[])
    .map((r) => kidView(db, r));
}

export function getKid(db: DatabaseSync, ctx: HomeCtx, memberId: string): Row {
  const kid = db.prepare("SELECT * FROM members WHERE id = ? AND home_id = ? AND role = 'kid'").get(memberId, ctx.homeId) as Row | undefined;
  if (!kid) throw new HttpError(404, 'No such kid in this home');
  return kid;
}

export function homeRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.post('/api/homes', async (req) => {
    const user = requireUser(req);
    const b = (req.body ?? {}) as Row;
    return { id: createHome(db, user, requireStr(b.name, 'Home name', 80), str(b.timezone, 60)) };
  });

  app.post('/api/homes/join', async (req) => {
    const user = requireUser(req);
    const code = requireStr((req.body as Row)?.code, 'Join code', 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const home = db.prepare('SELECT id FROM homes WHERE join_code = ?').get(code) as Row | undefined;
    if (!home) throw new HttpError(404, 'No home has that join code');
    addParent(db, home.id as string, user);
    return { id: home.id };
  });

  app.get('/api/homes/:homeId', async (req) => {
    const ctx = homeCtx(db, req);
    const home = db.prepare('SELECT * FROM homes WHERE id = ?').get(ctx.homeId) as Row;
    const base = {
      id: home.id as string,
      name: home.name as string,
      pointsName: home.points_name as string,
      pointsIcon: home.points_icon as string,
      theme: home.theme as string,
      timezone: home.timezone as string,
      weekStart: home.week_start as number,
      allowNegative: !!home.allow_negative,
      helpdeskMaxOpen: (home.helpdesk_max_open as number) ?? 3,
      viewer: ctx.actor.kind,
      kids: listKids(db, ctx.homeId),
    };
    if (ctx.actor.kind !== 'parent') return base;
    const parents = db.prepare(`
      SELECT m.id, m.user_id AS userId, m.name, m.avatar, m.created_at AS joinedAt FROM members m
      WHERE m.home_id = ? AND m.role = 'parent' ORDER BY m.created_at`).all(ctx.homeId);
    return { ...base, joinCode: home.join_code as string, parents, haWebhookUrl: home.ha_webhook_url as string | null };
  });

  app.patch('/api/homes/:homeId', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    const name = str(b.name, 80);
    if (name) db.prepare('UPDATE homes SET name = ? WHERE id = ?').run(name, ctx.homeId);
    const pointsName = str(b.pointsName, 30);
    if (pointsName) db.prepare('UPDATE homes SET points_name = ? WHERE id = ?').run(pointsName, ctx.homeId);
    if ('pointsIcon' in b) db.prepare('UPDATE homes SET points_icon = ? WHERE id = ?').run(cleanIcon(b.pointsIcon, POINT_ICONS[0]), ctx.homeId);
    if ('timezone' in b) {
      if (!isTimeZone(b.timezone)) throw new HttpError(400, 'Unknown time zone');
      db.prepare('UPDATE homes SET timezone = ? WHERE id = ?').run(b.timezone, ctx.homeId);
    }
    if ('theme' in b) {
      if (!isThemeId(b.theme)) throw new HttpError(400, 'Unknown theme');
      db.prepare('UPDATE homes SET theme = ? WHERE id = ?').run(b.theme, ctx.homeId);
    }
    if ('haWebhookUrl' in b) {
      const url = str(b.haWebhookUrl, 500);
      if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, 'The webhook URL should start with http:// or https://');
      db.prepare('UPDATE homes SET ha_webhook_url = ? WHERE id = ?').run(url, ctx.homeId);
    }
    if ('helpdeskMaxOpen' in b) {
      const n = Number(b.helpdeskMaxOpen);
      if (!Number.isInteger(n) || n < 1 || n > 20) throw new HttpError(400, 'Open Helpdesk requests per kid: 1 to 20');
      db.prepare('UPDATE homes SET helpdesk_max_open = ? WHERE id = ?').run(n, ctx.homeId);
    }
    if (typeof b.allowNegative === 'boolean') db.prepare('UPDATE homes SET allow_negative = ? WHERE id = ?').run(b.allowNegative ? 1 : 0, ctx.homeId);
    if (b.weekStart === 0 || b.weekStart === 1) db.prepare('UPDATE homes SET week_start = ? WHERE id = ?').run(b.weekStart, ctx.homeId);
    return { ok: true };
  });

  app.delete('/api/homes/:homeId', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM homes WHERE id = ?').run(ctx.homeId);
    return { ok: true };
  });

  app.post('/api/homes/:homeId/join-code', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const code = readableCode(8);
    db.prepare('UPDATE homes SET join_code = ? WHERE id = ?').run(code, ctx.homeId);
    return { joinCode: code };
  });

  // Parents can leave, and remove other parents, as long as one stays.
  app.delete('/api/homes/:homeId/parents/:memberId', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const { memberId } = req.params as { memberId: string };
    const parents = db.prepare("SELECT id FROM members WHERE home_id = ? AND role = 'parent'").all(ctx.homeId) as Row[];
    if (!parents.some((p) => p.id === memberId)) throw new HttpError(404, 'No such parent in this home');
    if (parents.length === 1) throw new HttpError(400, 'A home needs at least one parent. Invite someone else first, or delete the home.');
    db.prepare('DELETE FROM members WHERE id = ?').run(memberId);
    return { ok: true };
  });

  // ---------- kids ----------
  app.get('/api/homes/:homeId/kids', async (req) => {
    const ctx = homeCtx(db, req);
    return listKids(db, ctx.homeId);
  });

  app.post('/api/homes/:homeId/kids', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    const name = requireStr(b.name, 'Name', 40);
    const count = (db.prepare("SELECT COUNT(*) AS n FROM members WHERE home_id = ? AND role = 'kid'").get(ctx.homeId) as Row).n as number;
    if (count >= 20) throw new HttpError(400, "That's a lot of kids! 20 is the limit.");
    const id = newId();
    const pin = b.pin == null || b.pin === '' ? null : await hashPassword(cleanPin(b.pin));
    db.prepare("INSERT INTO members (id, home_id, role, name, avatar, color, pin_hash, position, theme) VALUES (?, ?, 'kid', ?, ?, ?, ?, ?, ?)")
      .run(id, ctx.homeId, name, isAvatar(b.avatar) ? b.avatar : AVATARS[count % 8],
        isKidColor(b.color) ? b.color : KID_COLORS[count % KID_COLORS.length], pin, count, isThemeId(b.theme) ? b.theme : null);
    applyKidProfile(db, id, b, homeToday(homeInfo(db, ctx.homeId)));
    return kidView(db, getKid(db, ctx, id));
  });

  app.patch('/api/homes/:homeId/kids/:memberId', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const b = (req.body ?? {}) as Row;
    const name = str(b.name, 40);
    if (name) db.prepare('UPDATE members SET name = ? WHERE id = ?').run(name, kid.id as string);
    if (isAvatar(b.avatar)) db.prepare('UPDATE members SET avatar = ? WHERE id = ?').run(b.avatar, kid.id as string);
    if (isKidColor(b.color)) db.prepare('UPDATE members SET color = ? WHERE id = ?').run(b.color, kid.id as string);
    // A kid's own theme for their board; empty means follow the home.
    if ('theme' in b) {
      if (b.theme != null && b.theme !== '' && !isThemeId(b.theme)) throw new HttpError(400, 'Unknown theme');
      db.prepare('UPDATE members SET theme = ? WHERE id = ?').run(b.theme || null, kid.id as string);
    }
    if ('pin' in b) {
      const hash = b.pin == null || b.pin === '' ? null : await hashPassword(cleanPin(b.pin));
      db.prepare('UPDATE members SET pin_hash = ? WHERE id = ?').run(hash, kid.id as string);
    }
    if (Number.isInteger(b.position)) db.prepare('UPDATE members SET position = ? WHERE id = ?').run(b.position as number, kid.id as string);
    applyKidProfile(db, kid.id as string, b, homeToday(homeInfo(db, ctx.homeId)));
    return kidView(db, getKid(db, ctx, kid.id as string));
  });

  // Removes the kid with all their chores, goals and points history.
  app.delete('/api/homes/:homeId/kids/:memberId', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    db.prepare('DELETE FROM members WHERE id = ?').run(kid.id as string);
    return { ok: true };
  });

  // ---------- family tablets ----------
  app.get('/api/homes/:homeId/devices', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return (db.prepare('SELECT id, name, last_seen_at, created_at FROM devices WHERE home_id = ? ORDER BY created_at').all(ctx.homeId) as Row[])
      .map((d) => ({ id: d.id, name: d.name, lastSeenAt: d.last_seen_at, createdAt: d.created_at, current: d.id === req.device?.id }));
  });

  // "Make this the family tablet": pairs the browser the parent is using right now.
  app.post('/api/homes/:homeId/devices', async (req, reply) => {
    const ctx = homeCtx(db, req, 'parent');
    if (req.device) db.prepare('DELETE FROM devices WHERE id = ?').run(req.device.id);
    return { device: startDevice(db, reply, ctx.homeId, str((req.body as Row)?.name, 60) ?? 'Family tablet', ctx.user!.id) };
  });

  app.delete('/api/homes/:homeId/devices/:deviceId', async (req, reply) => {
    const ctx = homeCtx(db, req, 'parent');
    const { deviceId } = req.params as { deviceId: string };
    db.prepare('DELETE FROM devices WHERE id = ? AND home_id = ?').run(deviceId, ctx.homeId);
    if (deviceId === req.device?.id) {
      reply.clearCookie(DEVICE_COOKIE, { path: '/' });
      reply.clearCookie(KID_COOKIE, { path: '/' });
    }
    return { ok: true };
  });

  // ---------- API tokens for Home Assistant and other automations ----------
  app.get('/api/homes/:homeId/tokens', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return db.prepare('SELECT id, name, scope, last_used_at, created_at FROM api_tokens WHERE home_id = ? ORDER BY created_at DESC').all(ctx.homeId);
  });

  app.post('/api/homes/:homeId/tokens', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const name = requireStr((req.body as Row)?.name, 'Token name', 60);
    const scope = (req.body as Row)?.scope === 'control' ? 'control' : 'read';
    const token = `dnk_${randomToken(30)}`;
    db.prepare('INSERT INTO api_tokens (id, home_id, name, token_hash, created_by, scope) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId(), ctx.homeId, name, sha256(token), ctx.user?.id ?? null, scope);
    // The plain token is shown exactly once.
    return { token };
  });

  app.delete('/api/homes/:homeId/tokens/:tokenId', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM api_tokens WHERE id = ? AND home_id = ?').run((req.params as { tokenId: string }).tokenId, ctx.homeId);
    return { ok: true };
  });

  // ---------- server administration ----------
  app.get('/api/admin/overview', async (req) => {
    requireAdmin(req);
    const users = db.prepare(`
      SELECT u.id, u.name, u.username, u.email, u.is_admin, u.disabled, u.totp_enabled, u.created_at,
        (u.password_hash IS NOT NULL) AS has_password, (u.google_sub IS NOT NULL) AS has_google,
        (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys,
        (SELECT COUNT(*) FROM members m WHERE m.user_id = u.id) AS homes
      FROM users u ORDER BY u.created_at`).all();
    const homes = db.prepare(`
      SELECT h.id, h.name, h.created_at,
        (SELECT COUNT(*) FROM members m WHERE m.home_id = h.id AND m.role = 'parent') AS parents,
        (SELECT COUNT(*) FROM members m WHERE m.home_id = h.id AND m.role = 'kid') AS kids,
        (SELECT COUNT(*) FROM chores c WHERE c.home_id = h.id AND c.active = 1) AS chores
      FROM homes h ORDER BY h.name`).all();
    return { users, homes };
  });

  app.patch('/api/admin/users/:userId', async (req) => {
    const admin = requireAdmin(req);
    const { userId } = req.params as { userId: string };
    const isAdmin = (req.body as Row)?.isAdmin;
    if (typeof isAdmin !== 'boolean') throw new HttpError(400, 'isAdmin must be true or false');
    if (!isAdmin && userId === admin.id) throw new HttpError(400, "You can't remove your own admin rights");
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
    return { ok: true };
  });

  app.delete('/api/admin/users/:userId', async (req) => {
    const admin = requireAdmin(req);
    const { userId } = req.params as { userId: string };
    if (userId === admin.id) throw new HttpError(400, "You can't delete yourself");
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return { ok: true };
  });
}

/** Is this page turned on for this kid? */
export function pageOn(db: DatabaseSync, memberId: string, page: KidPage): boolean {
  const r = db.prepare('SELECT pages_off FROM members WHERE id = ?').get(memberId) as Row | undefined;
  return !offList(r?.pages_off, KID_PAGE_IDS).includes(page);
}

/** Doctors sections turned off for this kid. */
export function doctorAreasOff(db: DatabaseSync, memberId: string): DoctorArea[] {
  const r = db.prepare('SELECT doctor_areas_off FROM members WHERE id = ?').get(memberId) as Row | undefined;
  return offList(r?.doctor_areas_off, DOCTOR_AREA_IDS);
}

/** Daily practice ideas switched off for this kid. */
export function ideasOff(db: DatabaseSync, memberId: string): PracticeIdea[] {
  const r = db.prepare('SELECT ideas_off FROM members WHERE id = ?').get(memberId) as Row | undefined;
  return r?.ideas_off == null ? IDEAS_OFF_DEFAULT : offList(r.ideas_off, PRACTICE_IDEA_IDS);
}

/** Is AI allowed for this kid (the per-kid master switch; the home switch is checked separately)? */
export function kidAiOn(db: DatabaseSync, memberId: string): boolean {
  return !(db.prepare('SELECT ai_off FROM members WHERE id = ?').get(memberId) as Row | undefined)?.ai_off;
}
