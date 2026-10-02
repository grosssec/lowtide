import { daysInMonth, makeDate, parts, type DateRange, type ISODate } from '../engine/dates.ts';
import type { OneOffEvent } from '../engine/flows.ts';
import type { Period, PlannedEvent } from './config.ts';

/** The same calendar date `years` later (Feb 29 becomes Feb 28). */
export function shiftYears(date: ISODate, years: number): ISODate {
  const { year, month, day } = parts(date);
  const target = year + years;
  return makeDate(target, month, Math.min(day, daysInMonth(target, month)));
}

/** How many years a yearly item repeats to reach `range` (never before its first date). */
function yearSpan(first: ISODate, range: DateRange): number[] {
  const from = Math.max(0, parts(range.start).year - parts(first).year - 1);
  const to = parts(range.end).year - parts(first).year;
  const years: number[] = [];
  for (let k = from; k <= to; k++) years.push(k);
  return years;
}

/** Every dated occurrence of the periods that touches `range`; yearly ones repeat from their first year on. */
export function occurrences<T extends Period>(periods: T[], range: DateRange): (T & DateRange)[] {
  const found: (T & DateRange)[] = [];
  for (const period of periods) {
    for (const k of period.yearly ? yearSpan(period.from, range) : [0]) {
      const start = shiftYears(period.from, k);
      const end = shiftYears(period.to, k);
      if (end >= range.start && start <= range.end) found.push({ ...period, start, end });
    }
  }
  return found.sort((a, b) => a.start.localeCompare(b.start));
}

/** One-off events inside `range`, with yearly ones repeated. */
export function eventOccurrences(events: PlannedEvent[], range: DateRange): OneOffEvent[] {
  const found: OneOffEvent[] = [];
  for (const event of events) {
    for (const k of event.yearly ? yearSpan(event.date, range) : [0]) {
      const date = shiftYears(event.date, k);
      if (date >= range.start && date <= range.end) found.push({ ...event, date });
    }
  }
  return found.sort((a, b) => a.date.localeCompare(b.date));
}
