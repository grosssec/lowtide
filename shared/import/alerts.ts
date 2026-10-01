import { toDayNumber, type ISODate } from '../engine/dates.ts';
import type { Cents } from '../engine/money.ts';
import type { EntryKind } from './categorize.ts';
import type { LedgerEntry } from './ledger.ts';
import { parseMoney } from './money.ts';

/** One bank alert email, as forwarded by the Apps Script. */
export interface AlertEmail {
  id: string;
  from: string;
  subject: string;
  body: string;
  /** ISO date-time the email was received. */
  date: string;
}

export type AlertAccount = 'chase' | 'discover';

export type ParsedAlert =
  | {
      status: 'transaction';
      account: AlertAccount;
      date: ISODate;
      description: string;
      amount: Cents;
      /** Set when the alert itself says what it is (e.g. a card payment), so rules are not needed. */
      category?: string;
      kind?: EntryKind;
    }
  | { status: 'balance'; account: AlertAccount; date: ISODate; amount: Cents }
  | { status: 'ignored'; note: string }
  | { status: 'unparsed'; note: string };

const MONEY = /\$\s?([\d,]+\.\d{2})/;
const IGNORE =
  /statement (is )?(ready|available)|payment (is )?due|due (date|soon)|minimum payment|reminder|scheduled|will be (paid|charged|debited)|autopay|upcoming|security|sign[- ]?in|log[- ]?in|password|verification|one-time code|new device|profile|offer|reward|cashback bonus|earn |promo|survey|paperless|update your|card (is )?on the way|activate/i;
const TRANSACTION =
  /transaction|purchase|charged?|spent|debit card|card (was )?used|withdrawal|atm|zelle|direct deposit|deposit|refund|credit(ed)?|payment (was |has been )?(received|posted|sent|made)|received your payment|you (sent|received|made)|transfer/i;
const MONEY_IN =
  /direct deposit|deposit(ed)?\b|credited|refund|you received|received (a |an )?(zelle|payment|money)|payment (was |has been )?(received|posted)|received your payment|money (was )?(added|received)|sent you/i;
const BALANCE = /(available|current|account|ending|new) balance|balance (is|was|of)/i;

const clean = (text: string) =>
  text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[®™]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Calendar date of the email in the user's time zone. */
function localDate(iso: string, timeZone: string): ISODate {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function firstMoney(...texts: string[]): Cents | null {
  for (const text of texts) {
    const match = MONEY.exec(text);
    if (match) return parseMoney(match[1]);
  }
  return null;
}

// A period ends the name only at the end of a sentence, so "APPLE.COM/BILL" stays whole.
const STOP = '(?:\\s+(?:on|for|was|were|has|have|is|using|ending|via|with your|from your|at \\d)\\b|[,!;(]|\\.(?=\\s|$)|$)';
const AFTER = (word: string) => new RegExp(`\\b${word}\\s+(.{2,60}?)${STOP}`, 'i');

function party(texts: string[], words: string[]): string | null {
  for (const text of texts) {
    for (const word of words) {
      const match = AFTER(word).exec(text);
      const value = match?.[1].trim().replace(/[.,;:]+$/, '');
      if (value && !/^(your|you|the|a|an)\b/i.test(value) && !MONEY.test(value)) return value;
    }
  }
  return null;
}

/** Exact sender domain (or a subdomain of it): "evilchase.com" is not Chase. */
function senderAccount(from: string): AlertAccount | null {
  const domain = /@([a-z0-9.-]+)>?\s*$/i.exec(from.trim())?.[1]?.toLowerCase() ?? '';
  const is = (bank: string) => domain === bank || domain.endsWith(`.${bank}`);
  return is('chase.com') ? 'chase' : is('discover.com') ? 'discover' : null;
}

/**
 * Reads a Chase or Discover alert. Only clear transaction or balance messages count;
 * anything doubtful stays 'unparsed', so a reminder can never turn into fake spending.
 */
export function parseBankAlert(email: AlertEmail, timeZone = 'America/Chicago'): ParsedAlert {
  const account = senderAccount(email.from);
  if (!account) return { status: 'ignored', note: 'Not from Chase or Discover' };

  const subject = clean(email.subject);
  const body = clean(email.body);
  const date = localDate(email.date, timeZone);
  if (IGNORE.test(subject)) return { status: 'ignored', note: 'Reminder, statement, security or marketing' };

  const both = `${subject} ${body}`;
  const isTransaction = TRANSACTION.test(both);
  if (!isTransaction && BALANCE.test(both)) {
    const afterBalance = both.slice(both.search(BALANCE));
    const amount = firstMoney(afterBalance);
    return amount === null ? { status: 'unparsed', note: 'Balance without an amount' } : { status: 'balance', account, date, amount };
  }
  if (!isTransaction) return { status: 'unparsed', note: 'No transaction words' };

  const amount = firstMoney(subject, body);
  if (amount === null) return { status: 'unparsed', note: 'No amount' };
  const moneyIn = MONEY_IN.test(both);
  const signed = moneyIn ? amount : -amount;

  // A payment to the card lowers what it owes: a transfer, never income.
  if (account === 'discover' && /payment/i.test(both) && moneyIn) {
    return { status: 'transaction', account, date, description: 'Card payment received', amount: signed, category: 'Card payment', kind: 'transfer' };
  }
  if (/zelle/i.test(both)) {
    const sender = /(?:^|[.!:]\s+)([A-Z][\w.'-]*(?: [A-Z][\w.'-]*){0,3}) sent you\b/.exec(body)?.[1];
    const name = moneyIn ? (party([subject, body], ['from']) ?? sender ?? null) : party([subject, body], ['to']);
    return { status: 'transaction', account, date, description: `Zelle Payment ${moneyIn ? 'From' : 'To'} ${name ?? 'someone'}`, amount: signed };
  }
  if (/direct deposit/i.test(both)) {
    const payer = party([subject, body], ['from']);
    return { status: 'transaction', account, date, description: `Direct deposit ${payer ?? ''}`.trim(), amount: signed };
  }
  const merchant = party([subject, body], moneyIn ? ['from', 'at', 'with'] : ['at', 'with', 'to']);
  return { status: 'transaction', account, date, description: merchant ?? subject, amount: signed };
}

const daysApart = (a: ISODate, b: ISODate) => Math.abs(toDayNumber(a) - toDayNumber(b));

/** Days the bank may take to post a purchase that an alert already reported. */
const PAIR_DAYS = 4;
const POST_DAYS = 5;

export interface AlertSettlement {
  /** Alert entry → bank row that replaces it. `date` is the earlier of the two (Chase rows only carry the posting date); `at` is the alert's time. */
  replaced: { alertId: string; rowId: string; date: ISODate; at?: string }[];
  /** Unpaired alert entries inside the file's period, old enough to have posted: declined, reversed, or a changed amount (a tip). */
  superseded: string[];
}

/**
 * Settles alert-made entries against rows from a statement or CSV: the bank's own rows are the record.
 * Each row pairs with at most one alert of the same account and amount, within 4 days (closest first).
 * Recent unpaired alerts stay: they are still pending at the bank.
 */
export function settleAlertEntries(
  alertEntries: Pick<LedgerEntry, 'id' | 'account' | 'date' | 'amount' | 'at'>[],
  rows: Pick<LedgerEntry, 'id' | 'account' | 'date' | 'postedDate' | 'amount'>[],
): AlertSettlement {
  const used = new Set<string>();
  const replaced: AlertSettlement['replaced'] = [];
  const gap = (alert: { date: ISODate }, row: { date: ISODate; postedDate: ISODate }) =>
    Math.min(daysApart(alert.date, row.date), daysApart(alert.date, row.postedDate));

  for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    const match = alertEntries
      .filter((alert) => !used.has(alert.id) && alert.account === row.account && alert.amount === row.amount && gap(alert, row) <= PAIR_DAYS)
      .sort((a, b) => gap(a, row) - gap(b, row))[0];
    if (!match) continue;
    used.add(match.id);
    replaced.push({
      alertId: match.id,
      rowId: row.id,
      date: match.date < row.date ? match.date : row.date,
      ...(match.at && match.date <= row.date ? { at: match.at } : {}),
    });
  }

  const periods = new Map<string, { start: ISODate; end: ISODate }>();
  for (const row of rows) {
    const period = periods.get(row.account);
    if (!period) periods.set(row.account, { start: row.date, end: row.postedDate });
    else {
      if (row.date < period.start) period.start = row.date;
      if (row.postedDate > period.end) period.end = row.postedDate;
    }
  }
  const superseded = alertEntries
    .filter((alert) => {
      const period = periods.get(alert.account);
      return (
        !used.has(alert.id) && period && alert.date >= period.start && toDayNumber(period.end) - toDayNumber(alert.date) >= POST_DAYS
      );
    })
    .map((alert) => alert.id);
  return { replaced, superseded };
}
