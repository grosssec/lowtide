import { addDays, monthKey, parts, type DateRange, type ISODate } from '../engine/dates.ts';
import { billFlows, essentialFlows, eventFlows, paycheckFlows, type DailyEssential, type Flow } from '../engine/flows.ts';
import { paychecksBetween, type Paycheck } from '../engine/schedule.ts';
import type { LoggedHours, PlanConfig } from './config.ts';
import { jobHoursPlan, weeklyHoursBasis, type HoursBasis } from './hours.ts';
import { eventOccurrences, occurrences } from './periods.ts';

export interface Forecast {
  paychecks: Paycheck[];
  flows: Flow[];
  /** Hours per week each job is counted with. */
  hours: HoursBasis[];
}

/** Budgets in engine form: the ones marked lessOnTrips drop to a quarter during trips. */
export function budgetsWithTrips(config: PlanConfig, range: DateRange): DailyEssential[] {
  const trips = occurrences(
    config.away.filter((period) => period.trip),
    range,
  );
  return config.budgets.map(({ lessOnTrips, ...budget }) => ({
    ...budget,
    ...(lessOnTrips && trips.length ? { adjustments: trips.map((trip) => ({ range: { start: trip.start, end: trip.end }, factor: 0.25 })) } : {}),
  }));
}

/**
 * The one forecast: paychecks from hours (logged days as they are, the rest at each job's weekly basis,
 * nothing while away or closed), bills, day-to-day budgets and one-off events dated inside `range`.
 */
export function planFlows(config: PlanConfig, range: DateRange, holidays: ReadonlySet<ISODate>, logged?: LoggedHours): Forecast {
  // Pay periods start up to two months before their pay date.
  const window = { start: addDays(range.start, -62), end: range.end };
  const hours = config.jobs.map((job) => weeklyHoursBasis(job, config.away, logged?.[job.id], holidays));
  const paychecks = config.jobs
    .flatMap((job, i) =>
      paychecksBetween(job, jobHoursPlan(job, config.away, logged?.[job.id], hours[i].weeklyHours, window), range.start, range.end, holidays),
    )
    .sort((a, b) => a.payDate.localeCompare(b.payDate));
  const flows = [
    ...paycheckFlows(paychecks),
    ...billFlows(config.bills, range, holidays),
    ...essentialFlows(budgetsWithTrips(config, range), range),
    ...eventFlows(eventOccurrences(config.events, range), range),
  ];
  return { paychecks, flows, hours };
}

/** Monthly budget per category: day-to-day budgets plus the bills due that month (all bills when no month is given). */
export function monthlyBudgets(config: PlanConfig, month?: string): Record<string, number> {
  const budgets: Record<string, number> = {};
  for (const item of config.budgets) budgets[item.category] = (budgets[item.category] ?? 0) + item.monthly;
  for (const bill of config.bills) {
    if (month) {
      const { month: m } = parts(`${month}-01`);
      if (bill.monthsOff?.includes(m)) continue;
      if (bill.from && monthKey(bill.from) > month) continue;
      if (bill.until && monthKey(bill.until) < month) continue;
    }
    budgets[bill.category] = (budgets[bill.category] ?? 0) + bill.amount;
  }
  return budgets;
}
