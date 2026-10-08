import { addDays, eachDay, endOfMonth, isWithin, monthKey, type ISODate } from '../engine/dates.ts';
import { billFlows, type DailyEssential, type Flow } from '../engine/flows.ts';
import type { Cents } from '../engine/money.ts';
import type { Actuals, PlanConfig } from './config.ts';
import { budgetsWithTrips, planFlows, type Forecast } from './forecast.ts';

const byDate = (a: Flow, b: Flow) => a.date.localeCompare(b.date);

/** A monthly budget spread evenly over the days of its month, scaled during trips. */
function dailyWeight(items: DailyEssential[], date: ISODate, daysInMonth: number): number {
  let total = 0;
  for (const item of items) {
    const factor = item.adjustments?.find((a) => isWithin(date, a.range))?.factor ?? 1;
    total += (item.monthly / daysInMonth) * factor;
  }
  return total;
}

/**
 * What the forecast still expects after today, adjusted for what already happened this month:
 * - day-to-day budgets for the rest of this month = what is left of each budget, spread over the remaining days;
 * - bills due on or before today that are not in the books yet move to tomorrow, so nothing is forgotten;
 * - paychecks and events dated today or earlier are left out (they are in the books, or not counted).
 */
export function forwardFlows(config: PlanConfig, actuals: Actuals, end: ISODate, holidays: ReadonlySet<ISODate>): Forecast {
  const today = actuals.today;
  const tomorrow = addDays(today, 1);
  const monthStart = `${monthKey(today)}-01`;
  const monthEnd = endOfMonth(today);
  const forecast = planFlows(config, { start: tomorrow, end }, holidays, actuals.hours);
  const result = forecast.flows.filter((f) => !(f.kind === 'essential' && f.date <= monthEnd));

  if (tomorrow <= monthEnd) {
    const categories = new Map<string, DailyEssential[]>();
    for (const item of budgetsWithTrips(config, { start: monthStart, end: monthEnd })) {
      categories.set(item.category, [...(categories.get(item.category) ?? []), item]);
    }
    const remaining = eachDay(tomorrow, monthEnd);
    const days = eachDay(monthStart, monthEnd).length;
    for (const [category, items] of categories) {
      const planned = eachDay(monthStart, monthEnd).reduce((total, date) => total + dailyWeight(items, date, days), 0);
      const left = Math.max(0, Math.round(planned - (actuals.spentThisMonth[category] ?? 0)));
      const weights = remaining.map((date) => dailyWeight(items, date, days));
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      if (left === 0 || totalWeight === 0) continue;
      let cumulative = 0;
      let given = 0;
      remaining.forEach((date, i) => {
        cumulative += weights[i];
        const target = Math.round((left * cumulative) / totalWeight);
        const amount: Cents = target - given;
        given = target;
        if (amount > 0) {
          result.push({ date, amount: -amount, label: items[0].label, category, kind: 'essential', paidWith: items[0].paidWith ?? 'checking' });
        }
      });
    }
  }

  // Bills already due this month: spending in the bill's category counts as paying it (largest bills first).
  const seen = { ...actuals.spentThisMonth };
  for (const bill of billFlows(config.bills, { start: monthStart, end: today }, holidays).sort((a, b) => a.amount - b.amount)) {
    const due = -bill.amount;
    const available = seen[bill.category] ?? 0;
    if (available >= due * 0.8) {
      seen[bill.category] = available - due;
      continue;
    }
    result.push({ ...bill, date: tomorrow, label: `${bill.label} (not seen yet)` }); // matched by dashboard.ts (LATE)
  }

  return { ...forecast, flows: result.sort(byDate) };
}
