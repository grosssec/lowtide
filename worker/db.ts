import type { ISODate } from '../shared/engine/index.ts';
import type { CategoryRule, EntryKind, LedgerEntry } from '../shared/import/index.ts';
import type { LoggedHours } from '../shared/plan/index.ts';

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
  at: string | null;
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
  ...(row.at ? { at: row.at } : {}),
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
    'INSERT OR IGNORE INTO transactions (id, account, date, posted_date, description, amount, category, kind, source, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  let added = 0;
  for (let i = 0; i < entries.length; i += 50) {
    const batch = entries
      .slice(i, i + 50)
      .map((e) => statement.bind(e.id, e.account, e.date, e.postedDate, e.description, e.amount, e.category, e.kind, e.source, e.at ?? null));
    const results = await db.batch(batch);
    added += results.reduce((total, result) => total + (result.meta.changes ?? 0), 0);
  }
  return added;
}

export async function deleteEntries(db: D1Database, ids: string[]): Promise<void> {
  const statement = db.prepare('DELETE FROM transactions WHERE id = ?');
  for (let i = 0; i < ids.length; i += 50) await db.batch(ids.slice(i, i + 50).map((id) => statement.bind(id)));
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
    .prepare('SELECT id, match, category, kind, sign FROM rules ORDER BY position, id')
    .all<{ id: number; match: string; category: string; kind: EntryKind | null; sign: 'in' | 'out' | null }>();
  return results.map((r) => ({
    id: r.id,
    match: r.match,
    category: r.category,
    ...(r.kind ? { kind: r.kind } : {}),
    ...(r.sign ? { sign: r.sign } : {}),
  }));
}

/** Hours from the timesheets, per job: they replace the planned hours up to the last synced day. */
export async function loadHours(db: D1Database): Promise<LoggedHours> {
  const { results } = await db.prepare('SELECT job_id, date, hours FROM hours').all<{ job_id: string; date: ISODate; hours: number }>();
  const logged: LoggedHours = {};
  for (const row of results) {
    const job = (logged[row.job_id] ??= { actuals: {}, through: row.date });
    job.actuals[row.date] = row.hours;
    if (row.date > job.through) job.through = row.date;
  }
  return logged;
}

/** Replaces one job's hours inside [from, to] in one transaction, so days removed from the sheet disappear too. */
export async function replaceHours(db: D1Database, jobId: string, from: ISODate, to: ISODate, rows: { date: ISODate; hours: number }[]): Promise<void> {
  const insert = db.prepare("INSERT INTO hours (job_id, date, hours, updated_at) VALUES (?, ?, ?, datetime('now'))");
  await db.batch([
    db.prepare('DELETE FROM hours WHERE job_id = ? AND date BETWEEN ? AND ?').bind(jobId, from, to),
    ...rows.map((r) => insert.bind(jobId, r.date, r.hours)),
  ]);
}

export interface AlertRow {
  id: string;
  received_at: string;
  sender: string;
  subject: string;
  body: string;
  status: 'transaction' | 'balance' | 'ignored' | 'unparsed';
  note: string | null;
  transaction_id: string | null;
}

export async function saveAlerts(db: D1Database, rows: AlertRow[]): Promise<void> {
  const statement = db.prepare(
    'INSERT OR IGNORE INTO alerts (id, received_at, sender, subject, body, status, note, transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (let i = 0; i < rows.length; i += 50) {
    await db.batch(
      rows.slice(i, i + 50).map((r) => statement.bind(r.id, r.received_at, r.sender, r.subject, r.body, r.status, r.note, r.transaction_id)),
    );
  }
}

export interface PushRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function loadSubscriptions(db: D1Database): Promise<PushRow[]> {
  const { results } = await db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all<PushRow>();
  return results;
}
