// The core loop on its own, with fixed dates: schedules become instances, approvals become points, points fill goals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-chores-'));

const { openMemoryDb } = await import('./db.ts');
const c = await import('./chores.ts');

const PARENT = { userId: null, name: 'Mom' };

function setup() {
  const db = openMemoryDb();
  db.prepare("INSERT INTO homes (id, name, join_code, timezone) VALUES ('h', 'Den', 'JOIN1234', 'America/New_York')").run();
  for (const [id, name] of [['ava', 'Ava'], ['ben', 'Ben']]) {
    db.prepare("INSERT INTO members (id, home_id, role, name) VALUES (?, 'h', 'kid', ?)").run(id, name);
  }
  const chore = (id: string, schedule: string, opts: { weekdays?: number[]; due?: string; start?: string; points?: number; kids?: string[] } = {}) => {
    db.prepare(`INSERT INTO chores (id, home_id, title, icon, points, schedule, weekdays, due_date, start_date)
      VALUES (?, 'h', ?, '🧹', ?, ?, ?, ?, ?)`).run(id, id, opts.points ?? 5, schedule, JSON.stringify(opts.weekdays ?? []), opts.due ?? null, opts.start ?? '2026-10-12');
    for (const k of opts.kids ?? ['ava']) db.prepare('INSERT INTO chore_assignments (chore_id, member_id) VALUES (?, ?)').run(id, k);
  };
  const instances = (member = 'ava') => db.prepare('SELECT * FROM chore_instances WHERE member_id = ? ORDER BY date, title').all(member) as Record<string, unknown>[];
  return { db, chore, instances };
}

test('schedules become one instance per kid per due day, up to today only', () => {
  const { db, chore, instances } = setup();
  chore('bed', 'daily', { kids: ['ava', 'ben'] });
  chore('trash', 'weekly', { weekdays: [1, 4] }); // Mon, Thu
  chore('garage', 'once', { due: '2026-10-15' });
  // Mon Oct 12 .. Sun Oct 18; today is Wed Oct 14.
  const week = c.agenda(db, 'h', ['ava'], '2026-10-12', 7, '2026-10-14');
  assert.equal(week.length, 7);
  assert.deepEqual(week[0].items.map((i) => i.title).sort(), ['bed', 'trash']);
  assert.deepEqual(week[2].items.map((i) => i.title), ['bed']);
  // Future days are planned, not stored.
  assert.deepEqual(week[3].items.map((i) => `${i.title}:${i.status}`).sort(), ['bed:planned', 'garage:planned', 'trash:planned']);
  assert.ok(week[3].items.every((i) => i.id === null));
  assert.equal(instances('ava').length, 4, 'bed x3 + trash on Monday');
  assert.equal(instances('ben').length, 3);
  // Running it again doesn't duplicate anything.
  c.agenda(db, 'h', ['ava', 'ben'], '2026-10-12', 7, '2026-10-14');
  assert.equal(instances('ava').length + instances('ben').length, 7);
  // Nothing before a chore existed.
  chore('dishes', 'daily', { start: '2026-10-14' });
  c.materialize(db, 'h', '2026-10-12', '2026-10-14', '2026-10-14');
  assert.deepEqual(instances('ava').filter((i) => i.title === 'dishes').map((i) => i.date), ['2026-10-14']);
});

test('complete, approve, points and goal progress', () => {
  const { db, chore } = setup();
  chore('bed', 'daily', { points: 5 });
  db.prepare("INSERT INTO goals (id, home_id, member_id, title, target_points, reward) VALUES ('g', 'h', 'ava', 'Movie night', 12, 'Pick the movie')").run();
  const today = '2026-10-14';
  const [first] = c.todayList(db, 'h', 'ava', today);
  assert.equal(first.status, 'pending');

  assert.equal(c.submitInstance(db, 'h', first.id!, today).status, 'submitted');
  assert.equal(c.balance(db, 'ava'), 0, 'no points until a parent approves');
  assert.equal(c.reviewQueue(db, 'h').length, 1);

  const { awarded } = c.approveInstance(db, 'h', first.id!, PARENT);
  assert.equal(awarded, 5);
  assert.equal(c.approveInstance(db, 'h', first.id!, PARENT).awarded, 0, 'approving twice never pays twice');
  assert.equal(c.balance(db, 'ava'), 5);
  assert.equal(c.reviewQueue(db, 'h').length, 0);
  const rows = db.prepare('SELECT * FROM points_ledger').all() as Record<string, unknown>[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'chore');
  assert.equal(rows[0].reason, 'bed');
  assert.equal(rows[0].by_name, 'Mom');
  assert.equal(rows[0].date, today);

  let [goal] = c.goalsFor(db, 'ava');
  assert.equal(goal.progress, 5);
  assert.equal(goal.percent, 42);
  assert.equal(goal.reached, false);

  // Two more days of made beds reach the goal (and the extra point is kept).
  for (const day of ['2026-10-12', '2026-10-13']) {
    c.materialize(db, 'h', day, day, today);
    const inst = db.prepare('SELECT id FROM chore_instances WHERE date = ?').get(day) as { id: string };
    c.approveInstance(db, 'h', inst.id, PARENT);
  }
  [goal] = c.goalsFor(db, 'ava');
  assert.equal(goal.progress, 12);
  assert.equal(goal.reached, true);

  const redeemed = c.redeemGoal(db, 'h', 'g', PARENT, today);
  assert.equal(redeemed.status, 'redeemed');
  assert.equal(c.balance(db, 'ava'), 3);
  assert.throws(() => c.redeemGoal(db, 'h', 'g', PARENT, today), /already redeemed/);
  // Spending doesn't reduce what was earned this week.
  assert.equal(c.earnedBetween(db, 'ava', '2026-10-12', '2026-10-18'), 15);
});

test('reject, retry, undo and reversals keep the ledger honest', () => {
  const { db, chore } = setup();
  chore('bed', 'daily', { points: 4 });
  const today = '2026-10-14';
  const [inst] = c.todayList(db, 'h', 'ava', today);
  c.submitInstance(db, 'h', inst.id!, today);
  const rejected = c.rejectInstance(db, 'h', inst.id!, PARENT, 'Pillows are on the floor');
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.note, 'Pillows are on the floor');
  assert.equal(c.balance(db, 'ava'), 0);

  assert.equal(c.submitInstance(db, 'h', inst.id!, today).status, 'submitted', 'rejected chores can be tried again');
  assert.equal(c.unsubmitInstance(db, 'h', inst.id!).status, 'pending', 'kids can take back a tap');
  c.submitInstance(db, 'h', inst.id!, today);
  c.approveInstance(db, 'h', inst.id!, PARENT);
  assert.throws(() => c.unsubmitInstance(db, 'h', inst.id!), /already approved/);

  const undone = c.unapproveInstance(db, 'h', inst.id!, PARENT);
  assert.equal(undone.status, 'submitted', 'back in the review queue');
  assert.equal(c.balance(db, 'ava'), 0);
  c.approveInstance(db, 'h', inst.id!, PARENT);
  assert.equal(c.balance(db, 'ava'), 4);
  const kinds = (db.prepare('SELECT kind, amount FROM points_ledger ORDER BY id').all() as { kind: string; amount: number }[]).map((r) => `${r.kind}${r.amount}`);
  assert.deepEqual(kinds, ['chore4', 'reversal-4', 'chore4']);
});

test('the points ledger is append-only, but goes away with its kid', () => {
  const { db } = setup();
  c.writeLedger(db, { homeId: 'h', memberId: 'ava', amount: 10, kind: 'bonus', reason: 'Helped grandma', date: '2026-10-14', by: PARENT });
  assert.throws(() => db.prepare('UPDATE points_ledger SET amount = 1000').run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM points_ledger').run(), /append-only/);
  assert.throws(() => c.writeLedger(db, { homeId: 'h', memberId: 'ava', amount: 0, kind: 'bonus', reason: 'x', date: '2026-10-14', by: PARENT }), /whole number/);
  db.prepare("DELETE FROM members WHERE id = 'ava'").run();
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM points_ledger').get() as { n: number }).n, 0);
});

test('editing a chore updates what is still to do and leaves finished work alone', () => {
  const { db, chore, instances } = setup();
  chore('bed', 'daily', { points: 2, kids: ['ava', 'ben'] });
  const today = '2026-10-14';
  c.materialize(db, 'h', '2026-10-13', today, today);
  const avaToday = instances('ava').find((i) => i.date === today)!;
  c.approveInstance(db, 'h', avaToday.id as string, PARENT);

  db.prepare("UPDATE chores SET points = 9, title = 'Make bed' WHERE id = 'bed'").run();
  db.prepare("DELETE FROM chore_assignments WHERE chore_id = 'bed' AND member_id = 'ben'").run();
  c.syncChore(db, 'h', 'bed', today);

  assert.equal(instances('ava').find((i) => i.date === today)!.points, 2, 'approved work keeps its points');
  assert.deepEqual(instances('ben').map((i) => i.date), ['2026-10-13'], "ben's open chore for today is gone, yesterday stays");

  db.prepare("UPDATE chores SET active = 0 WHERE id = 'bed'").run();
  c.syncChore(db, 'h', 'bed', today);
  const later = c.agenda(db, 'h', ['ava'], '2026-10-15', 3, today);
  assert.ok(later.every((d) => d.items.length === 0), 'retired chores stop showing up');
});

test('week summary and overdue one-off chores', () => {
  const { db, chore } = setup();
  chore('bed', 'daily', { points: 3 });
  chore('garage', 'once', { due: '2026-10-13', points: 10 });
  const home = c.homeInfo(db, 'h');
  db.prepare('UPDATE homes SET week_start = 1').run();
  const today = '2026-10-14';
  const list = c.todayList(db, 'h', 'ava', today);
  assert.deepEqual(list.map((i) => i.title), ['garage', 'bed'], "yesterday's one-off chore is still on today's list");
  c.approveInstance(db, 'h', list[1].id!, PARENT);
  c.submitInstance(db, 'h', list[0].id!, today);
  const w = c.kidWeek(db, { ...home, weekStart: 1 }, 'ava', today);
  assert.deepEqual(w, { balance: 3, pointsThisWeek: 3, choresDone: 1, choresWaiting: 1, choresDue: 4, leftToday: 0 });
});
