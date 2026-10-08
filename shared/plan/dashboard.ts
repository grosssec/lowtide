import { addDays, addMonths, endOfMonth, makeDate, monthDay, monthKey, parts, toDayNumber, type ISODate } from '../engine/dates.ts';
import { billFlows, toCashFlows } from '../engine/flows.ts';
import { holidaySet } from '../engine/holidays.ts';
import type { Cents } from '../engine/money.ts';
import { defaultHorizonEnd, project, type DayPoint } from '../engine/projection.ts';
import type { LedgerEntry } from '../import/ledger.ts';
import type { Actuals, PlanConfig } from './config.ts';
import { monthlyBudgets, planFlows } from './forecast.ts';
import { forwardFlows } from './forward.ts';
import type { HoursBasis } from './hours.ts';

export interface NamedAmount {
  name: string;
  amount: Cents;
}

export interface CategorySpending extends NamedAmount {
  /** The month's budget: a day-to-day budget, or the bill amount. Null when the category has none. */
  budget: Cents | null;
  kind: 'bill' | 'budget' | 'other';
  /** Bills only: when it is due this month, and whether spending in the category already covers it. */
  due?: ISODate;
  paid?: boolean;
}

/** Next month's income per job, and the hours per week it is counted with. */
export interface JobIncome extends HoursBasis {
  amount: Cents;
  paychecks: number;
}

export type AlertLevel = 'critical' | 'warning' | 'info';

export interface DashboardData {
  today: ISODate;
  month: string;
  isCurrentMonth: boolean;
  /** Latest transaction date per account, so stale data is visible. */
  dataUntil: Record<string, ISODate>;
  /** When each balance was last typed in or confirmed by a balance alert. */
  checkedOn: Actuals['checkedOn'];
  /** Safe to spend always keeps this much from `from` on; the balances above include it. */
  reserve: PlanConfig['reserve'];
  /** Live balances: last snapshot plus every transaction after it. */
  balances: { checking: Cents; cash: Cents; cardOwed: Cents; net: Cents };
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
    byJob: JobIncome[];
  } | null;
  /** Lowest checking + cash balance ahead, with card bills paid on their due date. */
  cashLow: { date: ISODate; balance: Cents } | null;
  /** late: a bill already due that is not in the books yet (counted once, tomorrow). */
  upcoming: { date: ISODate; label: string; amount: Cents; late?: boolean }[];
  /** Projected balance from today to the horizon (current month only). */
  runway: DayPoint[];
  paydays: ISODate[];
  alerts: { level: AlertLevel; text: string }[];
  uncategorized: number;
}

const byAmountDesc = (a: NamedAmount, b: NamedAmount) => b.amount - a.amount;
const usd = (cents: Cents) => `$${Math.round(Math.abs(cents) / 100).toLocaleString('en-US')}`;

/** Bank data older than this many days makes the numbers unreliable. */
const STALE_DAYS = 5;
/** The card comes in by a weekly CSV, so it gets a week before the reminder. */
const CARD_STALE_DAYS = 8;
const LATE = ' (not seen yet)';

export function buildDashboard(input: { month: string; config: PlanConfig; actuals: Actuals; ledger: LedgerEntry[] }): DashboardData {
  const { month, config, actuals, ledger } = input;
  const today = actuals.today;
  const isCurrentMonth = month === monthKey(today);
  const balances = { checking: actuals.checking, cash: actuals.cash, cardOwed: actuals.cardOwed, net: actuals.net };

  // What really happened in the month shown (transfers such as card payments never count).
  const monthEntries = ledger.filter((e) => monthKey(e.date) === month && e.kind !== 'transfer');
  const totals = (entries: LedgerEntry[], sign: 1 | -1) => {
    const map = new Map<string, Cents>();
    for (const e of entries) map.set(e.category, (map.get(e.category) ?? 0) + sign * e.amount);
    return map;
  };
  const incomeTotals = totals(monthEntries.filter((e) => e.kind === 'income'), 1);
  const spendingTotals = totals(monthEntries.filter((e) => e.kind === 'expense'), -1);
  const budgets = monthlyBudgets(config, month);
  const income = [...incomeTotals.values()].reduce((a, b) => a + b, 0);
  const spending = [...spendingTotals.values()].reduce((a, b) => a + b, 0);

  // Every budget of the month, plus any category with spending: bills first (by due date), then budgets, then the rest.
  const monthStartDate = `${month}-01`;
  const monthHolidays = holidaySet(parts(monthStartDate).year, parts(monthStartDate).year);
  const billsDue = new Map<string, { due: ISODate; amount: Cents }>();
  for (const bill of billFlows(config.bills, { start: monthStartDate, end: endOfMonth(monthStartDate) }, monthHolidays)) {
    const known = billsDue.get(bill.category);
    billsDue.set(bill.category, { due: known && known.due < bill.date ? known.due : bill.date, amount: (known?.amount ?? 0) - bill.amount });
  }
  const budgetCategories = new Set(config.budgets.map((b) => b.category));
  const rank = { bill: 0, budget: 1, other: 2 } as const;
  const spendingByCategory: CategorySpending[] = [...new Set([...Object.keys(budgets), ...spendingTotals.keys()])]
    .map((name) => {
      const amount = spendingTotals.get(name) ?? 0;
      const bill = budgetCategories.has(name) ? undefined : billsDue.get(name);
      if (bill) return { name, amount, budget: budgets[name] ?? bill.amount, kind: 'bill' as const, due: bill.due, paid: amount >= bill.amount * 0.8 };
      return { name, amount, budget: budgets[name] ?? null, kind: budgets[name] !== undefined ? ('budget' as const) : ('other' as const) };
    })
    .sort(
      (a, b) =>
        rank[a.kind] - rank[b.kind] ||
        (a.kind === 'bill' ? (a.due ?? '').localeCompare(b.due ?? '') : 0) ||
        (b.budget ?? 0) - (a.budget ?? 0) ||
        b.amount - a.amount,
    );
  const actual = {
    income,
    spending,
    result: income - spending,
    incomeBySource: [...incomeTotals].map(([name, amount]) => ({ name, amount })).sort(byAmountDesc),
    spendingByCategory,
  };

  const uncategorized = monthEntries.filter((e) => e.category.startsWith('Uncategorized')).length;
  const alerts: DashboardData['alerts'] = [];

  if (!isCurrentMonth) {
    return {
      today,
      month,
      isCurrentMonth,
      dataUntil: actuals.dataUntil,
      checkedOn: actuals.checkedOn,
      reserve: config.reserve,
      balances,
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

  // From today on: live balances plus what the plan still expects.
  const horizonEnd = defaultHorizonEnd(today);
  const { year, month: monthNumber } = parts(today);
  const next = addMonths(year, monthNumber, 1);
  const nextMonthEnd = endOfMonth(makeDate(next.year, next.month, 1));
  const flowsEnd = horizonEnd > nextMonthEnd ? horizonEnd : nextMonthEnd;
  const holidays = holidaySet(year, parts(flowsEnd).year);
  const { paychecks, flows, hours } = forwardFlows(config, actuals, flowsEnd, holidays);
  const floor = [{ from: config.reserve.from, amount: config.reserve.amount }];
  const projection = project({ asOf: today, startBalance: actuals.net, flows, horizonEnd, floor });
  const low = projection.low;
  const amount = projection.safeToSpend;
  // Jobs come one after another in the list, so sort by date to find the next payday.
  const upcomingPaydays = [...new Set(paychecks.filter((p) => p.amount > 0).map((p) => p.payDate))].sort();
  const nextPayDate = upcomingPaydays[0] ?? null;
  const daysToPay = nextPayDate ? Math.max(1, toDayNumber(nextPayDate) - toDayNumber(today)) : 30;

  // Rest of this month according to the plan (already adjusted for what was spent).
  const monthEndDate = endOfMonth(today);
  const rest = flows.filter((f) => f.date <= monthEndDate);
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
  const byJob: JobIncome[] = hours
    .map((basis) => {
      const checks = paychecks.filter((p) => p.jobId === basis.jobId && monthKey(p.payDate) === nextKey && p.amount > 0);
      return { ...basis, amount: checks.reduce((a, p) => a + p.amount, 0), paychecks: checks.length };
    })
    .filter((job) => job.paychecks > 0);

  // Liquidity: checking + cash, with card purchases leaving checking on the card's due date.
  const cashFlows = toCashFlows(flows, { owed: actuals.cardOwed, dueDay: actuals.cardDueDay }, today);
  const cashProjection = project({ asOf: today, startBalance: actuals.checking + actuals.cash, flows: cashFlows, horizonEnd });
  const cashLow = cashProjection.low;
  const firstNegative = cashProjection.points.find((p) => p.balance < 0);
  const covered = nextIncome - committed >= 0 && cashProjection.points.filter((p) => monthKey(p.date) === nextKey).every((p) => p.balance >= 0);
  const reserveStart = config.reserve.from > today ? config.reserve.from : today;
  const reservePoints = projection.points.filter((p) => p.date >= reserveStart && p.date <= nextMonthEnd);
  const reserveGap = reservePoints.length ? Math.max(0, config.reserve.amount - Math.min(...reservePoints.map((p) => p.balance))) : null;

  const upcoming = flows
    .filter((f) => f.kind !== 'essential' && f.date <= addDays(today, 14))
    .map((f) => ({ date: f.date, label: f.label, amount: f.amount, ...(f.label.endsWith(LATE) ? { late: true } : {}) }));

  if (firstNegative) {
    alerts.push({
      level: 'critical',
      text: `Checking goes negative on ${monthDay(firstNegative.date)} (lowest -${usd(cashLow.balance)} on ${monthDay(cashLow.date)}). Move a bill or wait for pay.`,
    });
  }
  const reserveTouched = projection.points.find((p) => p.floor > 0 && p.headroom < 0);
  if (reserveTouched) {
    const left = `${reserveTouched.balance < 0 ? '-' : ''}${usd(reserveTouched.balance)}`;
    alerts.push({ level: 'warning', text: `Reserve touched on ${monthDay(reserveTouched.date)}: ${left} of ${usd(reserveTouched.floor)}` });
  }
  if (amount === 0 && nextPayDate) alerts.push({ level: 'info', text: `Essentials only until the ${monthDay(nextPayDate)} paycheck` });
  for (const row of actual.spendingByCategory) {
    if (row.budget && row.amount > row.budget) alerts.push({ level: 'warning', text: `${row.name}: ${usd(row.amount)} spent, budget ${usd(row.budget)}` });
  }

  // Paychecks due by now: compare with what arrived under the job's name.
  const monthStart = `${monthKey(today)}-01`;
  const duePaychecks = planFlows(config, { start: monthStart, end: addDays(today, -2) }, holidays, actuals.hours).paychecks;
  for (const job of config.jobs) {
    const expected = duePaychecks.filter((p) => p.jobId === job.id).reduce((a, p) => a + p.amount, 0);
    if (expected <= 0) continue;
    const arrived = actuals.receivedThisMonth[job.name] ?? 0;
    if (arrived === 0) {
      const last = duePaychecks.filter((p) => p.jobId === job.id).at(-1);
      alerts.push({ level: 'info', text: `${job.name} paycheck (≈${usd(expected)}${last ? `, due ${monthDay(last.payDate)}` : ''}) not seen yet` });
    } else if (Math.abs(arrived - expected) > expected * 0.1) {
      alerts.push({ level: 'info', text: `${job.name} paid ${usd(arrived)} this month; the plan expected ${usd(expected)}. Check the hours.` });
    }
  }

  // A balance alert or a balance typed in also counts as fresh bank data.
  const lastBankData = [actuals.dataUntil.chase, actuals.checkedOn.checking].filter(Boolean).sort().at(-1);
  const bankAge = lastBankData ? toDayNumber(today) - toDayNumber(lastBankData) : null;
  if (bankAge === null || bankAge > STALE_DAYS) {
    alerts.push({
      level: 'warning',
      text: lastBankData ? `No bank data since ${monthDay(lastBankData)}: import a statement or check the email sync` : 'No bank data yet: import a statement',
    });
  }
  const lastCardData = [actuals.dataUntil.discover, actuals.checkedOn.cardOwed].filter(Boolean).sort().at(-1);
  if (lastCardData && toDayNumber(today) - toDayNumber(lastCardData) > CARD_STALE_DAYS) {
    alerts.push({ level: 'warning', text: `No card data since ${monthDay(lastCardData)}: import the Discover CSV` });
  }
  if (uncategorized) alerts.push({ level: 'info', text: `${uncategorized} transactions without a category` });

  return {
    today,
    month,
    isCurrentMonth,
    dataUntil: actuals.dataUntil,
    checkedOn: actuals.checkedOn,
    reserve: config.reserve,
    balances,
    actual,
    monthEnd: { incomeLeft, spendingLeft, expectedResult: actual.result + incomeLeft - spendingLeft },
    safeToSpend: {
      amount,
      perDay: Math.floor(amount / daysToPay),
      nextPayDate,
      low: { date: low.date, balance: low.balance, floor: low.floor },
      horizonEnd,
    },
    nextMonth: { month: nextKey, income: nextIncome, alreadyWorked, committed, free: nextIncome - committed, covered, reserveGap, byJob },
    cashLow: { date: cashLow.date, balance: cashLow.balance },
    upcoming,
    runway: projection.points,
    paydays: upcomingPaydays.filter((date) => date <= horizonEnd),
    alerts,
    uncategorized,
  };
}
