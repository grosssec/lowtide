import { describe, expect, it } from 'vitest';
import { holidaySet, nthBusinessDay, rollToBusinessDay, usFederalHolidays } from '../../shared/engine/holidays.ts';

describe('usFederalHolidays', () => {
  it('computes floating holidays', () => {
    const holidays2026 = usFederalHolidays(2026);
    expect(holidays2026).toContain('2026-09-07'); // Labor Day
    expect(holidays2026).toContain('2026-10-12'); // Columbus Day
    expect(holidays2026).toContain('2026-11-26'); // Thanksgiving
    expect(usFederalHolidays(2027)).toContain('2027-01-18'); // MLK Day
    expect(usFederalHolidays(2027)).toContain('2027-05-31'); // Memorial Day
  });

  it('moves weekend fixed-date holidays to the observed weekday', () => {
    expect(usFederalHolidays(2026)).toContain('2026-07-03'); // July 4 is a Saturday
    expect(usFederalHolidays(2027)).toContain('2027-06-18'); // Juneteenth is a Saturday
    expect(usFederalHolidays(2022)).toContain('2021-12-31'); // New Year's Day 2022 is a Saturday
  });
});

describe('business days', () => {
  const holidays = holidaySet(2026, 2027);

  it('finds the 5th business day of a month', () => {
    expect(nthBusinessDay(2026, 10, 5, holidays)).toBe('2026-10-07');
    expect(nthBusinessDay(2026, 11, 5, holidays)).toBe('2026-11-06');
    expect(nthBusinessDay(2026, 12, 5, holidays)).toBe('2026-12-07');
    expect(nthBusinessDay(2027, 1, 5, holidays)).toBe('2027-01-08'); // Jan 1 is a holiday
  });

  it('rolls weekends and holidays to a business day', () => {
    expect(rollToBusinessDay('2026-11-15', 'forward', holidays)).toBe('2026-11-16'); // Sunday
    expect(rollToBusinessDay('2027-01-16', 'forward', holidays)).toBe('2027-01-19'); // Saturday, then MLK Day
    expect(rollToBusinessDay('2026-11-15', 'backward', holidays)).toBe('2026-11-13');
    expect(rollToBusinessDay('2026-10-15', 'forward', holidays)).toBe('2026-10-15'); // already a business day
  });
});
