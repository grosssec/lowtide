import { describe, expect, it } from 'vitest';
import { parseChaseCheckingStatement, type TextItem } from '../../shared/import/chase-statement.ts';
import { parseMoney } from '../../shared/import/money.ts';

/** One printed line: [x, text] cells at height y. Mirrors the Chase checking layout (fake data). */
const line = (page: number, y: number, cells: [number, string][]): TextItem[] =>
  cells.map(([x, text]) => ({ page, x, y, text }));

const header = (page: number, y: number) =>
  line(page, y, [[36, 'DATE'], [78, 'DESCRIPTION'], [430, 'AMOUNT'], [498, 'BALANCE']]);

function statement(lastBalance = '1,169.25'): TextItem[] {
  return [
    ...line(1, 738, [[362, 'December 18, 2026 through January 15, 2027']]),
    // Summary block above the table: has an AMOUNT label but is not the table
    ...line(1, 480, [[340, 'AMOUNT']]),
    ...line(1, 473, [[40, 'Beginning'], [87, 'Balance'], [344, '$1,000.00']]),
    ...header(1, 366),
    ...line(1, 352, [[87, 'Beginning'], [134, 'Balance'], [502, '$1,000.00']]),
    ...line(1, 336, [[36, '12/21'], [80, 'Card'], [102, 'Purchase'], [170, '12/19'], [195, 'Corner'], [230, 'Store'], [270, 'Card'], [442, '- 3.50'], [507, '996.50']]),
    ...line(1, 327, [[80, '1234']]),
    ...line(1, 315, [[36, '12/24'], [80, 'Payroll'], [134, 'Inc'], [215, 'PPD'], [236, 'ID:'], [251, '0000000001'], [435, '250.00'], [499, '1,246.50']]),
    ...line(1, 65, [[31, '*end*transaction detail']]),
    ...line(1, 24, [[466, 'Page'], [482, '1'], [487, 'of'], [494, '2']]),
    // Page 2: the header repeats; an FX purchase spreads over three lines
    ...line(2, 701, [[29, '*start*transaction detail']]),
    ...header(2, 666),
    ...line(2, 654, [[34, '01/02'], [78, 'Card'], [100, 'Purchase'], [167, '12/31'], [193, 'Shop'], [220, 'Sao'], [245, 'Paulo'], [270, 'Card'], [292, '1234'], [435, '- 20.00'], [497, '1,226.50']]),
    ...line(2, 645, [[78, 'Br'], [89, 'Real']]),
    ...line(2, 636, [[78, '100.00'], [108, 'X'], [117, '0.2000000'], [162, '(Exchg'], [193, 'Rte)']]),
    ...line(2, 624, [[34, '01/02'], [78, 'Foreign'], [111, 'Exch'], [134, 'Rt'], [146, 'ADJ'], [165, 'Fee'], [184, '12/31'], [209, 'Shop'], [440, '-0.60'], [497, '1,225.90']]),
    ...line(2, 612, [[34, '01/05'], [78, 'Zelle'], [100, 'Payment'], [138, 'To'], [152, 'Landlord'], [187, 'Abc123'], [430, '-56.65'], [497, lastBalance]]),
    ...line(2, 509, [[85, 'Ending'], [118, 'Balance'], [500, '$1,169.25']]),
    ...line(2, 503, [[29, '*end*transaction detail']]),
  ];
}

describe('parseChaseCheckingStatement', () => {
  it('reads period, balances and every row, checked against the running balance', () => {
    const parsed = parseChaseCheckingStatement(statement());
    expect(parsed.period).toEqual({ start: '2026-12-18', end: '2027-01-15' });
    expect(parsed.beginningBalance).toBe(100_000);
    expect(parsed.endingBalance).toBe(116_925);
    expect(parsed.rows.map((r) => [r.postedDate, r.date, r.amount])).toEqual([
      ['2026-12-21', '2026-12-19', -350],
      ['2026-12-24', '2026-12-24', 25_000],
      ['2027-01-02', '2026-12-31', -2_000], // posted in January, bought on Dec 31
      ['2027-01-02', '2026-12-31', -60],
      ['2027-01-05', '2027-01-05', -5_665],
    ]);
  });

  it('joins continuation lines and drops the card number', () => {
    const [corner, , fx] = parseChaseCheckingStatement(statement()).rows;
    expect(corner.description).toBe('Card Purchase 12/19 Corner Store');
    expect(fx.description).toBe('Card Purchase 12/31 Shop Sao Paulo Br Real 100.00 X 0.2000000 (Exchg Rte)');
  });

  it('refuses a statement whose rows do not match the printed balance', () => {
    expect(() => parseChaseCheckingStatement(statement('1,169.24'))).toThrow(/balance should be/);
  });
});

describe('parseMoney', () => {
  it('handles signs, spaces, dollar signs and thousands', () => {
    expect(parseMoney('- 3.60')).toBe(-360);
    expect(parseMoney('-2,113.35')).toBe(-211_335);
    expect(parseMoney('$821.67')).toBe(82_167);
    expect(() => parseMoney('3.6')).toThrow();
  });
});
