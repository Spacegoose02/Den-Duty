// Linking calendars for two-way sync (see calsync.ts): Google and Microsoft through OAuth, CalDAV with an
// app password. Parents only (caregivers never see this).
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { cookieOpts, homeCtx, homeCtxFor } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, parseJson, requireStr, str } from '../util.ts';
import { sealKey } from '../ai.ts';
import {
  adapterFor, caldavCalendars, exchangeCode, newAccountId, oauthConfig, redirectUri, syncAccount, type Kind,
} from '../calsync.ts';
import { homeInfo } from '../chores.ts';


const view = (r: Row) => ({
  id: r.id as string, kind: r.kind as Kind, name: r.name as string, calendarId: r.calendar_id as string | null, calendarName: r.calendar_name as string | null,
  pull: !!r.pull, push: !!r.push, memberIds: parseJson<string[]>(r.member_ids, []), syncedAt: r.synced_at as string | null, error: r.error as string | null,
  username: r.kind === 'caldav' ? r.username as string : null,
});

export function calSyncRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const getAcct = (homeId: string, id: string) => {
    const r = db.prepare('SELECT * FROM calendar_accounts WHERE id = ? AND home_id = ?').get(id, homeId) as Row | undefined;
    if (!r) throw new HttpError(404, 'That calendar link is gone');
    return r;
  };

  app.get('/api/homes/:homeId/calendar-sync', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    return {
      providers: { google: !!oauthConfig('google'), microsoft: !!oauthConfig('microsoft'), caldav: true },
      accounts: (db.prepare('SELECT * FROM calendar_accounts WHERE home_id = ? ORDER BY created_at').all(ctx.homeId) as Row[]).map(view),
    };
  });

  // Google / Microsoft: off to their sign-in page, then back to the callback.
  app.get('/api/homes/:homeId/calendar-sync/:kind/start', async (req, reply) => {
    const ctx = homeCtx(db, req, 'parent');
    const kind = (req.params as { kind: string }).kind as 'google' | 'microsoft';
    const c = kind === 'google' || kind === 'microsoft' ? oauthConfig(kind) : null;
    if (!c) throw new HttpError(400, `${kind} calendars aren't set up on this server (see docs/calendar-sync.md)`);
    const state = crypto.randomBytes(16).toString('hex');
    reply.setCookie('dn_calsync', JSON.stringify({ state, homeId: ctx.homeId, kind }), { ...cookieOpts(reply), maxAge: 600 });
    const url = new URL(c.authUrl);
    for (const [k, v] of Object.entries({ client_id: c.clientId, redirect_uri: redirectUri(kind), response_type: 'code', scope: c.scope, state, ...c.extra })) url.searchParams.set(k, v);
    return reply.redirect(url.href);
  });

  app.get('/api/calendar-sync/callback/:kind', async (req, reply) => {
    const kind = (req.params as { kind: string }).kind as 'google' | 'microsoft';
    const q = req.query as { code?: string; state?: string; error?: string };
    const raw = req.cookies.dn_calsync;
    const un = raw ? req.unsignCookie(raw) : null;
    reply.clearCookie('dn_calsync', { path: '/' });
    if (q.error) return reply.redirect('/settings?calendar=cancelled#calendar-sync');
    if (!un?.valid || !un.value) return reply.redirect('/settings?calendar=expired#calendar-sync');
    const st = JSON.parse(un.value) as { state: string; homeId: string; kind: string };
    if (st.state !== q.state || st.kind !== kind || !q.code) return reply.redirect('/settings?calendar=expired#calendar-sync');
    // Still a parent of that home?
    homeCtxFor(db, req, st.homeId, 'parent');
    const secret = await exchangeCode(kind, q.code);
    const id = newAccountId();
    db.prepare('INSERT INTO calendar_accounts (id, home_id, kind, name, secret) VALUES (?, ?, ?, ?, ?)')
      .run(id, st.homeId, kind, kind === 'google' ? 'Google Calendar' : 'Outlook', sealKey(JSON.stringify(secret)));
    return reply.redirect(`/settings?calendar=${id}#calendar-sync`);
  });

  // CalDAV: iCloud (appleid.apple.com → App-Specific Passwords), Nextcloud, Fastmail...
  app.post('/api/homes/:homeId/calendar-sync/caldav', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const b = (req.body ?? {}) as Row;
    let url = requireStr(b.url, 'Server address', 500).trim();
    if (/^caldav\.icloud\.com$|icloud/i.test(url) && !/^https?:/i.test(url)) url = 'https://caldav.icloud.com/';
    if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url)) throw new HttpError(400, 'The address should start with https://');
    const username = requireStr(b.username, 'Username', 200);
    const password = requireStr(b.password, 'Password', 500);
    let cals;
    try { cals = await caldavCalendars(url, username, password); } catch (err) { throw new HttpError(400, `Couldn't reach that calendar: ${(err as Error).message}`); }
    if (!cals.length) throw new HttpError(400, 'Signed in, but found no calendars there');
    const id = newAccountId();
    db.prepare('INSERT INTO calendar_accounts (id, home_id, kind, name, url, username, secret) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, ctx.homeId, 'caldav', str(b.name, 60) ?? (/icloud/i.test(url) ? 'iCloud' : 'CalDAV'), url, username, sealKey(password));
    return { ...view(getAcct(ctx.homeId, id)), calendars: cals };
  });

  app.get('/api/homes/:homeId/calendar-sync/:id/calendars', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const acct = getAcct(ctx.homeId, (req.params as { id: string }).id);
    try { return await adapterFor(db, acct, homeInfo(db, ctx.homeId).timezone).calendars(); } catch (err) { throw new HttpError(502, (err as Error).message); }
  });

  app.patch('/api/homes/:homeId/calendar-sync/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const acct = getAcct(ctx.homeId, (req.params as { id: string }).id);
    const b = (req.body ?? {}) as Row;
    const kids = new Set((db.prepare("SELECT id FROM members WHERE home_id = ? AND role = 'kid'").all(ctx.homeId) as Row[]).map((r) => r.id as string));
    db.prepare('UPDATE calendar_accounts SET name = ?, calendar_id = ?, calendar_name = ?, pull = ?, push = ?, member_ids = ? WHERE id = ?').run(
      b.name !== undefined ? str(b.name, 60) ?? acct.name as string : acct.name as string,
      b.calendarId !== undefined ? str(b.calendarId, 500) : acct.calendar_id as string | null,
      b.calendarName !== undefined ? str(b.calendarName, 120) : acct.calendar_name as string | null,
      b.pull !== undefined ? (b.pull ? 1 : 0) : acct.pull as number,
      b.push !== undefined ? (b.push ? 1 : 0) : acct.push as number,
      b.memberIds !== undefined ? JSON.stringify(Array.isArray(b.memberIds) ? b.memberIds.map(String).filter((id) => kids.has(id)) : []) : acct.member_ids as string,
      acct.id as string,
    );
    // Switching calendars: the old one's mirror goes, and our events get made in the new one.
    if (b.calendarId !== undefined && b.calendarId !== acct.calendar_id) {
      db.prepare('DELETE FROM family_events WHERE account_id = ?').run(acct.id as string);
      db.prepare('DELETE FROM event_links WHERE account_id = ?').run(acct.id as string);
    }
    if (b.pull === false) db.prepare('DELETE FROM family_events WHERE account_id = ?').run(acct.id as string);
    return view(getAcct(ctx.homeId, acct.id as string));
  });

  app.post('/api/homes/:homeId/calendar-sync/:id/sync', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const acct = getAcct(ctx.homeId, (req.params as { id: string }).id);
    if (!acct.calendar_id) throw new HttpError(400, 'Pick which calendar to use first');
    try { return { ...(await syncAccount(db, acct.id as string)), account: view(getAcct(ctx.homeId, acct.id as string)) }; } catch (err) { throw new HttpError(502, (err as Error).message); }
  });

  // Unlinking: the mirrored events go; events made here stay (and stay in the other calendar too).
  app.delete('/api/homes/:homeId/calendar-sync/:id', async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const acct = getAcct(ctx.homeId, (req.params as { id: string }).id);
    db.prepare('DELETE FROM family_events WHERE account_id = ?').run(acct.id as string);
    db.prepare('DELETE FROM calendar_accounts WHERE id = ?').run(acct.id as string);
    db.prepare('DELETE FROM family_events WHERE home_id = ? AND deleted = 1 AND NOT EXISTS (SELECT 1 FROM event_links l WHERE l.event_id = family_events.id)').run(ctx.homeId);
    return { ok: true };
  });
}
