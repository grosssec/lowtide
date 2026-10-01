import { makeDate, type ISODate } from '../engine/dates.ts';
import type { Cents } from '../engine/money.ts';
import { isMoney, parseMoney } from './money.ts';

/** Minimal RFC 4180 reader: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

/** A transaction from a CSV export. amount < 0 means money left the account (or a card charge). */
export interface CsvTransaction {
  postedDate: ISODate;
  date: ISODate;
  description: string;
  amount: Cents;
  balance?: Cents;
  bankCategory?: string;
}

function usDate(text: string): ISODate {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match) throw new Error(`Not a MM/DD/YYYY date: "${text}"`);
  return makeDate(Number(match[3]), Number(match[1]), Number(match[2]));
}

function columns(header: string[], required: string[]): Record<string, number> {
  const normalized = header.map((h) => h.trim().toLowerCase());
  const index: Record<string, number> = {};
  for (const name of required) {
    const at = normalized.indexOf(name.toLowerCase());
    if (at < 0) throw new Error(`CSV is missing the "${name}" column (found: ${header.join(', ')})`);
    index[name] = at;
  }
  return index;
}

/** Chase checking export: Details, Posting Date, Description, Amount, Type, Balance, Check or Slip #. */
export function parseChaseCheckingCsv(text: string): CsvTransaction[] {
  const [header, ...rows] = parseCsv(text);
  const col = columns(header, ['Posting Date', 'Description', 'Amount', 'Balance']);
  return rows.map((row) => {
    const postedDate = usDate(row[col['Posting Date']]);
    const balance = row[col.Balance]?.trim();
    return {
      postedDate,
      date: postedDate,
      description: row[col.Description].replace(/\s+/g, ' ').trim(),
      amount: parseMoney(row[col.Amount]),
      ...(balance && isMoney(balance) ? { balance: parseMoney(balance) } : {}),
    };
  });
}

/** Discover card export: Trans. Date, Post Date, Description, Amount (charges positive), Category. */
export function parseDiscoverCsv(text: string): CsvTransaction[] {
  const [header, ...rows] = parseCsv(text);
  const col = columns(header, ['Trans. Date', 'Post Date', 'Description', 'Amount', 'Category']);
  return rows.map((row) => ({
    postedDate: usDate(row[col['Post Date']]),
    date: usDate(row[col['Trans. Date']]),
    description: row[col.Description].replace(/\s+/g, ' ').trim(),
    // The card reports charges as positive; for the person they are money out.
    amount: -parseMoney(row[col.Amount]),
    bankCategory: row[col.Category].trim(),
  }));
}

/** Which bank export a CSV is, from its header row. */
export function detectCsv(text: string): 'chase-checking' | 'discover' | null {
  const header = (parseCsv(text.split(/\r?\n/, 1)[0] ?? '')[0] ?? []).map((h) => h.trim().toLowerCase());
  if (header.includes('posting date') && header.includes('balance')) return 'chase-checking';
  if (header.includes('trans. date') && header.includes('post date')) return 'discover';
  return null;
}
