import { describe, expect, it } from 'vitest';
import { holidaySet } from '../../shared/engine/holidays.ts';
import { paychecksBetween, plannedHoursOn, type HoursPlan, type Job } from '../../shared/engine/schedule.ts';

const holidays = holidaySet(2026, 2027);

/** Paid once a month, on the 15th, for the whole previous month. */
const monthlyJob: Job = {
  id: 'campus',
  name: 'Campus',
  rates: [{ from: '2026-01-01', centsPerHour: 1500 }],
  periods: [{ startDay: 1, endDay: 'end', payMonthOffset: 1, payDate: { kind: 'dayOfMonth', day: 15, roll: 'forward' } }],
};

/** Days 1–15 paid on the 16th; days 16–end paid on the 5th business day of the next month. */
const semiMonthlyJob: Job = {
  id: 'agency',
  name: 'Agency',
  rates: [{ from: '2026-01-01', centsPerHour: 2000 }],
  periods: [
    { startDay: 1, endDay: 15, payMonthOffset: 0, payDate: { kind: 'dayOfMonth', day: 16, roll: 'forward' } },
    { startDay: 16, endDay: 'end', payMonthOffset: 1, payDate: { kind: 'nthBusinessDay', n: 5 } },
  ],
};

describe('plannedHoursOn', () => {
  const campusPlan: HoursPlan = {
    segments: [{ from: '2026-08-01', weeklyHours: 15 }],
    skipHolidays: true,
    closures: [{ start: '2026-12-09', end: '2027-01-11' }],
  };

  it('spreads weekly hours over the work days', () => {
    expect(plannedHoursOn('2026-10-01', campusPlan, holidays)).toBe(3);
    expect(plannedHoursOn('2026-10-03', campusPlan, holidays)).toBe(0); // Saturday
  });

  it('skips holidays and closures', () => {
    expect(plannedHoursOn('2026-09-07', campusPlan, holidays)).toBe(0); // Labor Day
    expect(plannedHoursOn('2026-12-10', campusPlan, holidays)).toBe(0); // winter break
    expect(plannedHoursOn('2027-01-12', campusPlan, holidays)).toBe(3); // back after the break
  });

  it('lets a later segment override an earlier one', () => {
    const plan: HoursPlan = {
      segments: [
        { from: '2026-09-01', weeklyHours: 20 },
        { from: '2026-12-19', to: '2027-01-03', weeklyHours: 0 },
      ],
    };
    expect(plannedHoursOn('2026-12-18', plan, holidays)).toBe(4);
    expect(plannedHoursOn('2026-12-21', plan, holidays)).toBe(0);
    expect(plannedHoursOn('2027-01-04', plan, holidays)).toBe(4);
  });

  it('uses logged hours up to actualsThrough, then the plan', () => {
    const plan: HoursPlan = {
      segments: [{ from: '2026-09-01', weeklyHours: 20 }],
      actuals: { '2026-10-03': 5 },
      actualsThrough: '2026-10-04',
    };
    expect(plannedHoursOn('2026-10-01', plan, holidays)).toBe(0); // nothing logged that day
    expect(plannedHoursOn('2026-10-03', plan, holidays)).toBe(5); // logged Saturday shift
    expect(plannedHoursOn('2026-10-05', plan, holidays)).toBe(4);
  });
});

describe('paychecksBetween', () => {
  it('pays a monthly job for the previous month on the 15th, rolled to a business day', () => {
    const plan: HoursPlan = { segments: [{ from: '2026-08-01', weeklyHours: 15 }], skipHolidays: true };
    const checks = paychecksBetween(monthlyJob, plan, '2026-10-01', '2026-11-30', holidays);
    expect(checks.map((c) => c.payDate)).toEqual(['2026-10-15', '2026-11-16']); // Nov 15 is a Sunday
    expect(checks[0].period).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(checks[0].hours).toBe(63); // 21 weekdays (Labor Day off) × 3 h
    expect(checks[0].amount).toBe(94_500); // 63 h × $15.00
  });

  it('pays a semi-monthly job: 1–15 mid-month, 16–end on the 5th business day after', () => {
    const plan: HoursPlan = {
      segments: [
        { from: '2026-09-01', to: '2026-09-30', weeklyHours: 12 },
        { from: '2026-10-01', weeklyHours: 20 },
      ],
    };
    const checks = paychecksBetween(semiMonthlyJob, plan, '2026-10-01', '2026-10-31', holidays);
    expect(checks.map((c) => [c.payDate, c.period.start, c.period.end])).toEqual([
      ['2026-10-07', '2026-09-16', '2026-09-30'],
      ['2026-10-16', '2026-10-01', '2026-10-15'],
    ]);
    expect(checks[0].amount).toBe(52_800); // 11 weekdays × 2.4 h × $20.00
    expect(checks[1].amount).toBe(88_000); // 11 weekdays × 4 h × $20.00
  });

  it('applies a rate change from its effective day', () => {
    const job: Job = { ...monthlyJob, rates: [{ from: '2026-01-01', centsPerHour: 1000 }, { from: '2026-09-16', centsPerHour: 2000 }] };
    const plan: HoursPlan = { segments: [{ from: '2026-01-01', weeklyHours: 5 }] }; // 1 h per weekday
    const [check] = paychecksBetween(job, plan, '2026-10-15', '2026-10-15', holidays);
    expect(check.amount).toBe(11 * 1000 + 11 * 2000); // Sep 1–15 and Sep 16–30 both have 11 weekdays
  });

  it('returns nothing when no pay date falls in the range', () => {
    const plan: HoursPlan = { segments: [{ from: '2026-08-01', weeklyHours: 15 }] };
    expect(paychecksBetween(monthlyJob, plan, '2026-10-16', '2026-11-14', holidays)).toEqual([]);
  });
});
