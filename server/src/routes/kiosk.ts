// The family tablet: it's paired to a home, shows the kids' avatars, and a kid taps theirs (plus a PIN if they have one).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { KID_COOKIE, startKidSession, type DeviceAuth } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, requireStr } from '../util.ts';
import { clearRateLimit, limitAuth, verifyPassword } from '../security.ts';
import { homeInfo } from '../chores.ts';
import { listKids } from './homes.ts';

function requireDevice(req: FastifyRequest): DeviceAuth {
  if (!req.device) throw new HttpError(401, 'This device is not set up as a family tablet');
  return req.device;
}

export function kioskRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/kiosk', async (req) => {
    const device = requireDevice(req);
    const home = homeInfo(db, device.homeId);
    return { device, home: { id: home.id, name: home.name, pointsName: home.pointsName, pointsIcon: home.pointsIcon }, kids: listKids(db, home.id) };
  });

  app.post('/api/kiosk/kid', async (req, reply) => {
    const device = requireDevice(req);
    const b = (req.body ?? {}) as Row;
    const memberId = requireStr(b.memberId, 'Kid', 60);
    const kid = db.prepare("SELECT id, name, avatar, color, pin_hash FROM members WHERE id = ? AND home_id = ? AND role = 'kid'").get(memberId, device.homeId) as Row | undefined;
    if (!kid) throw new HttpError(404, 'No such kid here');
    if (kid.pin_hash) {
      // Four digits are easy to guess, so a few wrong tries lock that kid's PIN for a while.
      limitAuth(req, 'pin', memberId);
      if (!(await verifyPassword(String(b.pin ?? ''), kid.pin_hash as string))) throw new HttpError(401, 'Oops, wrong PIN');
      clearRateLimit(`pin:acct:${memberId.toLowerCase()}`);
    }
    startKidSession(db, reply, memberId, device.id);
    return { kid: { id: kid.id, name: kid.name, avatar: kid.avatar, color: kid.color } };
  });

  app.post('/api/kiosk/kid/logout', async (req, reply) => {
    if (req.kid) db.prepare('DELETE FROM kid_sessions WHERE id = ?').run(req.kid.sessionHash);
    reply.clearCookie(KID_COOKIE, { path: '/' });
    return { ok: true };
  });
}
