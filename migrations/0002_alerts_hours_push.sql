-- Rules can apply only to money coming in or going out.
ALTER TABLE rules ADD COLUMN sign TEXT CHECK (sign IN ('in', 'out'));

-- Bank alert emails forwarded by the Google Apps Script (one row per email, deduplicated by message id).
CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('transaction', 'balance', 'ignored', 'unparsed')),
  note TEXT,
  transaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX alerts_received ON alerts (received_at);

-- Hours from the timesheets (Google Sheets), one row per job and day.
CREATE TABLE hours (
  job_id TEXT NOT NULL,
  date TEXT NOT NULL,
  hours REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (job_id, date)
);

-- Web push: devices that turned notifications on, and the messages they show.
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_sent_at TEXT
);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
