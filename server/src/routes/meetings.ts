// Family meeting: a guided weekly sit-down. The prep bundles what the steps need (last week's recap, what each kid
// said they'd do last time, reward votes and the family goal). Saving keeps what was said: each kid's "this week
// I'll..." (shown on their board until the next meeting), cheers (with points, written to the ledger) and plans.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx, isParent } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, num, parseJson, str } from '../util.ts';
import { homeInfo, homeToday, writeLedger } from '../chores.ts';
import { recap } from '../recap.ts';
import { teamGoals } from '../team.ts';
import { getKid, listKids } from './homes.ts';
import { byOf } from './chores.ts';

export interface MeetingData {
  intentions: Record<string, string>;
  cheers: { memberId: string; text: string; points: number }[];
  plans: string[];
  notes: string | null;
}

const view = (r: Row) => {
  const d = parseJson<Partial<MeetingData>>(r.data, {});
  return {
    id: r.id as string, heldOn: r.held_on as string, createdBy: r.created_by as string | null,
    intentions: d.intentions ?? {}, cheers: d.cheers ?? [], plans: d.plans ?? [], notes: d.notes ?? null,
  };
};
export type MeetingView = ReturnType<typeof view>;

export function lastMeeting(db: DatabaseSync, homeId: string): MeetingView | null {
  const r = db.prepare('SELECT * FROM family_meetings WHERE home_id = ? ORDER BY held_on DESC, created_at DESC LIMIT 1').get(homeId) as Row | undefined;
  return r ? view(r) : null;
}

export function meetingRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/homes/:homeId/meetings', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return (db.prepare('SELECT * FROM family_meetings WHERE home_id = ? ORDER BY held_on DESC, created_at DESC LIMIT 26').all(ctx.homeId) as Row[]).map(view);
  });

  // Everything the meeting's steps show, in one go.
  app.get('/api/homes/:homeId/meetings/prep', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const home = homeInfo(db, ctx.homeId);
    const today = homeToday(home);
    const polls = (db.prepare("SELECT * FROM polls WHERE home_id = ? AND status = 'open' ORDER BY created_at DESC").all(ctx.homeId) as Row[]).map((p) => ({
      id: p.id as string, title: p.title as string,
      options: (db.prepare(`SELECT o.id, o.title, o.icon, (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) AS votes
        FROM poll_options o WHERE o.poll_id = ? ORDER BY o.position`).all(p.id as string) as Row[])
        .map((o) => ({ id: o.id as string, title: o.title as string, icon: o.icon as string, votes: o.votes as number })),
    }));
    return {
      today,
      kids: listKids(db, ctx.homeId).map((k) => ({ id: k.id, name: k.name, avatar: k.avatar, color: k.color, balance: k.balance })),
      recap: recap(db, home, today),
      last: lastMeeting(db, ctx.homeId),
      polls,
      teamGoals: teamGoals(db, ctx.homeId).filter((g) => g.status === 'active'),
    };
  });

  app.post('/api/homes/:homeId/meetings', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    const kids = new Set(listKids(db, ctx.homeId).map((k) => k.id));
    const intentions: Record<string, string> = {};
    for (const [id, text] of Object.entries((b.intentions ?? {}) as Record<string, unknown>)) {
      const t = str(text, 140);
      if (t && kids.has(id)) intentions[id] = t;
    }
    const cheers = (Array.isArray(b.cheers) ? b.cheers : []).slice(0, 40).map((c: Row) => {
      const memberId = String(c?.memberId ?? '');
      if (!kids.has(memberId)) throw new HttpError(400, 'Unknown kid in a cheer');
      const points = num(c.points) ?? 0;
      if (!Number.isInteger(points) || points < 0 || points > 1000) throw new HttpError(400, 'Cheer points are 0 to 1000');
      const text = str(c.text, 140);
      if (!text) throw new HttpError(400, 'Every cheer needs words');
      return { memberId, text, points };
    });
    const plans = (Array.isArray(b.plans) ? b.plans : []).map((p) => str(p, 140)).filter((p): p is string => !!p).slice(0, 20);
    const data: MeetingData = { intentions, cheers, plans, notes: str(b.notes, 2000) };
    const today = homeToday(homeInfo(db, ctx.homeId));
    const id = newId();
    tx(db, () => {
      db.prepare('INSERT INTO family_meetings (id, home_id, held_on, data, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(id, ctx.homeId, today, JSON.stringify(data), ctx.user?.name ?? null);
      for (const c of cheers) {
        if (c.points) writeLedger(db, { homeId: ctx.homeId, memberId: c.memberId, amount: c.points, kind: 'bonus', reason: `🎉 Family meeting: ${c.text}`, date: today, by: byOf(ctx) });
      }
    });
    return view(db.prepare('SELECT * FROM family_meetings WHERE id = ?').get(id) as Row);
  });

  app.delete('/api/homes/:homeId/meetings/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM family_meetings WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  // A kid's "this week I'll..." and the cheers they got, from the latest meeting.
  app.get('/api/homes/:homeId/kids/:memberId/meeting', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    getKid(db, ctx, memberId);
    if (ctx.actor.kind !== 'kid' && !isParent(ctx)) return null;
    const m = lastMeeting(db, ctx.homeId);
    if (!m) return null;
    const intention = m.intentions[memberId] ?? null;
    const cheers = m.cheers.filter((c) => c.memberId === memberId).map((c) => c.text);
    return intention || cheers.length ? { heldOn: m.heldOn, intention, cheers } : null;
  });
}
