import { describe, expect, it } from 'vitest';
import { migratePlan, type PlanConfig } from '../../shared/plan/index.ts';

/** A plan in the first format: two hour levels, what-if options and one goal (fake numbers). */
const v1 = {
  planEnd: '2027-08-31',
  reserve: { amount: 100_000, from: '2026-11-30' },
  goal: { label: 'Fund', amount: 600_000, by: '2027-08-15', averageMonths: { start: '2027-02-01', end: '2027-07-31' } },
  jobs: [{ id: 'agency', name: 'Agency', rates: [{ from: '2026-01-01', centsPerHour: 1_250 }], periods: [] }],
  hours: {
    conservative: {
      agency: {
        segments: [
          { from: '2026-09-01', to: '2026-09-30', weeklyHours: 12 },
          { from: '2026-10-01', weeklyHours: 20 },
          { from: '2026-12-19', to: '2027-01-03', weeklyHours: 0 },
        ],
        closures: [{ start: '2026-11-25', end: '2026-11-27' }],
      },
    },
    expected: { agency: { segments: [{ from: '2026-10-01', weeklyHours: 23 }] } },
  },
  jobOptions: { same: { label: 'Same', changes: [] } },
  mainScenarios: [{ label: 'Worst case', level: 'conservative', option: 'same' }],
  bills: [{ label: 'Rent', category: 'Rent', amount: 30_000, day: 5 }],
  essentials: [
    { label: 'Groceries', category: 'Groceries', monthly: 25_500, adjustments: [{ range: { start: '2026-12-19', end: '2027-01-03' }, factor: 0.25 }] },
    { label: 'Shopping', category: 'Shopping', monthly: 9_000 },
  ],
  events: [{ date: '2027-01-05', label: 'Tuition', category: 'Tuition', amount: 60_000 }],
  checkpoints: [],
  notIncluded: ['Taxes'],
};

describe('migratePlan', () => {
  it('turns the two hour levels into usual and most-counted hours, and keeps every date', () => {
    const plan = migratePlan(v1);
    expect(plan).toEqual({
      version: 2,
      reserve: { amount: 100_000, from: '2026-11-30' },
      goals: [{ id: 'goal-1', name: 'Fund', target: 600_000, by: '2027-08-15' }],
      jobs: [
        {
          id: 'agency',
          name: 'Agency',
          rates: [{ from: '2026-01-01', centsPerHour: 1_250 }],
          periods: [],
          weeklyHours: 20,
          maxWeeklyHours: 23,
          hoursSince: '2026-10-01',
          previousWeeklyHours: 12,
          closures: [
            { label: 'Closed', from: '2026-11-25', to: '2026-11-27' },
            { label: 'No hours', from: '2026-12-19', to: '2027-01-03' },
          ],
        },
      ],
      away: [],
      bills: v1.bills,
      budgets: [
        { label: 'Groceries', category: 'Groceries', monthly: 25_500, lessOnTrips: true },
        { label: 'Shopping', category: 'Shopping', monthly: 9_000 },
      ],
      events: [{ ...v1.events[0], category: 'Education' }],
      notes: ['Taxes'],
    } satisfies PlanConfig);
  });

  it('renames older category names in budgets, bills and one-offs', () => {
    const current = migratePlan(v1);
    const old = { ...current, budgets: [{ label: 'Leisure', category: 'Leisure', monthly: 4_500 }] };
    const plan = migratePlan(old);
    expect(plan.budgets).toEqual([{ label: 'Fun', category: 'Fun', monthly: 4_500 }]);
    expect(plan.events[0].category).toBe('Education');
  });

  it('leaves a current plan as it is, and refuses anything else', () => {
    const current = migratePlan(v1);
    expect(migratePlan(current)).toBe(current);
    expect(() => migratePlan({ hello: 'world' })).toThrow('Unknown plan format');
  });
});
