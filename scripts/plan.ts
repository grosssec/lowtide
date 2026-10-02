/**
 * Prints the plan in the terminal: today's numbers, paychecks, the next 12 months, goals and trip room.
 * Same code as the dashboard. Input: data/plan.local.json ({ balances, plan }, gitignored) and data/ledger.json.
 * Run: npm run plan   (or: node scripts/plan.ts path/to/plan.json)
 */
import { existsSync, readFileSync } from 'node:fs';
import { formatUSD, monthKey, type Cents, type ISODate } from '../shared/engine/index.ts';
import type { LedgerEntry } from '../shared/import/index.ts';
import { buildDashboard, buildYearPlan, computeActuals, forwardFlows, migratePlan, type Balances } from '../shared/plan/index.ts';
import { holidaySet } from '../shared/engine/holidays.ts';

const path = process.argv[2] ?? new URL('../data/plan.local.json', import.meta.url).pathname;
const input = JSON.parse(readFileSync(path, 'utf8')) as { balances: Balances; plan: unknown };
const balances = input.balances;
const plan = migratePlan(input.plan);
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
  section('Today');
  console.log(`Safe to spend ${usd(s.amount)} (≈ ${usd(s.perDay)}/day until ${s.nextPayDate ?? '—'}); tightest day ${s.low.date} at ${usd(s.low.balance)}`);
  const n = dashboard.nextMonth;
  console.log(`${n.month}: in ${usd(n.income)} (${usd(n.alreadyWorked)} already worked), committed ${usd(n.committed)}, free ${usd(n.free)} → ${n.covered ? 'covered' : 'NOT covered'}`);
  for (const job of n.byJob) console.log(`  ${job.jobName}: ${usd(job.amount)} from ${job.paychecks} paycheck(s), ${job.weeklyHours} h/week (${job.source})`);
  for (const alert of dashboard.alerts) console.log(`[${alert.level}] ${alert.text}`);
}

section('Paychecks (next 12)');
const { paychecks } = forwardFlows(plan, actuals, year.months.at(-1)!.month + '-28', holidaySet(Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1));
console.log(
  table(
    ['Pay date', 'Job', 'Pays hours of', 'Hours', 'Amount'],
    paychecks.filter((p) => p.amount > 0).slice(0, 12).map((p) => [p.payDate, p.jobName, `${p.period.start.slice(5)} → ${p.period.end.slice(5)}`, String(p.hours), usd(p.amount)]),
  ),
);

section('Next 12 months');
console.log(table(['Month', 'In', 'Out', 'Result', 'Balance at month end'], year.months.map((m) => [m.month, usd(m.income), usd(m.spending), usd(m.result), usd(m.endBalance)])));

if (year.goals.length) {
  section('Goals (after the reserve, in order)');
  console.log(
    table(
      ['Goal', 'Target', 'By', 'Now', 'Projected', 'Short by', 'Per month'],
      year.goals.map((g) => [g.name, usd(g.target), g.date, usd(g.now), usd(g.projected), usd(g.shortBy), usd(g.perMonth)]),
    ),
  );
}

if (year.trips.length) {
  section('Room to spend on trips (reserve kept)');
  console.log(table(['Trip', 'Starts', 'Until', 'Room'], year.trips.map((t) => [t.label, t.start, t.until, usd(t.room)])));
}

section('Assumptions');
for (const line of [...year.assumptions, ...year.notes]) console.log(`- ${line}`);
