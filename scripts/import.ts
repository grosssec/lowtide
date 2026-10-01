/**
 * Imports bank files from data/imports into data/ledger.json (both gitignored).
 * - Chase checking statements (PDF): every row is checked against the printed running balance.
 * - Chase checking / Discover CSV exports: rows already covered by an imported statement are skipped.
 * Categories: personal rules from data/rules.local.json first, then the default merchant rules.
 * Run: npm run import
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatUSD, type ISODate } from '../shared/engine/index.ts';
import { parseBankFile } from '../shared/import/file.ts';
import {
  DEFAULT_RULES,
  makeCategorizer,
  mergeLedger,
  summarizeLedger,
  toLedgerEntries,
  type CategoryRule,
  type LedgerEntry,
  type ParsedFile,
} from '../shared/import/index.ts';

const dataDir = new URL('../data/', import.meta.url).pathname;
const importsDir = join(dataDir, 'imports');
const ledgerPath = join(dataDir, 'ledger.json');
const rulesPath = join(dataDir, 'rules.local.json');

const personalRules: CategoryRule[] = existsSync(rulesPath) ? JSON.parse(readFileSync(rulesPath, 'utf8')) : [];
const categorize = makeCategorizer([...personalRules, ...DEFAULT_RULES]);
const usd = (cents: number) => formatUSD(cents);

const parsed: (ParsedFile & { file: string })[] = [];
const skipped: string[] = [];
for (const file of readdirSync(importsDir).sort()) {
  if (file.startsWith('.')) continue;
  try {
    parsed.push({ file, ...(await parseBankFile(file, new Uint8Array(readFileSync(join(importsDir, file))))) });
  } catch (error) {
    skipped.push(`${file}: ${(error as Error).message}`);
  }
}

// Statements are the authority: CSV rows inside a statement's period are already in the ledger.
const coverage: Record<string, ISODate> = {};
for (const p of parsed) if (p.statementEnd && p.statementEnd > (coverage[p.account] ?? '')) coverage[p.account] = p.statementEnd;
const incoming: LedgerEntry[] = parsed.flatMap((p) => toLedgerEntries(p, p.file, coverage, categorize));

const existing: LedgerEntry[] = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : [];
const { ledger, added } = mergeLedger(existing, incoming);
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

console.log('# Import\n');
for (const p of parsed) console.log(`✓ ${p.file}: ${p.note}`);
for (const s of skipped) console.log(`✗ ${s}`);
console.log(`\nLedger: ${ledger.length} entries (${added} new) → data/ledger.json`);

console.log('\n# Months (transfers such as card payments excluded)\n');
for (const month of summarizeLedger(ledger)) {
  const top = (record: Record<string, number>) =>
    Object.entries(record)
      .sort((a, b) => b[1] - a[1])
      .map(([category, cents]) => `${category} ${usd(cents)}`)
      .join(' · ');
  console.log(`${month.month}  in ${usd(month.income)}  out ${usd(month.spending)}  result ${usd(month.result)}`);
  console.log(`  in:  ${top(month.incomeByCategory)}`);
  console.log(`  out: ${top(month.spendingByCategory)}`);
}

const uncategorized = ledger.filter((entry) => entry.category.startsWith('Uncategorized'));
if (uncategorized.length) {
  console.log(`\n# Uncategorized (${uncategorized.length})\n`);
  for (const entry of uncategorized) console.log(`${entry.date}  ${usd(entry.amount).padStart(10)}  ${entry.account}  ${entry.description}`);
}
