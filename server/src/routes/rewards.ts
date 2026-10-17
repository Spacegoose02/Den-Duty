// Quick rewards (one-tap bonuses), penalties, reward votes, and kids picking their own unlocked raccoon.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { assertCanActFor, homeCtx } from '../auth.ts';
import { tx, type Row } from '../db.ts';
import { HttpError, newId, num, requireStr, str } from '../util.ts';
import { balance, homeInfo, homeToday, penalize, writeLedger } from '../chores.ts';
import { levelOf } from '../progress.ts';
import { cleanIcon, getKid, kidView } from './homes.ts';
import { byOf } from './chores.ts';
import { avatarUnlocked, isAvatar } from '../../../shared/catalog.ts';

function wholePoints(v: unknown, max = 100_000): number {
  const n = num(v);
  if (n == null || !Number.isInteger(n) || n < 1 || n > max) throw new HttpError(400, 'Points must be a whole number, at least 1');
  return n;
}

const allowNegative = (db: DatabaseSync, homeId: string): boolean =>
  !!(db.prepare('SELECT allow_negative FROM homes WHERE id = ?').get(homeId) as Row).allow_negative;

interface PollRow { id: string; title: string; status: 'open' | 'closed'; winner_option_id: string | null; created_at: string; closed_at: string | null }

/**
 * Kids see the options and their own vote; vote counts stay hidden from them until a parent picks, so nobody
 * just follows the crowd. Parents always see the counts.
 */
function pollView(db: DatabaseSync, p: PollRow, viewer: { parent: boolean; memberId: string | null }) {
  const options = db.prepare('SELECT id, title, icon FROM poll_options WHERE poll_id = ? ORDER BY position').all(p.id) as Row[];
  const votes = db.prepare('SELECT v.member_id, v.option_id, m.name FROM poll_votes v JOIN members m ON m.id = v.member_id WHERE v.poll_id = ?').all(p.id) as Row[];
  const showCounts = viewer.parent || p.status === 'closed';
  return {
    id: p.id, title: p.title, status: p.status, winnerOptionId: p.winner_option_id, createdAt: p.created_at, closedAt: p.closed_at,
    myVote: (votes.find((v) => v.member_id === viewer.memberId)?.option_id as string) ?? null,
    totalVotes: votes.length,
    options: options.map((o) => ({
      id: o.id as string, title: o.title as string, icon: o.icon as string,
      votes: showCounts ? votes.filter((v) => v.option_id === o.id).length : null,
      voters: viewer.parent ? votes.filter((v) => v.option_id === o.id).map((v) => v.name as string) : undefined,
    })),
  };
}

export function rewardRoutes(app: FastifyInstance, db: DatabaseSync): void {
  // ---------- quick rewards ----------
  app.get('/api/homes/:homeId/quick-rewards', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return db.prepare('SELECT id, title, icon, amount FROM quick_rewards WHERE home_id = ? ORDER BY position, created_at').all(ctx.homeId);
  });

  app.post('/api/homes/:homeId/quick-rewards', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    const count = (db.prepare('SELECT COUNT(*) AS n FROM quick_rewards WHERE home_id = ?').get(ctx.homeId) as Row).n as number;
    if (count >= 24) throw new HttpError(400, 'That is plenty of quick rewards (24 max)');
    const id = newId();
    db.prepare('INSERT INTO quick_rewards (id, home_id, title, icon, amount, position) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, ctx.homeId, requireStr(b.title, 'Title', 60), cleanIcon(b.icon, '🌟'), wholePoints(b.amount, 1000), count);
    return db.prepare('SELECT id, title, icon, amount FROM quick_rewards WHERE id = ?').get(id);
  });

  app.delete('/api/homes/:homeId/quick-rewards/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM quick_rewards WHERE id = ? AND home_id = ?').run((req.params as { id: string }).id, ctx.homeId);
    return { ok: true };
  });

  // One tap: points for a kid, with the reward's name as the reason.
  app.post('/api/homes/:homeId/quick-rewards/:id/give', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const r = db.prepare('SELECT * FROM quick_rewards WHERE id = ? AND home_id = ?').get((req.params as { id: string }).id, ctx.homeId) as Row | undefined;
    if (!r) throw new HttpError(404, 'That quick reward is gone');
    const kid = getKid(db, ctx, requireStr((req.body as Row)?.memberId, 'Kid', 60));
    writeLedger(db, {
      homeId: ctx.homeId, memberId: kid.id as string, amount: r.amount as number, kind: 'bonus', reason: `${r.icon} ${r.title}`,
      date: homeToday(homeInfo(db, ctx.homeId)), by: byOf(ctx),
    });
    return { awarded: r.amount, balance: balance(db, kid.id as string) };
  });

  // ---------- penalties ----------
  app.post('/api/homes/:homeId/kids/:memberId/penalty', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const kid = getKid(db, ctx, (req.params as { memberId: string }).memberId);
    const b = (req.body ?? {}) as Row;
    const reason = requireStr(b.reason, 'Reason', 120);
    return penalize(db, { id: ctx.homeId, allowNegative: allowNegative(db, ctx.homeId) }, kid.id as string, wholePoints(b.points),
      reason, byOf(ctx), homeToday(homeInfo(db, ctx.homeId)));
  });

  // ---------- reward votes ----------
  app.get('/api/homes/:homeId/polls', async (req) => {
    const ctx = homeCtx(db, req);
    const viewer = { parent: ctx.actor.kind === 'parent', memberId: ctx.actor.kind === 'kid' ? ctx.actor.memberId : null };
    const rows = db.prepare(`SELECT * FROM polls WHERE home_id = ? AND (status = 'open' OR closed_at > datetime('now', '-30 days'))
      ORDER BY status DESC, created_at DESC`).all(ctx.homeId) as unknown as PollRow[];
    return rows.map((p) => pollView(db, p, viewer));
  });

  app.post('/api/homes/:homeId/polls', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    const title = requireStr(b.title, 'Question', 100);
    const options = (Array.isArray(b.options) ? b.options : [])
      .map((o: Row) => ({ title: str(o?.title, 60), icon: cleanIcon(o?.icon, '🎁') }))
      .filter((o): o is { title: string; icon: string } => !!o.title);
    if (options.length < 2 || options.length > 8) throw new HttpError(400, 'Give the kids 2 to 8 choices');
    const id = newId();
    tx(db, () => {
      db.prepare('INSERT INTO polls (id, home_id, title, created_by) VALUES (?, ?, ?, ?)').run(id, ctx.homeId, title, ctx.user?.id ?? null);
      const ins = db.prepare('INSERT INTO poll_options (id, poll_id, title, icon, position) VALUES (?, ?, ?, ?, ?)');
      options.forEach((o: { title: string; icon: string }, i: number) => ins.run(newId(), id, o.title, o.icon, i));
    });
    return pollView(db, db.prepare('SELECT * FROM polls WHERE id = ?').get(id) as unknown as PollRow, { parent: true, memberId: null });
  });

  // Kids vote (and can change their mind) while the vote is open.
  app.post('/api/homes/:homeId/polls/:pollId/vote', async (req) => {
    const ctx = homeCtx(db, req);
    if (ctx.actor.kind !== 'kid') throw new HttpError(403, 'Only kids vote. Tap your avatar first.');
    const { pollId } = req.params as { pollId: string };
    const poll = db.prepare('SELECT * FROM polls WHERE id = ? AND home_id = ?').get(pollId, ctx.homeId) as PollRow | undefined;
    if (!poll) throw new HttpError(404, 'That vote is gone');
    if (poll.status !== 'open') throw new HttpError(400, 'Voting is over');
    const optionId = requireStr((req.body as Row)?.optionId, 'Choice', 60);
    if (!db.prepare('SELECT 1 FROM poll_options WHERE id = ? AND poll_id = ?').get(optionId, pollId)) throw new HttpError(400, "That isn't one of the choices");
    db.prepare(`INSERT INTO poll_votes (poll_id, member_id, option_id) VALUES (?, ?, ?)
      ON CONFLICT (poll_id, member_id) DO UPDATE SET option_id = excluded.option_id, voted_at = datetime('now')`).run(pollId, ctx.actor.memberId, optionId);
    return pollView(db, poll, { parent: false, memberId: ctx.actor.memberId });
  });

  // Parents pick the winner (usually the most votes, but it's their call). That closes the vote.
  app.post('/api/homes/:homeId/polls/:pollId/pick', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const { pollId } = req.params as { pollId: string };
    const optionId = requireStr((req.body as Row)?.optionId, 'Choice', 60);
    if (!db.prepare('SELECT 1 FROM poll_options o JOIN polls p ON p.id = o.poll_id WHERE o.id = ? AND p.id = ? AND p.home_id = ?').get(optionId, pollId, ctx.homeId)) {
      throw new HttpError(404, 'That choice is gone');
    }
    db.prepare("UPDATE polls SET status = 'closed', winner_option_id = ?, closed_at = datetime('now') WHERE id = ?").run(optionId, pollId);
    return pollView(db, db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId) as unknown as PollRow, { parent: true, memberId: null });
  });

  app.delete('/api/homes/:homeId/polls/:pollId', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    db.prepare('DELETE FROM polls WHERE id = ? AND home_id = ?').run((req.params as { pollId: string }).pollId, ctx.homeId);
    return { ok: true };
  });

  // ---------- picking your own raccoon ----------
  // Kids can switch to any avatar their level has unlocked. Parents can pick any avatar in Kids → Edit.
  app.post('/api/homes/:homeId/kids/:memberId/avatar', async (req) => {
    const ctx = homeCtx(db, req);
    const { memberId } = req.params as { memberId: string };
    assertCanActFor(ctx, memberId);
    if (ctx.actor.kind !== 'kid' && ctx.actor.kind !== 'parent') throw new HttpError(403, 'Tap your avatar first');
    const kid = getKid(db, ctx, memberId);
    const avatar = (req.body as Row)?.avatar;
    if (!isAvatar(avatar)) throw new HttpError(400, 'Unknown avatar');
    if (ctx.actor.kind === 'kid' && !avatarUnlocked(avatar, levelOf(db, memberId).level)) throw new HttpError(403, 'Keep earning to unlock that one!');
    db.prepare('UPDATE members SET avatar = ? WHERE id = ?').run(avatar, kid.id as string);
    return kidView(db, getKid(db, ctx, memberId));
  });
}
