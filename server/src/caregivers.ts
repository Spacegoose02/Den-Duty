// Caregivers: grandparents, babysitters, a nanny or a co-parent's partner. They sign in like a parent but get the
// day-to-day only: see today's chores and calendar, approve and tick off chores and practice, answer the Helpdesk,
// run time-outs, hand out quick rewards and use the shared lists. No settings, money, health, feelings, AI or exports.
// Access can end on a date. Checked once, centrally, in homeCtxFor, so a route can't forget it.
import type { FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import type { Row } from './db.ts';
import { HttpError } from './util.ts';
import { todayIn } from '../../shared/schedule.ts';

const H = '/api/homes/:homeId';

/** What caregivers may change (method and route pattern, exactly as registered). */
const WRITE = new Set([
  'POST /instances/:id/approve', 'POST /instances/:id/reject', 'POST /instances/:id/done', 'POST /instances/:id/photo',
  'POST /instances/:id/start', 'POST /instances/:id/undo', 'POST /instances/:id/unclaim', 'POST /review/approve',
  'POST /habit-logs/:id/approve', 'POST /habit-logs/:id/reject',
  'POST /helpdesk/:id/approve', 'POST /helpdesk/:id/close', 'POST /helpdesk/:id/deny',
  'POST /kids/:memberId/timeouts', 'PATCH /timeouts/:id', 'DELETE /timeouts/:id',
  'POST /timeout-requests/:rid/approve', 'POST /timeout-requests/:rid/deny',
  'POST /quick-rewards/:id/give', 'POST /trades/:id/:answer',
  'POST /lists/:id/items', 'PATCH /list-items/:id', 'DELETE /list-items/:id',
  'POST /push', 'POST /push/remove', 'POST /push/test', 'DELETE /parents/:memberId',
  'POST /kids/:memberId/screen-time/start', 'POST /screen-time/:id/stop',
]);

/** What caregivers may not even look at. */
const HIDDEN = [
  /\/(doctors|therapy|health|meds|share-links|feelings|money|ai|tokens|backups?|export|archive|devices|honeydo|meetings|parent-duty|ha|calendars|weather-link|lootden|photo-frame|caregiver-code)(\/|$)/,
];

export type Access = 'full' | 'caregiver';

/** Throws when a caregiver tries something that isn't theirs to do. */
export function checkCaregiver(req: FastifyRequest, member: Row, timezone: string): void {
  if (member.access !== 'caregiver') return;
  const until = member.access_until as string | null;
  if (until && todayIn(timezone) > until) throw new HttpError(403, 'Your caregiver access to this home has ended. Ask a parent to extend it.');
  const url = req.routeOptions.url ?? '';
  if (!url.startsWith(H)) return;
  const rest = url.slice(H.length) || '/';
  if (['GET', 'HEAD'].includes(req.method)) {
    if (HIDDEN.some((re) => re.test(rest))) throw new HttpError(403, 'Caregivers can’t see this part of Den Duty');
    return;
  }
  if (!WRITE.has(`${req.method} ${rest}`)) throw new HttpError(403, 'Caregivers can’t change this. Ask a parent.');
}

/** A join code: the parents' code joins as a full parent, the caregiver code as a caregiver. */
export function homeForCode(db: DatabaseSync, code: string): { homeId: string; access: Access } | null {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!c) return null;
  const full = db.prepare('SELECT id FROM homes WHERE join_code = ?').get(c) as Row | undefined;
  if (full) return { homeId: full.id as string, access: 'full' };
  const cg = db.prepare('SELECT id FROM homes WHERE caregiver_code = ?').get(c) as Row | undefined;
  return cg ? { homeId: cg.id as string, access: 'caregiver' } : null;
}
