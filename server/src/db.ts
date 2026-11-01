import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Row = Record<string, unknown>;

// Each entry runs once, in order. Never edit a shipped migration; append a new one.
export const MIGRATIONS: string[] = [
  `
  -- ---------- people and sign-in (same shape as Nighttime Ninja) ----------
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT NOT NULL,
    username TEXT COLLATE NOCASE,
    google_sub TEXT UNIQUE,
    password_hash TEXT,
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    totp_last_step INTEGER,
    avatar TEXT NOT NULL DEFAULT 'classic',
    theme TEXT NOT NULL DEFAULT 'sunny',
    is_admin INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0,
    last_home_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX users_username ON users(username);
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    user_agent TEXT,
    ip TEXT,
    method TEXT,
    last_seen_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE recovery_codes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TEXT,
    PRIMARY KEY (user_id, code_hash)
  );
  CREATE TABLE mfa_tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE passkeys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );
  CREATE INDEX passkeys_user ON passkeys(user_id);
  CREATE TABLE webauthn_challenges (
    id TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    user_id TEXT,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE server_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- ---------- homes ----------
  CREATE TABLE homes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    join_code TEXT NOT NULL UNIQUE,
    points_name TEXT NOT NULL DEFAULT 'Shinies',
    points_icon TEXT NOT NULL DEFAULT '✨',
    timezone TEXT NOT NULL DEFAULT 'UTC',
    week_start INTEGER NOT NULL DEFAULT 0 CHECK (week_start IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Everyone in a home. Parents are linked to a user account; kids have no account and sign in on a family tablet.
  CREATE TABLE members (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('parent', 'kid')),
    name TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT 'classic',
    color TEXT NOT NULL DEFAULT '#2f9e6e',
    pin_hash TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((role = 'parent') = (user_id IS NOT NULL))
  );
  CREATE UNIQUE INDEX members_home_user ON members(home_id, user_id);
  CREATE INDEX members_home ON members(home_id, role);
  -- Pairing codes sign a tablet in as a parent (kind 'user') or set it up as the family tablet (kind 'device').
  CREATE TABLE pair_codes (
    code TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'device')),
    home_id TEXT REFERENCES homes(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  -- Family tablets: signed in to a home, not a person. Kids pick their avatar on them.
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    last_seen_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE kid_sessions (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE api_tokens (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ---------- chores ----------
  CREATE TABLE chores (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '⭐',
    points INTEGER NOT NULL DEFAULT 1 CHECK (points >= 0),
    schedule TEXT NOT NULL CHECK (schedule IN ('daily', 'weekly', 'once')),
    weekdays TEXT NOT NULL DEFAULT '[]',
    due_date TEXT,
    start_date TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX chores_home ON chores(home_id, active);
  CREATE TABLE chore_assignments (
    chore_id TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    PRIMARY KEY (chore_id, member_id)
  );
  -- One row per kid per day a chore is due. Title, icon and points are copied so history survives edits.
  CREATE TABLE chore_instances (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    chore_id TEXT REFERENCES chores(id) ON DELETE SET NULL,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    icon TEXT NOT NULL,
    points INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'approved', 'rejected')),
    submitted_at TEXT,
    reviewed_at TEXT,
    reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (chore_id, member_id, date)
  );
  CREATE INDEX chore_instances_member ON chore_instances(member_id, date);
  CREATE INDEX chore_instances_review ON chore_instances(home_id, status);

  -- ---------- points and goals ----------
  CREATE TABLE goals (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    target_points INTEGER NOT NULL CHECK (target_points > 0),
    reward TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed')),
    redeemed_at TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX goals_member ON goals(member_id, status);
  -- Append-only: every point a kid earns or spends is one row. Balances are sums. Mistakes are fixed with a new
  -- row, never by editing. "by" columns have no foreign keys on purpose, so deleting a parent can't rewrite history.
  CREATE TABLE points_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('chore', 'bonus', 'adjust', 'redeem', 'reversal')),
    reason TEXT NOT NULL,
    -- The day it counts for, in the home's time zone (a chore's own date, otherwise the day it was written).
    date TEXT NOT NULL,
    instance_id TEXT,
    goal_id TEXT,
    by_user_id TEXT,
    by_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX points_ledger_member ON points_ledger(member_id, date);
  CREATE TRIGGER points_ledger_no_update BEFORE UPDATE ON points_ledger
  BEGIN SELECT RAISE(ABORT, 'points_ledger is append-only'); END;
  -- Rows only disappear when their kid or home is deleted (the cascade removes the parent row first).
  CREATE TRIGGER points_ledger_no_delete BEFORE DELETE ON points_ledger
  WHEN EXISTS (SELECT 1 FROM members WHERE id = OLD.member_id) AND EXISTS (SELECT 1 FROM homes WHERE id = OLD.home_id)
  BEGIN SELECT RAISE(ABORT, 'points_ledger is append-only'); END;
  `,
  // Themes: one per home, an optional one per kid, and parents can follow the home's ('home').
  `
  ALTER TABLE homes ADD COLUMN theme TEXT NOT NULL DEFAULT 'sunny';
  ALTER TABLE members ADD COLUMN theme TEXT;
  UPDATE users SET theme = 'home' WHERE theme = 'sunny';
  `,
  // Phase 2: kanban "doing", bonus chores, penalties setting, quick rewards and reward votes.
  `
  ALTER TABLE chore_instances ADD COLUMN started_at TEXT;
  -- Bonus chores aren't handed out; kids opt in. 'each' lets every eligible kid do it, 'one' only the first to claim it.
  ALTER TABLE chores ADD COLUMN bonus INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE chores ADD COLUMN claim_limit TEXT NOT NULL DEFAULT 'each' CHECK (claim_limit IN ('each', 'one'));
  -- Penalties stop at zero unless a parent allows going below.
  ALTER TABLE homes ADD COLUMN allow_negative INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE quick_rewards (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '🌟',
    amount INTEGER NOT NULL CHECK (amount > 0),
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO quick_rewards (id, home_id, title, icon, amount, position)
    SELECT lower(hex(randomblob(16))), h.id, d.title, d.icon, d.amount, d.position FROM homes h,
    (SELECT 'Great attitude' AS title, '🌟' AS icon, 2 AS amount, 0 AS position
      UNION ALL SELECT 'Helped someone', '🤝', 3, 1
      UNION ALL SELECT 'Tried something hard', '🧠', 2, 2
      UNION ALL SELECT 'Ready on time', '🎒', 1, 3) d;
  -- Parents propose rewards, kids vote, parents pick.
  CREATE TABLE polls (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    winner_option_id TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT
  );
  CREATE TABLE poll_options (
    id TEXT PRIMARY KEY,
    poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '🎁',
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE poll_votes (
    poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    option_id TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    voted_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (poll_id, member_id)
  );
  `,
  // Phase 4: therapy tracking per kid (parents only unless they share goals with the kid), and the parents' honey-do board.
  `
  ALTER TABLE members ADD COLUMN therapy_kid_visible INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE therapy_appointments (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'other',
    title TEXT NOT NULL,
    provider TEXT,
    location TEXT,
    -- Local wall-clock time in the home's time zone, 'YYYY-MM-DDTHH:MM'.
    starts_at TEXT NOT NULL,
    duration_minutes INTEGER,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'cancelled', 'missed')),
    notes TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX therapy_appointments_member ON therapy_appointments(member_id, starts_at);
  CREATE TABLE therapy_goals (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    area TEXT NOT NULL DEFAULT 'development',
    title TEXT NOT NULL,
    description TEXT,
    target_date TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'met', 'paused')),
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    met_at TEXT
  );
  CREATE INDEX therapy_goals_member ON therapy_goals(member_id, status);
  -- Progress notes. A note with a progress value is also the goal's progress history (for its chart).
  CREATE TABLE therapy_notes (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    goal_id TEXT REFERENCES therapy_goals(id) ON DELETE CASCADE,
    appointment_id TEXT REFERENCES therapy_appointments(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    progress INTEGER CHECK (progress BETWEEN 0 AND 100),
    date TEXT NOT NULL,
    by_name TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX therapy_notes_member ON therapy_notes(member_id, date);
  CREATE TABLE honeydo (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT,
    assignee_id TEXT REFERENCES members(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
    due_date TEXT,
    position REAL NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    done_at TEXT
  );
  CREATE INDEX honeydo_home ON honeydo(home_id, status, position);
  `,
  // Home Assistant: tokens that can only read, or also act; events HA can poll or receive by webhook.
  `
  ALTER TABLE api_tokens ADD COLUMN scope TEXT NOT NULL DEFAULT 'read' CHECK (scope IN ('read', 'control'));
  ALTER TABLE homes ADD COLUMN ha_webhook_url TEXT;
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    member_id TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX events_home ON events(home_id, id);
  `,
  // Generic OpenID Connect and reverse-proxy (forward-auth) sign-in.
  `
  ALTER TABLE users ADD COLUMN oidc_sub TEXT;
  ALTER TABLE users ADD COLUMN forward_user TEXT COLLATE NOCASE;
  CREATE UNIQUE INDEX users_oidc_sub ON users(oidc_sub);
  CREATE UNIQUE INDEX users_forward_user ON users(forward_user);
  `,
  // Calendars: secret ICS links out (per home and per kid), and ICS feeds in (school lunch, meal plans...).
  `
  ALTER TABLE homes ADD COLUMN calendar_token TEXT;
  ALTER TABLE members ADD COLUMN calendar_token TEXT;
  CREATE UNIQUE INDEX homes_calendar_token ON homes(calendar_token);
  CREATE UNIQUE INDEX members_calendar_token ON members(calendar_token);
  CREATE TABLE calendar_feeds (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('lunch', 'meals', 'school', 'other')),
    show_kids INTEGER NOT NULL DEFAULT 1,
    events TEXT NOT NULL DEFAULT '[]',
    fetched_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // AI suggestions: off until a parent turns them on and pastes their own API key (stored encrypted).
  `
  ALTER TABLE homes ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE homes ADD COLUMN ai_key TEXT;
  ALTER TABLE homes ADD COLUMN ai_model TEXT;
  `,
  // Ages: a birthdate per kid (age updates itself) and picture-first screens for kids who don't read yet.
  `
  ALTER TABLE members ADD COLUMN birthdate TEXT;
  ALTER TABLE members ADD COLUMN picture_mode TEXT NOT NULL DEFAULT 'auto' CHECK (picture_mode IN ('auto', 'on', 'off'));
  `,
  // Therapy goals can earn points: some for each practice/progress note, and a bonus (paid once) when the goal is met.
  `
  ALTER TABLE therapy_goals ADD COLUMN reward_step INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE therapy_goals ADD COLUMN reward_met INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE therapy_goals ADD COLUMN reward_met_paid INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE therapy_notes ADD COLUMN awarded INTEGER NOT NULL DEFAULT 0;
  `,
  // AI therapy helpers: one daily tip per kid per area, cached so it isn't regenerated on every load.
  `
  CREATE TABLE ai_tips (
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    area TEXT NOT NULL CHECK (area IN ('speech', 'ot')),
    date TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (member_id, area, date)
  );
  `,
  // Den Duty: the honey-do board becomes room boards, one per kid (a raccoon's den is their room). Cards without a kid
  // stay as the parents' own to-do list, so existing honey-do cards keep working.
  `
  ALTER TABLE honeydo ADD COLUMN kid_id TEXT REFERENCES members(id) ON DELETE CASCADE;
  ALTER TABLE honeydo ADD COLUMN icon TEXT;
  ALTER TABLE honeydo ADD COLUMN points INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE honeydo ADD COLUMN repeat_daily INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE honeydo ADD COLUMN done_date TEXT;
  ALTER TABLE honeydo ADD COLUMN paid_at TEXT;
  CREATE INDEX honeydo_kid ON honeydo(kid_id, status);
  `,
  // Per-kid switches (pages off, Doctors sections off) and the "Ask AI" history in Doctors.
  `
  ALTER TABLE members ADD COLUMN pages_off TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE members ADD COLUMN doctor_areas_off TEXT NOT NULL DEFAULT '[]';
  CREATE TABLE ai_questions (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ai_questions_member ON ai_questions(member_id, created_at);
  `,
  // Parent Duty: the room board becomes parents' to-dos per kid. Kids' room cards turn into regular chores in a new
  // "room" category (daily cards stay daily, one-offs become one-time chores), so nothing is lost and kids keep them.
  `
  ALTER TABLE chores ADD COLUMN category TEXT;
  INSERT INTO chores (id, home_id, title, icon, points, schedule, weekdays, due_date, start_date, created_by, category)
    SELECT id, home_id, title, COALESCE(icon, '🧹'), points, CASE WHEN repeat_daily = 1 THEN 'daily' ELSE 'once' END, '[]',
      CASE WHEN repeat_daily = 1 THEN NULL ELSE date('now') END, date('now'), created_by, 'room'
    FROM honeydo WHERE kid_id IS NOT NULL;
  INSERT INTO chore_assignments (chore_id, member_id) SELECT id, kid_id FROM honeydo WHERE kid_id IS NOT NULL;
  DELETE FROM honeydo WHERE kid_id IS NOT NULL;
  `,
  // Time-outs: what's paused ("No Roblox"), why, and from when until when. Parents can let a kid buy time back with
  // points (a price per hour or per day, up to a cap); the kid asks and a parent approves before any points move.
  `
  CREATE TABLE timeouts (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    what TEXT NOT NULL,
    reason TEXT,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    ended_at TEXT,
    buy_unit TEXT CHECK (buy_unit IN ('hour', 'day')),
    buy_price INTEGER,
    buy_max_minutes INTEGER,
    bought_minutes INTEGER NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX timeouts_member ON timeouts(member_id, ends_at);
  CREATE TABLE timeout_requests (
    id TEXT PRIMARY KEY,
    timeout_id TEXT NOT NULL REFERENCES timeouts(id) ON DELETE CASCADE,
    units INTEGER NOT NULL,
    minutes INTEGER NOT NULL,
    points INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
    decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT
  );
  CREATE INDEX timeout_requests_timeout ON timeout_requests(timeout_id, status);
  `,
  // The daily "your den" message on each kid's screen, written once per kid per day. The text keeps a {name}
  // placeholder: names are never sent to the AI, they're filled in here.
  `
  CREATE TABLE room_messages (
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    text TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('ai', 'builtin')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (member_id, date)
  );
  `,
  // Doctors goals can have a practice schedule (weekdays with an optional time, or one date). Ticking a scheduled
  // practice off writes a practice note for that day. Daily practice ideas (speech, OT, anger) can be switched off per
  // kid; the anger idea starts off. The tips cache learns the new 'anger' area (SQLite can't change a CHECK in place).
  `
  ALTER TABLE therapy_goals ADD COLUMN practice_schedule TEXT CHECK (practice_schedule IN ('weekly', 'once'));
  ALTER TABLE therapy_goals ADD COLUMN practice_weekdays TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE therapy_goals ADD COLUMN practice_date TEXT;
  ALTER TABLE therapy_goals ADD COLUMN practice_time TEXT;
  ALTER TABLE therapy_notes ADD COLUMN practice INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX therapy_notes_goal ON therapy_notes(goal_id, date);
  ALTER TABLE members ADD COLUMN ideas_off TEXT NOT NULL DEFAULT '["anger"]';
  CREATE TABLE ai_tips_v2 (
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    area TEXT NOT NULL CHECK (area IN ('speech', 'ot', 'anger')),
    date TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (member_id, area, date)
  );
  INSERT INTO ai_tips_v2 SELECT member_id, home_id, area, date, data, created_at FROM ai_tips;
  DROP TABLE ai_tips;
  ALTER TABLE ai_tips_v2 RENAME TO ai_tips;
  `,
  // The family wall: the family tablet's home page. Settings are one JSON blob per home (landing page, night dimming,
  // and what a shared wall may show). Empty means the defaults in routes/wall.ts.
  `
  ALTER TABLE homes ADD COLUMN wall_settings TEXT NOT NULL DEFAULT '{}';
  `,
  // Per-kid AI master switch (on by default): off means no AI requests about that kid at all.
  `
  ALTER TABLE members ADD COLUMN ai_off INTEGER NOT NULL DEFAULT 0;
  `,
  // Helpdesk: a kid asks a grown-up for help. A yes becomes a card on that kid's Parent Duty board (duty_id).
  `
  CREATE TABLE helpdesk_requests (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    text TEXT,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'approved', 'denied', 'cancelled')),
    note TEXT,
    duty_id TEXT REFERENCES honeydo(id) ON DELETE SET NULL,
    decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT
  );
  CREATE INDEX helpdesk_member ON helpdesk_requests(member_id, status);
  ALTER TABLE homes ADD COLUMN helpdesk_max_open INTEGER NOT NULL DEFAULT 3;
  `,
  // Closing Helpdesk tickets at any stage (by a parent, or the kid's "All set, thanks!"). Closed ones move to history.
  `
  ALTER TABLE helpdesk_requests ADD COLUMN closed_at TEXT;
  ALTER TABLE helpdesk_requests ADD COLUMN close_note TEXT;
  ALTER TABLE helpdesk_requests ADD COLUMN closed_by_kid INTEGER NOT NULL DEFAULT 0;
  `,
  // Parents' reminders ("call to book Ava's dentist"): optional due date/time, kid tag and repeat. A repeating reminder
  // moves to its next date when ticked. appt_kind marks a "make an appointment" reminder (it can become one).
  `
  CREATE TABLE reminders (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT,
    kid_id TEXT REFERENCES members(id) ON DELETE SET NULL,
    due_date TEXT,
    due_time TEXT,
    repeat_every INTEGER,
    repeat_unit TEXT CHECK (repeat_unit IN ('day', 'week', 'month', 'year')),
    appt_kind TEXT,
    done_at TEXT,
    last_done_at TEXT,
    times_done INTEGER NOT NULL DEFAULT 0,
    notified_for TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX reminders_home ON reminders(home_id, done_at, due_date);
  `,
  // One day of a practice schedule changed on its own: skipped, or moved to another date/time. "date" is the day it
  // was originally scheduled (the occurrence); the rest of the schedule is untouched.
  `
  CREATE TABLE practice_exceptions (
    goal_id TEXT NOT NULL REFERENCES therapy_goals(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('skip', 'move')),
    new_date TEXT,
    new_time TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (goal_id, date)
  );
  `,
  // Closing Parent Duty cards: a closed card leaves the board for its history (done or not). Done cards that had
  // already dropped off the board (older than 30 days) start out in history.
  `
  ALTER TABLE honeydo ADD COLUMN closed_at TEXT;
  ALTER TABLE honeydo ADD COLUMN close_note TEXT;
  ALTER TABLE honeydo ADD COLUMN closed_by TEXT REFERENCES users(id) ON DELETE SET NULL;
  UPDATE honeydo SET closed_at = done_at WHERE status = 'done' AND done_at <= datetime('now', '-30 days');
  CREATE INDEX honeydo_closed ON honeydo(home_id, closed_at);
  `,
  // The weekly chore archive: one frozen row per kid per finished week, so weeks can be looked back on and compared
  // even after chores are edited or removed. A week stays open (final = 0) for 7 days after it ends to catch late approvals.
  `
  CREATE TABLE week_archive (
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    week_start TEXT NOT NULL,
    week_end TEXT NOT NULL,
    points INTEGER NOT NULL,
    done INTEGER NOT NULL,
    due INTEGER NOT NULL,
    bonus_done INTEGER NOT NULL,
    perfect_days INTEGER NOT NULL,
    streak INTEGER NOT NULL,
    penalties INTEGER NOT NULL,
    spent INTEGER NOT NULL,
    rewards INTEGER NOT NULL,
    balance INTEGER NOT NULL,
    chores TEXT NOT NULL DEFAULT '[]',
    days TEXT NOT NULL DEFAULT '[]',
    final INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (member_id, week_start)
  );
  CREATE INDEX week_archive_home ON week_archive(home_id, week_start);
  `,
  // The rewards shop: parents stock it, kids spend their points, a parent hands the reward over (or refunds it).
  // Orders copy the title, icon and price so they still read right after the item is changed or removed.
  `
  CREATE TABLE shop_items (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '🎁',
    price INTEGER NOT NULL CHECK (price > 0),
    -- NULL means as many as they like.
    stock INTEGER CHECK (stock IS NULL OR stock >= 0),
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE shop_orders (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    item_id TEXT REFERENCES shop_items(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    icon TEXT NOT NULL,
    price INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'given', 'refunded')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT,
    closed_by TEXT
  );
  CREATE INDEX shop_orders_home ON shop_orders(home_id, status);
  `,
  // Family team goals: every kid's earned points (from when the goal was set) fill one shared goal. Nothing is spent.
  `
  CREATE TABLE team_goals (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '🏕️',
    target INTEGER NOT NULL CHECK (target > 0),
    reward TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done')),
    reached_at TEXT,
    done_at TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX team_goals_home ON team_goals(home_id, status);
  `,
  // Surprise bonus chores: on some days a kid finds a gift box that turns one of today's bonus chores into double points.
  `
  ALTER TABLE homes ADD COLUMN surprise TEXT NOT NULL DEFAULT 'off' CHECK (surprise IN ('off', 'sometimes', 'often', 'daily'));
  ALTER TABLE chore_instances ADD COLUMN surprise INTEGER NOT NULL DEFAULT 0;
  `,
  // Photo proof and cheers: a chore can ask for a photo when it's marked done, and a parent can send a cheer with the approval.
  // Photos are files in the data folder (photos/<home>/), kept for 30 days.
  `
  ALTER TABLE chores ADD COLUMN photo INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE chore_instances ADD COLUMN needs_photo INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE chore_instances ADD COLUMN photo TEXT;
  ALTER TABLE chore_instances ADD COLUMN cheer TEXT;
  `,
  // LootDen link: a time-out can lock the kid's games in LootDen (all of them, or just Roblox), a shop reward can be
  // game time LootDen hands out by itself, and the family wall can show LootDen's Now Playing, screenshots and game night.
  `
  ALTER TABLE timeouts ADD COLUMN games TEXT CHECK (games IN ('all', 'roblox'));
  ALTER TABLE shop_items ADD COLUMN game_minutes INTEGER CHECK (game_minutes IS NULL OR game_minutes BETWEEN 5 AND 600);
  ALTER TABLE shop_orders ADD COLUMN game_minutes INTEGER;
  ALTER TABLE homes ADD COLUMN lootden_url TEXT;
  ALTER TABLE homes ADD COLUMN lootden_token TEXT;
  `,
  // Doctors, the health side: a kid's health card (allergies, conditions, insurance), care team, vaccines, growth,
  // medicines with dose check-offs, a symptom / mood / behavior log, appointment prep and follow-up, kid practice mode
  // (picture steps and a timer, approved by a parent) and read-only links for a therapist. Parents only, like the rest.
  `
  CREATE TABLE health_profiles (
    member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    allergies TEXT,
    conditions TEXT,
    blood_type TEXT,
    insurance TEXT,
    insurance_member TEXT,
    insurance_group TEXT,
    emergency TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE care_team (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX care_team_member ON care_team(member_id);
  CREATE TABLE vaccines (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    dose TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX vaccines_member ON vaccines(member_id, date);
  -- Stored metric (cm, kg); the app shows inches and pounds when a parent prefers.
  CREATE TABLE growth (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    height_cm REAL,
    weight_kg REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX growth_member ON growth(member_id, date);
  CREATE TABLE medications (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    dose TEXT,
    instructions TEXT,
    -- Dose times each day, e.g. ["08:00","19:30"]; empty with as_needed = 1 for "only when needed".
    times TEXT NOT NULL DEFAULT '[]',
    as_needed INTEGER NOT NULL DEFAULT 0,
    start_date TEXT,
    end_date TEXT,
    -- Doses left, counted down with each dose given; refill_at is when to remind (a parent reminder is made once).
    supply INTEGER,
    refill_at INTEGER,
    refill_reminded INTEGER NOT NULL DEFAULT 0,
    kid_can_mark INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX medications_member ON medications(member_id, active);
  -- One row per dose given or skipped. slot is the scheduled time ('08:00') or 'prn-<n>' for as-needed doses.
  CREATE TABLE med_doses (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    med_id TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    slot TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('given', 'skipped')),
    at TEXT NOT NULL DEFAULT (datetime('now')),
    by_name TEXT,
    by_kid INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    UNIQUE (med_id, date, slot)
  );
  CREATE INDEX med_doses_member ON med_doses(member_id, date);
  CREATE TABLE health_log (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('mood', 'symptom', 'behavior', 'sleep', 'other')),
    label TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT,
    severity INTEGER CHECK (severity BETWEEN 1 AND 5),
    minutes INTEGER,
    trigger TEXT,
    note TEXT,
    by_name TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX health_log_member ON health_log(member_id, date);
  -- Appointment prep (questions to ask, ticked off at the visit) and follow-up (what the provider said).
  ALTER TABLE therapy_appointments ADD COLUMN questions TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE therapy_appointments ADD COLUMN summary TEXT;
  -- Kid practice mode: picture steps and a timer on the kid's screen; "I did it!" waits for a parent.
  ALTER TABLE therapy_goals ADD COLUMN steps TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE therapy_goals ADD COLUMN practice_minutes INTEGER;
  ALTER TABLE therapy_goals ADD COLUMN kid_practice INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE practice_requests (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    goal_id TEXT NOT NULL REFERENCES therapy_goals(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    minutes INTEGER,
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'approved', 'rejected')),
    note_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT
  );
  CREATE INDEX practice_requests_home ON practice_requests(home_id, status);
  -- Read-only links for a therapist or doctor: chosen goals (or all), optionally the log and medicines, and optionally
  -- a box to leave a progress note. Only the token's hash is stored.
  CREATE TABLE share_links (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    goal_ids TEXT,
    show_log INTEGER NOT NULL DEFAULT 0,
    show_meds INTEGER NOT NULL DEFAULT 0,
    allow_notes INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX share_links_member ON share_links(member_id);
  `,
  // Helpdesk: 3 open requests per kid was too tight. Homes still on that old default go to 10 (0 now means no limit).
  `
  UPDATE homes SET helpdesk_max_open = 10 WHERE helpdesk_max_open = 3;
  `,
  // More schedules (every N days, monthly), a due time with fewer points when late, routines (ordered steps with a
  // timer), kids taking turns, and chores that approve themselves.
  `
  ALTER TABLE chores ADD COLUMN cadence TEXT CHECK (cadence IN ('interval', 'monthly'));
  ALTER TABLE chores ADD COLUMN every_days INTEGER;
  ALTER TABLE chores ADD COLUMN month_day INTEGER;
  ALTER TABLE chores ADD COLUMN due_time TEXT;
  ALTER TABLE chores ADD COLUMN late_points INTEGER;
  ALTER TABLE chores ADD COLUMN routine TEXT CHECK (routine IN ('morning', 'afterschool', 'bedtime'));
  ALTER TABLE chores ADD COLUMN routine_pos INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE chores ADD COLUMN minutes INTEGER;
  ALTER TABLE chores ADD COLUMN rotate TEXT CHECK (rotate IN ('daily', 'weekly'));
  ALTER TABLE chores ADD COLUMN auto_approve INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE chore_assignments ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE chore_instances ADD COLUMN due_time TEXT;
  ALTER TABLE chore_instances ADD COLUMN late_points INTEGER;
  ALTER TABLE chore_instances ADD COLUMN late INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE chore_instances ADD COLUMN routine TEXT;
  ALTER TABLE chore_instances ADD COLUMN routine_pos INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE chore_instances ADD COLUMN minutes INTEGER;
  ALTER TABLE chore_instances ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE members ADD COLUMN read_aloud TEXT NOT NULL DEFAULT 'auto' CHECK (read_aloud IN ('auto', 'on', 'off'));
  `,
  // Allowance and money jars: points turn into money split across Spend, Save and Give, a weekly allowance and
  // monthly interest on savings. Same rules as the points ledger: append-only, balances are sums.
  `
  ALTER TABLE homes ADD COLUMN money_enabled INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE homes ADD COLUMN money_symbol TEXT NOT NULL DEFAULT '$';
  ALTER TABLE homes ADD COLUMN cents_per_point INTEGER NOT NULL DEFAULT 10;
  ALTER TABLE homes ADD COLUMN jar_split TEXT NOT NULL DEFAULT '{"spend":70,"save":20,"give":10}';
  ALTER TABLE homes ADD COLUMN save_interest INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE members ADD COLUMN allowance_cents INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE members ADD COLUMN allowance_day INTEGER NOT NULL DEFAULT 6;
  ALTER TABLE members ADD COLUMN allowance_since TEXT;
  CREATE TABLE money_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    jar TEXT NOT NULL CHECK (jar IN ('spend', 'save', 'give')),
    cents INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('cashout', 'allowance', 'interest', 'withdraw', 'deposit', 'move')),
    reason TEXT NOT NULL,
    date TEXT NOT NULL,
    by_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX money_ledger_member ON money_ledger(member_id, jar);
  CREATE TRIGGER money_ledger_no_update BEFORE UPDATE ON money_ledger
  BEGIN SELECT RAISE(ABORT, 'money_ledger is append-only'); END;
  CREATE TRIGGER money_ledger_no_delete BEFORE DELETE ON money_ledger
  WHEN EXISTS (SELECT 1 FROM members WHERE id = OLD.member_id) AND EXISTS (SELECT 1 FROM homes WHERE id = OLD.home_id)
  BEGIN SELECT RAISE(ABORT, 'money_ledger is append-only'); END;
  -- Allowance and interest run once per kid per period, even if the server checks many times.
  CREATE TABLE money_runs (
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    period TEXT NOT NULL,
    PRIMARY KEY (member_id, kind, period)
  );
  `,
  // Push notifications (Web Push) for parents' phones and the family tablet, and the weekly recap.
  `
  CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY,
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_ok_at TEXT
  );
  CREATE INDEX push_subscriptions_home ON push_subscriptions(home_id);
  -- Things sent once (a due-soon nudge, a weekly recap), so a restart or a second check never repeats them.
  CREATE TABLE push_sent (
    home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (home_id, key)
  );
  ALTER TABLE homes ADD COLUMN recap_seen TEXT;
  `,
];

export function openDb(dataDir: string): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'den-duty.db');
  // The app used to be called Daytime Ninja: carry an existing database over under the new name.
  const old = path.join(dataDir, 'daytime-ninja.db');
  if (!fs.existsSync(file) && fs.existsSync(old)) {
    for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(old + ext)) fs.renameSync(old + ext, file + ext);
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function openMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const version = Number((db.prepare('PRAGMA user_version').get() as Row).user_version);
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** Runs fn inside a transaction. Inside another one it just joins it (the outer one commits or rolls back). */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
