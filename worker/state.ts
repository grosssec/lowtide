import { HTTPException } from 'hono/http-exception';
import type { ISODate } from '../shared/engine/index.ts';
import { computeActuals, migratePlan, type Actuals, type Balances, type PlanConfig } from '../shared/plan/index.ts';
import { getSetting, loadHours, loadLedger, putSetting, type Entry } from './db.ts';

/** A calendar date in Ricardo's time zone, not UTC. */
export const todayIn = (timeZone: string, at = new Date()): ISODate =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

export const hourIn = (timeZone: string, at = new Date()): number =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(at));

export async function loadPlan(db: D1Database): Promise<{ plan: PlanConfig; balances: Balances }> {
  const [stored, balances] = await Promise.all([getSetting<unknown>(db, 'plan'), getSetting<Balances>(db, 'balances')]);
  if (!stored || !balances) throw new HTTPException(409, { message: 'Plan or balances are missing. Run the seed or fill in Settings.' });
  const plan = migratePlan(stored);
  // An older plan is stored in the current format from now on.
  if (plan !== stored) await putSetting(db, 'plan', plan);
  return { plan, balances };
}

/** Everything a screen or the daily push needs: plan, snapshots, ledger and today's live numbers. */
export async function loadState(env: Env): Promise<{ plan: PlanConfig; balances: Balances; ledger: Entry[]; actuals: Actuals; today: ISODate }> {
  const today = todayIn(env.TIMEZONE);
  const [{ plan, balances }, ledger, hours] = await Promise.all([loadPlan(env.DB), loadLedger(env.DB), loadHours(env.DB)]);
  return { plan, balances, ledger, today, actuals: computeActuals(balances, ledger, today, hours) };
}
