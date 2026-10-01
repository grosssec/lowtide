/**
 * Prints the plan in the terminal: today's numbers, paychecks, month-by-month results,
 * spending room at checkpoints and the savings goal. Same code as the dashboard.
 * Input: data/plan.local.json ({ balances, plan }, gitignored) and data/ledger.json when present.
 * Run: npm run plan   (or: node scripts/plan.ts path/to/plan.json)
 */
import { existsSync, readFileSync } from 'node:fs';
import { formatUSD, monthKey, type Cents, type ISODate } from '../shared/engine/index.ts';
import type { LedgerEntry } from '../shared/import/index.ts';
import { buildDashboard, buildYearPlan, computeActuals, type Balances, type PlanConfig } from '../shared/plan/index.ts';

const path = process.argv[2] ?? new URL('../data/plan.local.json', import.meta.url).pathname;
const { balances, plan } = JSON.parse(readFileSync(path, 'utf8')) as { balances: Balances; plan: PlanConfig };
const ledgerPath = new URL('../data/ledger.json', import.meta.url).pathname;
const ledger: LedgerEntry[] = !process.argv[2] && existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : [];
const latestSnapshot = [balances.checking.asOf, balances.cash.asOf, balances.cardOwed.asOf].sort().at(-1)!;
const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const today: ISODate = now > latestSnapshot ? now : latestSnapshot;
const actuals = computeActuals(balances, ledger, today);

const usd = (cents: Cents) => formatUSD(Math.round(cents / 100) * 100).slice(0, -3);
function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  return [line(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}
const section = (title: string) => console.log(`\n## ${title}\n`);

const dashboard = buildDashboard({ month: monthKey(today), config: plan, actuals, ledger });
const year = buildYearPlan(plan, actuals);

console.log(`# Plan for ${today} (balances typed in on ${latestSnapshot}, plus ${ledger.length ? 'the ledger after that' : 'no ledger'})`);
console.log(`Checking ${usd(actuals.checking)} + cash ${usd(actuals.cash)} − card ${usd(actuals.cardOwed)} = total ${usd(actuals.net)} (reserve included)`);
if (dashboard.safeToSpend && dashboard.nextMonth) {
  const s = dashboard.safeToSpend;
  section(`Today — ${dashboard.scenarioLabel}`);
  console.log(`Safe to spend ${usd(s.amount)} (≈ ${usd(s.perDay)}/day until ${s.nextPayDate ?? '—'}); tightest day ${s.low.date} at ${usd(s.low.balance)}`);
  const n = dashboard.nextMonth;
  console.log(`${n.month}: in ${usd(n.income)} (${usd(n.alreadyWorked)} already worked), committed ${usd(n.committed)}, free ${usd(n.free)} → ${n.covered ? 'covered' : 'NOT covered'}`);
  for (const alert of dashboard.alerts) console.log(`[${alert.level}] ${alert.text}`);
}

section('Paychecks (first 16)');
const keys = [...new Set(year.scenarios.flatMap((s) => s.paychecks.map((p) => `${p.payDate}|${p.jobId}`)))].sort().slice(0, 16);
console.log(
  table(
    ['Pay date', 'Job', 'Pays hours of', ...year.scenarios.map((s) => s.label)],
    keys.map((key) => {
      const [date, job] = key.split('|');
      const find = (s: (typeof year.scenarios)[number]) => s.paychecks.find((p) => p.payDate === date && p.jobId === job);
      const any = year.scenarios.map(find).find(Boolean)!;
      return [date, any.jobName, `${any.period.start.slice(5)} → ${any.period.end.slice(5)}`, ...year.scenarios.map((s) => usd(find(s)?.amount ?? 0))];
    }),
  ),
);

for (const s of year.scenarios) {
  section(`Month by month — ${s.label}: ${s.level} hours, ${s.optionLabel}`);
  console.log(table(['Month', 'In', 'Out', 'Result', 'Balance at month end'], s.months.map((m) => [m.month, usd(m.income), usd(m.spending), usd(m.result), usd(m.endBalance)])));
}

section('Spending room at checkpoints (reserve stays intact)');
console.log(table(['Checkpoint', 'Until', ...year.scenarios.map((s) => s.label)], year.checkpoints.map((c) => [c.label, c.horizonEnd, ...c.room.map(usd)])));

section(`${year.goal.label}: money above the reserve on ${year.goal.by} (goal ${usd(year.goal.amount)})`);
console.log(
  table(
    ['Option', 'conservative hours', 'expected hours', 'avg month result'],
    year.goal.options.map((o) => [o.label, usd(o.aboveReserve.conservative), usd(o.aboveReserve.expected), `${usd(o.averageResult.conservative)} – ${usd(o.averageResult.expected)}`]),
  ),
);

if (year.notIncluded.length) {
  section('Not included yet');
  for (const item of year.notIncluded) console.log(`- ${item}`);
}
