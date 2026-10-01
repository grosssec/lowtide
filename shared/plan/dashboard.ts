import { addDays, addMonths, endOfMonth, makeDate, monthKey, parts, toDayNumber, type ISODate } from '../engine/dates.ts';
import { holidaySet } from '../engine/holidays.ts';
import type { Cents } from '../engine/money.ts';
import { toCashFlows } from '../engine/flows.ts';
import { defaultHorizonEnd, maxSpendOn, project, type DayPoint } from '../engine/projection.ts';
import type { LedgerEntry } from '../import/ledger.ts';
import { netBalance, type Balances, type PlanConfig } from './config.ts';
import { monthlyBudgets, scenarioFlows } from './scenario.ts';

export interface NamedAmount {
  name: string;
  amount: Cents;
}

export interface CategorySpending extends NamedAmount {
  budget: Cents | null;
}

export type AlertLevel = 'critical' | 'warning' | 'info';

export interface DashboardData {
  today: ISODate;
  month: string;
  isCurrentMonth: boolean;
  scenarioLabel: string;
  /** Latest transaction date per account, so stale imports are visible. */
  dataUntil: Record<string, ISODate>;
  balances: Balances & { net: Cents; staleDays: number };
  actual: {
    income: Cents;
    spending: Cents;
    result: Cents;
    incomeBySource: NamedAmount[];
    spendingByCategory: CategorySpending[];
  };
  /** Current month only: what the plan still expects until the month ends. */
  monthEnd: { incomeLeft: Cents; spendingLeft: Cents; expectedResult: Cents } | null;
  safeToSpend: {
    amount: Cents;
    perDay: Cents;
    nextPayDate: ISODate | null;
    low: { date: ISODate; balance: Cents; floor: Cents };
    horizonEnd: ISODate;
  } | null;
  /** covered: every bill is paid and checking never goes below zero. reserveGap: how short of the reserve, once it applies. */
  nextMonth: {
    month: string;
    income: Cents;
    alreadyWorked: Cents;
    committed: Cents;
    free: Cents;
    covered: boolean;
    reserveGap: Cents | null;
  } | null;
  /** Lowest checking + cash balance ahead, with card bills paid on their due date. */
  cashLow: { date: ISODate; balance: Cents } | null;
  upcoming: { date: ISODate; label: string; amount: Cents }[];
  /** Projected balance from today to the horizon (current month only). */
  runway: DayPoint[];
  paydays: ISODate[];
  alerts: { level: AlertLevel; text: string }[];
  uncategorized: number;
}

const byAmountDesc = (a: NamedAmount, b: NamedAmount) => b.amount - a.amount;
const usd = (cents: Cents) => `$${Math.round(Math.abs(cents) / 100).toLocaleString('en-US')}`;
const shortDate = (date: ISODate) => {
  const { month, day } = parts(date);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]} ${day}`;
};

export function buildDashboard(input: {
  today: ISODate;
  month: string;
  config: PlanConfig;
  balances: Balances;
  ledger: LedgerEntry[];
}): DashboardData {
  const { today, month, config, balances, ledger } = input;
  const scenario = config.mainScenarios[0];
  const isCurrentMonth = month === monthKey(today);
  const net = netBalance(balances);
  const staleDays = Math.max(0, toDayNumber(today) - toDayNumber(balances.asOf));

  const dataUntil: Record<string, ISODate> = {};
  for (const entry of ledger) {
    if (!dataUntil[entry.account] || entry.date > dataUntil[entry.account]) dataUntil[entry.account] = entry.date;
  }

  // What really happened this month (transfers such as card payments never count).
  const monthEntries = ledger.filter((e) => monthKey(e.date) === month && e.kind !== 'transfer');
  const sum = (entries: LedgerEntry[]) => {
    const totals = new Map<string, Cents>();
    for (const e of entries) totals.set(e.category, (totals.get(e.category) ?? 0) + Math.abs(e.amount));
    return totals;
  };
  const incomeTotals = sum(monthEntries.filter((e) => e.kind === 'income'));
  const spendingTotals = sum(monthEntries.filter((e) => e.kind === 'expense'));
  const budgets = monthlyBudgets(config);
  const income = [...incomeTotals.values()].reduce((a, b) => a + b, 0);
  const spending = [...spendingTotals.values()].reduce((a, b) => a + b, 0);
  const categories = new Set([...spendingTotals.keys(), ...(isCurrentMonth ? Object.keys(budgets) : [])]);
  const actual = {
    income,
    spending,
    result: income - spending,
    incomeBySource: [...incomeTotals].map(([name, amount]) => ({ name, amount })).sort(byAmountDesc),
    spendingByCategory: [...categories]
      .map((name) => ({ name, amount: spendingTotals.get(name) ?? 0, budget: budgets[name] ?? null }))
      .sort((a, b) => b.amount - a.amount || (b.budget ?? 0) - (a.budget ?? 0)),
  };

  const uncategorized = monthEntries.filter((e) => e.category.startsWith('Uncategorized')).length;
  const alerts: DashboardData['alerts'] = [];

  if (!isCurrentMonth) {
    return {
      today,
      month,
      isCurrentMonth,
      scenarioLabel: scenario.label,
      dataUntil,
      balances: { ...balances, net, staleDays },
      actual,
      monthEnd: null,
      safeToSpend: null,
      nextMonth: null,
      cashLow: null,
      upcoming: [],
      runway: [],
      paydays: [],
      alerts: uncategorized ? [{ level: 'info', text: `${uncategorized} transactions without a category` }] : [],
      uncategorized,
    };
  }

  // The plan from the balance snapshot on: planned flows fill the days not covered by real data yet.
  const horizonEnd = defaultHorizonEnd(today);
  const { year, month: monthNumber } = parts(today);
  const next = addMonths(year, monthNumber, 1);
  const nextMonthEnd = endOfMonth(makeDate(next.year, next.month, 1));
  const flowsEnd = horizonEnd > nextMonthEnd ? horizonEnd : nextMonthEnd;
  const holidays = holidaySet(parts(balances.asOf).year, parts(flowsEnd).year);
  const { paychecks, flows } = scenarioFlows(config, scenario, { start: addDays(balances.asOf, 1), end: flowsEnd }, holidays);
  const floor = [{ from: config.reserve.from, amount: config.reserve.amount }];
  const projection = project({ asOf: balances.asOf, startBalance: net, flows, horizonEnd, floor });
  const fromToday = projection.points.filter((p) => p.date >= today);
  const low = fromToday.reduce((min, p) => (p.headroom < min.headroom ? p : min), fromToday[0]);
  const amount = maxSpendOn(projection, today);
  // Jobs come one after another in the list, so sort by date to find the next payday.
  const upcomingPaydays = paychecks.filter((p) => p.amount > 0 && p.payDate >= today).map((p) => p.payDate).sort();
  const nextPayDate = upcomingPaydays.find((date) => date > today) ?? null;
  const daysToPay = nextPayDate ? Math.max(1, toDayNumber(nextPayDate) - toDayNumber(today)) : 30;

  // Rest of this month according to the plan, after the last real data.
  const lastData = Object.values(dataUntil).sort().at(-1) ?? balances.asOf;
  const plannedFrom = lastData > today ? lastData : today;
  const monthEndDate = endOfMonth(today);
  const rest = flows.filter((f) => f.date > plannedFrom && f.date <= monthEndDate);
  const incomeLeft = rest.filter((f) => f.amount > 0).reduce((a, f) => a + f.amount, 0);
  const spendingLeft = rest.filter((f) => f.amount < 0).reduce((a, f) => a - f.amount, 0);

  // Next month: income (part of it already worked), what is committed, and whether the balance holds.
  const nextKey = monthKey(makeDate(next.year, next.month, 1));
  const nextFlows = flows.filter((f) => monthKey(f.date) === nextKey);
  const nextIncome = nextFlows.filter((f) => f.amount > 0).reduce((a, f) => a + f.amount, 0);
  const committed = nextFlows.filter((f) => f.amount < 0).reduce((a, f) => a - f.amount, 0);
  const alreadyWorked = paychecks
    .filter((p) => monthKey(p.payDate) === nextKey && p.period.end <= today)
    .reduce((a, p) => a + p.amount, 0);
  // Liquidity: checking + cash, with card purchases leaving checking on the card's due date.
  const cashFlows = toCashFlows(flows, { owed: balances.cardOwed, dueDay: balances.cardDueDay }, balances.asOf);
  const cashProjection = project({ asOf: balances.asOf, startBalance: balances.checking + balances.cash, flows: cashFlows, horizonEnd });
  const cashAhead = cashProjection.points.filter((p) => p.date >= today);
  const cashLow = cashAhead.reduce((min, p) => (p.balance < min.balance ? p : min), cashAhead[0]);
  const firstNegative = cashAhead.find((p) => p.balance < 0);
  const covered = nextIncome - committed >= 0 && cashAhead.filter((p) => monthKey(p.date) === nextKey).every((p) => p.balance >= 0);
  const reserveStart = config.reserve.from > today ? config.reserve.from : today;
  const reservePoints = projection.points.filter((p) => p.date >= reserveStart && p.date <= nextMonthEnd);
  const reserveGap = reservePoints.length
    ? Math.max(0, config.reserve.amount - Math.min(...reservePoints.map((p) => p.balance)))
    : null;

  const upcoming = flows
    .filter((f) => f.kind !== 'essential' && f.date > today && f.date <= addDays(today, 14))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((f) => ({ date: f.date, label: f.label, amount: f.amount }));

  if (firstNegative) {
    alerts.push({
      level: 'critical',
      text: `Checking goes negative on ${shortDate(firstNegative.date)} (lowest -${usd(cashLow.balance)} on ${shortDate(cashLow.date)}). Move a bill or wait for pay.`,
    });
  }
  const reserveTouched = fromToday.find((p) => p.floor > 0 && p.headroom < 0);
  if (reserveTouched) {
    alerts.push({ level: 'warning', text: `Reserve touched on ${shortDate(reserveTouched.date)}: ${usd(reserveTouched.balance)} of ${usd(reserveTouched.floor)}` });
  }
  if (amount === 0 && nextPayDate) alerts.push({ level: 'info', text: `Essentials only until the ${shortDate(nextPayDate)} paycheck` });
  for (const row of actual.spendingByCategory) {
    if (row.budget && row.amount > row.budget) {
      alerts.push({ level: 'warning', text: `${row.name}: ${usd(row.amount)} spent, budget ${usd(row.budget)}` });
    }
  }
  if (staleDays > 7) alerts.push({ level: 'warning', text: `Balances were last updated ${staleDays} days ago` });
  if (uncategorized) alerts.push({ level: 'info', text: `${uncategorized} transactions without a category` });

  return {
    today,
    month,
    isCurrentMonth,
    scenarioLabel: scenario.label,
    dataUntil,
    balances: { ...balances, net, staleDays },
    actual,
    monthEnd: { incomeLeft, spendingLeft, expectedResult: actual.result + incomeLeft - spendingLeft },
    safeToSpend: {
      amount,
      perDay: Math.floor(amount / daysToPay),
      nextPayDate,
      low: { date: low.date, balance: low.balance, floor: low.floor },
      horizonEnd,
    },
    nextMonth: { month: nextKey, income: nextIncome, alreadyWorked, committed, free: nextIncome - committed, covered, reserveGap },
    cashLow: { date: cashLow.date, balance: cashLow.balance },
    upcoming,
    runway: fromToday,
    paydays: [...new Set(upcomingPaydays.filter((date) => date <= horizonEnd))],
    alerts,
    uncategorized,
  };
}
