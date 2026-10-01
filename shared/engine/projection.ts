import { addMonths, eachDay, endOfMonth, makeDate, monthKey, parts, type ISODate } from './dates.ts';
import type { Flow } from './flows.ts';
import type { Cents } from './money.ts';

/** Minimum balance to protect, effective from a date (e.g. the reserve once it should exist). */
export interface FloorStep {
  from: ISODate;
  amount: Cents;
}

export interface ProjectionInput {
  /** Balance at the end of asOf. Flows dated on or before asOf are treated as already included. */
  asOf: ISODate;
  startBalance: Cents;
  flows: Flow[];
  horizonEnd: ISODate;
  floor?: FloorStep[];
}

export interface DayPoint {
  date: ISODate;
  balance: Cents;
  floor: Cents;
  /** balance − floor */
  headroom: Cents;
}

export interface Projection {
  points: DayPoint[];
  /** The tightest day: smallest headroom (first one if tied). */
  low: DayPoint;
  /** What can be spent today while every day up to the horizon stays above the floor. */
  safeToSpend: Cents;
}

export function floorOn(date: ISODate, floor: FloorStep[] = []): Cents {
  let amount = 0;
  for (const step of [...floor].sort((a, b) => a.from.localeCompare(b.from))) {
    if (step.from <= date) amount = step.amount;
  }
  return amount;
}

export function project(input: ProjectionInput): Projection {
  if (input.horizonEnd < input.asOf) throw new Error('horizonEnd is before asOf');
  const net = new Map<ISODate, Cents>();
  for (const flow of input.flows) {
    if (flow.date > input.asOf && flow.date <= input.horizonEnd) net.set(flow.date, (net.get(flow.date) ?? 0) + flow.amount);
  }
  const points: DayPoint[] = [];
  let balance = input.startBalance;
  for (const date of eachDay(input.asOf, input.horizonEnd)) {
    balance += net.get(date) ?? 0;
    const floor = floorOn(date, input.floor);
    points.push({ date, balance, floor, headroom: balance - floor });
  }
  const low = points.reduce((min, point) => (point.headroom < min.headroom ? point : min));
  return { points, low, safeToSpend: Math.max(0, low.headroom) };
}

/** Largest one-off spend on `date` that keeps every later day (up to the horizon) above the floor. */
export function maxSpendOn(projection: Projection, date: ISODate): Cents {
  const later = projection.points.filter((point) => point.date >= date);
  if (later.length === 0) return 0;
  return Math.max(0, Math.min(...later.map((point) => point.headroom)));
}

/** End of next month. In November the horizon stretches to Jan 31, so the holidays never eat January. */
export function defaultHorizonEnd(asOf: ISODate): ISODate {
  const { year, month } = parts(asOf);
  if (month === 11) return makeDate(year + 1, 1, 31);
  const next = addMonths(year, month, 1);
  return endOfMonth(makeDate(next.year, next.month, 1));
}

export interface MonthSummary {
  month: string;
  income: Cents;
  /** Positive number. */
  spending: Cents;
  result: Cents;
  incomeBySource: Record<string, Cents>;
  spendingByCategory: Record<string, Cents>;
}

/** Money in vs out per calendar month (accrual: card purchases count when made). */
export function monthlySummary(flows: Flow[], from: ISODate, to: ISODate): MonthSummary[] {
  const months = new Map<string, MonthSummary>();
  const start = parts(from);
  const end = parts(to);
  for (let m = { year: start.year, month: start.month }; m.year * 12 + m.month <= end.year * 12 + end.month; m = addMonths(m.year, m.month, 1)) {
    const key = monthKey(makeDate(m.year, m.month, 1));
    months.set(key, { month: key, income: 0, spending: 0, result: 0, incomeBySource: {}, spendingByCategory: {} });
  }
  for (const flow of flows) {
    if (flow.date < from || flow.date > to) continue;
    const summary = months.get(monthKey(flow.date));
    if (!summary) continue;
    if (flow.amount >= 0) {
      summary.income += flow.amount;
      summary.incomeBySource[flow.category] = (summary.incomeBySource[flow.category] ?? 0) + flow.amount;
    } else {
      summary.spending -= flow.amount;
      summary.spendingByCategory[flow.category] = (summary.spendingByCategory[flow.category] ?? 0) - flow.amount;
    }
    summary.result += flow.amount;
  }
  return [...months.values()];
}
