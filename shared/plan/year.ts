import { addDays, endOfMonth, makeDate, parts, type ISODate } from '../engine/dates.ts';
import { holidaySet } from '../engine/holidays.ts';
import type { Cents } from '../engine/money.ts';
import { maxSpendOn, monthlySummary, project } from '../engine/projection.ts';
import type { Paycheck } from '../engine/schedule.ts';
import { netBalance, type Balances, type Level, type PlanConfig, type Scenario } from './config.ts';
import { scenarioFlows } from './scenario.ts';

export interface YearPlanData {
  asOf: ISODate;
  reserve: PlanConfig['reserve'];
  scenarios: (Scenario & {
    optionLabel: string;
    months: { month: string; income: Cents; spending: Cents; result: Cents; endBalance: Cents }[];
    paychecks: Paycheck[];
  })[];
  checkpoints: { label: string; date: ISODate; horizonEnd: ISODate; room: Cents[] }[];
  goal: PlanConfig['goal'] & {
    options: { key: string; label: string; aboveReserve: Record<Level, Cents>; averageResult: Record<Level, Cents> }[];
  };
  notIncluded: string[];
}

const LEVELS: Level[] = ['conservative', 'expected'];

/** Month-by-month plan until planEnd for the main scenarios, spending room at checkpoints and the savings goal under every option. */
export function buildYearPlan(config: PlanConfig, balances: Balances): YearPlanData {
  const range = { start: addDays(balances.asOf, 1), end: config.planEnd };
  const holidays = holidaySet(parts(balances.asOf).year, parts(config.planEnd).year);
  const floor = [{ from: config.reserve.from, amount: config.reserve.amount }];
  const start = netBalance(balances);
  const run = (scenario: Scenario, horizonEnd: ISODate = config.planEnd) => {
    const { paychecks, flows } = scenarioFlows(config, scenario, range, holidays);
    return { paychecks, flows, projection: project({ asOf: balances.asOf, startBalance: start, flows, horizonEnd, floor }) };
  };

  const scenarios = config.mainScenarios.map((scenario) => {
    const { paychecks, flows, projection } = run(scenario);
    const balanceOn = new Map(projection.points.map((p) => [p.date, p.balance]));
    return {
      ...scenario,
      optionLabel: config.jobOptions[scenario.option]?.label ?? scenario.option,
      paychecks,
      months: monthlySummary(flows, range.start, range.end).map((m) => ({
        month: m.month,
        income: m.income,
        spending: m.spending,
        result: m.result,
        endBalance: balanceOn.get(endOfMonth(makeDate(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7)), 1))) ?? 0,
      })),
    };
  });

  const checkpoints = config.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    room: config.mainScenarios.map((scenario) => maxSpendOn(run(scenario, checkpoint.horizonEnd).projection, checkpoint.date)),
  }));

  const options = Object.entries(config.jobOptions).map(([key, option]) => {
    const aboveReserve = {} as Record<Level, Cents>;
    const averageResult = {} as Record<Level, Cents>;
    for (const level of LEVELS) {
      const { flows, projection } = run({ label: key, level, option: key }, config.goal.by);
      aboveReserve[level] = projection.points[projection.points.length - 1].balance - config.reserve.amount;
      const months = monthlySummary(flows, config.goal.averageMonths.start, config.goal.averageMonths.end);
      averageResult[level] = Math.round(months.reduce((total, m) => total + m.result, 0) / Math.max(1, months.length));
    }
    return { key, label: option.label, aboveReserve, averageResult };
  });

  return {
    asOf: balances.asOf,
    reserve: config.reserve,
    scenarios,
    checkpoints,
    goal: { ...config.goal, options },
    notIncluded: config.notIncluded ?? [],
  };
}
