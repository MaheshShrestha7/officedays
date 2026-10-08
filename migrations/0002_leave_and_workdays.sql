-- Which weekdays count towards the target, as ISO day numbers (1 = Monday ... 7 = Sunday).
ALTER TABLE targets ADD COLUMN workdays TEXT NOT NULL DEFAULT '12345';

-- Days off that lower the target for their week or month instead of counting as misses.
CREATE TABLE leave_days (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('leave', 'holiday', 'sick')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date)
);
