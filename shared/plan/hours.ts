import { addDays, dayOfWeek, eachDay, isWithin, type DateRange, type ISODate } from '../engine/dates.ts';
import type { HoursPlan } from '../engine/schedule.ts';
import type { AwayPeriod, JobConfig, LoggedHours } from './config.ts';
import { occurrences } from './periods.ts';

/** How the forecast counts a job's hours from now on. */
export interface HoursBasis {
  jobId: string;
  jobName: string;
  weeklyHours: number;
  /** 'timesheet': the average of the last `weeks` logged weeks; 'usual': the job's usual hours (not enough logged weeks yet). */
  source: 'timesheet' | 'usual';
  weeks: number;
}

/** Weeks averaged, and the minimum before the timesheet replaces the usual hours. */
const LEARN_WEEKS = 6;
const MIN_WEEKS = 2;
const LOOK_BACK_WEEKS = 26;
const WEEKDAYS = [1, 2, 3, 4, 5];

/** Days a job can't have work: its closures and time away. */
export function offDays(job: JobConfig, away: AwayPeriod[], range: DateRange): DateRange[] {
  return [...occurrences(job.closures ?? [], range), ...occurrences(away, range)];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Hours per week the forecast uses: the average of the last full weeks in the timesheet (Monday to Sunday,
 * weeks with time away, closures or holidays left out), capped at the job's maximum so extra hours stay extra.
 * With fewer than two such weeks, the usual hours.
 */
export function weeklyHoursBasis(
  job: JobConfig,
  away: AwayPeriod[],
  logged: LoggedHours[string] | undefined,
  holidays: ReadonlySet<ISODate>,
): HoursBasis {
  const cap = job.maxWeeklyHours ?? job.weeklyHours;
  const usual: HoursBasis = { jobId: job.id, jobName: job.name, weeklyHours: Math.min(job.weeklyHours, cap), source: 'usual', weeks: 0 };
  if (!logged) return usual;

  // The last Sunday on or before the last logged day closes the newest full week.
  let weekEnd = logged.through;
  while (dayOfWeek(weekEnd) !== 0) weekEnd = addDays(weekEnd, -1);
  // Weeks before the usual hours changed, before the job started or before the timesheet has any day don't teach anything.
  const firstLogged = Object.keys(logged.actuals).sort()[0];
  const earliest = [job.hoursSince, job.start, firstLogged].filter(Boolean).sort().at(-1) ?? '0000-01-01';
  const off = offDays(job, away, { start: addDays(weekEnd, -7 * LOOK_BACK_WEEKS), end: weekEnd });
  const workDays = job.workDays ?? WEEKDAYS;

  const totals: number[] = [];
  for (let w = 0; w < LOOK_BACK_WEEKS && totals.length < LEARN_WEEKS; w++) {
    const end = addDays(weekEnd, -7 * w);
    const start = addDays(end, -6);
    if (start < earliest) break;
    const days = eachDay(start, end);
    const unusual = days.some(
      (day) => off.some((range) => isWithin(day, range)) || (job.skipHolidays && holidays.has(day) && workDays.includes(dayOfWeek(day))),
    );
    if (unusual) continue;
    totals.push(days.reduce((sum, day) => sum + (logged.actuals[day] ?? 0), 0));
  }
  if (totals.length < MIN_WEEKS) return usual;
  const average = totals.reduce((a, b) => a + b, 0) / totals.length;
  return { ...usual, weeklyHours: round1(Math.min(average, cap)), source: 'timesheet', weeks: totals.length };
}

/** The engine's hours plan for one job: the weekly basis, minus closures and time away, with logged days as they are. */
export function jobHoursPlan(
  job: JobConfig,
  away: AwayPeriod[],
  logged: LoggedHours[string] | undefined,
  weeklyHours: number,
  range: DateRange,
): HoursPlan {
  const from = job.start ?? '0000-01-01';
  const until = job.end ? { to: job.end } : {};
  const changed = job.hoursSince && job.previousWeeklyHours !== undefined && job.hoursSince > from;
  return {
    segments: changed
      ? [
          { from, to: addDays(job.hoursSince!, -1), weeklyHours: job.previousWeeklyHours! },
          { from: job.hoursSince!, ...until, weeklyHours },
        ]
      : [{ from, ...until, weeklyHours }],
    ...(job.workDays ? { workDays: job.workDays } : {}),
    ...(job.skipHolidays ? { skipHolidays: true } : {}),
    closures: offDays(job, away, range),
    ...(logged ? { actuals: logged.actuals, actualsThrough: logged.through } : {}),
  };
}
