-- One-time codes to add a device (made in Settings → Security, or by `npm run setup-code` for the first passkey or recovery).
-- Only the SHA-256 of a code is stored; a code works once, for 10–15 minutes.
CREATE TABLE device_codes (
  code_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The security log gains the event for making a code (SQLite can't change a CHECK, so the table is rebuilt).
CREATE TABLE security_events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL CHECK (type IN ('sign_in', 'sign_out', 'passkey_added', 'passkey_removed', 'session_ended', 'others_signed_out', 'device_code_created')),
  device TEXT,
  place TEXT,
  detail TEXT
);
INSERT INTO security_events_new (id, at, type, device, place, detail) SELECT id, at, type, device, place, detail FROM security_events;
DROP TABLE security_events;
ALTER TABLE security_events_new RENAME TO security_events;
CREATE INDEX security_events_at ON security_events (at);
