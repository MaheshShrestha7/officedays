CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Target history: the row with the latest effective_from on or before a date applies to it.
CREATE TABLE targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period IN ('week', 'month')),
  days_required INTEGER NOT NULL CHECK (days_required BETWEEN 0 AND 31),
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX targets_user ON targets(user_id, effective_from);

CREATE TABLE checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  desk_eui64 TEXT,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_country TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'flagged', 'manual')),
  UNIQUE (user_id, local_date)
);
