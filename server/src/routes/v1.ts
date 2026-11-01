// The public API, /api/v1: a fixed list of the app's own endpoints that other apps and scripts may call with a home's
// API token (Settings → Home Assistant and API tokens), plus a few made just for it. Read tokens can call the GET
// endpoints; control tokens can call all of them. A signed-in parent can call them from the browser too.
//
// Most v1 endpoints are the app's own routes served again under /api/v1, so they can't drift from what the app does.
// Anything private stays out: Doctors, Helpdesk, AI, sign-in, devices, tokens and the home's join code.
import type { FastifyInstance, RouteOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError } from '../util.ts';
import { agenda, homeInfo, homeToday, kidsWithPageOff } from '../chores.ts';
import { eventView } from '../events.ts';
import { getKid, listKids } from './homes.ts';
import { addDays, daysBetween, isIsoDate, startOfWeek } from '../../../shared/schedule.ts';

export type ApiScope = 'read' | 'control';

interface Param { name: string; in: 'path' | 'query'; description: string; required?: boolean }
interface Field { name: string; type: string; description: string; required?: boolean }
export interface V1Route {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** The path under /api/v1. */
  path: string;
  /** The app's own route this serves, when it isn't one made just for the API. */
  from?: string;
  scope: ApiScope;
  tag: string;
  summary: string;
  query?: Param[];
  body?: Field[];
}

const KID = { name: 'kidId', in: 'path', description: 'A kid id from GET /kids', required: true } as const;

/** Every v1 endpoint, with what the docs page says about it. */
export const V1_ROUTES: V1Route[] = [
  { method: 'GET', path: '/homes/:homeId', scope: 'read', tag: 'Home', summary: "The home: name, time zone, week start, points name and icon, and today's date there." },
  { method: 'GET', path: '/homes/:homeId/kids', from: '/homes/:homeId/kids', scope: 'read', tag: 'Kids', summary: 'Every kid with their avatar, color, age, balance and which pages are switched off.' },

  { method: 'GET', path: '/homes/:homeId/chores', from: '/homes/:homeId/chores', scope: 'read', tag: 'Chores', summary: 'Active chores with their schedule, points and the kids they belong to.' },
  {
    method: 'POST', path: '/homes/:homeId/chores', from: '/homes/:homeId/chores', scope: 'control', tag: 'Chores', summary: 'Create a chore.',
    body: [
      { name: 'title', type: 'string', description: 'Up to 80 characters', required: true },
      { name: 'memberIds', type: 'string[]', description: 'Kid ids (may be empty for a bonus chore)', required: true },
      { name: 'icon', type: 'string', description: 'One emoji (default ⭐)' },
      { name: 'points', type: 'integer', description: '0 to 10000 (default 1)' },
      { name: 'schedule', type: '"daily" | "weekly" | "once"', description: 'Default daily' },
      { name: 'weekdays', type: 'integer[]', description: 'For weekly: 0 = Sunday … 6 = Saturday' },
      { name: 'dueDate', type: 'YYYY-MM-DD', description: 'For once' },
      { name: 'bonus', type: 'boolean', description: 'Opt-in bonus chore' },
      { name: 'claimLimit', type: '"each" | "one"', description: 'Bonus chores: every kid, or first come (one per day)' },
    ],
  },
  { method: 'PATCH', path: '/homes/:homeId/chores/:choreId', from: '/homes/:homeId/chores/:choreId', scope: 'control', tag: 'Chores', summary: 'Change a chore. Send only the fields to change (same fields as creating one).' },
  { method: 'DELETE', path: '/homes/:homeId/chores/:choreId', from: '/homes/:homeId/chores/:choreId', scope: 'control', tag: 'Chores', summary: 'Retire a chore. Past days keep what was done.' },

  {
    method: 'GET', path: '/homes/:homeId/instances', scope: 'read', tag: 'Chores',
    summary: 'Chores per kid per day, with their status (pending, submitted, approved, rejected; planned for future days). At most 92 days at a time.',
    query: [
      { name: 'from', in: 'query', description: 'YYYY-MM-DD (default: start of this week)' },
      { name: 'to', in: 'query', description: 'YYYY-MM-DD (default: 6 days after from)' },
      { name: 'kid', in: 'query', description: 'Only this kid' },
      { name: 'status', in: 'query', description: 'Only this status' },
    ],
  },
  { method: 'GET', path: '/homes/:homeId/review', from: '/homes/:homeId/review', scope: 'read', tag: 'Chores', summary: 'Chores kids marked done that are waiting for a grown-up.' },
  { method: 'POST', path: '/homes/:homeId/instances/:id/done', from: '/homes/:homeId/instances/:id/done', scope: 'control', tag: 'Chores', summary: 'Tick a chore off as a grown-up: it counts straight away and pays its points.' },
  { method: 'POST', path: '/homes/:homeId/instances/:id/approve', from: '/homes/:homeId/instances/:id/approve', scope: 'control', tag: 'Chores', summary: 'Approve a chore waiting for review: it pays its points.' },
  {
    method: 'POST', path: '/homes/:homeId/instances/:id/reject', from: '/homes/:homeId/instances/:id/reject', scope: 'control', tag: 'Chores', summary: 'Send a chore back to try again.',
    body: [{ name: 'note', type: 'string', description: 'What to fix (the kid sees it)' }],
  },
  { method: 'POST', path: '/homes/:homeId/instances/:id/undo', from: '/homes/:homeId/instances/:id/undo', scope: 'control', tag: 'Chores', summary: 'Undo: an approval is taken back with a reversing ledger row, a waiting chore goes back to to-do.' },

  { method: 'GET', path: '/homes/:homeId/kids/:kidId/ledger', from: '/homes/:homeId/kids/:memberId/ledger', scope: 'read', tag: 'Points', summary: "A kid's balance and newest ledger rows.", query: [KID, { name: 'limit', in: 'query', description: 'Rows, up to 500 (default 100)' }] },
  {
    method: 'POST', path: '/homes/:homeId/kids/:kidId/points', from: '/homes/:homeId/kids/:memberId/points', scope: 'control', tag: 'Points',
    summary: "Give bonus points (positive amount) or take some away (negative). Penalties stop at zero unless the home allows negative balances.",
    query: [KID],
    body: [{ name: 'amount', type: 'integer', description: 'Not zero', required: true }, { name: 'reason', type: 'string', description: 'The kid sees it' }],
  },
  { method: 'GET', path: '/homes/:homeId/kids/:kidId/goals', from: '/homes/:homeId/kids/:memberId/goals', scope: 'read', tag: 'Points', summary: "A kid's goals and how close they are.", query: [KID, { name: 'all', in: 'query', description: '1 to include redeemed goals' }] },
  {
    method: 'POST', path: '/homes/:homeId/kids/:kidId/goals', from: '/homes/:homeId/kids/:memberId/goals', scope: 'control', tag: 'Points', summary: 'Add a goal.',
    query: [KID],
    body: [{ name: 'title', type: 'string', description: 'Up to 80 characters', required: true }, { name: 'targetPoints', type: 'integer', description: 'At least 1', required: true }, { name: 'reward', type: 'string', description: 'What they get' }],
  },
  { method: 'POST', path: '/homes/:homeId/goals/:goalId/redeem', from: '/homes/:homeId/goals/:goalId/redeem', scope: 'control', tag: 'Points', summary: 'Hand over the reward: spends the goal’s points.' },

  { method: 'GET', path: '/homes/:homeId/parent-duty', from: '/homes/:homeId/parent-duty', scope: 'read', tag: 'Parent Duty', summary: 'Open Parent Duty cards.', query: [{ name: 'kid', in: 'query', description: 'A kid id, or "general"' }] },
  {
    method: 'GET', path: '/homes/:homeId/parent-duty/history', from: '/homes/:homeId/parent-duty/history', scope: 'read', tag: 'Parent Duty', summary: 'Closed Parent Duty cards, newest first.',
    query: [{ name: 'kid', in: 'query', description: 'A kid id, or "general"' }, { name: 'q', in: 'query', description: 'Search titles and notes' }, { name: 'limit', in: 'query', description: 'Up to 500 (default 100)' }],
  },
  {
    method: 'POST', path: '/homes/:homeId/parent-duty', from: '/homes/:homeId/parent-duty', scope: 'control', tag: 'Parent Duty', summary: 'Add a card.',
    body: [
      { name: 'title', type: 'string', description: 'Up to 120 characters', required: true },
      { name: 'kidId', type: 'string', description: 'The kid it is for (leave out for the general list)' },
      { name: 'notes', type: 'string', description: 'Details' },
      { name: 'dueDate', type: 'YYYY-MM-DD', description: 'Shows on the calendar' },
      { name: 'status', type: '"todo" | "doing" | "done"', description: 'Default todo' },
    ],
  },
  { method: 'PATCH', path: '/homes/:homeId/parent-duty/:id', from: '/homes/:homeId/parent-duty/:id', scope: 'control', tag: 'Parent Duty', summary: 'Change a card (title, notes, kidId, dueDate, status).' },
  {
    method: 'POST', path: '/homes/:homeId/parent-duty/:id/close', from: '/homes/:homeId/parent-duty/:id/close', scope: 'control', tag: 'Parent Duty', summary: 'Close a card into history.',
    body: [{ name: 'note', type: 'string', description: 'Shown in history' }, { name: 'done', type: 'boolean', description: 'false closes it unfinished (default true)' }],
  },
  { method: 'POST', path: '/homes/:homeId/parent-duty/:id/reopen', from: '/homes/:homeId/parent-duty/:id/reopen', scope: 'control', tag: 'Parent Duty', summary: 'Put a closed card back on the board.' },

  { method: 'GET', path: '/homes/:homeId/archive', from: '/homes/:homeId/archive', scope: 'read', tag: 'Stats', summary: 'The weekly archive: every finished week per kid, newest first.', query: [{ name: 'kid', in: 'query', description: 'Only this kid' }, { name: 'limit', in: 'query', description: 'Weeks, up to 104' }] },
  {
    method: 'GET', path: '/homes/:homeId/gaming', scope: 'read', tag: 'LootDen',
    summary: "For LootDen: each kid's chores today, time-outs that lock games (all, or just Roblox), game time bought in the shop and not yet handed out, and family goals reached in the last 30 days.",
  },
  { method: 'POST', path: '/homes/:homeId/gaming/orders/:orderId/claim', scope: 'control', tag: 'LootDen', summary: 'LootDen handed out the game time: marks the shop order given.' },
  { method: 'GET', path: '/homes/:homeId/events', scope: 'read', tag: 'Events', summary: 'Recent events (chore done, approved, points changed, goal reached…), newest first.', query: [{ name: 'after', in: 'query', description: 'Only events after this id (poll with the last id you saw)' }] },
];

const internal = (path: string) => `/api${path}`;
export const v1Path = (path: string) => `/api/v1${path}`;

/**
 * Serves the listed app routes again under /api/v1. Must run before those routes are registered: it watches them
 * being added and adds the copy, marked with the scope a token needs.
 */
export function installV1(app: FastifyInstance): void {
  const wanted = new Map(V1_ROUTES.filter((r) => r.from).map((r) => [`${r.method} ${internal(r.from!)}`, r]));
  app.addHook('onRoute', (opts: RouteOptions) => {
    const methods = Array.isArray(opts.method) ? opts.method : [opts.method];
    for (const m of methods) {
      const r = wanted.get(`${m} ${opts.url}`);
      if (!r) continue;
      wanted.delete(`${m} ${opts.url}`);
      app.route({ method: m, url: v1Path(r.path).replace(':kidId', ':memberId'), handler: opts.handler, config: { v1: r.scope } });
    }
  });
  app.addHook('onReady', async () => {
    if (wanted.size) throw new Error(`/api/v1 is missing routes: ${[...wanted.keys()].join(', ')}`);
  });
}

/** The few v1 endpoints that aren't app routes. */
export function v1Routes(app: FastifyInstance, db: DatabaseSync): void {
  const config = { v1: 'read' as ApiScope };

  app.get(v1Path('/homes/:homeId'), { config }, async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const h = homeInfo(db, ctx.homeId);
    const today = homeToday(h);
    return { id: h.id, name: h.name, timezone: h.timezone, weekStart: h.weekStart, pointsName: h.pointsName, pointsIcon: h.pointsIcon, today, thisWeek: startOfWeek(today, h.weekStart) };
  });

  app.get(v1Path('/homes/:homeId/instances'), { config }, async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const h = homeInfo(db, ctx.homeId);
    const today = homeToday(h);
    const q = req.query as { from?: string; to?: string; kid?: string; status?: string };
    const from = q.from ?? startOfWeek(today, h.weekStart);
    const to = q.to ?? addDays(from, 6);
    if (!isIsoDate(from) || !isIsoDate(to)) throw new HttpError(400, 'Dates look like 2026-10-17');
    const days = daysBetween(from, to) + 1;
    if (days < 1 || days > 92) throw new HttpError(400, 'from must be before to, at most 92 days apart');
    const off = kidsWithPageOff(db, ctx.homeId, 'chores');
    const kids = q.kid ? [getKid(db, ctx, q.kid).id as string] : listKids(db, ctx.homeId).map((k) => k.id);
    return agenda(db, ctx.homeId, kids.filter((k) => !off.has(k)), from, days, today).flatMap((d) => d.items)
      .filter((i) => !q.status || i.status === q.status);
  });

  app.get(v1Path('/homes/:homeId/events'), { config }, async (req) => {
    const ctx = homeCtx(db, req, 'parent');
    const after = Number((req.query as { after?: string }).after) || 0;
    return (db.prepare('SELECT * FROM events WHERE home_id = ? AND id > ? ORDER BY id DESC LIMIT 100').all(ctx.homeId, after) as Row[]).map((r) => eventView(db, r));
  });

  app.get(v1Path('/openapi.json'), async (req) => openApi(`${req.protocol}://${req.host}`));
}

/** OpenAPI 3.1 description of V1_ROUTES, for the docs page and for tools that read OpenAPI. */
export function openApi(server: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of V1_ROUTES) {
    const path = r.path.replace(/:(\w+)/g, '{$1}');
    const pathParams = [...r.path.matchAll(/:(\w+)/g)].map((m) => m[1]);
    const params = [
      ...pathParams.map((name) => r.query?.find((p) => p.name === name) ?? { name, in: 'path', required: true, description: name === 'homeId' ? 'Your home id (Settings → Home Assistant and API tokens)' : '' }),
      ...(r.query ?? []).filter((p) => p.in === 'query'),
    ].map((p) => ({ name: p.name, in: p.in, required: p.in === 'path' || !!p.required, description: p.description, schema: { type: 'string' } }));
    (paths[path] ??= {})[r.method.toLowerCase()] = {
      tags: [r.tag], summary: r.summary, 'x-scope': r.scope,
      description: r.scope === 'control' ? 'Needs a **control** token.' : 'Works with a **read** or control token.',
      parameters: params,
      ...(r.body ? {
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object', required: r.body.filter((f) => f.required).map((f) => f.name),
                properties: Object.fromEntries(r.body.map((f) => [f.name, { description: `${f.type}. ${f.description}` }])),
              },
            },
          },
        },
      } : {}),
      responses: { 200: { description: 'OK (JSON)' }, 400: { description: '{ "error": "what was wrong" }' }, 401: { description: 'No or unknown token' }, 403: { description: 'Token scope too low, or a different home' }, 404: { description: 'Not found' } },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Den Duty API', version: '1',
      description: 'Send a home API token as `Authorization: Bearer dnk_…`. Make one in Settings → Home Assistant and API tokens. Read tokens can call GET endpoints; control tokens can call all of them. Errors are `{ "error": "…" }`.',
    },
    servers: [{ url: `${server}/api/v1` }],
    components: { securitySchemes: { token: { type: 'http', scheme: 'bearer' } } },
    security: [{ token: [] }],
    paths,
  };
}
