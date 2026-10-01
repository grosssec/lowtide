import { addMonths, dayOfWeek, daysInMonth, eachDay, isWithin, makeDate, parts, type DateRange, type ISODate } from './dates.ts';
import { nthBusinessDay, rollToBusinessDay } from './holidays.ts';
import type { Cents } from './money.ts';

export interface RateChange {
  from: ISODate;
  /** Net pay per hour: what actually lands in the account. */
  centsPerHour: Cents;
}

export type PayDateRule =
  | { kind: 'dayOfMonth'; day: number; roll: 'forward' | 'backward' | 'none' }
  | { kind: 'nthBusinessDay'; n: number };

/** Hours worked from startDay to endDay of month M are paid in month M + payMonthOffset. */
export interface PeriodTemplate {
  startDay: number;
  endDay: number | 'end';
  payMonthOffset: number;
  payDate: PayDateRule;
}

export interface Job {
  id: string;
  name: string;
  rates: RateChange[];
  periods: PeriodTemplate[];
}

export interface HoursSegment {
  from: ISODate;
  to?: ISODate;
  weeklyHours: number;
}

export interface HoursPlan {
  /** Planned weekly hours. When segments overlap, the later one wins. */
  segments: HoursSegment[];
  /** Days of the week worked (0 = Sunday); weekly hours are split evenly across them. */
  workDays?: number[];
  /** Skip US federal holidays (e.g. a campus job). */
  skipHolidays?: boolean;
  /** Days without work: closures, trips. */
  closures?: DateRange[];
  /** Logged hours by date. They replace the plan for every date up to actualsThrough. */
  actuals?: Record<ISODate, number>;
  actualsThrough?: ISODate;
}

export interface Paycheck {
  jobId: string;
  jobName: string;
  period: DateRange;
  payDate: ISODate;
  hours: number;
  amount: Cents;
}

const WEEKDAYS = [1, 2, 3, 4, 5];

export function plannedHoursOn(date: ISODate, plan: HoursPlan, holidays: ReadonlySet<ISODate>): number {
  if (plan.actualsThrough && date <= plan.actualsThrough) return plan.actuals?.[date] ?? 0;
  const workDays = plan.workDays ?? WEEKDAYS;
  if (!workDays.includes(dayOfWeek(date))) return 0;
  if (plan.skipHolidays && holidays.has(date)) return 0;
  if (plan.closures?.some((range) => isWithin(date, range))) return 0;
  let weekly = 0;
  for (const segment of plan.segments) {
    if (date >= segment.from && (!segment.to || date <= segment.to)) weekly = segment.weeklyHours;
  }
  return weekly / workDays.length;
}

export function rateOn(date: ISODate, job: Job): Cents {
  let rate = 0;
  for (const change of [...job.rates].sort((a, b) => a.from.localeCompare(b.from))) {
    if (change.from <= date) rate = change.centsPerHour;
  }
  return rate;
}

export function resolvePayDate(
  year: number,
  month: number,
  rule: PayDateRule,
  holidays: ReadonlySet<ISODate>,
): ISODate {
  if (rule.kind === 'nthBusinessDay') return nthBusinessDay(year, month, rule.n, holidays);
  const date = makeDate(year, month, Math.min(rule.day, daysInMonth(year, month)));
  return rule.roll === 'none' ? date : rollToBusinessDay(date, rule.roll, holidays);
}

function periodRange(year: number, month: number, template: PeriodTemplate): DateRange {
  const last = daysInMonth(year, month);
  const end = template.endDay === 'end' ? last : Math.min(template.endDay, last);
  return { start: makeDate(year, month, template.startDay), end: makeDate(year, month, end) };
}

/** Every paycheck of a job whose pay date falls inside [from, to]. */
export function paychecksBetween(
  job: Job,
  plan: HoursPlan,
  from: ISODate,
  to: ISODate,
  holidays: ReadonlySet<ISODate>,
): Paycheck[] {
  const maxOffset = Math.max(0, ...job.periods.map((p) => p.payMonthOffset));
  const first = parts(from);
  const last = parts(to);
  const paychecks: Paycheck[] = [];
  // Start a month early: a pay date can roll forward into the next month.
  let month = addMonths(first.year, first.month, -maxOffset - 1);
  while (month.year * 12 + month.month <= last.year * 12 + last.month) {
    for (const template of job.periods) {
      const payMonth = addMonths(month.year, month.month, template.payMonthOffset);
      const payDate = resolvePayDate(payMonth.year, payMonth.month, template.payDate, holidays);
      if (payDate < from || payDate > to) continue;
      const period = periodRange(month.year, month.month, template);
      let hours = 0;
      let amount = 0;
      for (const day of eachDay(period.start, period.end)) {
        const dayHours = plannedHoursOn(day, plan, holidays);
        hours += dayHours;
        amount += dayHours * rateOn(day, job);
      }
      paychecks.push({
        jobId: job.id,
        jobName: job.name,
        period,
        payDate,
        hours: Math.round(hours * 100) / 100,
        amount: Math.round(amount),
      });
    }
    month = addMonths(month.year, month.month, 1);
  }
  return paychecks.sort((a, b) => a.payDate.localeCompare(b.payDate));
}
