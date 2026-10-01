import { describe, expect, it } from 'vitest';
import { displayName, suggestKeyword } from '../../shared/import/display.ts';

describe('displayName', () => {
  it('drops card prefixes, references and wallet suffixes', () => {
    expect(displayName('Card Purchase With Pin 09/14 Dollar General #13419 Austin LA')).toBe('Dollar General #13419 Austin LA');
    expect(displayName('Recurring Card Purchase 08/13 Capcut 650-5840896 De')).toBe('Capcut 650-5840896 De');
    expect(displayName('Payroll Payroll PPD ID: 0000000001')).toBe('Payroll');
    expect(displayName('Card Purchase 09/07 Coca Cola Round Rock LA Round Rock LA')).toBe('Coca Cola Round Rock LA');
    expect(displayName('APPLE.COM/BILL 866-712-7753 CAAPPLE PAY ENDING IN 1234ABCDEFGHIJ')).toBe('APPLE.COM/BILL 866-712-7753 CA');
    expect(displayName('Card Purchase 05/31 Pg *Eros Negocios Digi Barueri Br Real 297.00 X 0.1988215 (Exchg Rte)')).toBe('Pg *Eros Negocios Digi Barueri');
  });

  it('names Zelle transfers after the person', () => {
    expect(displayName('Zelle Payment To Jane Roe Jpm11Abc2De3')).toBe('Zelle to Jane Roe');
    expect(displayName('Zelle Payment From John Q Public 30000000001')).toBe('Zelle from John Q Public');
    expect(displayName('Zelle Payment To Sam W Jpm11Xyz9Q11')).toBe('Zelle to Sam W');
  });

  it('labels foreign exchange fees', () => {
    expect(displayName('Foreign Exch Rt ADJ Fee 05/31 Pg *Eros Negocios Digi Barueri')).toBe('FX fee · Pg *Eros Negocios Digi Barueri');
  });
});

describe('suggestKeyword', () => {
  it('suggests merchant words that appear in the raw description', () => {
    expect(suggestKeyword('Card Purchase With Pin 09/14 Dollar General #13419 Austin LA')).toBe('Dollar General');
    expect(suggestKeyword('Card Purchase 09/07 Coca Cola Round Rock LA Round Rock LA')).toBe('Coca Cola');
    expect(suggestKeyword('Zelle Payment To Jane Roe Jpm11Abc2De3')).toBe('Jane Roe');
    expect(suggestKeyword('WALMART STORE 00075 AUSTIN LA')).toBe('WALMART STORE');
  });
});
