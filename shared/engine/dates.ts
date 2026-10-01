/** Calendar dates as ISO strings (YYYY-MM-DD). All math is UTC, so time zones never shift a day. */
export type ISODate = string;

/** Inclusive on both ends. */
export interface DateRange {
  start: ISODate;
  end: ISODate;
}

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function makeDate(year: number, month: number, day: number): ISODate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parts(date: ISODate): { year: number; month: number; day: number } {
  if (!ISO_DATE.test(date)) throw new Error(`Invalid ISO date: ${date}`);
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

export function toDayNumber(date: ISODate): number {
  const { year, month, day } = parts(date);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function fromDayNumber(dayNumber: number): ISODate {
  const d = new Date(dayNumber * DAY_MS);
  return makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export const addDays = (date: ISODate, days: number): ISODate => fromDayNumber(toDayNumber(date) + days);

/** 0 = Sunday … 6 = Saturday */
export const dayOfWeek = (date: ISODate): number => new Date(toDayNumber(date) * DAY_MS).getUTCDay();

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** YYYY-MM */
export const monthKey = (date: ISODate): string => date.slice(0, 7);

export function endOfMonth(date: ISODate): ISODate {
  const { year, month } = parts(date);
  return makeDate(year, month, daysInMonth(year, month));
}

export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const days: ISODate[] = [];
  for (let n = toDayNumber(start), last = toDayNumber(end); n <= last; n++) days.push(fromDayNumber(n));
  return days;
}

export const isWithin = (date: ISODate, range: DateRange): boolean => date >= range.start && date <= range.end;

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sep 16" */
export function monthDay(date: ISODate): string {
  const { month, day } = parts(date);
  return `${MONTH_ABBR[month - 1]} ${day}`;
}
