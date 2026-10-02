/**
 * Loads the local files (ledger, plan + balances, personal rules) into D1. Input and SQL stay in the gitignored data/ folder.
 *
 * Run: npm run seed                      → local dev database
 *      npm run seed -- --remote          → the deployed database (only with Ricardo's OK)
 *      npm run seed -- --plan            → only replace the plan (e.g. after editing data/plan.local.json)
 *      npm run seed -- --force           → also replace balances, coverage and rules (loses edits made in the app)
 *
 * By default it only adds: transactions already there, balances, the plan and rules made in the app stay as they are.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { CategoryRule, LedgerEntry } from '../shared/import/index.ts';

const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const planOnly = args.has('--plan');

const data = (file: string) => new URL(`../data/${file}`, import.meta.url).pathname;
const read = <T>(file: string, fallback: T): T => (existsSync(data(file)) ? JSON.parse(readFileSync(data(file), 'utf8')) : fallback);

const ledger = read<LedgerEntry[]>('ledger.json', []);
const { plan, balances } = read<{ plan?: unknown; balances?: unknown }>('plan.local.json', {});
const rules = read<CategoryRule[]>('rules.local.json', []);

const text = (value: string | null | undefined) => (value == null ? 'NULL' : `'${value.replace(/'/g, "''")}'`);
const setting = (key: string, value: unknown, replace: boolean) =>
  `INSERT OR ${replace ? 'REPLACE' : 'IGNORE'} INTO settings (key, value) VALUES ('${key}', ${text(JSON.stringify(value))});`;

const lines: string[] = [];
if (planOnly) {
  if (!plan) throw new Error('data/plan.local.json has no plan');
  lines.push(setting('plan', plan, true));
} else {
  lines.push(
    ...ledger.map(
      (e) =>
        `INSERT OR IGNORE INTO transactions (id, account, date, posted_date, description, amount, category, kind, source) VALUES (${text(e.id)}, ${text(e.account)}, ${text(e.date)}, ${text(e.postedDate)}, ${text(e.description)}, ${Math.round(e.amount)}, ${text(e.category)}, ${text(e.kind)}, ${text(e.source)});`,
    ),
  );
  if (force) lines.push('DELETE FROM rules;');
  lines.push(
    ...rules.map(
      (r, i) =>
        `INSERT INTO rules (match, category, kind, sign, position) SELECT ${text(r.match)}, ${text(r.category)}, ${text(r.kind ?? null)}, ${text(r.sign ?? null)}, ${i} WHERE NOT EXISTS (SELECT 1 FROM rules WHERE match = ${text(r.match)});`,
    ),
  );
  if (plan) lines.push(setting('plan', plan, force));
  if (balances) lines.push(setting('balances', balances, force));
  // Statement coverage: CSV rows inside an imported statement period are skipped on later imports.
  const coverage: Record<string, string> = {};
  for (const e of ledger) if (e.source.endsWith('.pdf') && e.postedDate > (coverage[e.account] ?? '')) coverage[e.account] = e.postedDate;
  lines.push(setting('coverage', coverage, force));
}

writeFileSync(data('seed.sql'), `${lines.join('\n')}\n`);
console.log(
  planOnly
    ? 'data/seed.sql: plan only'
    : `data/seed.sql: ${ledger.length} transactions, ${rules.length} rules, plan ${plan ? 'yes' : 'no'}, balances ${balances ? 'yes' : 'no'}${force ? ' (replacing)' : ''}`,
);

const target = args.has('--remote') ? '--remote' : '--local';
execFileSync('npx', ['wrangler', 'd1', 'execute', 'finance', target, `--file=${data('seed.sql')}`], { stdio: 'inherit' });
