import type { ISODate } from '../engine/dates.ts';
import type { EntryKind } from './categorize.ts';
import type { CsvTransaction } from './csv.ts';
import { withIds, type LedgerEntry } from './ledger.ts';

export interface ParsedFile {
  account: 'chase' | 'discover';
  rows: CsvTransaction[];
  /** Set for statements: CSV rows inside this period are already covered by the statement. */
  statementEnd?: ISODate;
  note: string;
}

/** Ledger rows for one parsed file. CSV rows already covered by an imported statement are skipped. */
export function toLedgerEntries(
  parsed: ParsedFile,
  file: string,
  coverage: Record<string, ISODate>,
  categorize: (description: string, amount: number) => { category: string; kind: EntryKind },
): LedgerEntry[] {
  const limit = parsed.statementEnd ? undefined : coverage[parsed.account];
  const rows = limit ? parsed.rows.filter((row) => row.postedDate > limit) : parsed.rows;
  return withIds(parsed.account, rows).map((row) => ({
    id: row.id,
    account: parsed.account,
    date: row.date,
    postedDate: row.postedDate,
    description: row.description,
    amount: row.amount,
    ...categorize(row.description, row.amount),
    source: file,
  }));
}
