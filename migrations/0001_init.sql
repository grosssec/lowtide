-- Ledger: one row per bank/card/cash transaction. Amounts in integer cents, negative = money out.
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  date TEXT NOT NULL,
  posted_date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL,
  category TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
  source TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX transactions_date ON transactions (date);

-- Personal categorization rules, tried before the built-in merchant rules (lower position first).
CREATE TABLE rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match TEXT NOT NULL,
  category TEXT NOT NULL,
  kind TEXT CHECK (kind IN ('income', 'expense', 'transfer')),
  position INTEGER NOT NULL DEFAULT 0
);

-- JSON documents: 'plan' (PlanConfig), 'balances' (Balances), 'coverage' (last statement date per account).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT NOT NULL,
  account TEXT NOT NULL,
  rows INTEGER NOT NULL,
  added INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Passkeys (single user) and login sessions.
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
