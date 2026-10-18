// Things worth telling Home Assistant about: a chore was submitted or approved, a goal was reached or redeemed.
// Every event is stored (HA can poll /ha/events) and, if the home has a webhook URL, also POSTed to it.
import type { DatabaseSync } from 'node:sqlite';
import type { Row } from './db.ts';

export type EventType = 'chore_submitted' | 'chore_approved' | 'goal_reached' | 'goal_redeemed' | 'points_changed'
  | 'timeout_started' | 'timeout_ended' | 'timeout_buy_requested' | 'timeout_time_bought'
  | 'helpdesk_requested' | 'helpdesk_answered';

/** Swapped out in tests so nothing leaves the machine. */
export let deliver = async (url: string, payload: unknown): Promise<void> => {
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
};
export function setDeliver(fn: typeof deliver): void { deliver = fn; }

export function emit(db: DatabaseSync, homeId: string, type: EventType, memberId: string | null, data: Record<string, unknown>): void {
  const r = db.prepare('INSERT INTO events (home_id, type, member_id, data) VALUES (?, ?, ?, ?)').run(homeId, type, memberId, JSON.stringify(data));
  const id = Number(r.lastInsertRowid);
  // Keep the table small: a few thousand events per home is plenty for polling.
  if (id % 200 === 0) db.prepare('DELETE FROM events WHERE home_id = ? AND id < ?').run(homeId, id - 5000);
  const url = (db.prepare('SELECT ha_webhook_url FROM homes WHERE id = ?').get(homeId) as Row | undefined)?.ha_webhook_url as string | null;
  if (!url) return;
  // After the current transaction: only send events that were actually committed.
  setImmediate(() => {
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as Row | undefined;
    if (row) deliver(url, eventView(db, row)).catch(() => { /* HA being offline must never break chores */ });
  });
}

export function eventView(db: DatabaseSync, r: Row) {
  const kid = r.member_id ? (db.prepare('SELECT name FROM members WHERE id = ?').get(r.member_id as string) as Row | undefined) : undefined;
  return {
    id: r.id as number, event: r.type as string, kid: (kid?.name as string) ?? null, kid_id: r.member_id as string | null,
    ...JSON.parse(r.data as string), at: `${(r.created_at as string).replace(' ', 'T')}Z`,
  };
}
