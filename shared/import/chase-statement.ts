import { makeDate, parts, type ISODate } from '../engine/dates.ts';
import type { Cents } from '../engine/money.ts';
import { isMoney, parseMoney } from './money.ts';

/** A piece of text from a PDF page, positioned in PDF points (y grows upwards). */
export interface TextItem {
  page: number;
  x: number;
  y: number;
  text: string;
}

export interface StatementRow {
  postedDate: ISODate;
  /** Purchase date printed in the description when present, otherwise the posted date. */
  date: ISODate;
  description: string;
  amount: Cents;
  balance: Cents;
}

export interface CheckingStatement {
  period: { start: ISODate; end: ISODate };
  beginningBalance: Cents;
  endingBalance: Cents;
  rows: StatementRow[];
}

interface Line {
  page: number;
  y: number;
  items: TextItem[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PERIOD = /([A-Z][a-z]+) (\d{1,2}), (\d{4}) through ([A-Z][a-z]+) (\d{1,2}), (\d{4})/;
const MMDD = /^\d{2}\/\d{2}$/;
const PURCHASE_DATE = /^(?:Recurring Card Purchase|Card Purchase With Pin|Card Purchase|Payment Received|Foreign Exch Rt ADJ Fee)\s+(\d{2})\/(\d{2})\s/;

const textOf = (items: TextItem[]): string => items.map((item) => item.text.trim()).join(' ').replace(/\s+/g, ' ').trim();

function toLines(items: TextItem[]): Line[] {
  const sorted = items.filter((item) => item.text.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const item of sorted) {
    const last = lines.at(-1);
    if (last && last.page === item.page && Math.abs(last.y - item.y) <= 2) last.items.push(item);
    else lines.push({ page: item.page, y: item.y, items: [item] });
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

function longDate(month: string, day: string, year: string): ISODate {
  const index = MONTHS.indexOf(month);
  if (index < 0) throw new Error(`Unknown month "${month}"`);
  return makeDate(Number(year), index + 1, Number(day));
}

/** MM/DD inside a statement period that may cross New Year. */
function dateInPeriod(mmdd: string, period: { start: ISODate; end: ISODate }): ISODate {
  const [month, day] = mmdd.split('/').map(Number);
  const start = parts(period.start);
  const end = parts(period.end);
  const year = start.year === end.year || month >= start.month ? start.year : end.year;
  return makeDate(year, month, day);
}

/** Card purchases print the purchase date ("Card Purchase 08/18 …"); it can fall in the previous year. */
function purchaseDate(description: string, posted: ISODate): ISODate {
  const match = PURCHASE_DATE.exec(description);
  if (!match) return posted;
  const month = Number(match[1]);
  const { year, month: postedMonth } = parts(posted);
  return makeDate(month > postedMonth ? year - 1 : year, month, Number(match[2]));
}

/** Drops the card's last four digits and squeezes spaces. */
const cleanDescription = (text: string): string => text.replace(/\s*\bCard \d{4}\b/g, '').replace(/\s+/g, ' ').trim();

/**
 * Parses the TRANSACTION DETAIL table of a Chase checking statement (PDF text with positions).
 * Columns are located from the "DATE DESCRIPTION AMOUNT BALANCE" header on each page.
 * Every row is checked against the printed running balance, so a bad parse fails loudly instead of importing wrong numbers.
 */
export function parseChaseCheckingStatement(items: TextItem[]): CheckingStatement {
  const lines = toLines(items);
  const periodMatch = lines.map((line) => textOf(line.items)).join('\n').match(PERIOD);
  if (!periodMatch) throw new Error('Statement period ("Month D, YYYY through Month D, YYYY") not found');
  const period = {
    start: longDate(periodMatch[1], periodMatch[2], periodMatch[3]),
    end: longDate(periodMatch[4], periodMatch[5], periodMatch[6]),
  };

  let beginningBalance: Cents | null = null;
  let endingBalance: Cents | null = null;
  const rows: StatementRow[] = [];
  let columns: { description: number; amount: number; balance: number } | null = null;
  let page = 0;
  let current: (Omit<StatementRow, 'date'> & { postedText: string }) | null = null;
  const pending: (Omit<StatementRow, 'date'> & { postedText: string })[] = [];

  for (const line of lines) {
    if (line.page !== page) {
      page = line.page;
      columns = null;
      current = null;
    }
    const words = line.items.map((item) => item.text.trim());
    if (['DATE', 'DESCRIPTION', 'AMOUNT', 'BALANCE'].every((w) => words.includes(w))) {
      const at = (word: string) => line.items[words.indexOf(word)].x;
      columns = { description: at('DESCRIPTION') - 5, amount: at('AMOUNT') - 30, balance: at('BALANCE') - 12 };
      continue;
    }
    if (!columns) continue;
    const text = textOf(line.items);
    if (text.includes('*end*transaction detail')) {
      columns = null;
      current = null;
      continue;
    }
    const { description: descriptionX, amount: amountX, balance: balanceX } = columns;
    const descriptionText = textOf(line.items.filter((i) => i.x >= descriptionX && i.x < amountX));
    const amountText = textOf(line.items.filter((i) => i.x >= amountX && i.x < balanceX));
    const balanceText = textOf(line.items.filter((i) => i.x >= balanceX));

    if (descriptionText === 'Beginning Balance' && isMoney(balanceText)) {
      beginningBalance = parseMoney(balanceText);
      continue;
    }
    if (descriptionText === 'Ending Balance' && isMoney(balanceText)) {
      endingBalance = parseMoney(balanceText);
      columns = null;
      current = null;
      continue;
    }
    const first = line.items[0];
    if (first.x < descriptionX && MMDD.test(first.text.trim())) {
      if (!isMoney(amountText) || !isMoney(balanceText)) {
        throw new Error(`Page ${line.page}: row without amount or balance: "${text}"`);
      }
      current = {
        postedText: first.text.trim(),
        postedDate: dateInPeriod(first.text.trim(), period),
        description: descriptionText,
        amount: parseMoney(amountText),
        balance: parseMoney(balanceText),
      };
      pending.push(current);
    } else if (current && descriptionText && !amountText && !balanceText) {
      current.description += ` ${descriptionText}`;
    }
  }

  if (beginningBalance === null) throw new Error('Beginning Balance not found');
  if (endingBalance === null) throw new Error('Ending Balance not found');

  let running = beginningBalance;
  for (const [index, row] of pending.entries()) {
    running += row.amount;
    if (running !== row.balance) {
      throw new Error(
        `Row ${index + 1} (${row.postedText} ${row.description}): balance should be ${running / 100}, statement shows ${row.balance / 100}`,
      );
    }
    const description = cleanDescription(row.description);
    rows.push({
      postedDate: row.postedDate,
      date: purchaseDate(description, row.postedDate),
      description,
      amount: row.amount,
      balance: row.balance,
    });
  }
  if (running !== endingBalance) {
    throw new Error(`Rows add up to ${running / 100}, statement ending balance is ${endingBalance / 100}`);
  }
  return { period, beginningBalance, endingBalance, rows };
}
