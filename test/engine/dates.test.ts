import { describe, expect, it } from 'vitest';
import { addDays, addMonths, dayOfWeek, daysInMonth, eachDay, endOfMonth, monthKey } from '../../shared/engine/dates.ts';
import { formatUSD } from '../../shared/engine/money.ts';

describe('dates', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('knows the day of the week', () => {
    expect(dayOfWeek('2026-09-30')).toBe(3); // Wednesday
    expect(dayOfWeek('2026-11-26')).toBe(4); // Thanksgiving, Thursday
  });

  it('counts days in a month, leap years included', () => {
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(endOfMonth('2026-11-10')).toBe('2026-11-30');
  });

  it('steps months across years', () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('lists every day of a range, both ends included', () => {
    expect(eachDay('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(monthKey('2026-10-30')).toBe('2026-10');
  });

  it('rejects malformed dates', () => {
    expect(() => addDays('2026-9-30', 1)).toThrow('Invalid ISO date');
  });
});

describe('formatUSD', () => {
  it('formats cents with sign and thousands separator', () => {
    expect(formatUSD(123456)).toBe('$1,234.56');
    expect(formatUSD(-6000)).toBe('-$60.00');
    expect(formatUSD(5)).toBe('$0.05');
  });
});
