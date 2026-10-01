import { describe, expect, it } from 'vitest';
import { addDays, parts } from '../../shared/engine/dates.ts';
import { holidaySet } from '../../shared/engine/holidays.ts';
import { project } from '../../shared/engine/projection.ts';
import type { LedgerEntry } from '../../shared/import/ledger.ts';
import { buildDashboard, buildYearPlan, scenarioFlows, type Balances, type PlanConfig } from '../../shared/plan/index.ts';

/** Fake numbers: one semi-monthly job at $10/h, rent on the 20th, $304/month of food. */
const config: PlanConfig = {
  planEnd: '2027-01-31',
  reserve: { amount: 20_000, from: '2026-11-01' },
  goal: { label: 'Goal', amount: 100_000, by: '2027-01-31', averageMonths: { start: '2026-12-01', end: '2027-01-31' } },
  jobs: [
    {
      id: 'shop',
      name: 'Shop',
      rates: [{ from: '2026-01-01', centsPerHour: 1_000 }],
      periods: [
        { startDay: 1, endDay: 15, payMonthOffset: 0, payDate: { kind: 'dayOfMonth', day: 16, roll: 'forward' } },
        { startDay: 16, endDay: 'end', payMonthOffset: 1, payDate: { kind: 'nthBusinessDay', n: 5 } },
      ],
    },
  ],
  hours: {
    conservative: { shop: { segments: [{ from: '2026-01-01', weeklyHours: 20 }] } },
    expected: { shop: { segments: [{ from: '2026-01-01', weeklyHours: 25 }] } },
  },
  jobOptions: { same: { jobId: 'shop', label: 'Same job', segments: [] } },
  mainScenarios: [{ label: 'Worst case', level: 'conservative', option: 'same' }],
  bills: [{ label: 'Rent', category: 'Rent', amount: 30_000, day: 20 }],
  essentials: [{ label: 'Food', category: 'Food', monthly: 30_400 }],
  events: [],
  checkpoints: [{ label: 'Trip', date: '2026-12-01', horizonEnd: '2027-01-31' }],
};

const balances: Balances = { checking: 50_000, cash: 0, cardOwed: 10_000, asOf: '2026-10-10', cardDueDay: 21 };

const entry = (date: string, amount: number, category: string, kind: LedgerEntry['kind']): LedgerEntry => ({
  id: `${date}|${category}|${amount}`,
  account: 'checking',
  date,
  postedDate: date,
  description: category,
  amount,
  category,
  kind,
  source: 'test',
});

const ledger: LedgerEntry[] = [
  entry('2026-10-01', 40_000, 'Shop', 'income'),
  entry('2026-10-05', -5_000, 'Food', 'expense'),
  entry('2026-10-08', -3_000, 'Dining out', 'expense'),
  entry('2026-10-09', -10_000, 'Card payment', 'transfer'),
  entry('2026-10-09', -500, 'Uncategorized', 'expense'),
  entry('2026-09-20', -30_000, 'Rent', 'expense'),
];

describe('buildDashboard (current month)', () => {
  const data = buildDashboard({ today: '2026-10-10', month: '2026-10', config, balances, ledger });

  it('sums the real month without transfers and shows budgets next to spending', () => {
    expect(data.actual).toMatchObject({ income: 40_000, spending: 8_500, result: 31_500 });
    expect(data.actual.spendingByCategory).toEqual([
      { name: 'Food', amount: 5_000, budget: 30_400 },
      { name: 'Dining out', amount: 3_000, budget: null },
      { name: 'Uncategorized', amount: 500, budget: null },
      { name: 'Rent', amount: 0, budget: 30_000 },
    ]);
    expect(data.balances.net).toBe(40_000);
  });

  it('finds safe to spend at the tightest day once the reserve starts', () => {
    // $400 today, $9.99 of food a day, +$440 on Oct 16, rent on Oct 20, reserve $200 from Nov 1:
    // tightest day is Nov 5 (the day before the Nov 6 paycheck) with $280.26, i.e. $80.26 above the reserve.
    expect(data.safeToSpend).toMatchObject({
      amount: 8_026,
      nextPayDate: '2026-10-16',
      perDay: 1_337,
      low: { date: '2026-11-05', balance: 28_026, floor: 20_000 },
      horizonEnd: '2026-11-30',
    });
  });

  it('expects the rest of the month from the plan after the last real data', () => {
    // +$440 paycheck, −$300 rent, −21 days × $9.99 food
    expect(data.monthEnd).toEqual({ incomeLeft: 44_000, spendingLeft: 50_979, expectedResult: 24_521 });
  });

  it('checks that next month is covered', () => {
    expect(data.nextMonth).toEqual({ month: '2026-11', income: 84_000, alreadyWorked: 0, committed: 59_970, free: 24_030, covered: true, reserveGap: 0 });
    // Checking starts $100 above the net view until the card bill leaves on Oct 21; after that they match.
    expect(data.cashLow).toEqual({ date: '2026-11-05', balance: 28_026 });
  });

  it('lists upcoming paychecks and bills, and flags uncategorized transactions', () => {
    expect(data.upcoming.map((u) => [u.date, u.amount])).toEqual([
      ['2026-10-16', 44_000],
      ['2026-10-20', -30_000],
    ]);
    expect(data.alerts).toEqual([{ level: 'info', text: '1 transactions without a category' }]);
    expect(data.runway[0]).toMatchObject({ date: '2026-10-10', balance: 40_000 });
    expect(data.paydays).toEqual(['2026-10-16', '2026-11-06', '2026-11-16']);
  });

  it('warns when checking would go negative and when the reserve gets touched', () => {
    const tight = buildDashboard({ today: '2026-10-10', month: '2026-10', config, balances: { ...balances, checking: 20_000 }, ledger });
    expect(tight.safeToSpend?.amount).toBe(0);
    expect(tight.alerts.map((a) => a.level)).toEqual(['critical', 'warning', 'info', 'info']);
    expect(tight.alerts[0].text).toBe('Checking goes negative on Nov 4 (lowest -$20 on Nov 5). Move a bill or wait for pay.');
    expect(tight.nextMonth).toMatchObject({ covered: false, reserveGap: 21_974 });
  });
});

describe('buildDashboard with two jobs', () => {
  it('takes the earliest payday, not the first job in the list', () => {
    const lateJob = {
      id: 'late',
      name: 'Late',
      rates: [{ from: '2026-01-01', centsPerHour: 1_000 }],
      periods: [{ startDay: 1, endDay: 'end' as const, payMonthOffset: 1, payDate: { kind: 'dayOfMonth' as const, day: 25, roll: 'forward' as const } }],
    };
    const twoJobs: PlanConfig = {
      ...config,
      jobs: [lateJob, ...config.jobs],
      hours: {
        conservative: { ...config.hours.conservative, late: { segments: [{ from: '2026-01-01', weeklyHours: 5 }] } },
        expected: config.hours.expected,
      },
    };
    const data = buildDashboard({ today: '2026-10-10', month: '2026-10', config: twoJobs, balances, ledger });
    expect(data.safeToSpend?.nextPayDate).toBe('2026-10-16');
    expect(data.paydays).toEqual(['2026-10-16', '2026-10-26', '2026-11-06', '2026-11-16', '2026-11-25']);
  });
});

describe('buildDashboard (past month)', () => {
  it('shows only what happened', () => {
    const data = buildDashboard({ today: '2026-10-10', month: '2026-09', config, balances, ledger });
    expect(data.actual).toMatchObject({ income: 0, spending: 30_000, result: -30_000 });
    expect(data.safeToSpend).toBeNull();
    expect(data.runway).toEqual([]);
  });
});

describe('buildYearPlan', () => {
  const plan = buildYearPlan(config, balances);
  const [worst] = plan.scenarios;

  it('lists months with results and month-end balances matching the dashboard projection', () => {
    expect(worst.months.map((m) => m.month)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    expect(worst.months[0]).toMatchObject({ income: 44_000, spending: 50_979, result: -6_979, endBalance: 33_021 });
  });

  it('gives checkpoint room that keeps every later day above the reserve, and not a cent more', () => {
    const [room] = plan.checkpoints[0].room;
    const holidays = holidaySet(2026, 2027);
    const { flows } = scenarioFlows(config, config.mainScenarios[0], { start: addDays(balances.asOf, 1), end: config.planEnd }, holidays);
    const withSpend = (amount: number) =>
      project({
        asOf: balances.asOf,
        startBalance: 40_000,
        flows: [...flows, { date: '2026-12-01', amount: -amount, label: 'Trip', category: 'Travel', kind: 'event', paidWith: 'checking' }],
        horizonEnd: '2027-01-31',
        floor: [{ from: '2026-11-01', amount: 20_000 }],
      }).points.filter((p) => p.date >= '2026-12-01');
    expect(room).toBeGreaterThan(0);
    expect(Math.min(...withSpend(room).map((p) => p.headroom))).toBe(0);
    expect(Math.min(...withSpend(room + 1).map((p) => p.headroom))).toBe(-1);
    expect(parts(plan.asOf).year).toBe(2026);
  });

  it('reports the goal as money above the reserve on the goal date', () => {
    const [option] = plan.goal.options;
    expect(option.aboveReserve.conservative).toBe(worst.months[3].endBalance - 20_000);
    expect(option.aboveReserve.expected).toBeGreaterThan(option.aboveReserve.conservative);
  });
});
