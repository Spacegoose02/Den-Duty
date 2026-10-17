import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Row = Record<string, unknown>;

// Each entry runs once, in order. Never edit a shipped migration; append a new one.
const MIGRATIONS: string[] = [
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
];

export function openDb(dataDir: string): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'daytime-ninja.db'));
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

/** Runs fn inside a transaction. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
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
