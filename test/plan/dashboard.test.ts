import { describe, expect, it } from 'vitest';
import { holidaySet } from '../../shared/engine/holidays.ts';
import { project } from '../../shared/engine/projection.ts';
import type { LedgerEntry } from '../../shared/import/ledger.ts';
import {
  buildDashboard,
  buildYearPlan,
  computeActuals,
  dailyMessage,
  forwardFlows,
  type Balances,
  type PlanConfig,
} from '../../shared/plan/index.ts';

/** Fake numbers: one semi-monthly job at $10/h (usually 20 h a week, never more than 25 counted), rent on the 20th, $304/month of food. */
const config: PlanConfig = {
  version: 2,
  reserve: { amount: 20_000, from: '2026-11-01' },
  goals: [{ id: 'goal', name: 'Goal', target: 100_000, by: '2027-01-31' }],
  jobs: [
    {
      id: 'shop',
      name: 'Shop',
      rates: [{ from: '2026-01-01', centsPerHour: 1_000 }],
      periods: [
        { startDay: 1, endDay: 15, payMonthOffset: 0, payDate: { kind: 'dayOfMonth', day: 16, roll: 'forward' } },
        { startDay: 16, endDay: 'end', payMonthOffset: 1, payDate: { kind: 'nthBusinessDay', n: 5 } },
      ],
      weeklyHours: 20,
      maxWeeklyHours: 25,
    },
  ],
  away: [],
  bills: [{ label: 'Rent', category: 'Rent', amount: 30_000, day: 20 }],
  budgets: [{ label: 'Food', category: 'Food', monthly: 30_400 }],
  events: [],
};

const balances: Balances = {
  checking: { amount: 50_000, asOf: '2026-10-10' },
  cash: { amount: 0, asOf: '2026-10-10' },
  cardOwed: { amount: 10_000, asOf: '2026-10-10' },
  cardDueDay: 21,
};

const entry = (date: string, amount: number, category: string, kind: LedgerEntry['kind'], account = 'chase'): LedgerEntry => ({
  id: `${account}|${date}|${category}|${amount}`,
  account,
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

const actuals = computeActuals(balances, ledger, '2026-10-10');

describe('computeActuals', () => {
  it('adds transactions after each snapshot and keeps this month per category', () => {
    const later: LedgerEntry[] = [
      ...ledger,
      entry('2026-10-11', -2_000, 'Food', 'expense'), // after the snapshot: lowers checking
      entry('2026-10-11', -1_500, 'Dining out', 'expense', 'discover'), // card purchase: raises what the card owes
      entry('2026-10-11', 5_000, 'Card payment', 'transfer', 'discover'), // card payment: lowers it
      entry('2026-10-11', -700, 'Snacks', 'expense', 'cash'),
      entry('2026-10-20', -9_999, 'Food', 'expense'), // after today: ignored
    ];
    const live = computeActuals(balances, later, '2026-10-11');
    expect(live).toMatchObject({ checking: 48_000, cash: -700, cardOwed: 6_500, net: 40_800 });
    expect(live.spentThisMonth).toEqual({ Food: 7_000, 'Dining out': 4_500, Uncategorized: 500, Snacks: 700 });
    expect(live.receivedThisMonth).toEqual({ Shop: 40_000 });
    expect(live.dataUntil).toEqual({ chase: '2026-10-20', discover: '2026-10-11', cash: '2026-10-11' });
    expect(live.checkedOn).toEqual({ checking: '2026-10-10', cash: '2026-10-10', cardOwed: '2026-10-10' });
  });

  it('counts checking by purchase date (available balance) and the card by posting date (current balance)', () => {
    const pending: LedgerEntry[] = [
      // Bought on the snapshot day, posted two days later: the available balance already had it.
      { ...entry('2026-10-10', -2_500, 'Food', 'expense'), postedDate: '2026-10-12' },
      // Card purchase on the snapshot day that posts later: the card's current balance did not have it yet.
      { ...entry('2026-10-10', -1_200, 'Dining out', 'expense', 'discover'), postedDate: '2026-10-12' },
      // Not posted by "today": the card does not owe it yet.
      { ...entry('2026-10-11', -800, 'Dining out', 'expense', 'discover'), postedDate: '2026-10-14' },
    ];
    const live = computeActuals(balances, pending, '2026-10-12');
    expect(live).toMatchObject({ checking: 50_000, cardOwed: 11_200 });
  });

  it('on the day a balance was read, counts only what came after it', () => {
    const morning: Balances = { ...balances, checking: { amount: 50_000, asOf: '2026-10-10', at: '2026-10-10T13:00:00.000Z' } };
    const sameDay: LedgerEntry[] = [
      { ...entry('2026-10-10', -1_000, 'Food', 'expense'), at: '2026-10-10T12:00:00.000Z' }, // before the alert: already in it
      { ...entry('2026-10-10', -2_000, 'Food', 'expense'), at: '2026-10-10T22:00:00.000Z' }, // after it
      entry('2026-10-10', -4_000, 'Food', 'expense'), // a bank row with no time: the day counts as included
    ];
    expect(computeActuals(morning, sameDay, '2026-10-10').checking).toBe(48_000);
    // Without a time on the balance, the whole day is included.
    expect(computeActuals(balances, sameDay, '2026-10-10').checking).toBe(50_000);
  });
});

describe('forwardFlows', () => {
  const holidays = holidaySet(2026, 2027);

  it('spreads what is left of a budget over the rest of the month', () => {
    const { flows } = forwardFlows(config, actuals, '2026-10-31', holidays);
    const food = flows.filter((f) => f.category === 'Food');
    expect(food).toHaveLength(21); // Oct 11–31
    expect(food.reduce((a, f) => a - f.amount, 0)).toBe(25_400); // $304 budget − $50 already spent
  });

  it('plans nothing more for a category that is already over budget', () => {
    const over = computeActuals(balances, [...ledger, entry('2026-10-09', -40_000, 'Food', 'expense')], '2026-10-10');
    const { flows } = forwardFlows(config, over, '2026-10-31', holidays);
    expect(flows.some((f) => f.category === 'Food')).toBe(false);
  });

  it('moves a bill that is due but not in the books yet to tomorrow, and drops one already paid', () => {
    const afterRent = computeActuals(balances, ledger, '2026-10-22');
    const unpaid = forwardFlows(config, afterRent, '2026-10-31', holidays).flows.filter((f) => f.category === 'Rent');
    expect(unpaid).toEqual([expect.objectContaining({ date: '2026-10-23', amount: -30_000, label: 'Rent (not seen yet)' })]);

    const paid = computeActuals(balances, [...ledger, entry('2026-10-21', -30_000, 'Rent', 'expense')], '2026-10-22');
    expect(forwardFlows(config, paid, '2026-10-31', holidays).flows.some((f) => f.category === 'Rent')).toBe(false);
  });
});

describe('buildDashboard (current month)', () => {
  const data = buildDashboard({ month: '2026-10', config, actuals, ledger });

  it('sums the real month without transfers and shows budgets next to spending', () => {
    expect(data.actual).toMatchObject({ income: 40_000, spending: 8_500, result: 31_500 });
    // Bills first (with their due date and whether they are paid), then budgets, then everything else.
    expect(data.actual.spendingByCategory).toEqual([
      { name: 'Rent', amount: 0, budget: 30_000, kind: 'bill', due: '2026-10-20', paid: false },
      { name: 'Food', amount: 5_000, budget: 30_400, kind: 'budget' },
      { name: 'Dining out', amount: 3_000, budget: null, kind: 'other' },
      { name: 'Uncategorized', amount: 500, budget: null, kind: 'other' },
    ]);
    expect(data.balances.net).toBe(40_000);
  });

  it('finds safe to spend at the tightest day once the reserve starts', () => {
    // $400 today; the $254 left of the food budget over Oct 11–31; +$440 on Oct 16; rent Oct 20; reserve $200 from Nov 1.
    // Tightest day: Nov 5 (the day before the Nov 6 paycheck) at $236.05, i.e. $36.05 above the reserve.
    expect(data.safeToSpend).toMatchObject({
      amount: 3_605,
      nextPayDate: '2026-10-16',
      perDay: 600,
      low: { date: '2026-11-05', balance: 23_605, floor: 20_000 },
      horizonEnd: '2026-11-30',
    });
  });

  it('expects the rest of the month from what is left of each budget', () => {
    expect(data.monthEnd).toEqual({ incomeLeft: 44_000, spendingLeft: 55_400, expectedResult: 20_100 });
  });

  it('checks that next month is covered', () => {
    expect(data.nextMonth).toEqual({
      month: '2026-11',
      income: 84_000,
      alreadyWorked: 0,
      committed: 59_970,
      free: 24_030,
      covered: true,
      reserveGap: 0,
      byJob: [{ jobId: 'shop', jobName: 'Shop', weeklyHours: 20, source: 'usual', weeks: 0, amount: 84_000, paychecks: 2 }],
    });
    // Checking starts $100 above the net view until the card bill leaves on Oct 21; after that they match.
    expect(data.cashLow).toEqual({ date: '2026-11-05', balance: 23_605 });
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
    const tight = buildDashboard({
      month: '2026-10',
      config,
      actuals: computeActuals({ ...balances, checking: { amount: 20_000, asOf: '2026-10-10' } }, ledger, '2026-10-10'),
      ledger,
    });
    expect(tight.safeToSpend?.amount).toBe(0);
    expect(tight.alerts.map((a) => a.level)).toEqual(['critical', 'warning', 'info', 'info']);
    expect(tight.alerts[0].text).toBe('Checking goes negative on Oct 30 (lowest -$64 on Nov 5). Move a bill or wait for pay.');
    expect(tight.alerts[1].text).toBe('Reserve touched on Nov 1: -$24 of $200');
    expect(tight.nextMonth).toMatchObject({ covered: false, reserveGap: 26_395 });
  });

  it('notices a paycheck that has not arrived', () => {
    const noPay = ledger.filter((e) => e.category !== 'Shop');
    const data = buildDashboard({ month: '2026-10', config, actuals: computeActuals(balances, noPay, '2026-10-10'), ledger: noPay });
    expect(data.alerts.map((a) => a.text)).toContain('Shop paycheck (≈$440, due Oct 7) not seen yet');
  });

  it('warns when bank data is old', () => {
    const old = buildDashboard({ month: '2026-10', config, actuals: computeActuals(balances, ledger, '2026-10-20'), ledger });
    // The last transaction is Oct 9, but the checking balance was confirmed on Oct 10.
    expect(old.alerts.map((a) => a.text)).toContain('No bank data since Oct 10: import a statement or check the email sync');
  });
});

describe('buildDashboard with two jobs', () => {
  it('takes the earliest payday, not the first job in the list', () => {
    const lateJob = {
      id: 'late',
      name: 'Late',
      rates: [{ from: '2026-01-01', centsPerHour: 1_000 }],
      periods: [{ startDay: 1, endDay: 'end' as const, payMonthOffset: 1, payDate: { kind: 'dayOfMonth' as const, day: 25, roll: 'forward' as const } }],
      weeklyHours: 5,
    };
    const twoJobs: PlanConfig = { ...config, jobs: [lateJob, ...config.jobs] };
    const data = buildDashboard({ month: '2026-10', config: twoJobs, actuals, ledger });
    expect(data.safeToSpend?.nextPayDate).toBe('2026-10-16');
    expect(data.paydays).toEqual(['2026-10-16', '2026-10-26', '2026-11-06', '2026-11-16', '2026-11-25']);
  });
});

describe('buildDashboard (past month)', () => {
  it('shows only what happened', () => {
    const data = buildDashboard({ month: '2026-09', config, actuals, ledger });
    expect(data.actual).toMatchObject({ income: 0, spending: 30_000, result: -30_000 });
    expect(data.safeToSpend).toBeNull();
    expect(data.runway).toEqual([]);
  });
});

describe('buildYearPlan', () => {
  const plan = buildYearPlan(config, actuals);

  it('lists the next 12 months; the current one adds what already happened', () => {
    expect(plan.months.map((m) => m.month)).toEqual([
      '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09',
    ]);
    expect(plan.months[0]).toMatchObject({ income: 84_000, spending: 63_900, result: 20_100, endBalance: 28_600 });
  });

  it('reports a goal as money above the reserve on its date, and the saving per month that closes the gap', () => {
    const [goal] = plan.goals;
    const january = plan.months.find((m) => m.month === '2027-01')!;
    expect(goal).toMatchObject({ name: 'Goal', date: '2027-01-31', projected: january.endBalance - 20_000, now: 20_000 });
    expect(goal.shortBy).toBe(100_000 - goal.projected);
    // Three months to go (Oct → Jan), rounded up to whole dollars.
    expect(goal.perMonth).toBe(Math.ceil(goal.shortBy / 3 / 100) * 100);
  });

  it('fills goals in order: a later goal only counts what is left after the full targets before it', () => {
    const two = buildYearPlan({ ...config, goals: [{ id: 'a', name: 'A', target: 10_000 }, { id: 'b', name: 'B', target: 1_000_000 }] }, actuals);
    const end = plan.months[11].endBalance - 20_000;
    expect(two.goals[0]).toMatchObject({ projected: 10_000, reached: true, date: '2027-09-30', hasDate: false });
    expect(two.goals[1].projected).toBe(end - 10_000);
    expect(two.goals[1].reached).toBe(false);
  });

  it('gives each trip the room that keeps every day until the end of the next month above the reserve, and not a cent more', () => {
    const withTrip: PlanConfig = { ...config, away: [{ label: 'Trip', from: '2026-12-01', to: '2026-12-05', trip: true }] };
    const [trip] = buildYearPlan(withTrip, actuals).trips;
    expect(trip).toMatchObject({ label: 'Trip', start: '2026-12-01', until: '2027-01-31' });
    const holidays = holidaySet(2026, 2027);
    const { flows } = forwardFlows(withTrip, actuals, '2027-01-31', holidays);
    const withSpend = (amount: number) =>
      project({
        asOf: '2026-10-10',
        startBalance: actuals.net,
        flows: [...flows, { date: '2026-12-01', amount: -amount, label: 'Trip', category: 'Travel', kind: 'event', paidWith: 'checking' }],
        horizonEnd: '2027-01-31',
        floor: [{ from: '2026-11-01', amount: 20_000 }],
      }).points.filter((p) => p.date >= '2026-12-01');
    expect(trip.room).toBeGreaterThan(0);
    expect(Math.min(...withSpend(trip.room).map((p) => p.headroom))).toBe(0);
    expect(Math.min(...withSpend(trip.room + 1).map((p) => p.headroom))).toBe(-1);
  });

  it('describes its assumptions from the plan itself', () => {
    const described = buildYearPlan(
      {
        ...config,
        bills: [{ label: 'Rent', category: 'Rent', amount: 30_000, rule: { kind: 'nthBusinessDay', n: 5 }, monthsOff: [6, 7, 8] }],
        away: [{ label: 'Holidays', from: '2026-12-19', to: '2027-01-03', yearly: true, trip: true }],
        budgets: [{ label: 'Food', category: 'Food', monthly: 30_400, lessOnTrips: true }],
        events: [{ date: '2027-01-05', label: 'Tuition', category: 'Tuition', amount: 60_000 }],
      },
      actuals,
    );
    expect(described.assumptions).toEqual([
      'Pay from hours: Shop 20 h/week (your usual hours). Extra hours, freelance cash and money from people are never counted.',
      'No pay while away: Holidays (Dec 19 – Jan 3, 2027).',
      'Bills: Rent $300 (5th business day, not in Jun/Jul/Aug).',
      'Day-to-day budgets: $304 a month; on trips, food drops to a quarter.',
      'One-offs: Tuition $600 (Jan 5, 2027).',
      'Reserve: $200 kept from Nov 1 on.',
    ]);
  });
});

describe('dailyMessage', () => {
  it('says what is in the bank, what is safe to spend and the pace until payday', () => {
    const data = buildDashboard({ month: '2026-10', config, actuals, ledger });
    expect(dailyMessage(data)).toEqual({ title: 'Balance $500 · Available $36', body: '≈ $6 a day until the Oct 16 paycheck' });
  });

  it('leads with a bill due in the next days, or with an urgent alert', () => {
    // The Oct 16 paycheck arrived; rent is due in two days.
    const paid = [...ledger, entry('2026-10-16', 44_000, 'Shop', 'income')];
    const soon = buildDashboard({ month: '2026-10', config, actuals: computeActuals(balances, paid, '2026-10-18'), ledger: paid });
    expect(dailyMessage(soon).body).toMatch(/^Rent \$300 on Oct 20 · /);
    const tight = buildDashboard({
      month: '2026-10',
      config,
      actuals: computeActuals({ ...balances, checking: { amount: 20_000, asOf: '2026-10-10' } }, ledger, '2026-10-10'),
      ledger,
    });
    expect(dailyMessage(tight).body).toBe('Checking goes negative on Oct 30 (lowest -$64 on Nov 5). Move a bill or wait for pay. · Essentials only until the Oct 16 paycheck');
  });
});
