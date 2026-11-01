// Push notifications (Web Push). Parents' phones and browsers get "Ava finished Make your bed", Helpdesk asks,
// shop buys and the weekly recap; a family tablet that turned them on gets kid-facing nudges ("Feed the dog is due
// at 5:00") and celebrations. Keys are made once per server and kept in server_settings.
import webpush from 'web-push';
import type { DatabaseSync } from 'node:sqlite';
import type { Row } from './db.ts';
import { config } from './config.ts';
import { getSetting, setSetting } from './auth.ts';
import { homeToday } from './chores.ts';
import { addDays, clockText, startOfWeek, timeIn } from '../../shared/schedule.ts';

export type Audience = 'parents' | 'tablet' | 'all';
export interface PushMessage { title: string; body?: string; url?: string; tag?: string }
export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }

export function vapidKeys(db: DatabaseSync): { publicKey: string; privateKey: string } {
  let publicKey = getSetting(db, 'vapid_public');
  let privateKey = getSetting(db, 'vapid_private');
  if (!publicKey || !privateKey) {
    ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
    setSetting(db, 'vapid_public', publicKey);
    setSetting(db, 'vapid_private', privateKey);
  }
  return { publicKey, privateKey };
}

/** Swapped out in tests so nothing leaves the machine. Resolves to the HTTP status of the push service. */
export let sendPush = async (db: DatabaseSync, sub: PushSub, msg: PushMessage): Promise<number> => {
  const { publicKey, privateKey } = vapidKeys(db);
  const subject = config.publicUrl.startsWith('https://') ? config.publicUrl : 'mailto:den-duty@localhost';
  try {
    const r = await webpush.sendNotification(sub, JSON.stringify(msg), { vapidDetails: { subject, publicKey, privateKey }, TTL: 6 * 3600 });
    return r.statusCode;
  } catch (e) {
    return (e as { statusCode?: number }).statusCode ?? 0;
  }
};
export function setSendPush(fn: typeof sendPush): void { sendPush = fn; }

export function saveSubscription(db: DatabaseSync, homeId: string, who: { userId: string | null; deviceId: string | null }, v: unknown): void {
  const s = v as Partial<PushSub> | null;
  const endpoint = typeof s?.endpoint === 'string' ? s.endpoint : '';
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || typeof s?.keys?.p256dh !== 'string' || typeof s.keys.auth !== 'string') {
    throw Object.assign(new Error('That doesn\'t look like a push subscription'), { statusCode: 400 });
  }
  db.prepare(`INSERT INTO push_subscriptions (id, home_id, user_id, device_id, endpoint, p256dh, auth) VALUES (lower(hex(randomblob(12))), ?, ?, ?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET home_id = excluded.home_id, user_id = excluded.user_id, device_id = excluded.device_id,
      p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(homeId, who.userId, who.deviceId, endpoint, s.keys.p256dh.slice(0, 200), s.keys.auth.slice(0, 100));
}

/** Sends to everyone in the audience, after the current transaction. Gone subscriptions (404/410) are removed. */
export function notify(db: DatabaseSync, homeId: string, audience: Audience, msg: PushMessage, only?: string): void {
  const where = audience === 'parents' ? 'AND user_id IS NOT NULL' : audience === 'tablet' ? 'AND device_id IS NOT NULL' : '';
  const subs = db.prepare(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE home_id = ? ${where} ${only ? 'AND endpoint = ?' : ''}`)
    .all(...(only ? [homeId, only] : [homeId])) as Row[];
  if (!subs.length) return;
  setImmediate(() => {
    for (const s of subs) {
      sendPush(db, { endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } }, msg).then((status) => {
        if (status === 404 || status === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id as string);
        else if (status >= 200 && status < 300) db.prepare("UPDATE push_subscriptions SET last_ok_at = datetime('now') WHERE id = ?").run(s.id as string);
      }).catch(() => { /* a push service being down must never break chores */ });
    }
  });
}

/** True the first time a key is used for a home (so nudges and recaps go out once). */
function once(db: DatabaseSync, homeId: string, key: string): boolean {
  return Number(db.prepare('INSERT OR IGNORE INTO push_sent (home_id, key) VALUES (?, ?)').run(homeId, key).changes) > 0;
}

const kidName = (db: DatabaseSync, id: string | null): string =>
  (id && ((db.prepare('SELECT name FROM members WHERE id = ?').get(id) as Row | undefined)?.name as string)) || 'Someone';

/** What each Home Assistant event says as a push, and to whom. Called from emit(). */
export function pushForEvent(db: DatabaseSync, homeId: string, type: string, memberId: string | null, d: Record<string, unknown>): void {
  const kid = () => kidName(db, memberId);
  switch (type) {
    case 'chore_submitted': {
      const waiting = Number((db.prepare("SELECT COUNT(*) AS n FROM chore_instances WHERE home_id = ? AND status = 'submitted'").get(homeId) as Row).n);
      return notify(db, homeId, 'parents', { title: `${d.icon ?? '✅'} ${kid()} finished ${d.chore}${d.late ? ' (late)' : ''}`, body: `${waiting} waiting for you to check`, url: '/', tag: 'review' });
    }
    case 'helpdesk_requested': return notify(db, homeId, 'parents', { title: `🙋 ${kid()} needs a hand`, body: String(d.request ?? ''), url: '/', tag: `help-${d.request_id}` });
    case 'reward_bought': return notify(db, homeId, 'parents', { title: `${d.icon ?? '🛍️'} ${kid()} bought ${d.reward}`, body: 'Hand it over or refund it on Home', url: '/' });
    case 'timeout_buy_requested': return notify(db, homeId, 'parents', { title: `⏳ ${kid()} wants to buy back time`, body: `${d.what}: ${d.points} points`, url: '/' });
    case 'practice_waiting': return notify(db, homeId, 'parents', { title: `🌈 ${kid()} finished a practice`, body: 'Check it on Home', url: '/' });
    case 'reminder_due': return notify(db, homeId, 'parents', { title: `⏰ ${d.reminder}`, body: d.due_time ? `Due at ${clockText(String(d.due_time))}` : 'Due today', url: '/reminders', tag: `rem-${d.reminder_id}` });
    case 'med_refill_due': return notify(db, homeId, 'parents', { title: `💊 Time to refill ${kid()}'s medicine`, body: `${d.doses_left} doses left`, url: '/' });
    case 'goal_reached': return notify(db, homeId, 'all', { title: `🏆 ${kid()} reached a goal!`, body: String(d.goal ?? ''), url: '/' });
    case 'team_goal_reached': return notify(db, homeId, 'all', { title: `🎉 The family reached ${d.goal}!`, body: d.reward ? `Reward: ${d.reward}` : 'Great teamwork!', url: '/' });
  }
}

/** Minutes before a chore's due time that the tablet gets a nudge. */
export const NUDGE_MINUTES = 15;

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * Runs every minute: nudges the family tablet about chores due soon, and on the first day of a week (from 8 am)
 * tells parents last week's recap is ready.
 */
export function checkPush(db: DatabaseSync, now = new Date()): void {
  const homes = db.prepare('SELECT DISTINCT h.id, h.timezone, h.week_start FROM homes h JOIN push_subscriptions p ON p.home_id = h.id').all() as Row[];
  for (const h of homes) {
    const homeId = h.id as string;
    const today = homeToday({ timezone: h.timezone as string }, now);
    const time = timeIn(h.timezone as string, now);
    const due = db.prepare(`SELECT i.id, i.title, i.icon, i.due_time, m.name FROM chore_instances i JOIN members m ON m.id = i.member_id
      WHERE i.home_id = ? AND i.date = ? AND i.due_time IS NOT NULL AND i.status IN ('pending', 'rejected')`).all(homeId, today) as Row[];
    for (const i of due) {
      const left = minutesOf(i.due_time as string) - minutesOf(time);
      if (left > 0 && left <= NUDGE_MINUTES && once(db, homeId, `due:${i.id}`)) {
        notify(db, homeId, 'tablet', { title: `⏰ ${i.name}: ${i.icon} ${i.title}`, body: `Due at ${clockText(i.due_time as string)}. You've got this!`, url: '/', tag: `due-${i.id}` });
      }
    }
    const weekStart = startOfWeek(today, h.week_start as number);
    if (today === weekStart && time >= '08:00' && once(db, homeId, `recap:${addDays(weekStart, -7)}`)) {
      notify(db, homeId, 'parents', { title: '📊 Last week\'s recap is ready', body: 'See how everyone did, and who to cheer on', url: '/recap', tag: 'recap' });
    }
  }
  // Keep the "already sent" list short.
  if (now.getUTCMinutes() === 0) db.prepare("DELETE FROM push_sent WHERE created_at < datetime('now', '-30 days')").run();
}
