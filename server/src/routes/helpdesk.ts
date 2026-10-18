// Helpdesk: a kid asks a grown-up for help ("help with my science project", "can we buy new shoes"). Parents say yes
// (it becomes a card on that kid's Parent Duty board, with the due date on the calendar) or "not this time" with a
// kind note. Only parents and the asking kid ever see a request: never the family wall or another kid's board.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx, type HomeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, requireStr, str } from '../util.ts';
import { homeInfo, homeToday, kidsWithPageOff } from '../chores.ts';
import { emit } from '../events.ts';
import { rateLimit } from '../security.ts';
import { getKid, pageOn } from './homes.ts';
import { HELP_PICKS } from '../../../shared/pages.ts';
import { isIsoDate } from '../../../shared/schedule.ts';

type KidStatus = 'waiting' | 'yes' | 'doing' | 'done' | 'no' | 'cancelled' | 'closed';

const pickOf = (kind: string) => HELP_PICKS.find((p) => p.id === kind) ?? HELP_PICKS[HELP_PICKS.length - 1];

/** A request plus how it's going, from the kid's side: a yes follows its Parent Duty card (doing, done). */
export function requestView(r: Row) {
  const pick = pickOf(r.kind as string);
  const status: KidStatus = r.closed_at ? 'closed' : r.status === 'waiting' ? 'waiting' : r.status === 'denied' ? 'no' : r.status === 'cancelled' ? 'cancelled'
    : r.duty_status === 'done' ? 'done' : r.duty_status === 'doing' ? 'doing' : 'yes';
  return {
    id: r.id as string, memberId: r.member_id as string, kind: pick.id, icon: pick.icon, label: pick.label,
    text: r.text as string | null, dueDate: r.due_date as string | null, status, note: r.note as string | null,
    dutyId: r.duty_id as string | null, createdAt: r.created_at as string, decidedAt: r.decided_at as string | null,
    closedAt: r.closed_at as string | null, closeNote: r.close_note as string | null, closedByKid: !!r.closed_by_kid,
  };
}

const SELECT = `SELECT r.*, h.status AS duty_status FROM helpdesk_requests r LEFT JOIN honeydo h ON h.id = r.duty_id`;

/** Waiting requests across the home, for the parent home, the count badge and Home Assistant. */
export function waitingRequests(db: DatabaseSync, homeId: string) {
  const off = kidsWithPageOff(db, homeId, 'helpdesk');
  return (db.prepare(`${SELECT.replace('SELECT r.*', 'SELECT r.*, m.name AS kid_name, m.avatar AS kid_avatar, m.color AS kid_color')}
    JOIN members m ON m.id = r.member_id WHERE r.home_id = ? AND r.status = 'waiting' AND r.closed_at IS NULL ORDER BY r.created_at`).all(homeId) as Row[])
    .filter((r) => !off.has(r.member_id as string))
    .map((r) => ({ ...requestView(r), kid: { name: r.kid_name as string, avatar: r.kid_avatar as string, color: r.kid_color as string } }));
}

export function helpdeskRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const own = (ctx: HomeCtx, id: string): Row => {
    const r = db.prepare(`${SELECT} WHERE r.id = ? AND r.home_id = ?`).get(id, ctx.homeId) as Row | undefined;
    if (!r) throw new HttpError(404, 'That request is gone');
    return r;
  };
  const waiting = (r: Row) => { if (r.status !== 'waiting' || r.closed_at) throw new HttpError(400, 'That request was already answered'); };
  const on = (memberId: string, name: unknown) => {
    if (!pageOn(db, memberId, 'helpdesk')) throw new HttpError(403, `Helpdesk is turned off for ${name}`);
  };

  // A kid's own requests (open ones, and answers from the last 30 days).
  app.get('/api/homes/:homeId/kids/:memberId/helpdesk', async (req) => {
    const ctx = homeCtx(db, req);
    if (ctx.actor.kind === 'token') throw new HttpError(403, 'Helpdesk requests stay between a kid and their grown-ups');
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    getKid(db, ctx, memberId);
    if (!pageOn(db, memberId, 'helpdesk')) return [];
    // Open ones always; finished, answered and closed ones as history for 60 days (until a parent clears them).
    return (db.prepare(`${SELECT} WHERE r.member_id = ? AND r.status != 'cancelled'
      AND ((r.closed_at IS NULL AND (r.status = 'waiting' OR (r.status = 'approved' AND COALESCE(h.status, '') != 'done')))
        OR COALESCE(r.closed_at, r.decided_at, r.created_at) > datetime('now', '-60 days'))
      ORDER BY r.created_at DESC LIMIT 50`).all(memberId) as Row[]).map(requestView);
  });

  // The kid asks. Only the kid themselves (signed in on the tablet) or a parent on their behalf.
  app.post('/api/homes/:homeId/kids/:memberId/helpdesk', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    if (ctx.actor.kind !== 'kid' && ctx.actor.kind !== 'parent') throw new HttpError(403, 'Tap your raccoon first');
    assertCanActFor(ctx, memberId);
    const kid = getKid(db, ctx, memberId);
    on(memberId, kid.name);
    const b = (req.body ?? {}) as Row;
    const pick = HELP_PICKS.find((p) => p.id === b.kind);
    if (!pick) throw new HttpError(400, 'Pick what you need help with');
    const text = str(b.text, 200);
    if (pick.id === 'other' && !text) throw new HttpError(400, 'Tell us what you need');
    const due = b.dueDate == null || b.dueDate === '' ? null : b.dueDate;
    if (due != null && (!isIsoDate(due) || due < homeToday(homeInfo(db, ctx.homeId)))) throw new HttpError(400, 'Pick today or a day after');
    // No spamming the grown-ups: a cap on open requests per kid (Settings), and a few asks a minute at most.
    const max = (db.prepare('SELECT helpdesk_max_open FROM homes WHERE id = ?').get(ctx.homeId) as Row).helpdesk_max_open as number;
    const open = (db.prepare("SELECT COUNT(*) AS n FROM helpdesk_requests WHERE member_id = ? AND status = 'waiting' AND closed_at IS NULL").get(memberId) as Row).n as number;
    if (open >= max) throw new HttpError(429, `You already have ${open} waiting. Let a grown-up answer those first!`);
    rateLimit(`helpdesk:${memberId}`, 5, 60e3);
    const id = newId();
    db.prepare('INSERT INTO helpdesk_requests (id, home_id, member_id, kind, text, due_date) VALUES (?, ?, ?, ?, ?, ?)').run(id, ctx.homeId, memberId, pick.id, text, due);
    emit(db, ctx.homeId, 'helpdesk_requested', memberId, { request: text ? `${pick.label}: ${text}` : pick.label, due_date: due, request_id: id });
    return requestView(own(ctx, id));
  });

  // The kid takes back a request nobody has answered yet.
  app.delete('/api/homes/:homeId/helpdesk/:id', async (req) => {
    const ctx = homeCtx(db, req);
    const r = own(ctx, (req.params as { id: string }).id);
    assertCanActFor(ctx, r.member_id as string);
    if (ctx.actor.kind !== 'kid' && ctx.actor.kind !== 'parent') throw new HttpError(403, 'Tap your raccoon first');
    waiting(r);
    db.prepare("UPDATE helpdesk_requests SET status = 'cancelled', decided_at = datetime('now') WHERE id = ?").run(r.id as string);
    return { ok: true };
  });

  // Close a ticket at any stage, with an optional note. A parent can choose whether the linked Parent Duty card is
  // marked done (the default); a kid closing their own ("All set, thanks!") always finishes the card, noting it was them.
  app.post('/api/homes/:homeId/helpdesk/:id/close', async (req) => {
    const ctx = homeCtx(db, req);
    if (ctx.actor.kind !== 'kid' && ctx.actor.kind !== 'parent') throw new HttpError(403, 'Tap your raccoon first');
    const r = own(ctx, (req.params as { id: string }).id);
    assertCanActFor(ctx, r.member_id as string);
    if (r.closed_at) throw new HttpError(400, 'That one is already closed');
    if (r.status === 'cancelled') throw new HttpError(400, 'That one was taken back');
    const b = (req.body ?? {}) as Row;
    const byKid = ctx.actor.kind === 'kid';
    const note = str(b.note, 200) ?? (byKid ? 'All set, thanks!' : null);
    const finishCard = byKid || b.finishCard !== false;
    tx(db, () => {
      db.prepare("UPDATE helpdesk_requests SET closed_at = datetime('now'), close_note = ?, closed_by_kid = ? WHERE id = ?").run(note, byKid ? 1 : 0, r.id as string);
      if (r.duty_id && finishCard) {
        const kidName = (db.prepare('SELECT name FROM members WHERE id = ?').get(r.member_id as string) as Row).name as string;
        db.prepare(`UPDATE honeydo SET status = 'done', done_at = COALESCE(done_at, datetime('now')),
          notes = CASE WHEN ? IS NULL THEN notes ELSE COALESCE(notes || char(10), '') || ? END WHERE id = ?`)
          .run(note, byKid ? `✔️ ${kidName} closed it: “${note}”` : `✔️ Closed: “${note}”`, r.duty_id as string);
      }
    });
    emit(db, ctx.homeId, 'helpdesk_answered', r.member_id as string, { answer: 'closed', by: byKid ? 'kid' : 'parent', request_id: r.id });
    return requestView(own(ctx, r.id as string));
  });

  // Parents: clear a kid's closed and taken-back tickets from their history.
  app.delete('/api/homes/:homeId/kids/:memberId/helpdesk/closed', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const n = db.prepare("DELETE FROM helpdesk_requests WHERE member_id = ? AND (closed_at IS NOT NULL OR status = 'cancelled')").run(kid.id as string).changes;
    return { cleared: Number(n) };
  });

  app.get('/api/homes/:homeId/helpdesk', async (req) => waitingRequests(db, homeCtx(db, req, 'parent').homeId));

  // Yes: becomes a Parent Duty card for that kid (title, due date and which parent can be changed here).
  app.post('/api/homes/:homeId/helpdesk/:id/approve', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const r = own(ctx, (req.params as { id: string }).id);
    waiting(r);
    const b = (req.body ?? {}) as Row;
    const view = requestView(r);
    const kid = getKid(db, ctx, r.member_id as string);
    const title = b.title != null ? requireStr(b.title, 'Title', 120) : (view.text ? (view.kind === 'other' ? view.text : `${view.label}: ${view.text}`) : view.label).slice(0, 120);
    const due = 'dueDate' in b ? (b.dueDate == null || b.dueDate === '' ? null : b.dueDate) : view.dueDate;
    if (due != null && !isIsoDate(due)) throw new HttpError(400, 'Due dates look like 2026-10-20');
    let assignee: string | null = null;
    if (b.assigneeId) {
      if (!db.prepare("SELECT 1 FROM members WHERE id = ? AND home_id = ? AND role = 'parent'").get(String(b.assigneeId), ctx.homeId)) throw new HttpError(400, 'Pick a parent in this home');
      assignee = String(b.assigneeId);
    }
    // If Parent Duty is switched off for this kid, the card goes on the general list (named) so it isn't hidden.
    const dutyOn = pageOn(db, kid.id as string, 'parentduty');
    const dutyId = newId();
    tx(db, () => {
      const pos = (((db.prepare("SELECT MAX(position) AS p FROM honeydo WHERE home_id = ? AND status = 'todo' AND kid_id IS ?").get(ctx.homeId, dutyOn ? kid.id as string : null) as Row).p as number | null) ?? 0) + 1;
      db.prepare(`INSERT INTO honeydo (id, home_id, title, notes, kid_id, assignee_id, status, due_date, position, created_by)
        VALUES (?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?)`).run(dutyId, ctx.homeId, dutyOn ? title : `For ${kid.name}: ${title}`,
        `🛎️ ${kid.name} asked on the Helpdesk${view.text ? `: “${view.text}”` : ''}`, dutyOn ? kid.id as string : null, assignee, due as string | null, pos, ctx.user?.id ?? null);
      db.prepare("UPDATE helpdesk_requests SET status = 'approved', duty_id = ?, due_date = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?")
        .run(dutyId, due as string | null, ctx.user?.id ?? null, r.id as string);
    });
    emit(db, ctx.homeId, 'helpdesk_answered', kid.id as string, { answer: 'yes', request: title, request_id: r.id });
    return requestView(own(ctx, r.id as string));
  });

  // Not this time, with an optional kind note the kid sees.
  app.post('/api/homes/:homeId/helpdesk/:id/deny', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const r = own(ctx, (req.params as { id: string }).id);
    waiting(r);
    db.prepare("UPDATE helpdesk_requests SET status = 'denied', note = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?")
      .run(str((req.body as Row | undefined)?.note, 200), ctx.user?.id ?? null, r.id as string);
    emit(db, ctx.homeId, 'helpdesk_answered', r.member_id as string, { answer: 'not this time', request_id: r.id });
    return requestView(own(ctx, r.id as string));
  });
}
