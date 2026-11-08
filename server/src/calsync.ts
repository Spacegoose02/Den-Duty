// Two-way calendar sync with Google Calendar, Outlook / Microsoft 365 and CalDAV (iCloud, Nextcloud, Fastmail...).
//
// Both directions, without fighting over the same event:
// - In: events from a linked calendar are mirrored into the family calendar (a month back to four months ahead).
//   They're edited where they came from; the mirror follows on the next sync.
// - Out: events made in Den Duty (typed or snapped from a flyer) are created in each linked calendar that pushes,
//   and kept in step when they're edited or deleted here.
// event_links remembers which remote event each family event is. Synced every 15 minutes, and soon after a change.
import type { DatabaseSync } from 'node:sqlite';
import type { Row } from './db.ts';
import { config } from './config.ts';
import { openKey, sealKey } from './ai.ts';
import { newId, parseJson } from './util.ts';
import { homeInfo, homeToday } from './chores.ts';
import { addDays } from '../../shared/schedule.ts';
import { buildIcs, parseIcs } from '../../shared/ics.ts';
import { eventView, insertEvent, updateEvent, type EventFields, type FamilyEvent } from './familyevents.ts';

export type Kind = 'google' | 'microsoft' | 'caldav';

export interface RemoteEvent {
  id: string; etag: string | null; title: string; date: string; endDate: string | null; time: string | null; endTime: string | null;
  location: string | null; notes: string | null;
}
export interface RemoteCalendar { id: string; name: string; primary?: boolean }

export interface Adapter {
  calendars(): Promise<RemoteCalendar[]>;
  list(from: string, to: string): Promise<RemoteEvent[]>;
  create(e: FamilyEvent): Promise<{ id: string; etag: string | null }>;
  update(id: string, e: FamilyEvent, etag: string | null): Promise<{ etag: string | null }>;
  remove(id: string, etag: string | null): Promise<void>;
}

/** Swapped in tests so nothing leaves the machine. */
let syncFetch: typeof fetch = (...a) => fetch(...a);
export function setSyncFetch(f: typeof fetch | null): void { syncFetch = f ?? ((...a) => fetch(...a)); }

const TIMEOUT = 15_000;
async function http(url: string, init: RequestInit & { ok?: number[] } = {}): Promise<Response> {
  const res = await syncFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok && !(init.ok ?? []).includes(res.status)) {
    const body = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) throw new Error(`The calendar refused the sign-in (${res.status}). Link it again in Settings.`);
    throw new Error(`The calendar answered ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
  }
  return res;
}
const json = async <T>(res: Response) => (await res.json()) as T;

const nextDay = (d: string) => addDays(d, 1);
const prevDay = (d: string) => addDays(d, -1);
const plusHour = (t: string) => { const h = Math.min(Number(t.slice(0, 2)) + 1, 23); return `${String(h).padStart(2, '0')}:${t.slice(3, 5)}`; };
const notesOf = (e: FamilyEvent) => [e.notes, 'Added in Den Duty'].filter(Boolean).join('\n\n');

// ---------- OAuth (Google and Microsoft) ----------

interface OAuthSecret { refresh: string; access?: string; expires?: number }

export function oauthConfig(kind: 'google' | 'microsoft') {
  if (kind === 'google') {
    if (!config.google) return null;
    return {
      ...config.google,
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events',
      extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' } as Record<string, string>,
    };
  }
  if (!config.microsoft) return null;
  const t = config.microsoft.tenant;
  return {
    clientId: config.microsoft.clientId, clientSecret: config.microsoft.clientSecret,
    authUrl: `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${t}/oauth2/v2.0/token`,
    scope: 'offline_access Calendars.ReadWrite',
    extra: { prompt: 'select_account' } as Record<string, string>,
  };
}

export const redirectUri = (kind: string) => `${config.publicUrl}/api/calendar-sync/callback/${kind}`;

export async function exchangeCode(kind: 'google' | 'microsoft', code: string): Promise<OAuthSecret> {
  const c = oauthConfig(kind)!;
  const res = await http(c.tokenUrl, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri(kind), grant_type: 'authorization_code', ...(kind === 'microsoft' ? { scope: c.scope } : {}) }),
  });
  const t = await json<{ access_token: string; refresh_token?: string; expires_in: number }>(res);
  if (!t.refresh_token) throw new Error('No refresh token came back. Remove Den Duty from your account’s connected apps and link again.');
  return { refresh: t.refresh_token, access: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000 };
}

async function accessToken(db: DatabaseSync, acct: Row): Promise<string> {
  const kind = acct.kind as 'google' | 'microsoft';
  const s = parseJson<OAuthSecret | null>(openKey(String(acct.secret ?? '')), null);
  if (!s?.refresh) throw new Error('This calendar needs linking again (Settings → Calendars)');
  if (s.access && (s.expires ?? 0) > Date.now()) return s.access;
  const c = oauthConfig(kind);
  if (!c) throw new Error(`${kind === 'google' ? 'Google' : 'Microsoft'} isn't set up on this server any more`);
  const res = await http(c.tokenUrl, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: s.refresh, grant_type: 'refresh_token', ...(kind === 'microsoft' ? { scope: c.scope } : {}) }),
  });
  const t = await json<{ access_token: string; refresh_token?: string; expires_in: number }>(res);
  const next: OAuthSecret = { refresh: t.refresh_token ?? s.refresh, access: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000 };
  db.prepare('UPDATE calendar_accounts SET secret = ? WHERE id = ?').run(sealKey(JSON.stringify(next)), acct.id as string);
  return next.access!;
}

// ---------- Google ----------

function google(db: DatabaseSync, acct: Row, tz: string): Adapter {
  const cal = encodeURIComponent((acct.calendar_id as string) || 'primary');
  const base = 'https://www.googleapis.com/calendar/v3';
  const auth = async () => ({ authorization: `Bearer ${await accessToken(db, acct)}`, 'content-type': 'application/json' });
  type G = { id: string; etag: string; status?: string; summary?: string; description?: string; location?: string; start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string } };
  const body = (e: FamilyEvent) => JSON.stringify({
    summary: e.title, description: notesOf(e), location: e.location ?? undefined,
    start: e.time ? { dateTime: `${e.date}T${e.time}:00`, timeZone: tz } : { date: e.date },
    end: e.time ? { dateTime: `${e.endDate ?? e.date}T${e.endTime ?? plusHour(e.time)}:00`, timeZone: tz } : { date: nextDay(e.endDate ?? e.date) },
    extendedProperties: { private: { denDuty: e.id } },
  });
  return {
    async calendars() {
      const r = await json<{ items: { id: string; summary: string; primary?: boolean; accessRole: string }[] }>(await http(`${base}/users/me/calendarList?minAccessRole=writer`, { headers: await auth() }));
      return r.items.map((c) => ({ id: c.id, name: c.summary, primary: !!c.primary }));
    },
    async list(from, to) {
      const out: RemoteEvent[] = [];
      let page = '';
      for (let n = 0; n < 10; n++) {
        const q = new URLSearchParams({ timeMin: `${from}T00:00:00Z`, timeMax: `${nextDay(to)}T00:00:00Z`, singleEvents: 'true', maxResults: '250', timeZone: tz, ...(page ? { pageToken: page } : {}) });
        const r = await json<{ items: G[]; nextPageToken?: string }>(await http(`${base}/calendars/${cal}/events?${q}`, { headers: await auth() }));
        for (const g of r.items) {
          if (g.status === 'cancelled') continue;
          const allDay = !!g.start.date;
          out.push({
            id: g.id, etag: g.etag, title: g.summary || '(no title)', location: g.location ?? null, notes: g.description ?? null,
            date: allDay ? g.start.date! : g.start.dateTime!.slice(0, 10), time: allDay ? null : g.start.dateTime!.slice(11, 16),
            endDate: allDay ? (prevDay(g.end.date!) > g.start.date! ? prevDay(g.end.date!) : null) : (g.end.dateTime!.slice(0, 10) > g.start.dateTime!.slice(0, 10) ? g.end.dateTime!.slice(0, 10) : null),
            endTime: allDay ? null : g.end.dateTime!.slice(11, 16),
          });
        }
        if (!r.nextPageToken) break;
        page = r.nextPageToken;
      }
      return out;
    },
    async create(e) {
      const g = await json<G>(await http(`${base}/calendars/${cal}/events`, { method: 'POST', headers: await auth(), body: body(e) }));
      return { id: g.id, etag: g.etag };
    },
    async update(id, e) {
      const g = await json<G>(await http(`${base}/calendars/${cal}/events/${encodeURIComponent(id)}`, { method: 'PUT', headers: await auth(), body: body(e) }));
      return { etag: g.etag };
    },
    async remove(id) {
      await http(`${base}/calendars/${cal}/events/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await auth(), ok: [404, 410] });
    },
  };
}

// ---------- Microsoft Graph ----------

function microsoft(db: DatabaseSync, acct: Row, tz: string): Adapter {
  const base = 'https://graph.microsoft.com/v1.0/me';
  const cal = acct.calendar_id ? `/calendars/${encodeURIComponent(acct.calendar_id as string)}` : '/calendar';
  const auth = async () => ({ authorization: `Bearer ${await accessToken(db, acct)}`, 'content-type': 'application/json', prefer: `outlook.timezone="${tz}"` });
  type M = { id: string; '@odata.etag'?: string; subject?: string; isAllDay: boolean; isCancelled?: boolean; bodyPreview?: string; location?: { displayName?: string }; start: { dateTime: string }; end: { dateTime: string } };
  const body = (e: FamilyEvent) => JSON.stringify({
    subject: e.title, body: { contentType: 'text', content: notesOf(e) }, location: e.location ? { displayName: e.location } : undefined,
    isAllDay: !e.time,
    start: { dateTime: `${e.date}T${e.time ?? '00:00'}:00`, timeZone: tz },
    end: e.time ? { dateTime: `${e.endDate ?? e.date}T${e.endTime ?? plusHour(e.time)}:00`, timeZone: tz } : { dateTime: `${nextDay(e.endDate ?? e.date)}T00:00:00`, timeZone: tz },
  });
  return {
    async calendars() {
      const r = await json<{ value: { id: string; name: string; canEdit: boolean; isDefaultCalendar?: boolean }[] }>(await http(`${base}/calendars?$top=50`, { headers: await auth() }));
      return r.value.filter((c) => c.canEdit).map((c) => ({ id: c.id, name: c.name, primary: !!c.isDefaultCalendar }));
    },
    async list(from, to) {
      const out: RemoteEvent[] = [];
      let url = `${base}${cal}/calendarView?${new URLSearchParams({ startDateTime: `${from}T00:00:00`, endDateTime: `${nextDay(to)}T00:00:00`, $top: '250' })}`;
      for (let n = 0; n < 10 && url; n++) {
        const r = await json<{ value: M[]; '@odata.nextLink'?: string }>(await http(url, { headers: await auth() }));
        for (const m of r.value) {
          if (m.isCancelled) continue;
          const sd = m.start.dateTime.slice(0, 10), ed = m.end.dateTime.slice(0, 10);
          out.push({
            id: m.id, etag: m['@odata.etag'] ?? null, title: m.subject || '(no title)', location: m.location?.displayName || null, notes: m.bodyPreview || null,
            date: sd, time: m.isAllDay ? null : m.start.dateTime.slice(11, 16),
            endDate: m.isAllDay ? (prevDay(ed) > sd ? prevDay(ed) : null) : (ed > sd ? ed : null),
            endTime: m.isAllDay ? null : m.end.dateTime.slice(11, 16),
          });
        }
        url = r['@odata.nextLink'] ?? '';
      }
      return out;
    },
    async create(e) {
      const m = await json<M>(await http(`${base}${cal}/events`, { method: 'POST', headers: await auth(), body: body(e) }));
      return { id: m.id, etag: m['@odata.etag'] ?? null };
    },
    async update(id, e) {
      const m = await json<M>(await http(`${base}/events/${encodeURIComponent(id)}`, { method: 'PATCH', headers: await auth(), body: body(e) }));
      return { etag: m['@odata.etag'] ?? null };
    },
    async remove(id) {
      await http(`${base}/events/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await auth(), ok: [404] });
    },
  };
}

// ---------- CalDAV (iCloud, Nextcloud, Fastmail, Radicale...) ----------

const xmlText = (xml: string, tag: string): string[] => {
  const re = new RegExp(`<(?:[a-zA-Z0-9]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tag}>`, 'g');
  const out: string[] = [];
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1]);
  return out;
};
const unXml = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
const hrefIn = (xml: string) => { const h = xmlText(xml, 'href')[0]; return h ? unXml(h) : null; };

/** Finds the calendars an account can write to: principal → calendar home → calendars. */
export async function caldavCalendars(url: string, username: string, password: string): Promise<RemoteCalendar[]> {
  const auth = { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };
  const prop = async (u: string, depth: string, body: string) => (await http(u, { method: 'PROPFIND', headers: { ...auth, depth, 'content-type': 'application/xml; charset=utf-8' }, body, ok: [207] })).text();
  const abs = (href: string, from: string) => new URL(href, from).href;
  let home = url;
  const p1 = await prop(url, '0', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:current-user-principal/><c:calendar-home-set/><d:resourcetype/></d:prop></d:propfind>');
  // Already a calendar URL?
  if (/<(?:[a-zA-Z0-9]+:)?calendar\s*\/>/.test(xmlText(p1, 'resourcetype')[0] ?? '')) {
    return [{ id: url, name: unXml(xmlText(p1, 'displayname')[0] ?? '') || 'Calendar' }];
  }
  const homeSet = xmlText(p1, 'calendar-home-set')[0];
  if (homeSet && hrefIn(homeSet)) home = abs(hrefIn(homeSet)!, url);
  else {
    const principal = xmlText(p1, 'current-user-principal')[0];
    if (principal && hrefIn(principal)) {
      const pUrl = abs(hrefIn(principal)!, url);
      const p2 = await prop(pUrl, '0', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>');
      const hs = xmlText(p2, 'calendar-home-set')[0];
      if (hs && hrefIn(hs)) home = abs(hrefIn(hs)!, pUrl);
    }
  }
  const list = await prop(home, '1', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>');
  return xmlText(list, 'response')
    .filter((r) => /<(?:[a-zA-Z0-9]+:)?calendar\s*\/>/.test(xmlText(r, 'resourcetype')[0] ?? '') && (!/supported-calendar-component-set/.test(r) || /name="VEVENT"/.test(r)))
    .map((r) => ({ id: abs(hrefIn(r)!, home), name: unXml(xmlText(r, 'displayname')[0] ?? '') || 'Calendar' }));
}

function caldav(acct: Row, tz: string): Adapter {
  const password = openKey(String(acct.secret ?? '')) ?? '';
  const username = acct.username as string;
  const auth = { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };
  const cal = String(acct.calendar_id || acct.url).replace(/\/?$/, '/');
  const ics = (e: FamilyEvent, uid: string) => buildIcs('Den Duty', tz, [{
    uid, summary: e.title, description: notesOf(e), location: e.location, date: e.date, time: e.time,
    durationMinutes: e.time ? Math.max(Math.round((Date.parse(`${e.endDate ?? e.date}T${e.endTime ?? plusHour(e.time)}:00Z`) - Date.parse(`${e.date}T${e.time}:00Z`)) / 60000), 15) : null,
    endDate: e.time ? null : nextDay(e.endDate ?? e.date),
  }]).replace('METHOD:PUBLISH\r\n', '');
  const utc = (d: string) => `${d.replace(/-/g, '')}T000000Z`;
  return {
    async calendars() { return caldavCalendars(String(acct.url), username, password); },
    async list(from, to) {
      const body = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data><c:expand start="${utc(from)}" end="${utc(nextDay(to))}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${utc(from)}" end="${utc(nextDay(to))}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
      const xml = await (await http(cal, { method: 'REPORT', headers: { ...auth, depth: '1', 'content-type': 'application/xml; charset=utf-8' }, body, ok: [207] })).text();
      const out: RemoteEvent[] = [];
      for (const r of xmlText(xml, 'response')) {
        const href = hrefIn(r);
        const data = xmlText(r, 'calendar-data')[0];
        if (!href || !data) continue;
        const etag = unXml(xmlText(r, 'getetag')[0] ?? '') || null;
        for (const ev of parseIcs(unXml(data), tz)) {
          const end = ev.time && ev.durationMinutes ? new Date(Date.parse(`${ev.date}T${ev.time}:00Z`) + ev.durationMinutes * 60e3).toISOString() : null;
          out.push({
            // Expanded repeats share a file: tell them apart by occurrence.
            id: ev.recurrenceId ? `${href}#${ev.recurrenceId}` : href, etag,
            title: ev.summary, notes: ev.description ?? null, location: ev.location ?? null, date: ev.date, time: ev.time ?? null,
            endDate: ev.time ? (end && end.slice(0, 10) > ev.date ? end.slice(0, 10) : null) : (ev.endDate ? prevDay(ev.endDate) : null),
            endTime: end ? end.slice(11, 16) : null,
          });
        }
      }
      return out;
    },
    async create(e) {
      const uid = `${e.id}@den-duty`;
      const href = new URL(`${encodeURIComponent(e.id)}.ics`, cal).href;
      const res = await http(href, { method: 'PUT', headers: { ...auth, 'content-type': 'text/calendar; charset=utf-8', 'if-none-match': '*' }, body: ics(e, uid) });
      return { id: new URL(href).pathname, etag: res.headers.get('etag') };
    },
    async update(id, e) {
      const res = await http(new URL(id, cal).href, { method: 'PUT', headers: { ...auth, 'content-type': 'text/calendar; charset=utf-8' }, body: ics(e, `${e.id}@den-duty`) });
      return { etag: res.headers.get('etag') };
    },
    async remove(id) {
      await http(new URL(id, cal).href, { method: 'DELETE', headers: auth, ok: [404, 410] });
    },
  };
}

export function adapterFor(db: DatabaseSync, acct: Row, tz: string): Adapter {
  if (acct.kind === 'google') return google(db, acct, tz);
  if (acct.kind === 'microsoft') return microsoft(db, acct, tz);
  return caldav(acct, tz);
}

/** Swapped in tests: a fake calendar instead of a real one. */
let adapterOverride: ((acct: Row) => Adapter) | null = null;
export function setAdapterOverride(f: ((acct: Row) => Adapter) | null): void { adapterOverride = f; }

// ---------- syncing ----------

export interface SyncResult { pulled: number; removed: number; pushed: number; updated: number; deleted: number }

const fieldsOf = (r: RemoteEvent, memberIds: string[]): EventFields => ({
  title: r.title.slice(0, 120), date: r.date, endDate: r.endDate && r.endDate > r.date ? r.endDate : null,
  time: r.time, endTime: r.time ? r.endTime : null, location: r.location?.slice(0, 200) ?? null, notes: r.notes?.slice(0, 1000) ?? null,
  memberIds, kidsSee: true,
});

export async function syncAccount(db: DatabaseSync, acctId: string): Promise<SyncResult> {
  const acct = db.prepare('SELECT * FROM calendar_accounts WHERE id = ?').get(acctId) as Row | undefined;
  const res: SyncResult = { pulled: 0, removed: 0, pushed: 0, updated: 0, deleted: 0 };
  if (!acct) return res;
  const home = homeInfo(db, acct.home_id as string);
  const today = homeToday(home);
  const from = addDays(today, -31), to = addDays(today, 120);
  const a = adapterOverride ? adapterOverride(acct) : adapterFor(db, acct, home.timezone);
  const memberIds = parseJson<string[]>(acct.member_ids, []);
  try {
    // Out first, so our own events are linked before we look at what's there.
    // Deleted here: delete there.
    for (const l of db.prepare(`SELECT l.*, e.id AS eid FROM event_links l JOIN family_events e ON e.id = l.event_id
      WHERE l.account_id = ? AND e.deleted = 1`).all(acctId) as Row[]) {
      await a.remove(l.remote_id as string, l.etag as string | null);
      db.prepare('DELETE FROM event_links WHERE event_id = ? AND account_id = ?').run(l.eid as string, acctId);
      res.deleted++;
    }
    if (acct.push) {
      const mine = (db.prepare(`SELECT e.*, l.remote_id, l.etag AS link_etag, l.synced_at AS link_synced FROM family_events e
        LEFT JOIN event_links l ON l.event_id = e.id AND l.account_id = ?
        WHERE e.home_id = ? AND e.deleted = 0 AND e.account_id IS NULL AND COALESCE(e.end_date, e.date) >= ?`).all(acctId, acct.home_id as string, from) as Row[]);
      for (const r of mine) {
        const e = eventView(r);
        // A calendar for one kid only gets their events (and the whole family's).
        if (memberIds.length && e.memberIds.length && !e.memberIds.some((m) => memberIds.includes(m))) continue;
        if (!r.remote_id) {
          const made = await a.create(e);
          db.prepare('INSERT OR REPLACE INTO event_links (event_id, account_id, remote_id, etag) VALUES (?, ?, ?, ?)').run(e.id, acctId, made.id, made.etag);
          res.pushed++;
        } else if ((r.updated_at as string) > (r.link_synced as string)) {
          const u = await a.update(r.remote_id as string, e, r.link_etag as string | null);
          db.prepare("UPDATE event_links SET etag = ?, synced_at = datetime('now') WHERE event_id = ? AND account_id = ?").run(u.etag, e.id, acctId);
          res.updated++;
        }
      }
    }
    // In: mirror what's there (skipping our own events, which are already here).
    if (acct.pull) {
      const ours = new Set((db.prepare(`SELECT l.remote_id FROM event_links l JOIN family_events e ON e.id = l.event_id
        WHERE l.account_id = ? AND e.account_id IS NULL`).all(acctId) as Row[]).map((r) => r.remote_id as string));
      const mirrored = new Map((db.prepare(`SELECT l.remote_id, l.etag, e.id FROM event_links l JOIN family_events e ON e.id = l.event_id
        WHERE l.account_id = ? AND e.account_id = ?`).all(acctId, acctId) as Row[]).map((r) => [r.remote_id as string, r]));
      const seen = new Set<string>();
      for (const r of await a.list(from, to)) {
        if (ours.has(r.id) || seen.has(r.id)) continue;
        // An event Den Duty made in another family's calendar, or a copy of ours: leave it.
        if (/Added in Den Duty\s*$/.test(r.notes ?? '')) continue;
        seen.add(r.id);
        const have = mirrored.get(r.id);
        const f = fieldsOf(r, memberIds);
        if (!have) {
          const id = insertEvent(db, acct.home_id as string, f, acct.kind as string, null, acctId);
          db.prepare('INSERT INTO event_links (event_id, account_id, remote_id, etag) VALUES (?, ?, ?, ?)').run(id, acctId, r.id, r.etag);
          res.pulled++;
        } else if (!r.etag || r.etag !== have.etag) {
          updateEvent(db, have.id as string, f);
          db.prepare("UPDATE event_links SET etag = ?, synced_at = datetime('now') WHERE event_id = ? AND account_id = ?").run(r.etag, have.id as string, acctId);
        }
      }
      // Gone there (inside the window we looked at): gone here.
      for (const [remoteId, have] of mirrored) {
        if (seen.has(remoteId)) continue;
        const e = db.prepare('SELECT date, end_date FROM family_events WHERE id = ?').get(have.id as string) as Row | undefined;
        if (e && ((e.end_date as string | null) ?? (e.date as string)) >= from && (e.date as string) <= to) {
          db.prepare('DELETE FROM family_events WHERE id = ?').run(have.id as string);
          res.removed++;
        }
      }
    }
    db.prepare("UPDATE calendar_accounts SET synced_at = datetime('now'), error = NULL WHERE id = ?").run(acctId);
  } catch (err) {
    db.prepare("UPDATE calendar_accounts SET synced_at = datetime('now'), error = ? WHERE id = ?").run((err as Error).message.slice(0, 300), acctId);
    throw err;
  } finally {
    // Tombstones no linked calendar still holds can go.
    db.prepare('DELETE FROM family_events WHERE home_id = ? AND deleted = 1 AND NOT EXISTS (SELECT 1 FROM event_links l WHERE l.event_id = family_events.id)').run(acct.home_id as string);
  }
  return res;
}

/** Every linked calendar of a home. Errors are kept on each account for Settings to show. */
export async function syncHome(db: DatabaseSync, homeId: string): Promise<void> {
  const ids = (db.prepare('SELECT id FROM calendar_accounts WHERE home_id = ? AND calendar_id IS NOT NULL').all(homeId) as Row[]).map((r) => r.id as string);
  for (const id of ids) await syncAccount(db, id).catch(() => {});
  // With no calendars linked, a deleted event has nothing to wait for.
  if (!ids.length) db.prepare('DELETE FROM family_events WHERE home_id = ? AND deleted = 1').run(homeId);
}

const pending = new Map<string, NodeJS.Timeout>();
/** After a change: sync that home in a few seconds (several quick edits make one sync). */
export function syncSoon(db: DatabaseSync, homeId: string): void {
  if (!db.prepare('SELECT 1 FROM calendar_accounts WHERE home_id = ? AND calendar_id IS NOT NULL').get(homeId)) return;
  clearTimeout(pending.get(homeId));
  const t = setTimeout(() => { pending.delete(homeId); void syncHome(db, homeId); }, 3000);
  t.unref();
  pending.set(homeId, t);
}

let lastAll = 0;
/** The every-15-minutes sync, called from the minute timer. */
export async function syncAllDue(db: DatabaseSync): Promise<void> {
  if (Date.now() - lastAll < 15 * 60e3) return;
  lastAll = Date.now();
  for (const h of db.prepare('SELECT DISTINCT home_id FROM calendar_accounts WHERE calendar_id IS NOT NULL').all() as Row[]) await syncHome(db, h.home_id as string);
}

export function newAccountId(): string { return newId(); }
