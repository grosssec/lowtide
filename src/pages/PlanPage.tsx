import { useMemo } from 'react';
import type { Balances, PlanConfig } from '../../shared/plan/config.ts';
import { buildYearPlan } from '../../shared/plan/year.ts';
import { MonthLines } from '../components/charts.tsx';
import { Card, ErrorNote, Loading } from '../components/ui.tsx';
import { money, monthLabel, monthShort, shortDate } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';

const COLORS = ['var(--series-1)', 'var(--series-2)'];

export function PlanPage() {
  const { data: inputs, error } = useApi<{ plan: PlanConfig; balances: Balances }>('/plan');
  // Computed here, not on the Worker: it needs more CPU than the free plan allows per request.
  const data = useMemo(() => (inputs ? buildYearPlan(inputs.plan, inputs.balances) : undefined), [inputs]);
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;

  const months = data.scenarios[0]?.months.map((m) => m.month) ?? [];
  const floor = months.map((m) => (`${m}-31` >= data.reserve.from ? data.reserve.amount : null));
  const goal = data.goal;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Plan until {months.length ? monthLabel(months[months.length - 1]) : '—'}</h1>
        <p className="mt-1 text-sm text-ink-2">From your balances on {shortDate(data.asOf)}, with the bills, budgets and events in Settings.</p>
      </div>

      <Card title="Balance at the end of each month">
        <MonthLines
          months={months.map(monthShort)}
          series={data.scenarios.map((s, i) => ({ label: s.label, color: COLORS[i % COLORS.length], values: s.months.map((m) => m.endBalance) }))}
          floor={floor}
        />
        <ul className="mt-3 space-y-1 text-xs text-muted">
          {data.scenarios.map((s) => (
            <li key={s.label}>
              <span className="font-medium text-ink-2">{s.label}:</span> {s.level} hours, {s.optionLabel}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Month by month">
        <table className="num w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1.5 font-normal">Month</th>
              {data.scenarios.map((s) => (
                <th key={s.label} className="py-1.5 text-right font-normal">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {months.map((month, i) => (
              <tr key={month}>
                <td className="py-2 text-ink-2">{monthShort(month)}</td>
                {data.scenarios.map((s) => {
                  const row = s.months[i];
                  const belowReserve = floor[i] !== null && row.endBalance < (floor[i] ?? 0);
                  return (
                    <td key={s.label} className="py-2 text-right">
                      <div className="text-ink">
                        {money(row.endBalance)}
                        {belowReserve && <span className="sr-only"> (below the reserve)</span>}
                        {belowReserve && (
                          <span aria-hidden="true" className="ml-1 text-warning">
                            ▲
                          </span>
                        )}
                      </div>
                      <div className={`text-xs ${row.result < 0 ? 'text-critical-ink' : 'text-muted'}`}>{money(row.result, { sign: true })} in the month</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">Balance at the end of each month (bank + cash − card). ▲ below the {money(data.reserve.amount)} reserve.</p>
      </Card>

      {data.checkpoints.length > 0 && (
        <Card title="Room to spend without touching the reserve">
          <ul className="divide-y divide-line text-sm">
            {data.checkpoints.map((c) => (
              <li key={c.label} className="py-2">
                <div className="text-ink">{c.label}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 text-ink-2">
                  {c.room.map((room, i) => (
                    <span key={data.scenarios[i].label} className="num">
                      {data.scenarios[i].label}: <span className="font-medium text-ink">{money(room)}</span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`${goal.label} · goal ${money(goal.amount)} by ${shortDate(goal.by)}`}>
        <ul className="space-y-4">
          {goal.options.map((option) => (
            <li key={option.key}>
              <div className="text-sm text-ink">{option.label}</div>
              {(['conservative', 'expected'] as const).map((level) => {
                const value = option.aboveReserve[level];
                const share = Math.max(0, Math.min(1, value / goal.amount));
                return (
                  <div key={level} className="mt-1.5">
                    <div className="flex justify-between text-xs text-ink-2">
                      <span>{level === 'conservative' ? 'Fewer hours' : 'More hours'}</span>
                      <span className="num text-ink">{money(value)}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-surface-2">
                      <div className="h-2 rounded-full bg-series-1" style={{ width: `${share * 100}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="mt-1 text-xs text-muted">
                Average month: {money(option.averageResult.conservative, { sign: true })} to {money(option.averageResult.expected, { sign: true })}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {data.notIncluded.length > 0 && (
        <Card title="Not in these numbers yet">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            {data.notIncluded.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
