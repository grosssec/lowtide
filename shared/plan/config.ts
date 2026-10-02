import { monthKey, type ISODate } from '../engine/dates.ts';
import type { DailyEssential, MonthlyBill, OneOffEvent } from '../engine/flows.ts';
import type { Cents } from '../engine/money.ts';
import type { Job } from '../engine/schedule.ts';
import type { LedgerEntry } from '../import/ledger.ts';

/** A stretch of days, optionally on the same dates every year (a break, the summer). */
export interface Period {
  label: string;
  from: ISODate;
  to: ISODate;
  yearly?: boolean;
}

/** Time away: no job pays while away. On a trip, everyday budgets (groceries, snacks, eating out) drop to a quarter. */
export interface AwayPeriod extends Period {
  trip?: boolean;
}

/** A job with its pay schedule and the hours it usually has. */
export interface JobConfig extends Job {
  /** Usual hours per week, used until the timesheet shows enough weeks. */
  weeklyHours: number;
  /** The forecast never counts more than this per week: extra hours stay extra. Defaults to weeklyHours. */
  maxWeeklyHours?: number;
  /** When the usual hours last changed: only weeks from this date on teach the forecast. */
  hoursSince?: ISODate;
  /** Usual hours before hoursSince, for paychecks that still pay for those days. */
  previousWeeklyHours?: number;
  /** Days of the week worked (0 = Sunday). Defaults to Monday to Friday. */
  workDays?: number[];
  /** No work on US federal holidays (e.g. a campus job). */
  skipHolidays?: boolean;
  /** When this job has no work, e.g. the campus store closed in summer. */
  closures?: Period[];
  start?: ISODate;
  end?: ISODate;
}

/** A savings goal. The list order is the priority: earlier goals get the money first. */
export interface Goal {
  id: string;
  name: string;
  target: Cents;
  by?: ISODate;
}

/** Day-to-day budget for one category, spread over the month. */
export type Budget = Omit<DailyEssential, 'adjustments'> & {
  /** Drops to a quarter during trips (you are not buying groceries at home). */
  lessOnTrips?: boolean;
};

export type Bill = MonthlyBill;

/** A one-off expense (or income, when negative), optionally on the same date every year. */
export type PlannedEvent = OneOffEvent & { yearly?: boolean };

export interface PlanConfig {
  version: 2;
  /** Money that is never available to spend, from a date on. */
  reserve: { amount: Cents; from: ISODate };
  goals: Goal[];
  jobs: JobConfig[];
  away: AwayPeriod[];
  /** Bill categories should not overlap with budget categories (spending in a category pays the bill first). */
  bills: Bill[];
  budgets: Budget[];
  events: PlannedEvent[];
  /** Free-form reminders shown on the Plan screen. */
  notes?: string[];
}

export interface Snapshot {
  amount: Cents;
  asOf: ISODate;
  /** ISO date-time in UTC when the balance was read (a balance alert, or typed in today). Without it, the whole day is included. */
  at?: string;
}

/** What was in each account at the end of a given day: typed in from the bank apps, or from a balance alert. */
export interface Balances {
  /** Available balance (pending purchases already taken out), as the bank app shows it. */
  checking: Snapshot;
  cash: Snapshot;
  /** What the card owes (positive): the current balance, posted charges only. */
  cardOwed: Snapshot;
  cardDueDay: number;
}

/** Hours logged per job (from the timesheets): they replace the plan for every date up to `through`. */
export type LoggedHours = Record<string, { actuals: Record<ISODate, number>; through: ISODate }>;

/** Where things stand today: live balances and what already happened this month. */
export interface Actuals {
  today: ISODate;
  checking: Cents;
  cash: Cents;
  cardOwed: Cents;
  net: Cents;
  /** Spending and income already in the books this month, per category (transfers excluded). */
  spentThisMonth: Record<string, Cents>;
  receivedThisMonth: Record<string, Cents>;
  /** Latest transaction date per account. */
  dataUntil: Record<string, ISODate>;
  /** When each balance was last typed in or confirmed by a balance alert. */
  checkedOn: { checking: ISODate; cash: ISODate; cardOwed: ISODate };
  cardDueDay: number;
  hours?: LoggedHours;
}

const ACCOUNT_KIND: Record<string, 'checking' | 'card' | 'cash'> = { chase: 'checking', discover: 'card', cash: 'cash' };

/** Did this happen after the balance was read? Same-day entries count only when both times are known and it came later. */
const after = (snapshot: Snapshot, date: ISODate, at: string | undefined) =>
  date > snapshot.asOf || (date === snapshot.asOf && Boolean(snapshot.at && at && at > snapshot.at));

/**
 * Live balances: each snapshot plus every transaction after it (up to today).
 * Checking and cash snapshots are available balances (pending purchases already out), so they count by
 * transaction date; the card snapshot is the posted balance, so card rows count by posting date.
 * Card purchases raise what the card owes; card payments lower it.
 */
export function computeActuals(balances: Balances, ledger: LedgerEntry[], today: ISODate, hours?: LoggedHours): Actuals {
  let checking = balances.checking.amount;
  let cash = balances.cash.amount;
  let cardOwed = balances.cardOwed.amount;
  const spentThisMonth: Record<string, Cents> = {};
  const receivedThisMonth: Record<string, Cents> = {};
  const dataUntil: Record<string, ISODate> = {};
  const month = monthKey(today);

  for (const entry of ledger) {
    if (!dataUntil[entry.account] || entry.date > dataUntil[entry.account]) dataUntil[entry.account] = entry.date;
    const posted = entry.postedDate || entry.date;
    const kind = ACCOUNT_KIND[entry.account];
    if (entry.date <= today) {
      if (kind === 'checking' && after(balances.checking, entry.date, entry.at)) checking += entry.amount;
      if (kind === 'cash' && after(balances.cash, entry.date, entry.at)) cash += entry.amount;
    }
    if (kind === 'card' && posted <= today && after(balances.cardOwed, posted, entry.at)) cardOwed -= entry.amount;
    if (entry.kind !== 'transfer' && entry.date <= today && monthKey(entry.date) === month) {
      if (entry.kind === 'expense') spentThisMonth[entry.category] = (spentThisMonth[entry.category] ?? 0) - entry.amount;
      else receivedThisMonth[entry.category] = (receivedThisMonth[entry.category] ?? 0) + entry.amount;
    }
  }

  return {
    today,
    checking,
    cash,
    cardOwed,
    net: checking + cash - cardOwed,
    spentThisMonth,
    receivedThisMonth,
    dataUntil,
    checkedOn: { checking: balances.checking.asOf, cash: balances.cash.asOf, cardOwed: balances.cardOwed.asOf },
    cardDueDay: balances.cardDueDay,
    ...(hours ? { hours } : {}),
  };
}
