import { monthDay, toDayNumber } from '../engine/dates.ts';
import type { Cents } from '../engine/money.ts';
import type { DashboardData } from './dashboard.ts';

const usd = (cents: Cents) => `${cents < 0 ? '-' : ''}$${Math.round(Math.abs(cents) / 100).toLocaleString('en-US')}`;

/**
 * The daily push: what is in the bank (checking + cash) and what is safe to spend,
 * plus the one thing worth knowing today (an urgent alert, a bill in the next 3 days, or the pace until payday).
 */
export function dailyMessage(data: DashboardData): { title: string; body: string } {
  const safe = data.safeToSpend;
  const title = `Balance ${usd(data.balances.checking + data.balances.cash)} · Available ${usd(safe?.amount ?? 0)}`;
  const lines: string[] = [];

  const urgent = data.alerts.find((a) => a.level === 'critical');
  const days = (date: string) => toDayNumber(date) - toDayNumber(data.today);
  const bill = data.upcoming.find((u) => u.amount < 0 && days(u.date) <= 3);
  if (urgent) lines.push(urgent.text);
  else if (bill) {
    const when = days(bill.date) <= 0 ? 'today' : days(bill.date) === 1 ? 'tomorrow' : `on ${monthDay(bill.date)}`;
    lines.push(`${bill.label} ${usd(-bill.amount)} ${when}`);
  }

  if (safe?.nextPayDate) {
    lines.push(
      safe.amount === 0
        ? `Essentials only until the ${monthDay(safe.nextPayDate)} paycheck`
        : `≈ ${usd(safe.perDay)} a day until the ${monthDay(safe.nextPayDate)} paycheck`,
    );
  }
  return { title, body: lines.join(' · ') || 'All on track' };
}
