import { parseChaseCheckingStatement } from './chase-statement.ts';
import { detectCsv, parseChaseCheckingCsv, parseDiscoverCsv } from './csv.ts';
import { extractTextItems } from './pdf.ts';
import type { ParsedFile } from './rows.ts';

/**
 * Turns one bank file into rows. Throws with a readable message when the file is not supported.
 * Imported on its own (not through the index) because it pulls in the PDF library.
 */
export async function parseBankFile(name: string, bytes: Uint8Array): Promise<ParsedFile> {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) {
    const statement = parseChaseCheckingStatement(await extractTextItems(bytes));
    return {
      account: 'chase',
      rows: statement.rows,
      statementEnd: statement.period.end,
      note: `Chase statement ${statement.period.start} → ${statement.period.end}, ${statement.rows.length} rows, balances verified`,
    };
  }
  if (lower.endsWith('.csv')) {
    const text = new TextDecoder().decode(bytes);
    const kind = detectCsv(text);
    if (kind === 'discover') {
      const rows = parseDiscoverCsv(text);
      return { account: 'discover', rows, note: `Discover CSV, ${rows.length} rows` };
    }
    if (kind === 'chase-checking') {
      const rows = parseChaseCheckingCsv(text);
      return { account: 'chase', rows, note: `Chase CSV, ${rows.length} rows` };
    }
    throw new Error('This CSV is not a Chase checking or Discover export');
  }
  throw new Error('Only Chase statement PDFs and Chase / Discover CSV exports can be imported (screenshots cannot)');
}
