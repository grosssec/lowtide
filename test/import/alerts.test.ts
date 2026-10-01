import { describe, expect, it } from 'vitest';
import { parseBankAlert, settleAlertEntries, type AlertEmail } from '../../shared/import/alerts.ts';

// Fake alerts in the style of bank notification emails.
const email = (from: string, subject: string, body = '', date = '2026-10-07T23:30:00Z'): AlertEmail => ({ id: 'x', from, subject, body, date });
const CHASE = 'Chase <no.reply.alerts@chase.com>';
const DISCOVER = 'Discover Card <discover@services.discover.com>';

describe('parseBankAlert', () => {
  it('reads a debit card purchase in the local date (UTC evening is still the same day in Lakeside)', () => {
    expect(parseBankAlert(email(CHASE, 'Your $3.60 debit card transaction with COCA COLA ROUND ROCK LA'))).toEqual({
      status: 'transaction',
      account: 'chase',
      date: '2026-10-07',
      description: 'COCA COLA ROUND ROCK LA',
      amount: -360,
    });
  });

  it('finds who sent a Zelle payment when the subject does not say', () => {
    expect(parseBankAlert(email(CHASE, 'You received money with Zelle', 'Jane Roe sent you $25.00. The money is in your account.'))).toMatchObject({
      description: 'Zelle Payment From Jane Roe',
      amount: 2_500,
    });
  });

  it('names Zelle transfers the way the statements do, so rules match', () => {
    expect(parseBankAlert(email(CHASE, 'You sent $300.00 to Jane Roe', 'Your Zelle® payment to Jane Roe was sent.'))).toMatchObject({
      description: 'Zelle Payment To Jane Roe',
      amount: -30_000,
    });
    expect(parseBankAlert(email(CHASE, 'You received $50.00 from John Q Public', 'John Q Public sent you money with Zelle®.'))).toMatchObject({
      description: 'Zelle Payment From John Q Public',
      amount: 5_000,
    });
  });

  it('reads a direct deposit as money in, named after the payer', () => {
    expect(parseBankAlert(email(CHASE, 'Your direct deposit of $498.04 has posted', 'A direct deposit from ACME PAYROLL was credited to your account.'))).toMatchObject({
      description: 'Direct deposit ACME PAYROLL',
      amount: 49_804,
    });
  });

  it('reads a card purchase from the body when the subject has no amount', () => {
    expect(parseBankAlert(email(DISCOVER, 'Transaction Alert', 'A transaction of $22.10 at APPLE.COM/BILL was made on October 7, 2026.'))).toEqual({
      status: 'transaction',
      account: 'discover',
      date: '2026-10-07',
      description: 'APPLE.COM/BILL',
      amount: -2_210,
    });
  });

  it('treats a card payment as a transfer that lowers what the card owes', () => {
    expect(parseBankAlert(email(DISCOVER, 'Your payment has been received', 'We received your payment of $216.00.'))).toMatchObject({
      amount: 21_600,
      category: 'Card payment',
      kind: 'transfer',
    });
  });

  it('reads balance alerts', () => {
    expect(parseBankAlert(email(CHASE, 'Your available balance is $1,234.56'))).toEqual({ status: 'balance', account: 'chase', date: '2026-10-07', amount: 123_456 });
  });

  it('never turns reminders, statements or security notes into spending', () => {
    expect(parseBankAlert(email(DISCOVER, 'Your payment of $216.00 is due soon')).status).toBe('ignored');
    expect(parseBankAlert(email(CHASE, 'Your statement is ready')).status).toBe('ignored');
    expect(parseBankAlert(email(CHASE, 'Security alert: new sign-in')).status).toBe('ignored');
    expect(parseBankAlert(email('Netflix <info@netflix.com>', 'You were charged $15.49')).status).toBe('ignored');
    expect(parseBankAlert(email('Chase <alerts@evilchase.com>', 'You made a $500.00 transaction with Shop')).status).toBe('ignored');
    expect(parseBankAlert(email('alerts@chase.com.example.net', 'You made a $500.00 transaction with Shop')).status).toBe('ignored');
    expect(parseBankAlert(email(CHASE, 'Something changed on your account')).status).toBe('unparsed');
  });
});

describe('settleAlertEntries', () => {
  const alerts = [
    { id: 'a1', account: 'chase', date: '2026-10-07', amount: -360 },
    { id: 'a2', account: 'chase', date: '2026-10-07', amount: -360 },
    { id: 'a3', account: 'discover', date: '2026-10-01', amount: -2_210 },
    { id: 'tip', account: 'chase', date: '2026-10-02', amount: -2_000 },
    { id: 'pending', account: 'chase', date: '2026-10-19', amount: -1_500 },
    { id: 'before-file', account: 'chase', date: '2026-09-20', amount: -900 },
  ];
  const row = (id: string, account: string, date: string, postedDate: string, amount: number) => ({ id, account, date, postedDate, amount });

  it('pairs each bank row with one alert of the same account and amount within 4 days', () => {
    const { replaced } = settleAlertEntries(alerts, [
      row('r1', 'chase', '2026-10-08', '2026-10-08', -360),
      row('r2', 'discover', '2026-10-01', '2026-10-04', -2_210),
      row('r3', 'chase', '2026-10-20', '2026-10-20', -360), // too far from both alerts
    ]);
    expect(replaced).toEqual([
      { alertId: 'a3', rowId: 'r2', date: '2026-10-01' },
      // Chase rows only carry the posting date: the alert knows when the money really left.
      { alertId: 'a1', rowId: 'r1', date: '2026-10-07' },
    ]);
  });

  it('drops unpaired alerts the bank should have posted by now, keeps recent ones as pending', () => {
    const { superseded } = settleAlertEntries(alerts, [
      row('r1', 'chase', '2026-10-01', '2026-10-01', -2_400), // the tip changed the amount
      row('r2', 'chase', '2026-10-20', '2026-10-20', -500),
    ]);
    // a1/a2 (Oct 7) and tip (Oct 2) are inside the file and 5+ days old; "pending" is too recent; "before-file" is outside it.
    expect(superseded).toEqual(['a1', 'a2', 'tip']);
  });
});
