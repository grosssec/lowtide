import { monthKey, type ISODate } from '../engine/dates.ts';
import type { Cents } from '../engine/money.ts';
import type { EntryKind } from './categorize.ts';

export interface LedgerEntry {
  /** Stable across re-imports of the same data. */
  id: string;
  account: string;
  /** When the money was spent or received (purchase date for card purchases). */
  date: ISODate;
  postedDate: ISODate;
  /** ISO date-time in UTC when the moment is known (bank alert emails, cash typed in). */
  at?: string;
  description: string;
  /** Negative = money out (or a card charge). */
  amount: Cents;
  category: string;
  kind: EntryKind;
  source: string;
}

/** Ids repeat-safe: two identical $3.60 purchases on the same day get #1 and #2. */
export function withIds<T extends { postedDate: ISODate; amount: Cents; description: string }>(
  account: string,
  rows: T[],
): (T & { id: string })[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = `${account}|${row.postedDate}|${row.amount}|${row.description.toLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...row, id: `${base}|${n}` };
  });
}

/** Merge new entries into a ledger, keeping existing ones (and their manual edits) when ids match. */
export function mergeLedger(existing: LedgerEntry[], incoming: LedgerEntry[]): { ledger: LedgerEntry[]; added: number } {
  const ids = new Set(existing.map((entry) => entry.id));
  const fresh = incoming.filter((entry) => !ids.has(entry.id));
  const ledger = [...existing, ...fresh].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { ledger, added: fresh.length };
}

export interface LedgerMonth {
  month: string;
  income: Cents;
  spending: Cents;
  result: Cents;
  incomeByCategory: Record<string, Cents>;
  spendingByCategory: Record<string, Cents>;
}

/** Money in vs out per calendar month. Transfers are left out on purpose. */
export function summarizeLedger(entries: LedgerEntry[]): LedgerMonth[] {
  const months = new Map<string, LedgerMonth>();
  for (const entry of entries) {
    if (entry.kind === 'transfer') continue;
    const key = monthKey(entry.date);
    const month = months.get(key) ?? { month: key, income: 0, spending: 0, result: 0, incomeByCategory: {}, spendingByCategory: {} };
    months.set(key, month);
    if (entry.kind === 'income') {
      month.income += entry.amount;
      month.incomeByCategory[entry.category] = (month.incomeByCategory[entry.category] ?? 0) + entry.amount;
    } else {
      month.spending -= entry.amount;
      month.spendingByCategory[entry.category] = (month.spendingByCategory[entry.category] ?? 0) - entry.amount;
    }
    month.result += entry.amount;
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}
