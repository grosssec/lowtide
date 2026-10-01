import type { CategoryRule, EntryKind, LedgerEntry } from '../shared/import/index.ts';

export type Entry = LedgerEntry & { note: string | null };

interface TransactionRow {
  id: string;
  account: string;
  date: string;
  posted_date: string;
  description: string;
  amount: number;
  category: string;
  kind: EntryKind;
  source: string;
  note: string | null;
}

const toEntry = (row: TransactionRow): Entry => ({
  id: row.id,
  account: row.account,
  date: row.date,
  postedDate: row.posted_date,
  description: row.description,
  amount: row.amount,
  category: row.category,
  kind: row.kind,
  source: row.source,
  note: row.note,
});

export async function loadLedger(db: D1Database): Promise<Entry[]> {
  const { results } = await db.prepare('SELECT * FROM transactions ORDER BY date, id').all<TransactionRow>();
  return results.map(toEntry);
}

export async function getEntry(db: D1Database, id: string): Promise<Entry | null> {
  const row = await db.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first<TransactionRow>();
  return row ? toEntry(row) : null;
}

/** INSERT OR IGNORE in batches; returns how many rows were new. */
export async function insertEntries(db: D1Database, entries: LedgerEntry[]): Promise<number> {
  const statement = db.prepare(
    'INSERT OR IGNORE INTO transactions (id, account, date, posted_date, description, amount, category, kind, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  let added = 0;
  for (let i = 0; i < entries.length; i += 50) {
    const batch = entries
      .slice(i, i + 50)
      .map((e) => statement.bind(e.id, e.account, e.date, e.postedDate, e.description, e.amount, e.category, e.kind, e.source));
    const results = await db.batch(batch);
    added += results.reduce((total, result) => total + (result.meta.changes ?? 0), 0);
  }
  return added;
}

export async function updateCategory(db: D1Database, ids: string[], category: string, kind: EntryKind): Promise<void> {
  const statement = db.prepare('UPDATE transactions SET category = ?, kind = ? WHERE id = ?');
  for (let i = 0; i < ids.length; i += 50) {
    await db.batch(ids.slice(i, i + 50).map((id) => statement.bind(category, kind, id)));
  }
}

export async function getSetting<T>(db: D1Database, key: string): Promise<T | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function putSetting(db: D1Database, key: string, value: unknown): Promise<void> {
  await db
    .prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key, JSON.stringify(value))
    .run();
}

export type StoredRule = CategoryRule & { id: number };

export async function loadRules(db: D1Database): Promise<StoredRule[]> {
  const { results } = await db
    .prepare('SELECT id, match, category, kind FROM rules ORDER BY position, id')
    .all<{ id: number; match: string; category: string; kind: EntryKind | null }>();
  return results.map((r) => ({ id: r.id, match: r.match, category: r.category, ...(r.kind ? { kind: r.kind } : {}) }));
}
