import { endOfMonth, makeDate, monthKey, parts, type ISODate } from '../engine/dates.ts';
import { holidaySet } from '../engine/holidays.ts';
import type { Cents } from '../engine/money.ts';
import { maxSpendOn, monthlySummary, project } from '../engine/projection.ts';
import type { Paycheck } from '../engine/schedule.ts';
import type { Actuals, Level, PlanConfig, Scenario } from './config.ts';
import { forwardFlows } from './forward.ts';

export interface YearPlanData {
  today: ISODate;
  reserve: PlanConfig['reserve'];
  scenarios: (Scenario & {
    optionLabel: string;
    /** endBalance is the total balance (bank + cash − card) on the last day of the month, reserve included. */
    months: { month: string; income: Cents; spending: Cents; result: Cents; endBalance: Cents }[];
    paychecks: Paycheck[];
  })[];
  checkpoints: { label: string; date: ISODate; horizonEnd: ISODate; room: Cents[] }[];
  goal: PlanConfig['goal'] & {
    options: { key: string; label: string; aboveReserve: Record<Level, Cents>; averageResult: Record<Level, Cents> }[];
  };
  assumptions: string[];
  notIncluded: string[];
}

const LEVELS: Level[] = ['conservative', 'expected'];
const sum = (record: Record<string, Cents>) => Object.values(record).reduce((a, b) => a + b, 0);

/**
 * Month by month until planEnd for the main scenarios, spending room at checkpoints and the savings goal
 * under every option. Starts from today's live balances; the current month adds what already happened.
 */
export function buildYearPlan(config: PlanConfig, actuals: Actuals): YearPlanData {
  const today = actuals.today;
  const holidays = holidaySet(parts(today).year, parts(config.planEnd).year);
  const floor = [{ from: config.reserve.from, amount: config.reserve.amount }];
  const run = (scenario: Scenario, horizonEnd: ISODate) => {
    const { paychecks, flows } = forwardFlows(config, scenario, actuals, horizonEnd, holidays);
    return { paychecks, flows, projection: project({ asOf: today, startBalance: actuals.net, flows, horizonEnd, floor }) };
  };
  const currentMonth = monthKey(today);

  const scenarios = config.mainScenarios.map((scenario) => {
    const { paychecks, flows, projection } = run(scenario, config.planEnd);
    const balanceOn = new Map(projection.points.map((p) => [p.date, p.balance]));
    const months = monthlySummary(flows, `${currentMonth}-01`, config.planEnd).map((m) => {
      const isCurrent = m.month === currentMonth;
      const income = m.income + (isCurrent ? sum(actuals.receivedThisMonth) : 0);
      const spending = m.spending + (isCurrent ? sum(actuals.spentThisMonth) : 0);
      const monthEnd = endOfMonth(makeDate(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7)), 1));
      return { month: m.month, income, spending, result: income - spending, endBalance: balanceOn.get(monthEnd) ?? actuals.net };
    });
    return { ...scenario, optionLabel: config.jobOptions[scenario.option]?.label ?? scenario.option, paychecks, months };
  });

  const checkpoints = config.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    room: config.mainScenarios.map((scenario) =>
      checkpoint.horizonEnd > today ? maxSpendOn(run(scenario, checkpoint.horizonEnd).projection, checkpoint.date) : 0,
    ),
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
    today,
    reserve: config.reserve,
    scenarios,
    checkpoints,
    goal: { ...config.goal, options },
    assumptions: config.assumptions ?? [],
    notIncluded: config.notIncluded ?? [],
  };
}

