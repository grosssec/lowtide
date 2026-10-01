import { addDays, dayOfWeek, daysInMonth, makeDate, type ISODate } from './dates.ts';

/** n-th weekday of a month, e.g. the 4th Thursday of November. weekday: 0 = Sunday. */
function nthWeekday(year: number, month: number, weekday: number, n: number): ISODate {
  const first = makeDate(year, month, 1);
  const offset = (weekday - dayOfWeek(first) + 7) % 7;
  return addDays(first, offset + (n - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number): ISODate {
  const last = makeDate(year, month, daysInMonth(year, month));
  return addDays(last, -((dayOfWeek(last) - weekday + 7) % 7));
}

/** Fixed-date holidays move to Friday when they fall on Saturday, to Monday on Sunday. */
function observed(date: ISODate): ISODate {
  const dow = dayOfWeek(date);
  if (dow === 6) return addDays(date, -1);
  if (dow === 0) return addDays(date, 1);
  return date;
}

/** US federal holidays (observed dates) for one calendar year. */
export function usFederalHolidays(year: number): ISODate[] {
  return [
    observed(makeDate(year, 1, 1)), // New Year's Day
    nthWeekday(year, 1, 1, 3), // Martin Luther King Jr. Day
    nthWeekday(year, 2, 1, 3), // Washington's Birthday
    lastWeekday(year, 5, 1), // Memorial Day
    observed(makeDate(year, 6, 19)), // Juneteenth
    observed(makeDate(year, 7, 4)), // Independence Day
    nthWeekday(year, 9, 1, 1), // Labor Day
    nthWeekday(year, 10, 1, 2), // Columbus Day
    observed(makeDate(year, 11, 11)), // Veterans Day
    nthWeekday(year, 11, 4, 4), // Thanksgiving
    observed(makeDate(year, 12, 25)), // Christmas
  ];
}

/** Holidays for every year in the span, plus one year each side (observed dates can cross New Year). */
export function holidaySet(fromYear: number, toYear: number): Set<ISODate> {
  const set = new Set<ISODate>();
  for (let year = fromYear - 1; year <= toYear + 1; year++) {
    for (const holiday of usFederalHolidays(year)) set.add(holiday);
  }
  return set;
}

export function isBusinessDay(date: ISODate, holidays: ReadonlySet<ISODate>): boolean {
  const dow = dayOfWeek(date);
  return dow !== 0 && dow !== 6 && !holidays.has(date);
}

export function rollToBusinessDay(
  date: ISODate,
  direction: 'forward' | 'backward',
  holidays: ReadonlySet<ISODate>,
): ISODate {
  const step = direction === 'forward' ? 1 : -1;
  let day = date;
  while (!isBusinessDay(day, holidays)) day = addDays(day, step);
  return day;
}

export function nthBusinessDay(year: number, month: number, n: number, holidays: ReadonlySet<ISODate>): ISODate {
  let count = 0;
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    const date = makeDate(year, month, day);
    if (isBusinessDay(date, holidays) && ++count === n) return date;
  }
  throw new Error(`${year}-${month} has fewer than ${n} business days`);
}
