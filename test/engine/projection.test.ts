import { describe, expect, it } from 'vitest';
import type { ISODate } from '../../shared/engine/dates.ts';
import { billFlows, essentialFlows, toCashFlows, type Flow } from '../../shared/engine/flows.ts';
import { holidaySet } from '../../shared/engine/holidays.ts';
import type { Cents } from '../../shared/engine/money.ts';
import { defaultHorizonEnd, maxSpendOn, monthlySummary, project } from '../../shared/engine/projection.ts';

const flow = (date: ISODate, amount: Cents, category = 'Other', paidWith: Flow['paidWith'] = 'checking'): Flow => ({
  date,
  amount,
  label: category,
  category,
  kind: amount > 0 ? 'income' : 'bill',
  paidWith,
});

describe('project', () => {
  it('finds the tight day when rent is due before payday', () => {
    const p = project({
      asOf: '2026-09-30',
      startBalance: 24_000,
      horizonEnd: '2026-10-31',
      flows: [flow('2026-10-05', -30_000, 'Rent'), flow('2026-10-07', 40_000, 'Pay')],
    });
    expect(p.low.date).toBe('2026-10-05');
    expect(p.low.balance).toBe(-6_000);
    expect(p.safeToSpend).toBe(0);
  });

  it('treats flows on or before asOf as already in the balance', () => {
    const p = project({
      asOf: '2026-09-30',
      startBalance: 10_000,
      horizonEnd: '2026-10-02',
      flows: [flow('2026-09-30', -5_000), flow('2026-10-01', -1_000)],
    });
    expect(p.points.map((point) => point.balance)).toEqual([10_000, 9_000, 9_000]);
  });

  it('protects the floor only from its start date and caps spending by the lowest later day', () => {
    const p = project({
      asOf: '2026-11-20',
      startBalance: 150_000,
      horizonEnd: '2026-12-15',
      floor: [{ from: '2026-11-30', amount: 100_000 }],
      flows: [flow('2026-11-25', -20_000), flow('2026-12-05', -10_000), flow('2026-12-10', 50_000)],
    });
    expect(p.points.find((point) => point.date === '2026-11-29')?.headroom).toBe(130_000); // no floor yet
    expect(p.low.date).toBe('2026-12-05');
    expect(p.safeToSpend).toBe(20_000);
    expect(maxSpendOn(p, '2026-12-10')).toBe(70_000); // after the paycheck
  });

  it('rejects a horizon before asOf', () => {
    expect(() => project({ asOf: '2026-10-10', startBalance: 0, horizonEnd: '2026-10-09', flows: [] })).toThrow();
  });
});

describe('defaultHorizonEnd', () => {
  it('looks to the end of next month, and to Jan 31 from November', () => {
    expect(defaultHorizonEnd('2026-09-30')).toBe('2026-10-31');
    expect(defaultHorizonEnd('2026-11-02')).toBe('2027-01-31');
    expect(defaultHorizonEnd('2026-12-15')).toBe('2027-01-31');
    expect(defaultHorizonEnd('2027-01-10')).toBe('2027-02-28');
  });
});

describe('monthlySummary', () => {
  it('splits money in and out per month, by source and category', () => {
    const flows: Flow[] = [
      flow('2026-10-07', 33_000, 'UMM'),
      flow('2026-10-05', -30_000, 'Rent'),
      flow('2026-10-20', -5_000, 'Groceries', 'card'),
      flow('2026-11-05', -30_000, 'Rent'),
    ];
    const [october, november] = monthlySummary(flows, '2026-10-01', '2026-11-30');
    expect(october).toMatchObject({ month: '2026-10', income: 33_000, spending: 35_000, result: -2_000 });
    expect(october.spendingByCategory).toEqual({ Rent: 30_000, Groceries: 5_000 });
    expect(october.incomeBySource).toEqual({ UMM: 33_000 });
    expect(november).toMatchObject({ month: '2026-11', income: 0, result: -30_000 });
  });
});

describe('flow builders', () => {
  const holidays = holidaySet(2026, 2027);

  it('clamps a bill day to the month and respects from/until', () => {
    const flows = billFlows(
      [{ label: 'Phone', category: 'Phone', amount: 2_600, day: 30, from: '2027-01-01', until: '2027-03-30', paidWith: 'card' }],
      { start: '2026-12-01', end: '2027-04-30' },
      holidays,
    );
    expect(flows.map((f) => f.date)).toEqual(['2027-01-30', '2027-02-28', '2027-03-30']);
    expect(flows[0]).toMatchObject({ amount: -2_600, paidWith: 'card', kind: 'bill' });
  });

  it('places a bill on a business-day rule, e.g. rent paid the day a paycheck lands', () => {
    const flows = billFlows(
      [{ label: 'Rent', category: 'Rent', amount: 30_000, rule: { kind: 'nthBusinessDay', n: 5 } }],
      { start: '2026-10-01', end: '2027-01-31' },
      holidays,
    );
    expect(flows.map((f) => f.date)).toEqual(['2026-10-07', '2026-11-06', '2026-12-07', '2027-01-08']);
  });

  it('spreads a monthly essential per day and scales it while travelling', () => {
    const flows = essentialFlows(
      [{ label: 'Groceries', category: 'Groceries', monthly: 30_000, adjustments: [{ range: { start: '2026-12-20', end: '2026-12-31' }, factor: 0.5 }] }],
      { start: '2026-12-19', end: '2026-12-20' },
    );
    expect(flows.map((f) => f.amount)).toEqual([-986, -493]); // $300 × 12 / 365 per day
  });

  it('moves card purchases to the next due date and pays what is owed now', () => {
    const flows: Flow[] = [flow('2026-10-05', -10_000, 'Software', 'card'), flow('2026-10-05', -30_000, 'Rent')];
    const cash = toCashFlows(flows, { owed: 21_600, dueDay: 21 }, '2026-09-30');
    expect(cash.map((f) => [f.date, f.amount, f.label])).toEqual([
      ['2026-10-05', -30_000, 'Rent'],
      ['2026-10-21', -21_600, 'Card payment'],
      ['2026-11-21', -10_000, 'Card payment'],
    ]);
  });
});
