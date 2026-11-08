// Shared family lists: groceries, packing, to-dos. Parents make the lists; kids (on their board) and the wall
// tablet can add to and tick off the lists that allow it. A kid adding something buzzes the parents.
// Home Assistant can add by voice ("add milk to the shopping list") through POST /ha/lists/add.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx, isParent, type HomeCtx } from '../auth.ts';
import type { Row } from '../db.ts';
import { HttpError, newId, requireStr, str } from '../util.ts';
import { emit } from '../events.ts';

export const LIST_TEMPLATES = [
  { name: 'Groceries', icon: '🛒', kidsCanAdd: true },
  { name: 'To-do', icon: '✅', kidsCanAdd: false },
  { name: 'Packing', icon: '🧳', kidsCanAdd: true },
  { name: 'Wish list', icon: '🎁', kidsCanAdd: true },
];

interface ListView {
  id: string; name: string; icon: string; kidsCanAdd: boolean; onWall: boolean;
  items: { id: string; text: string; note: string | null; done: boolean; by: string | null; byMemberId: string | null; createdAt: string }[];
}

function itemsOf(db: DatabaseSync, listId: string) {
  // Open things first (oldest first, like a shopping list), then the last few ticked off.
  const open = db.prepare('SELECT * FROM list_items WHERE list_id = ? AND done = 0 ORDER BY created_at, rowid').all(listId) as Row[];
  const done = db.prepare('SELECT * FROM list_items WHERE list_id = ? AND done = 1 ORDER BY done_at DESC LIMIT 20').all(listId) as Row[];
  return [...open, ...done].map((r) => ({
    id: r.id as string, text: r.text as string, note: r.note as string | null, done: !!r.done,
    by: r.added_by_name as string | null, byMemberId: r.added_by_member_id as string | null, createdAt: r.created_at as string,
  }));
}

export function listsOf(db: DatabaseSync, homeId: string, only?: { wall?: boolean }): ListView[] {
  const rows = db.prepare(`SELECT * FROM lists WHERE home_id = ? ${only?.wall ? 'AND on_wall = 1' : ''} ORDER BY position, created_at`).all(homeId) as Row[];
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, icon: r.icon as string, kidsCanAdd: !!r.kids_can_add, onWall: !!r.on_wall, items: itemsOf(db, r.id as string) }));
}

/** The wall's view: open items only. */
export function wallLists(db: DatabaseSync, homeId: string) {
  return listsOf(db, homeId, { wall: true }).map((l) => ({ ...l, items: l.items.filter((i) => !i.done) }));
}

function getList(db: DatabaseSync, homeId: string, id: string): Row {
  const l = db.prepare('SELECT * FROM lists WHERE id = ? AND home_id = ?').get(id, homeId) as Row | undefined;
  if (!l) throw new HttpError(404, 'List not found');
  return l;
}

/** Kids and the wall tablet may touch lists that allow it; parents any list. */
function assertCanEdit(ctx: HomeCtx, l: Row) {
  if (isParent(ctx)) return;
  if ((ctx.actor.kind === 'kid' || ctx.actor.kind === 'device') && l.kids_can_add) return;
  throw new HttpError(403, 'Only a grown-up can change this list');
}

/** Find a list by name, loosely ("shopping" finds "Groceries" if nothing else matches). */
export function findList(db: DatabaseSync, homeId: string, said: string): Row | null {
  const lists = db.prepare('SELECT * FROM lists WHERE home_id = ? ORDER BY position, created_at').all(homeId) as Row[];
  const s = said.trim().toLowerCase().replace(/^(the|my|our) /, '').replace(/ list$/, '');
  if (!s) return lists[0] ?? null;
  const n = (l: Row) => String(l.name).toLowerCase();
  return lists.find((l) => n(l) === s) ?? lists.find((l) => n(l).startsWith(s) || s.startsWith(n(l)))
    ?? (/shop|grocer|food|store/.test(s) ? lists.find((l) => /grocer|shop/.test(n(l))) : undefined) ?? null;
}

export function addItem(db: DatabaseSync, ctx: HomeCtx, l: Row, text: string, note: string | null = null) {
  const by = ctx.actor.kind === 'kid' ? (db.prepare('SELECT name FROM members WHERE id = ?').get(ctx.actor.memberId) as Row | undefined)?.name as string
    : ctx.user?.name ?? (ctx.actor.kind === 'device' ? 'Family tablet' : ctx.tokenName ?? 'Home Assistant');
  // Already on the list (not ticked off): don't add it twice.
  const same = db.prepare('SELECT id FROM list_items WHERE list_id = ? AND done = 0 AND lower(text) = lower(?)').get(l.id as string, text) as Row | undefined;
  if (same) return { id: same.id as string, duplicate: true };
  const id = newId();
  const memberId = ctx.actor.kind === 'kid' ? ctx.actor.memberId : ctx.actor.kind === 'parent' ? ctx.actor.memberId : null;
  db.prepare('INSERT INTO list_items (id, list_id, text, note, added_by_member_id, added_by_name) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, l.id as string, text, note, memberId, by ?? null);
  emit(db, ctx.homeId, 'list_item_added', ctx.actor.kind === 'kid' ? ctx.actor.memberId : null, {
    list_id: l.id, list: l.name, list_icon: l.icon, item: text, by, by_kid: ctx.actor.kind === 'kid',
  });
  return { id, duplicate: false };
}

export function listRoutes(app: FastifyInstance, db: DatabaseSync): void {
  const parent = (req: Parameters<typeof homeCtx>[1]) => homeCtx(db, req, 'parent');

  app.get('/api/homes/:homeId/lists', async (req) => {
    const ctx = homeCtx(db, req);
    return listsOf(db, ctx.homeId);
  });

  app.post('/api/homes/:homeId/lists', async (req) => {
    const ctx = parent(req);
    const b = (req.body ?? {}) as Row;
    const id = newId();
    const pos = ((db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM lists WHERE home_id = ?').get(ctx.homeId) as Row).p as number) + 1;
    db.prepare('INSERT INTO lists (id, home_id, name, icon, kids_can_add, on_wall, position) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, ctx.homeId, requireStr(b.name, 'Name', 60), str(b.icon, 16) ?? '📝', b.kidsCanAdd === false ? 0 : 1, b.onWall === false ? 0 : 1, pos);
    return listsOf(db, ctx.homeId).find((l) => l.id === id);
  });

  app.patch('/api/homes/:homeId/lists/:id', async (req) => {
    const ctx = parent(req);
    const l = getList(db, ctx.homeId, (req.params as { id: string }).id);
    const b = (req.body ?? {}) as Row;
    db.prepare('UPDATE lists SET name = ?, icon = ?, kids_can_add = ?, on_wall = ?, position = ? WHERE id = ?').run(
      b.name !== undefined ? requireStr(b.name, 'Name', 60) : l.name as string,
      b.icon !== undefined ? str(b.icon, 16) ?? '📝' : l.icon as string,
      b.kidsCanAdd !== undefined ? (b.kidsCanAdd ? 1 : 0) : l.kids_can_add as number,
      b.onWall !== undefined ? (b.onWall ? 1 : 0) : l.on_wall as number,
      typeof b.position === 'number' ? b.position : l.position as number,
      l.id as string,
    );
    return listsOf(db, ctx.homeId).find((x) => x.id === l.id);
  });

  app.delete('/api/homes/:homeId/lists/:id', async (req) => {
    const ctx = parent(req);
    const l = getList(db, ctx.homeId, (req.params as { id: string }).id);
    db.prepare('DELETE FROM lists WHERE id = ?').run(l.id as string);
    return { ok: true };
  });

  app.post('/api/homes/:homeId/lists/:id/items', async (req) => {
    const ctx = homeCtx(db, req);
    const l = getList(db, ctx.homeId, (req.params as { id: string }).id);
    assertCanEdit(ctx, l);
    const b = (req.body ?? {}) as Row;
    const r = addItem(db, ctx, l, requireStr(b.text, 'Item', 120), str(b.note, 200));
    return { ...r, list: listsOf(db, ctx.homeId).find((x) => x.id === l.id) };
  });

  // Tick off (or un-tick) and rename.
  app.patch('/api/homes/:homeId/list-items/:id', async (req) => {
    const ctx = homeCtx(db, req);
    const it = db.prepare('SELECT * FROM list_items WHERE id = ?').get((req.params as { id: string }).id) as Row | undefined;
    if (!it) throw new HttpError(404, 'Item not found');
    const l = getList(db, ctx.homeId, it.list_id as string);
    assertCanEdit(ctx, l);
    const b = (req.body ?? {}) as Row;
    if (b.done !== undefined) db.prepare("UPDATE list_items SET done = ?, done_at = CASE WHEN ? THEN datetime('now') ELSE NULL END WHERE id = ?").run(b.done ? 1 : 0, b.done ? 1 : 0, it.id as string);
    if (b.text !== undefined) {
      if (!isParent(ctx) && it.added_by_member_id !== (ctx.actor.kind === 'kid' ? ctx.actor.memberId : '-')) throw new HttpError(403, 'Only a grown-up can change that');
      db.prepare('UPDATE list_items SET text = ?, note = ? WHERE id = ?').run(requireStr(b.text, 'Item', 120), str(b.note, 200), it.id as string);
    }
    return listsOf(db, ctx.homeId).find((x) => x.id === l.id);
  });

  app.delete('/api/homes/:homeId/list-items/:id', async (req) => {
    const ctx = homeCtx(db, req);
    const it = db.prepare('SELECT * FROM list_items WHERE id = ?').get((req.params as { id: string }).id) as Row | undefined;
    if (!it) throw new HttpError(404, 'Item not found');
    const l = getList(db, ctx.homeId, it.list_id as string);
    // Kids can take back what they added themselves.
    const own = ctx.actor.kind === 'kid' && it.added_by_member_id === ctx.actor.memberId;
    if (!isParent(ctx) && !own) throw new HttpError(403, 'Only a grown-up can remove that');
    db.prepare('DELETE FROM list_items WHERE id = ?').run(it.id as string);
    return listsOf(db, ctx.homeId).find((x) => x.id === l.id);
  });

  app.post('/api/homes/:homeId/lists/:id/clear-done', async (req) => {
    const ctx = parent(req);
    const l = getList(db, ctx.homeId, (req.params as { id: string }).id);
    db.prepare('DELETE FROM list_items WHERE list_id = ? AND done = 1').run(l.id as string);
    return listsOf(db, ctx.homeId).find((x) => x.id === l.id);
  });

  // Home Assistant / voice: "add milk to the shopping list". A control token (or a parent).
  app.post('/api/homes/:homeId/ha/lists/add', async (req) => {
    const ctx = homeCtx(db, req);
    if (!(isParent(ctx) || (ctx.actor.kind === 'token' && ctx.actor.scope === 'control'))) throw new HttpError(403, 'This needs a control token (Settings → Home Assistant)');
    const b = (req.body ?? {}) as Row;
    const l = findList(db, ctx.homeId, String(b.list ?? ''));
    if (!l) return { speech: `I couldn't find a list called ${String(b.list ?? '')}.`, error: true };
    const text = requireStr(b.item, 'Item', 120).trim().replace(/^(some|a|an) /i, '');
    const r = addItem(db, ctx, l, text.charAt(0).toUpperCase() + text.slice(1));
    return { speech: r.duplicate ? `${text} is already on the ${l.name} list.` : `Added ${text} to the ${l.name} list.`, list: l.name };
  });
}
