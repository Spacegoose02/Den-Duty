// Family events (the home's own calendar): stored here, shown on the calendar, the wall, kids' boards and the ICS
// feeds, and synced both ways with linked Google, Microsoft and CalDAV calendars (calsync.ts).
import type { DatabaseSync } from 'node:sqlite';
import type { Row } from './db.ts';
import { HttpError, newId, parseJson, str } from './util.ts';

export interface FamilyEvent {
  id: string; title: string; date: string; endDate: string | null; time: string | null; endTime: string | null;
  location: string | null; notes: string | null; memberIds: string[]; kidsSee: boolean; source: string; accountId: string | null;
}

export const eventView = (r: Row): FamilyEvent => ({
  id: r.id as string, title: r.title as string, date: r.date as string, endDate: r.end_date as string | null,
  time: r.time as string | null, endTime: r.end_time as string | null, location: r.location as string | null, notes: r.notes as string | null,
  memberIds: parseJson<string[]>(r.member_ids, []), kidsSee: !!r.kids_see, source: r.source as string, accountId: r.account_id as string | null,
});

/** Events touching [from, to]. For a kid: only ones they can see (theirs or the whole family's). */
export function eventsBetween(db: DatabaseSync, homeId: string, from: string, to: string, kidId?: string | null): FamilyEvent[] {
  const rows = db.prepare(`SELECT * FROM family_events WHERE home_id = ? AND deleted = 0 AND date <= ? AND COALESCE(end_date, date) >= ?
    ORDER BY date, COALESCE(time, ''), title`).all(homeId, to, from) as Row[];
  const all = rows.map(eventView);
  if (kidId === undefined) return all;
  return all.filter((e) => e.kidsSee && (!e.memberIds.length || (kidId !== null && e.memberIds.includes(kidId))));
}

/** Per day, for the calendar views (a several-day event shows on each day). */
export function eventsByDay(db: DatabaseSync, homeId: string, from: string, to: string, kidId?: string | null): Map<string, FamilyEvent[]> {
  const out = new Map<string, FamilyEvent[]>();
  for (const e of eventsBetween(db, homeId, from, to, kidId)) {
    for (let d = e.date > from ? e.date : from; d <= (e.endDate ?? e.date) && d <= to; d = nextDay(d)) {
      const list = out.get(d) ?? [];
      list.push(e);
      out.set(d, list);
    }
  }
  return out;
}
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

/** Checks and normalizes what a parent typed (or a draft from a snapped flyer). */
export function eventInput(db: DatabaseSync, homeId: string, b: Row, cur?: FamilyEvent) {
  const title = b.title !== undefined ? str(b.title, 120) : cur?.title;
  if (!title) throw new HttpError(400, 'Give the event a name');
  const date = b.date !== undefined ? String(b.date) : cur?.date;
  if (!date || !DATE.test(date)) throw new HttpError(400, 'Pick a date');
  let endDate = b.endDate !== undefined ? (b.endDate ? String(b.endDate) : null) : cur?.endDate ?? null;
  if (endDate && (!DATE.test(endDate) || endDate < date)) throw new HttpError(400, 'The end date is before the start');
  if (endDate === date) endDate = null;
  const time = b.time !== undefined ? (b.time ? String(b.time) : null) : cur?.time ?? null;
  const endTime = b.endTime !== undefined ? (b.endTime ? String(b.endTime) : null) : cur?.endTime ?? null;
  if ((time && !TIME.test(time)) || (endTime && !TIME.test(endTime))) throw new HttpError(400, 'Times look like 15:30');
  const kids = new Set((db.prepare("SELECT id FROM members WHERE home_id = ? AND role = 'kid'").all(homeId) as Row[]).map((r) => r.id as string));
  const memberIds = b.memberIds !== undefined ? (Array.isArray(b.memberIds) ? [...new Set(b.memberIds.map(String))].filter((id) => kids.has(id)) : []) : cur?.memberIds ?? [];
  return {
    title, date, endDate, time, endTime: time ? endTime : null,
    location: b.location !== undefined ? str(b.location, 200) : cur?.location ?? null,
    notes: b.notes !== undefined ? str(b.notes, 1000) : cur?.notes ?? null,
    memberIds, kidsSee: b.kidsSee !== undefined ? b.kidsSee !== false : cur?.kidsSee ?? true,
  };
}

export type EventFields = ReturnType<typeof eventInput>;

export function insertEvent(db: DatabaseSync, homeId: string, f: EventFields, source: string, by: string | null, accountId: string | null = null): string {
  const id = newId();
  db.prepare(`INSERT INTO family_events (id, home_id, title, date, end_date, time, end_time, location, notes, member_ids, kids_see, source, account_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, homeId, f.title, f.date, f.endDate, f.time, f.endTime, f.location, f.notes, JSON.stringify(f.memberIds), f.kidsSee ? 1 : 0, source, accountId, by);
  return id;
}

export function updateEvent(db: DatabaseSync, id: string, f: EventFields, touch = true): void {
  db.prepare(`UPDATE family_events SET title = ?, date = ?, end_date = ?, time = ?, end_time = ?, location = ?, notes = ?, member_ids = ?, kids_see = ?
    ${touch ? ", updated_at = datetime('now')" : ''} WHERE id = ?`)
    .run(f.title, f.date, f.endDate, f.time, f.endTime, f.location, f.notes, JSON.stringify(f.memberIds), f.kidsSee ? 1 : 0, id);
}

export function getEvent(db: DatabaseSync, homeId: string, id: string): FamilyEvent {
  const r = db.prepare('SELECT * FROM family_events WHERE id = ? AND home_id = ? AND deleted = 0').get(id, homeId) as Row | undefined;
  if (!r) throw new HttpError(404, 'Event not found');
  return eventView(r);
}

/** Deleting keeps a tombstone while a linked calendar still has a copy, so sync can delete it there too. */
export function deleteEvent(db: DatabaseSync, id: string): void {
  const linked = db.prepare('SELECT 1 FROM event_links WHERE event_id = ?').get(id);
  if (linked) db.prepare("UPDATE family_events SET deleted = 1, updated_at = datetime('now') WHERE id = ?").run(id);
  else db.prepare('DELETE FROM family_events WHERE id = ?').run(id);
}
