import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, makeCategorizer } from '../../shared/import/categorize.ts';
import { detectCsv, parseChaseCheckingCsv, parseCsv, parseDiscoverCsv } from '../../shared/import/csv.ts';
import { mergeLedger, summarizeLedger, withIds, type LedgerEntry } from '../../shared/import/ledger.ts';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, commas inside fields and CRLF', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });
});

describe('bank CSV exports', () => {
  const chase = [
    'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #',
    'DEBIT,09/22/2026,"CORNER STORE AUSTIN TX  09/21",-3.60,DEBIT_CARD,276.00,,',
    'CREDIT,09/18/2026,PAYROLL INC PPD ID: 0000000001,250.00,ACH_CREDIT,,,',
  ].join('\n');
  const discover = [
    'Trans. Date,Post Date,Description,Amount,Category',
    '09/15/2026,09/15/2026,APPLE.COM/BILL 866-712-7753 CA,22.10,Merchandise',
    '09/21/2026,09/21/2026,DIRECTPAY FULL BALANCE,-381.47,Payments and Credits',
  ].join('\n');

  it('detects which bank a CSV comes from', () => {
    expect(detectCsv(chase)).toBe('chase-checking');
    expect(detectCsv(discover)).toBe('discover');
    expect(detectCsv('foo,bar\n1,2')).toBeNull();
  });

  it('reads Chase checking rows with signed amounts and optional balance', () => {
    const rows = parseChaseCheckingCsv(chase);
    expect(rows[0]).toMatchObject({ postedDate: '2026-09-22', amount: -360, balance: 27_600, description: 'CORNER STORE AUSTIN TX 09/21' });
    expect(rows[1]).toMatchObject({ postedDate: '2026-09-18', amount: 25_000 });
    expect(rows[1].balance).toBeUndefined();
  });

  it('turns Discover charges into money out and payments into money in', () => {
    const [charge, payment] = parseDiscoverCsv(discover);
    expect(charge).toMatchObject({ date: '2026-09-15', amount: -2_210, bankCategory: 'Merchandise' });
    expect(payment.amount).toBe(38_147);
  });

  it('names the missing column when the header is wrong', () => {
    expect(() => parseDiscoverCsv('Date,Amount\n01/01/2026,1.00')).toThrow(/Trans\. Date/);
  });
});

describe('categorizer', () => {
  const categorize = makeCategorizer([{ match: 'zelle payment to landlord', category: 'Rent' }, ...DEFAULT_RULES]);

  it('lets personal rules win over defaults', () => {
    expect(categorize('Zelle Payment To Landlord Abc123', -30_000)).toEqual({ category: 'Rent', kind: 'expense' });
    expect(categorize('Zelle Payment To Friend Xyz', -1_000)).toEqual({ category: 'Sent to people', kind: 'expense' });
  });

  it('keeps specific merchants ahead of broad ones', () => {
    expect(categorize('WALMART^ MEMBER 07/26 800-925-6278 AR', -1_295).category).toBe('Subscriptions');
    expect(categorize('WALMART STORE 00075 AUSTIN TX', -902).category).toBe('Groceries');
    expect(categorize('AMAZON PRIME*0E2YJ0N33 AMZN.COM/BILLWA', -1_656).category).toBe('Subscriptions');
    expect(categorize('Card Purchase With Pin 07/14 Seaworld-Food Svc Orlando FL', -1_192).category).toBe('Dining out');
    expect(categorize('Card Purchase 07/23 Sq *Phenomenal Sports B Orlando FL', -326).category).toBe('Fun');
    expect(categorize('Card Purchase 08/02 Hidden Grounds Coffee Austin TX', -500).category).toBe('Dining out');
  });

  it('marks card payments as transfers, never spending', () => {
    expect(categorize('Discover E-Payment 0000 Web ID: 0000000000', -17_847)).toEqual({ category: 'Card payment', kind: 'transfer' });
    expect(categorize('DIRECTPAY FULL BALANCE', 38_147).kind).toBe('transfer');
  });

  it('applies a rule only in the direction it is meant for', () => {
    const withPayroll = makeCategorizer([{ match: 'lakeside chri|lakeside col', sign: 'in', category: 'Bookstore', kind: 'income' }, ...DEFAULT_RULES]);
    expect(withPayroll('LAKESIDE CHRISTIAN UN PAYROLL PPD ID: 0000000002', 74_000)).toEqual({ category: 'Bookstore', kind: 'income' });
    // Direct deposits carry the payer's name cut at 16 characters.
    expect(withPayroll('LAKESIDE CHRIST PAYROLL PPD ID: 0000000002', 74_000)).toEqual({ category: 'Bookstore', kind: 'income' });
    expect(withPayroll('LAKESIDE COLLEG BUSINESS OFFICE', -60_000)).toEqual({ category: 'Education', kind: 'expense' });
    expect(withPayroll('Card Purchase 09/01 Lakeside Christian University Austin TX', -414)).toEqual({ category: 'Education', kind: 'expense' });
  });

  it('sorts pharmacy and haircuts into health & personal care, ahead of the store they are in', () => {
    expect(categorize('Card Purchase With Pin 05/22 Walgreens Store 7301 S Winderme', -3_971).category).toBe('Health & personal care');
    expect(categorize('GREAT CLIPS #1234 ROUND ROCK TX', -1_500).category).toBe('Health & personal care');
    expect(categorize('WAL-MART #0075 AUSTIN TX', -7_460).category).toBe('Groceries');
  });

  it('counts refunds as money in only when money comes in', () => {
    expect(categorize('AMAZON REFUND AMZN.COM', 2_000)).toEqual({ category: 'Refunds', kind: 'income' });
    expect(categorize('AMAZON MKTPL*5R2YE11', -2_000).category).toBe('Shopping');
  });

  it('falls back by sign when nothing matches', () => {
    expect(categorize('Something New', -100)).toEqual({ category: 'Uncategorized', kind: 'expense' });
    expect(categorize('Something New', 100)).toEqual({ category: 'Uncategorized income', kind: 'income' });
  });
});

describe('ledger', () => {
  const entry = (id: string, date: string, amount: number, category: string, kind: LedgerEntry['kind']): LedgerEntry => ({
    id,
    account: 'chase',
    date,
    postedDate: date,
    description: id,
    amount,
    category,
    kind,
    source: 'test',
  });

  it('gives identical same-day purchases different ids', () => {
    const rows = withIds('chase', [
      { postedDate: '2026-09-08', amount: -360, description: 'Coca Cola' },
      { postedDate: '2026-09-08', amount: -360, description: 'Coca Cola' },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['chase|2026-09-08|-360|coca cola|1', 'chase|2026-09-08|-360|coca cola|2']);
  });

  it('merges without duplicating and keeps existing edits', () => {
    const existing = [entry('a', '2026-09-01', -500, 'Groceries (edited)', 'expense')];
    const { ledger, added } = mergeLedger(existing, [entry('a', '2026-09-01', -500, 'Groceries', 'expense'), entry('b', '2026-09-02', -100, 'Snacks', 'expense')]);
    expect(added).toBe(1);
    expect(ledger.map((e) => [e.id, e.category])).toEqual([['a', 'Groceries (edited)'], ['b', 'Snacks']]);
  });

  it('summarizes months without counting transfers', () => {
    const [september] = summarizeLedger([
      entry('pay', '2026-09-09', 31_736, 'Paycheck', 'income'),
      entry('rent', '2026-09-08', -30_000, 'Rent', 'expense'),
      entry('card', '2026-09-21', -38_147, 'Card payment', 'transfer'),
    ]);
    expect(september).toMatchObject({ month: '2026-09', income: 31_736, spending: 30_000, result: 1_736 });
  });
});
