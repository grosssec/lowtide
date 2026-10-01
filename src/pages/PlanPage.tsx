import { useMemo, useState } from 'react';
import type { Actuals, PlanConfig } from '../../shared/plan/config.ts';
import { buildYearPlan } from '../../shared/plan/year.ts';
import { MonthLines } from '../components/charts.tsx';
import { Card, ErrorNote, Loading } from '../components/ui.tsx';
import { money, monthLabel, monthShort, shortDate } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';

const COLORS = ['var(--series-1)', 'var(--series-2)'];

export function PlanPage() {
  const { data: inputs, error } = useApi<{ plan: PlanConfig; actuals: Actuals }>('/plan');
  // Computed here, not on the Worker: it needs more CPU than the free plan allows per request.
  const data = useMemo(() => (inputs ? buildYearPlan(inputs.plan, inputs.actuals) : undefined), [inputs]);
  const [view, setView] = useState<'total' | 'free'>('total');
  if (!data || !inputs) return error ? <ErrorNote message={error} /> : <Loading />;

  const months = data.scenarios[0]?.months.map((m) => m.month) ?? [];
  const floor = months.map((m) => (`${m}-31` >= data.reserve.from ? data.reserve.amount : null));
  const goal = data.goal;
  const reserve = money(data.reserve.amount);
  const toggle = 'h-7 rounded-md px-2.5 text-xs font-medium transition';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Plan until {months.length ? monthLabel(months[months.length - 1]) : '—'}</h1>
        <p className="mt-1 text-sm text-ink-2">
          Starts from today&apos;s total of {money(inputs.actuals.net)} (bank + cash − card, the {reserve} reserve included) and the bills, budgets and
          events in Settings.
        </p>
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

      <Card
        title="Month by month"
        action={
          <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Show">
            {(
              [
                ['total', 'Total'],
                ['free', 'Above reserve'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => setView(key)}
                className={`${toggle} ${view === key ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
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
                  const shown = view === 'free' ? row.endBalance - (floor[i] ?? 0) : row.endBalance;
                  return (
                    <td key={s.label} className="py-2 text-right">
                      <div className="text-ink">
                        {money(shown)}
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
        <p className="mt-2 text-xs text-muted">
          {view === 'total'
            ? `Total at the end of each month (bank + cash − card), the ${reserve} reserve included.`
            : `What is left at the end of each month after setting the ${reserve} reserve aside (from ${shortDate(data.reserve.from)}).`}{' '}
          ▲ below the reserve.
        </p>
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
        <p className="-mt-1 mb-3 text-xs text-muted">Money above the {reserve} reserve on {shortDate(goal.by)}, for each work option.</p>
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

      {data.assumptions.length > 0 && (
        <Card title="Assumptions to check">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            {data.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      )}

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
