import type { ISODate } from '../engine/dates.ts';
import type { DailyEssential, MonthlyBill, OneOffEvent } from '../engine/flows.ts';
import type { Cents } from '../engine/money.ts';
import type { Job } from '../engine/schedule.ts';
import { RENAMED_CATEGORIES } from '../import/categorize.ts';
import type { JobConfig, Period, PlanConfig } from './config.ts';

/** The first plan format: two hour levels, what-if options and one goal. */
interface PlanV1 {
  reserve: { amount: Cents; from: ISODate };
  goal?: { label: string; amount: Cents; by: ISODate };
  jobs: Job[];
  hours: Record<'conservative' | 'expected', Record<string, V1Hours>>;
  bills: MonthlyBill[];
  essentials: DailyEssential[];
  events: OneOffEvent[];
  notIncluded?: string[];
}

interface V1Hours {
  segments: { from: ISODate; to?: ISODate; weeklyHours: number }[];
  workDays?: number[];
  skipHolidays?: boolean;
  closures?: { start: ISODate; end: ISODate }[];
}

const isV2 = (plan: unknown): plan is PlanConfig => typeof plan === 'object' && plan !== null && (plan as { version?: number }).version === 2;

/** The open-ended segment that applies from now on (the last one without an end), or the last one. */
function usualSegment(hours: V1Hours | undefined) {
  const segments = hours?.segments ?? [];
  return [...segments].reverse().find((s) => !s.to && s.weeklyHours > 0) ?? segments.at(-1);
}

function migrateJob(job: Job, v1: PlanV1): JobConfig {
  const low = v1.hours.conservative?.[job.id];
  const high = v1.hours.expected?.[job.id];
  const usual = usualSegment(low);
  const max = usualSegment(high);
  const before = usual
    ? [...(low?.segments ?? [])].reverse().find((s) => s.to && s.to < usual.from && s.weeklyHours > 0)
    : undefined;
  // Closures and zero-hour stretches become closures of the job, on the same dates.
  const closures: Period[] = [
    ...(low?.closures ?? []).map((c) => ({ label: 'Closed', from: c.start, to: c.end })),
    ...(low?.segments ?? []).filter((s) => s.weeklyHours === 0 && s.to).map((s) => ({ label: 'No hours', from: s.from, to: s.to! })),
  ];
  return {
    ...job,
    weeklyHours: usual?.weeklyHours ?? 0,
    ...(max && usual && max.weeklyHours > usual.weeklyHours ? { maxWeeklyHours: max.weeklyHours } : {}),
    ...(usual ? { hoursSince: usual.from } : {}),
    ...(before ? { previousWeeklyHours: before.weeklyHours } : {}),
    ...(low?.workDays ? { workDays: low.workDays } : {}),
    ...(low?.skipHolidays ? { skipHolidays: true } : {}),
    ...(closures.length ? { closures } : {}),
  };
}

/**
 * Brings a stored plan to the current format. Version 1 had two hour levels and what-if options;
 * it becomes one forecast: the cautious hours as the usual week, the optimistic ones as the most counted.
 */
export function migratePlan(plan: unknown): PlanConfig {
  if (isV2(plan)) return renameCategories(plan);
  const v1 = plan as PlanV1;
  if (!v1 || !Array.isArray(v1.jobs) || !v1.hours) throw new Error('Unknown plan format');
  return renameCategories({
    version: 2,
    reserve: v1.reserve,
    goals: v1.goal ? [{ id: 'goal-1', name: v1.goal.label, target: v1.goal.amount, by: v1.goal.by }] : [],
    jobs: v1.jobs.map((job) => migrateJob(job, v1)),
    away: [],
    bills: v1.bills,
    budgets: v1.essentials.map(({ adjustments, ...budget }) => ({ ...budget, ...(adjustments?.some((a) => a.factor < 1) ? { lessOnTrips: true } : {}) })),
    events: v1.events,
    notes: v1.notIncluded ?? [],
  });
}

/** Older category names (RENAMED_CATEGORIES) become the current ones. The same plan comes back when nothing changes. */
function renameCategories(plan: PlanConfig): PlanConfig {
  const renamed = (category: string) => RENAMED_CATEGORIES[category] ?? category;
  const touched = [...plan.budgets, ...plan.bills, ...plan.events].some((item) => renamed(item.category) !== item.category);
  if (!touched) return plan;
  return {
    ...plan,
    budgets: plan.budgets.map((b) => ({ ...b, category: renamed(b.category), ...(b.label === b.category ? { label: renamed(b.label) } : {}) })),
    bills: plan.bills.map((b) => ({ ...b, category: renamed(b.category) })),
    events: plan.events.map((e) => ({ ...e, category: renamed(e.category) })),
  };
}
