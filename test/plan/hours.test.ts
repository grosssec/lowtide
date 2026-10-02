import { describe, expect, it } from 'vitest';
import { billFlows } from '../../shared/engine/flows.ts';
import { holidaySet } from '../../shared/engine/holidays.ts';
import { eventOccurrences, occurrences, planFlows, weeklyHoursBasis, type JobConfig, type PlanConfig } from '../../shared/plan/index.ts';

const holidays = holidaySet(2026, 2028);

const job: JobConfig = {
  id: 'agency',
  name: 'Agency',
  rates: [{ from: '2026-01-01', centsPerHour: 1_000 }],
  periods: [{ startDay: 1, endDay: 'end', payMonthOffset: 1, payDate: { kind: 'dayOfMonth', day: 5, roll: 'forward' } }],
  weeklyHours: 20,
  maxWeeklyHours: 23,
  hoursSince: '2026-10-01',
};

/** Logged hours: `perWeekday` hours on every weekday from `from` to `through`. */
function logged(from: string, through: string, perWeekday: number) {
  const actuals: Record<string, number> = {};
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${through}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) actuals[d.toISOString().slice(0, 10)] = perWeekday;
  }
  return { actuals, through };
}

describe('weeklyHoursBasis', () => {
  it('uses the usual hours until the timesheet has two full weeks', () => {
    expect(weeklyHoursBasis(job, [], undefined, holidays)).toMatchObject({ weeklyHours: 20, source: 'usual' });
    // Oct 5–11 is the only full week so far.
    expect(weeklyHoursBasis(job, [], logged('2026-10-01', '2026-10-14', 4), holidays)).toMatchObject({ weeklyHours: 20, source: 'usual' });
  });

  it('learns the average of the last full weeks', () => {
    // 4.3 h × 5 weekdays = 21.5 h a week, three full weeks (Oct 5–25).
    expect(weeklyHoursBasis(job, [], logged('2026-10-01', '2026-10-27', 4.3), holidays)).toEqual({
      jobId: 'agency',
      jobName: 'Agency',
      weeklyHours: 21.5,
      source: 'timesheet',
      weeks: 3,
    });
  });

  it('never counts more than the maximum: extra hours stay extra', () => {
    expect(weeklyHoursBasis(job, [], logged('2026-10-01', '2026-10-27', 6), holidays).weeklyHours).toBe(23);
  });

  it('follows the timesheet down when the weeks are lighter', () => {
    expect(weeklyHoursBasis(job, [], logged('2026-10-01', '2026-10-27', 2), holidays).weeklyHours).toBe(10);
  });

  it('leaves out weeks with time away, and weeks before the usual hours changed', () => {
    const away = [{ label: 'Trip', from: '2026-10-14', to: '2026-10-16' }];
    const hours = logged('2026-09-01', '2026-10-27', 4);
    hours.actuals['2026-10-14'] = 0;
    // Oct 12–18 had the trip: only Oct 5–11 and Oct 19–25 count; September is before hoursSince.
    expect(weeklyHoursBasis(job, away, hours, holidays)).toMatchObject({ weeklyHours: 20, weeks: 2 });
  });
});

describe('periods that repeat every year', () => {
  it('finds each occurrence touching a range, across the new year', () => {
    const breaks = occurrences([{ label: 'Holidays', from: '2026-12-19', to: '2027-01-03', yearly: true }], { start: '2027-01-01', end: '2027-12-31' });
    expect(breaks.map((b) => [b.start, b.end])).toEqual([
      ['2026-12-19', '2027-01-03'],
      ['2027-12-19', '2028-01-03'],
    ]);
  });

  it('never repeats before the first date', () => {
    expect(occurrences([{ label: 'Summer', from: '2027-05-15', to: '2027-08-05', yearly: true }], { start: '2026-01-01', end: '2026-12-31' })).toEqual([]);
  });

  it('repeats yearly events', () => {
    const events = eventOccurrences([{ date: '2027-01-05', label: 'Tuition', category: 'Tuition', amount: 60_000, yearly: true }], {
      start: '2026-10-01',
      end: '2028-02-01',
    });
    expect(events.map((e) => e.date)).toEqual(['2027-01-05', '2028-01-05']);
  });
});

describe('bills with months off', () => {
  it('skips the months off every year', () => {
    const flows = billFlows([{ label: 'Rent', category: 'Rent', amount: 30_000, day: 1, monthsOff: [6, 7, 8] }], { start: '2027-04-01', end: '2027-10-31' }, holidays);
    expect(flows.map((f) => f.date)).toEqual(['2027-04-01', '2027-05-01', '2027-09-01', '2027-10-01']);
  });
});

describe('planFlows', () => {
  const config: PlanConfig = {
    version: 2,
    reserve: { amount: 0, from: '2026-01-01' },
    goals: [],
    jobs: [job],
    away: [{ label: 'Holidays', from: '2026-12-19', to: '2027-01-03', yearly: true, trip: true }],
    bills: [],
    budgets: [
      { label: 'Groceries', category: 'Groceries', monthly: 31_000, lessOnTrips: true },
      { label: 'Shopping', category: 'Shopping', monthly: 31_000 },
    ],
    events: [],
  };

  it('pays days before the hours changed at the hours of that time', () => {
    const changed: PlanConfig = { ...config, away: [], jobs: [{ ...job, previousWeeklyHours: 10 }] };
    const { paychecks } = planFlows(changed, { start: '2026-10-01', end: '2026-11-30' }, holidays);
    // September is paid on Oct 5 at 10 h a week (2 h a day); October on Nov 5 at 20 h (4 h a day).
    expect(paychecks.map((p) => [p.payDate, p.hours])).toEqual([
      ['2026-10-05', 22 * 2],
      ['2026-11-05', 22 * 4],
    ]);
  });

  it('pays nothing for days away', () => {
    const { paychecks } = planFlows(config, { start: '2027-01-01', end: '2027-01-31' }, holidays);
    // December has 23 weekdays; 9 of them (Dec 21–25, 28–31) are away → 14 days × 4 h.
    const december = paychecks.find((p) => p.period.start === '2026-12-01')!;
    expect(december.hours).toBe(14 * 4);
  });

  it('cuts the budgets marked for trips to a quarter while away', () => {
    const { flows } = planFlows(config, { start: '2026-12-18', end: '2026-12-20' }, holidays);
    const groceries = flows.filter((f) => f.category === 'Groceries').map((f) => f.amount);
    const shopping = flows.filter((f) => f.category === 'Shopping').map((f) => f.amount);
    expect(groceries[1]).toBe(Math.round(groceries[0] * 0.25));
    expect(shopping[1]).toBe(shopping[0]);
  });
});
