import type { DateRange, ISODate } from '../engine/dates.ts';
import type { DailyEssential, MonthlyBill, OneOffEvent } from '../engine/flows.ts';
import type { Cents } from '../engine/money.ts';
import type { HoursPlan, HoursSegment, Job, RateChange } from '../engine/schedule.ts';

export type Level = 'conservative' | 'expected';

/** A mutually exclusive what-if for one job, e.g. whether a campus job comes back next semester. */
export interface JobOption {
  jobId: string;
  label: string;
  /** Appended to the job's hours plan, so they win over earlier segments. */
  segments: HoursSegment[];
  rate?: RateChange;
}

export interface Scenario {
  label: string;
  level: Level;
  option: string;
}

export interface PlanConfig {
  planEnd: ISODate;
  /** Money that is never available to spend, from a date on. */
  reserve: { amount: Cents; from: ISODate };
  goal: { label: string; amount: Cents; by: ISODate; averageMonths: DateRange };
  jobs: Job[];
  hours: Record<Level, Record<string, HoursPlan>>;
  jobOptions: Record<string, JobOption>;
  /** Shown side by side. The first one drives the Month screen, so it should be the cautious one. */
  mainScenarios: Scenario[];
  bills: MonthlyBill[];
  /** Day-to-day spending per category (monthly budget, spread per day). */
  essentials: DailyEssential[];
  events: OneOffEvent[];
  /** "How much can I spend on this date without breaking anything until horizonEnd?" */
  checkpoints: { label: string; date: ISODate; horizonEnd: ISODate }[];
  notIncluded?: string[];
}

/** One snapshot of what is in the accounts, all taken on the same day. */
export interface Balances {
  checking: Cents;
  cash: Cents;
  cardOwed: Cents;
  asOf: ISODate;
  cardDueDay: number;
}

export const netBalance = (b: Balances): Cents => b.checking + b.cash - b.cardOwed;
