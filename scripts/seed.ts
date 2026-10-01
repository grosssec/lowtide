/**
 * Builds data/seed.sql from the local files (ledger, plan + balances, personal rules) so the
 * database starts with real history. Both the input and the SQL stay in the gitignored data/ folder.
 * Run: npm run seed            → applies to the local dev database
 *      npm run seed -- --remote → applies to the deployed database (only with Ricardo's OK)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { CategoryRule, LedgerEntry } from '../shared/import/index.ts';

const data = (file: string) => new URL(`../data/${file}`, import.meta.url).pathname;
const read = <T>(file: string, fallback: T): T => (existsSync(data(file)) ? JSON.parse(readFileSync(data(file), 'utf8')) : fallback);

const ledger = read<LedgerEntry[]>('ledger.json', []);
const { plan, balances } = read<{ plan?: unknown; balances?: unknown }>('plan.local.json', {});
const rules = read<CategoryRule[]>('rules.local.json', []);

const text = (value: string | null | undefined) => (value == null ? 'NULL' : `'${value.replace(/'/g, "''")}'`);
const lines = [
  ...ledger.map(
    (e) =>
      `INSERT OR IGNORE INTO transactions (id, account, date, posted_date, description, amount, category, kind, source) VALUES (${text(e.id)}, ${text(e.account)}, ${text(e.date)}, ${text(e.postedDate)}, ${text(e.description)}, ${Math.round(e.amount)}, ${text(e.category)}, ${text(e.kind)}, ${text(e.source)});`,
  ),
  'DELETE FROM rules;',
  ...rules.map((r, i) => `INSERT INTO rules (match, category, kind, position) VALUES (${text(r.match)}, ${text(r.category)}, ${text(r.kind ?? null)}, ${i});`),
  ...(plan ? [`INSERT OR REPLACE INTO settings (key, value) VALUES ('plan', ${text(JSON.stringify(plan))});`] : []),
  ...(balances ? [`INSERT OR REPLACE INTO settings (key, value) VALUES ('balances', ${text(JSON.stringify(balances))});`] : []),
];

// Statement coverage: CSV rows inside an imported statement period are skipped on later imports.
const coverage: Record<string, string> = {};
for (const e of ledger) if (e.source.endsWith('.pdf') && e.postedDate > (coverage[e.account] ?? '')) coverage[e.account] = e.postedDate;
lines.push(`INSERT OR REPLACE INTO settings (key, value) VALUES ('coverage', ${text(JSON.stringify(coverage))});`);

writeFileSync(data('seed.sql'), `${lines.join('\n')}\n`);
console.log(`data/seed.sql: ${ledger.length} transactions, ${rules.length} rules, plan ${plan ? 'yes' : 'no'}, balances ${balances ? 'yes' : 'no'}`);

const target = process.argv.includes('--remote') ? '--remote' : '--local';
execFileSync('npx', ['wrangler', 'd1', 'execute', 'finance', target, `--file=${data('seed.sql')}`], { stdio: 'inherit' });
