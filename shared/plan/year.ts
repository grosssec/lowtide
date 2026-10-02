import { addDays, addMonths, endOfMonth, makeDate, monthDay, monthKey, parts, type ISODate } from '../engine/dates.ts';
import { holidaySet } from '../engine/holidays.ts';
import type { Cents } from '../engine/money.ts';
import { defaultHorizonEnd, monthlySummary, project } from '../engine/projection.ts';
import type { Actuals, Bill, PlanConfig } from './config.ts';
import { forwardFlows } from './forward.ts';
import type { HoursBasis } from './hours.ts';
import { eventOccurrences, occurrences } from './periods.ts';

/** Months shown on the Plan screen, the current one included. */
export const PLAN_MONTHS = 12;
/** Goals further out than this are projected only this far. */
const MAX_GOAL_MONTHS = 36;

export interface GoalStatus {
  id: string;
  name: string;
  target: Cents;
  /** The goal's date, or the end of the plan when it has none. */
  date: ISODate;
  hasDate: boolean;
  /** Money above the reserve today that counts for this goal (goals fill in order). */
  now: Cents;
  /** Projected on the date, after the reserve and the goals before it. */
  projected: Cents;
  reached: boolean;
  shortBy: Cents;
  /** Extra saving per month that closes the gap by the date. */
  perMonth: Cents;
}

export interface TripRoom {
  label: string;
  start: ISODate;
  end: ISODate;
  /** Largest amount that can be spent from the trip's start while every day until `until` keeps the reserve. */
  room: Cents;
  until: ISODate;
}

export interface YearPlanData {
  today: ISODate;
  reserve: PlanConfig['reserve'];
  /** endBalance is the total (bank + cash − card) on the last day of the month, reserve included. */
  months: { month: string; income: Cents; spending: Cents; result: Cents; endBalance: Cents }[];
  hours: HoursBasis[];
  goals: GoalStatus[];
  trips: TripRoom[];
  /** Written from the plan itself, so they follow every change in Settings. */
  assumptions: string[];
  notes: string[];
}

const sum = (record: Record<string, Cents>) => Object.values(record).reduce((a, b) => a + b, 0);
const usd = (cents: Cents) => `$${Math.round(Math.abs(cents) / 100).toLocaleString('en-US')}`;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];

const monthsAhead = (from: ISODate, to: ISODate) => {
  const a = parts(from);
  const b = parts(to);
  return b.year * 12 + b.month - (a.year * 12 + a.month);
};

function endOfMonthsAhead(today: ISODate, months: number): ISODate {
  const { year, month } = parts(today);
  const target = addMonths(year, month, months);
  return endOfMonth(makeDate(target.year, target.month, 1));
}

function billWhen(bill: Bill): string {
  const when = bill.rule
    ? bill.rule.kind === 'nthBusinessDay'
      ? `${ORDINAL[bill.rule.n] ?? `${bill.rule.n}th`} business day`
      : `day ${bill.rule.day}`
    : `day ${bill.day}`;
  const off = bill.monthsOff?.length ? `, not in ${bill.monthsOff.map((m) => MONTH_NAMES[m - 1]).join('/')}` : '';
  return `${when}${off}`;
}

/** The forecast's assumptions, in words, from the plan as it is now. */
function describe(config: PlanConfig, hours: HoursBasis[], today: ISODate, until: ISODate): string[] {
  const thisYear = parts(today).year;
  const date = (d: ISODate) => (parts(d).year === thisYear ? monthDay(d) : `${monthDay(d)}, ${parts(d).year}`);
  // "Nov 25–29", "May 15 – Aug 5, 2027", "Dec 19 – Jan 3, 2027"
  const span = (start: ISODate, end: ISODate) => {
    if (start === end) return date(start);
    const a = parts(start);
    const b = parts(end);
    const year = b.year === thisYear ? '' : `, ${b.year}`;
    if (a.year !== b.year && a.year !== thisYear) return `${date(start)} – ${date(end)}`;
    if (a.year === b.year && a.month === b.month) return `${monthDay(start)}–${b.day}${year}`;
    return `${monthDay(start)} – ${monthDay(end)}${year}`;
  };
  const window = { start: today, end: until };
  const lines: string[] = [];

  const hoursText = hours
    .map((h) => `${h.jobName} ${h.weeklyHours} h/week (${h.source === 'timesheet' ? `average of your last ${h.weeks} weeks` : 'your usual hours'})`)
    .join('; ');
  if (hoursText) lines.push(`Pay from hours: ${hoursText}. Extra hours, freelance cash and money from people are never counted.`);

  const away = occurrences(config.away, window);
  if (away.length) lines.push(`No pay while away: ${away.map((a) => `${a.label} (${span(a.start, a.end)})`).join(', ')}.`);

  for (const job of config.jobs) {
    const closed = occurrences(job.closures ?? [], window);
    if (closed.length) lines.push(`${job.name} has no work: ${closed.map((c) => `${c.label} (${span(c.start, c.end)})`).join(', ')}.`);
    if (job.end && job.end >= today && job.end <= until) lines.push(`${job.name} ends on ${date(job.end)}.`);
  }

  if (config.bills.length) lines.push(`Bills: ${config.bills.map((b) => `${b.label} ${usd(b.amount)} (${billWhen(b)})`).join(', ')}.`);

  if (config.budgets.length) {
    const total = config.budgets.reduce((a, b) => a + b.monthly, 0);
    const lessOnTrips = config.budgets.filter((b) => b.lessOnTrips).map((b) => b.label.toLowerCase());
    const verb = lessOnTrips.length === 1 ? 'drops' : 'drop';
    const trips = config.away.some((a) => a.trip) && lessOnTrips.length ? `; on trips, ${lessOnTrips.join(', ')} ${verb} to a quarter` : '';
    lines.push(`Day-to-day budgets: ${usd(total)} a month${trips}.`);
  }

  const events = eventOccurrences(config.events, window);
  if (events.length) {
    lines.push(`One-offs: ${events.map((e) => `${e.label} ${e.amount < 0 ? '+' : ''}${usd(e.amount)} (${date(e.date)})`).join(', ')}.`);
  }

  lines.push(
    config.reserve.from > today
      ? `Reserve: ${usd(config.reserve.amount)} kept from ${date(config.reserve.from)} on.`
      : `Reserve: ${usd(config.reserve.amount)}, always kept.`,
  );
  return lines;
}

/**
 * The next 12 months from today's live balances, the savings goals (they fill in list order, after the reserve),
 * the room to spend on each trip, and the assumptions behind the numbers.
 */
export function buildYearPlan(config: PlanConfig, actuals: Actuals): YearPlanData {
  const today = actuals.today;
  const horizonEnd = endOfMonthsAhead(today, PLAN_MONTHS - 1);
  const goalLimit = endOfMonthsAhead(today, MAX_GOAL_MONTHS);
  const lastGoal = config.goals.map((g) => g.by ?? '').filter((d) => d > horizonEnd).sort().at(-1);
  const end = lastGoal ? (lastGoal < goalLimit ? lastGoal : goalLimit) : horizonEnd;

  const holidays = holidaySet(parts(today).year, parts(end).year);
  const floor = [{ from: config.reserve.from, amount: config.reserve.amount }];
  const { flows, hours } = forwardFlows(config, actuals, end, holidays);
  const projection = project({ asOf: today, startBalance: actuals.net, flows, horizonEnd: end, floor });
  const pointOn = new Map(projection.points.map((p) => [p.date, p]));
  const currentMonth = monthKey(today);

  const months = monthlySummary(flows, `${currentMonth}-01`, horizonEnd).map((m) => {
    const isCurrent = m.month === currentMonth;
    const income = m.income + (isCurrent ? sum(actuals.receivedThisMonth) : 0);
    const spending = m.spending + (isCurrent ? sum(actuals.spentThisMonth) : 0);
    const monthEnd = endOfMonth(`${m.month}-01`);
    return { month: m.month, income, spending, result: income - spending, endBalance: pointOn.get(monthEnd)?.balance ?? actuals.net };
  });

  // Goals fill in order: a goal counts only what is left after the reserve (always first) and the full targets before it.
  const reserve = config.reserve.amount;
  const freeNow = Math.max(0, actuals.net - reserve);
  let before = 0;
  const goals = config.goals.map((goal): GoalStatus => {
    const date = !goal.by || goal.by > end ? (goal.by ? end : horizonEnd) : goal.by < today ? today : goal.by;
    const point = pointOn.get(date) ?? projection.points[projection.points.length - 1];
    const projected = Math.min(goal.target, Math.max(0, point.balance - reserve - before));
    const now = Math.min(goal.target, Math.max(0, freeNow - before));
    before += goal.target;
    const shortBy = Math.max(0, goal.target - projected);
    const perMonth = shortBy === 0 ? 0 : Math.ceil(shortBy / Math.max(1, monthsAhead(today, date)) / 100) * 100;
    return { id: goal.id, name: goal.name, target: goal.target, date, hasDate: Boolean(goal.by), now, projected, reached: shortBy === 0, shortBy, perMonth };
  });

  const trips = occurrences(
    config.away.filter((a) => a.trip),
    { start: addDays(today, 1), end: horizonEnd },
  ).map((trip): TripRoom => {
    const from = trip.start > today ? trip.start : addDays(today, 1);
    const until = defaultHorizonEnd(trip.end) < end ? defaultHorizonEnd(trip.end) : end;
    const later = projection.points.filter((p) => p.date >= from && p.date <= until);
    const room = later.length ? Math.max(0, Math.min(...later.map((p) => p.headroom))) : 0;
    return { label: trip.label, start: trip.start, end: trip.end, room, until };
  });

  return {
    today,
    reserve: config.reserve,
    months,
    hours,
    goals,
    trips,
    assumptions: describe(config, hours, today, horizonEnd),
    notes: config.notes ?? [],
  };
}
