import type { DateRange, ISODate } from '../engine/dates.ts';
import { billFlows, essentialFlows, eventFlows, paycheckFlows, type Flow } from '../engine/flows.ts';
import { paychecksBetween, type HoursPlan, type Job, type Paycheck } from '../engine/schedule.ts';
import type { PlanConfig, Scenario } from './config.ts';

/** Paychecks plus every planned outflow for one scenario, dated inside `range`. */
export function scenarioFlows(
  config: PlanConfig,
  scenario: Scenario,
  range: DateRange,
  holidays: ReadonlySet<ISODate>,
): { paychecks: Paycheck[]; flows: Flow[] } {
  const option = config.jobOptions[scenario.option];
  const paychecks = config.jobs.flatMap((job) => {
    const base = config.hours[scenario.level][job.id];
    if (!base) return [];
    const applies = option?.jobId === job.id;
    const plan: HoursPlan = applies ? { ...base, segments: [...base.segments, ...option.segments] } : base;
    const effectiveJob: Job = applies && option.rate ? { ...job, rates: [...job.rates, option.rate] } : job;
    return paychecksBetween(effectiveJob, plan, range.start, range.end, holidays);
  });
  const flows = [
    ...paycheckFlows(paychecks),
    ...billFlows(config.bills, range, holidays),
    ...essentialFlows(config.essentials, range),
    ...eventFlows(config.events, range),
  ];
  return { paychecks, flows };
}

/** Monthly budget per category: day-to-day budgets plus bills. */
export function monthlyBudgets(config: PlanConfig): Record<string, number> {
  const budgets: Record<string, number> = {};
  for (const item of config.essentials) budgets[item.category] = (budgets[item.category] ?? 0) + item.monthly;
  for (const bill of config.bills) budgets[bill.category] = (budgets[bill.category] ?? 0) + bill.amount;
  return budgets;
}
