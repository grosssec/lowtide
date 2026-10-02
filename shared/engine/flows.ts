import { addMonths, daysInMonth, eachDay, isWithin, makeDate, monthDay, parts, type DateRange, type ISODate } from './dates.ts';
import type { Cents } from './money.ts';
import { resolvePayDate, type PayDateRule, type Paycheck } from './schedule.ts';

export type PaidWith = 'checking' | 'cash' | 'card';
export type FlowKind = 'income' | 'bill' | 'essential' | 'event';

/** A dated money movement: income is positive, spending negative. */
export interface Flow {
  date: ISODate;
  amount: Cents;
  label: string;
  category: string;
  kind: FlowKind;
  paidWith: PaidWith;
}

interface BillDetails {
  label: string;
  category: string;
  amount: Cents;
  from?: ISODate;
  until?: ISODate;
  /** Months without the bill (1 = January), e.g. no rent in the summer. */
  monthsOff?: number[];
  paidWith?: PaidWith;
}

/**
 * A fixed day of the month (clamped to the month's last day), or a date rule,
 * e.g. rent paid on the same 5th business day a paycheck lands.
 */
export type MonthlyBill = BillDetails & ({ day: number; rule?: never } | { rule: PayDateRule; day?: never });

export interface DailyEssential {
  label: string;
  category: string;
  /** Typical monthly spend, spread evenly over the days. */
  monthly: Cents;
  /** Scales the daily amount inside a range, e.g. 0.25 while travelling. */
  adjustments?: { range: DateRange; factor: number }[];
  paidWith?: PaidWith;
}

export interface OneOffEvent {
  date: ISODate;
  label: string;
  category: string;
  /** Positive = money out, negative = money in. */
  amount: Cents;
  paidWith?: PaidWith;
}

const byDate = (a: Flow, b: Flow): number => a.date.localeCompare(b.date);

export function billFlows(bills: MonthlyBill[], range: DateRange, holidays: ReadonlySet<ISODate>): Flow[] {
  const flows: Flow[] = [];
  const start = parts(range.start);
  const end = parts(range.end);
  for (let m = { year: start.year, month: start.month }; m.year * 12 + m.month <= end.year * 12 + end.month; m = addMonths(m.year, m.month, 1)) {
    for (const bill of bills) {
      const date = bill.rule
        ? resolvePayDate(m.year, m.month, bill.rule, holidays)
        : makeDate(m.year, m.month, Math.min(bill.day, daysInMonth(m.year, m.month)));
      if (!isWithin(date, range)) continue;
      if ((bill.from && date < bill.from) || (bill.until && date > bill.until)) continue;
      if (bill.monthsOff?.includes(m.month)) continue;
      flows.push({
        date,
        amount: -bill.amount,
        label: bill.label,
        category: bill.category,
        kind: 'bill',
        paidWith: bill.paidWith ?? 'checking',
      });
    }
  }
  return flows.sort(byDate);
}

export function essentialFlows(essentials: DailyEssential[], range: DateRange): Flow[] {
  const flows: Flow[] = [];
  for (const date of eachDay(range.start, range.end)) {
    for (const item of essentials) {
      const factor = item.adjustments?.find((a) => isWithin(date, a.range))?.factor ?? 1;
      const amount = Math.round(((item.monthly * 12) / 365) * factor);
      if (amount === 0) continue;
      flows.push({
        date,
        amount: -amount,
        label: item.label,
        category: item.category,
        kind: 'essential',
        paidWith: item.paidWith ?? 'checking',
      });
    }
  }
  return flows;
}

export function eventFlows(events: OneOffEvent[], range: DateRange): Flow[] {
  return events
    .filter((event) => isWithin(event.date, range))
    .map((event) => ({
      date: event.date,
      amount: -event.amount,
      label: event.label,
      category: event.category,
      kind: 'event' as const,
      paidWith: event.paidWith ?? 'checking',
    }))
    .sort(byDate);
}

export function paycheckFlows(paychecks: Paycheck[]): Flow[] {
  return paychecks
    .filter((check) => check.amount !== 0)
    .map((check) => ({
      date: check.payDate,
      amount: check.amount,
      label: `${check.jobName} pay · hours ${monthDay(check.period.start)}–${monthDay(check.period.end)}`,
      category: check.jobName,
      kind: 'income' as const,
      paidWith: 'checking' as const,
    }));
}

/**
 * Cash view of the same flows: card purchases leave checking only when the card bill is paid.
 * Purchases made in month M are paid on dueDay of month M + 1; what is owed today is paid on the next due date.
 * Accrual flows (purchases counted when made) stay the source for spending reports.
 */
export function toCashFlows(flows: Flow[], card: { owed: Cents; dueDay: number }, asOf: ISODate): Flow[] {
  const payments = new Map<ISODate, Cents>();
  const addPayment = (date: ISODate, amount: Cents) => payments.set(date, (payments.get(date) ?? 0) + amount);
  const dueIn = (year: number, month: number) => makeDate(year, month, Math.min(card.dueDay, daysInMonth(year, month)));

  const today = parts(asOf);
  const thisMonthDue = dueIn(today.year, today.month);
  const next = addMonths(today.year, today.month, 1);
  if (card.owed > 0) addPayment(thisMonthDue > asOf ? thisMonthDue : dueIn(next.year, next.month), -card.owed);

  const cash = flows.filter((flow) => flow.paidWith !== 'card');
  for (const flow of flows) {
    if (flow.paidWith !== 'card') continue;
    const { year, month } = parts(flow.date);
    const due = addMonths(year, month, 1);
    addPayment(dueIn(due.year, due.month), flow.amount);
  }
  for (const [date, amount] of payments) {
    cash.push({ date, amount, label: 'Card payment', category: 'Card payment', kind: 'bill', paidWith: 'checking' });
  }
  return cash.sort(byDate);
}
