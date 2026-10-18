// Calendars in and out. Out: a secret ICS link per home and per kid with chores and appointments, so they show
// up in Google Calendar. In: ICS feeds a parent adds (school lunch menus, Nighttime Ninja's meal plan), cached
// and shown on the weekly agenda.
import type { DatabaseSync } from 'node:sqlite';
import type { Row } from './db.ts';
import { randomToken } from './util.ts';
import { agenda, homeInfo, homeToday, kidsWithPageOff, type HomeInfo } from './chores.ts';
import { appointmentOn, DOCTOR_AREA_IDS, offList } from '../../shared/pages.ts';

const doctorAreasOffFor = (db: DatabaseSync, memberId: string) =>
  offList((db.prepare('SELECT doctor_areas_off FROM members WHERE id = ?').get(memberId) as Row | undefined)?.doctor_areas_off, DOCTOR_AREA_IDS);
import { addDays } from '../../shared/schedule.ts';
import { buildIcs, parseIcs, type IcsEvent } from '../../shared/ics.ts';

// ---------- out ----------

/** The secret link token for a home (target 'home') or a kid, made on first use. */
export function calendarToken(db: DatabaseSync, target: { homeId: string } | { memberId: string }, reset = false): string {
  const [table, id] = 'homeId' in target ? ['homes', target.homeId] : ['members', target.memberId];
  const cur = (db.prepare(`SELECT calendar_token FROM ${table} WHERE id = ?`).get(id) as Row | undefined)?.calendar_token as string | null;
  if (cur && !reset) return cur;
  const token = randomToken(24);
  db.prepare(`UPDATE ${table} SET calendar_token = ? WHERE id = ?`).run(token, id);
  return token;
}

/** Builds the ICS for a token, or null if no home or kid has it. */
export function calendarFor(db: DatabaseSync, token: string): string | null {
  const home = db.prepare('SELECT id FROM homes WHERE calendar_token = ?').get(token) as Row | undefined;
  const kid = home ? undefined : db.prepare("SELECT id, home_id, name, therapy_kid_visible FROM members WHERE calendar_token = ? AND role = 'kid'").get(token) as Row | undefined;
  if (!home && !kid) return null;
  // A kid with Calendar switched off has no feed at all; in the home feed they're left out.
  if (kid && kidsWithPageOff(db, kid.home_id as string, 'calendar').has(kid.id as string)) return null;
  const info = homeInfo(db, (home?.id ?? kid!.home_id) as string);
  const today = homeToday(info);
  const calendarOff = kidsWithPageOff(db, info.id, 'calendar');
  const choresOff = kidsWithPageOff(db, info.id, 'chores');
  const doctorsOff = kidsWithPageOff(db, info.id, 'doctors');
  const kids = (db.prepare("SELECT id, name FROM members WHERE home_id = ? AND role = 'kid' ORDER BY position, created_at").all(info.id) as Row[])
    .filter((k) => !calendarOff.has(k.id as string));
  const wanted = (kid ? kids.filter((k) => k.id === kid.id) : kids).filter((k) => !choresOff.has(k.id as string));
  const from = addDays(today, -14);
  const days = agenda(db, info.id, wanted.map((k) => k.id as string), from, 14 + 29, today);
  const events: IcsEvent[] = [];
  // One all-day event per kid per day, listing that day's chores, instead of a pile of separate events.
  for (const day of days) {
    for (const k of wanted) {
      const items = day.items.filter((i) => i.memberId === k.id);
      if (!items.length) continue;
      const done = items.filter((i) => i.status === 'approved').length;
      events.push({
        uid: `chores-${k.id}-${day.date}@daytime-ninja`,
        summary: `${kid ? '' : `${k.name}: `}${items.length} chore${items.length === 1 ? '' : 's'}${day.date <= today ? ` (${done} done)` : ''}`,
        description: items.map((i) => `${i.status === 'approved' ? '✅' : i.status === 'submitted' ? '⏳' : '▫️'} ${i.icon} ${i.title} (+${i.points} ${info.pointsName})`).join('\n'),
        date: day.date,
      });
    }
  }
  // Appointments: always in the parents' home calendar; in a kid's only when a parent shares therapy with them.
  const apptKids = (kid ? (kid.therapy_kid_visible ? [kid.id as string] : []) : kids.map((k) => k.id as string)).filter((id) => !doctorsOff.has(id));
  if (apptKids.length) {
    const rows = db.prepare(`SELECT a.*, m.name AS kid_name FROM therapy_appointments a JOIN members m ON m.id = a.member_id
      WHERE a.home_id = ? AND a.status = 'scheduled' AND a.starts_at >= ? AND a.member_id IN (${apptKids.map(() => '?').join(',')})`).all(info.id, from, ...apptKids) as Row[];
    const areasOff = new Map(apptKids.map((id) => [id, doctorAreasOffFor(db, id)]));
    for (const a of rows) {
      if (!appointmentOn(a.kind as string, areasOff.get(a.member_id as string) ?? [])) continue;
      const [date, time] = (a.starts_at as string).split('T');
      events.push({
        uid: `appt-${a.id}@daytime-ninja`, date, time, durationMinutes: (a.duration_minutes as number | null) ?? 60,
        summary: `${kid ? '' : `${a.kid_name}: `}${a.title}${a.provider ? ` with ${a.provider}` : ''}`,
        description: [a.location, a.notes].filter(Boolean).join('\n') || null,
      });
    }
  }
  return buildIcs(kid ? `${kid.name}'s chores` : `${info.name} chores`, info.timezone, events);
}

// ---------- in ----------

export interface ExternalItem { date: string; time: string | null; title: string; feed: string; kind: string }

const STALE_MS = 60 * 60e3;
const MAX_BYTES = 2 * 1024 * 1024;

/** Swapped out in tests. */
export let fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url.replace(/^webcal:/i, 'https:'), { signal: AbortSignal.timeout(8000), headers: { accept: 'text/calendar, */*' } });
  if (!res.ok) throw new Error(`The feed answered ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('That feed is too big (over 2 MB)');
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error("That address doesn't return an ICS calendar");
  return text;
};
export function setFetchText(fn: typeof fetchText): void { fetchText = fn; }

/** Downloads and caches one feed: only events from a month back to four months ahead are kept. */
export async function refreshFeed(db: DatabaseSync, feedId: string, home: HomeInfo): Promise<void> {
  const f = db.prepare('SELECT * FROM calendar_feeds WHERE id = ?').get(feedId) as Row | undefined;
  if (!f) return;
  const today = homeToday(home);
  try {
    const events = parseIcs(await fetchText(f.url as string), home.timezone)
      .filter((e) => e.date >= addDays(today, -31) && e.date <= addDays(today, 120))
      .map((e) => ({ date: e.date, time: e.time ?? null, title: e.summary }));
    db.prepare("UPDATE calendar_feeds SET events = ?, fetched_at = datetime('now'), error = NULL WHERE id = ?").run(JSON.stringify(events), feedId);
  } catch (err) {
    // Keep the last good copy; just remember what went wrong.
    db.prepare("UPDATE calendar_feeds SET fetched_at = datetime('now'), error = ? WHERE id = ?").run((err as Error).message.slice(0, 300), feedId);
  }
}

/** Refreshes any feeds older than an hour, all at once. A slow school website can't hold the page for more than 8 s. */
export async function refreshStale(db: DatabaseSync, homeId: string): Promise<void> {
  const stale = (db.prepare('SELECT id, fetched_at FROM calendar_feeds WHERE home_id = ?').all(homeId) as Row[])
    .filter((f) => !f.fetched_at || Date.parse(`${(f.fetched_at as string).replace(' ', 'T')}Z`) < Date.now() - STALE_MS);
  if (!stale.length) return;
  const home = homeInfo(db, homeId);
  await Promise.all(stale.map((f) => refreshFeed(db, f.id as string, home)));
}

/** Feed events between two dates, per day. Kids only see feeds marked for them. */
export function externalBetween(db: DatabaseSync, homeId: string, from: string, to: string, forKids: boolean): Map<string, ExternalItem[]> {
  const feeds = db.prepare(`SELECT name, kind, events FROM calendar_feeds WHERE home_id = ? ${forKids ? 'AND show_kids = 1' : ''} ORDER BY created_at`).all(homeId) as Row[];
  const byDate = new Map<string, ExternalItem[]>();
  for (const f of feeds) {
    for (const e of JSON.parse(f.events as string) as { date: string; time: string | null; title: string }[]) {
      if (e.date < from || e.date > to) continue;
      const list = byDate.get(e.date) ?? [];
      list.push({ ...e, feed: f.name as string, kind: f.kind as string });
      byDate.set(e.date, list);
    }
  }
  for (const list of byDate.values()) list.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  return byDate;
}
