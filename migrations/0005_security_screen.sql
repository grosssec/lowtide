-- Security screen: which device each session and passkey belongs to, when it was last used,
-- and a log of sign-ins and security changes (only written once a passkey has verified).
ALTER TABLE sessions ADD COLUMN device TEXT;
ALTER TABLE sessions ADD COLUMN place TEXT;
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
ALTER TABLE credentials ADD COLUMN last_used_at TEXT;
CREATE TABLE security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL CHECK (type IN ('sign_in', 'sign_out', 'passkey_added', 'passkey_removed', 'session_ended', 'others_signed_out')),
  device TEXT,
  place TEXT,
  detail TEXT
);
CREATE INDEX security_events_at ON security_events (at);
