import { useMemo, useState } from 'react';
import type { Actuals, PlanConfig } from '../../shared/plan/config.ts';
import { buildYearPlan, type GoalStatus } from '../../shared/plan/year.ts';
import { MonthLines } from '../components/charts.tsx';
import type { Route } from '../components/Shell.tsx';
import { Button, Card, Chevron, Chip, Empty, Loading, PageError, PageHeader } from '../components/ui.tsx';
import { money, monthLabel, monthShort, shortDate } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';

const longDate = (iso: string, today: string) => (iso.slice(0, 4) === today.slice(0, 4) ? shortDate(iso) : `${shortDate(iso)}, ${iso.slice(0, 4)}`);

function GoalRow({ goal, today }: { goal: GoalStatus; today: string }) {
  const nowShare = Math.min(1, goal.now / goal.target);
  const projectedShare = Math.min(1, goal.projected / goal.target);
  const when = goal.hasDate ? `by ${longDate(goal.date, today)}` : 'no date';
  return (
    <li className="rounded-xl bg-surface-2/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-ink">{goal.name}</div>
          <div className="num mt-0.5 text-xs text-muted">
            {money(goal.target)} {when}
          </div>
        </div>
        <Chip tone={goal.reached ? 'good' : 'warning'}>{goal.reached ? 'On track' : `${money(goal.shortBy)} short`}</Chip>
      </div>
      <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
        <div className="forecast-stripes grow-x absolute inset-y-0 left-0 rounded-full" style={{ width: `${projectedShare * 100}%` }} />
        <div className="grow-x absolute inset-y-0 left-0 rounded-full bg-series-1" style={{ width: `${nowShare * 100}%` }} />
      </div>
      <div className="mt-2.5 flex flex-wrap justify-between gap-x-4 gap-y-1.5 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-series-1" aria-hidden="true" />
          Saved now <span className="num font-medium text-ink">{money(goal.now)}</span> · {Math.round(nowShare * 100)}%
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="forecast-stripes size-2 rounded-full" aria-hidden="true" />
          Forecast {goal.hasDate ? `by ${longDate(goal.date, today)}` : 'in 12 months'} <span className="num font-medium text-ink">{money(goal.projected)}</span> ·{' '}
          {Math.round(projectedShare * 100)}%
        </span>
      </div>
      {!goal.reached && <p className="mt-3 text-[13px] text-ink-2">Save about {money(goal.perMonth)} more a month to make it.</p>}
    </li>
  );
}

export function PlanPage({ onGo }: { onGo: (route: Route) => void }) {
  const { data: inputs, error, reload } = useApi<{ plan: PlanConfig; actuals: Actuals }>('/plan');
  // Computed here, not on the Worker: it needs more CPU than the free plan allows per request.
  const data = useMemo(() => (inputs ? buildYearPlan(inputs.plan, inputs.actuals) : undefined), [inputs]);
  const [view, setView] = useState<'total' | 'free'>('total');
  if (!data || !inputs) return error ? <PageError message={error} onRetry={reload} /> : <Loading />;

  const months = data.months.map((m) => m.month);
  const floor = months.map((m) => (`${m}-31` >= data.reserve.from ? data.reserve.amount : null));
  const reserve = money(data.reserve.amount);
  const toggle = 'press h-7 rounded-full px-3 text-xs font-medium';
  const edit = (route: Route) => (
    <Button variant="ghost" size="sm" className="-mr-2" onClick={() => onGo(route)}>
      Edit <Chevron className="size-3.5" />
    </Button>
  );

  return (
    <div className="stagger space-y-4">
      <PageHeader eyebrow={`Plan · until ${monthLabel(months[months.length - 1])}`} title="Next 12 months" />

      <Card hero title="Balance at the end of each month">
        <p className="-mt-2 mb-5 max-w-2xl text-sm text-ink-2">
          One forecast from today&apos;s total of <span className="num font-medium text-ink">{money(inputs.actuals.net)}</span> (bank + cash − card, the{' '}
          {reserve} reserve included). It updates itself as transactions and hours come in.
        </p>
        <MonthLines months={months.map(monthShort)} series={[{ label: 'Forecast', color: 'var(--series-1)', values: data.months.map((m) => m.endBalance) }]} floor={floor} />
      </Card>

      <Card
        title="Month by month"
        action={
          <div className="flex rounded-full bg-surface-2 p-0.5" role="group" aria-label="Show">
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
                className={`${toggle} ${view === key ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        <table className="num w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="pb-2.5 font-medium">Month</th>
              <th className="hidden pb-2.5 text-right font-medium sm:table-cell">In</th>
              <th className="hidden pb-2.5 text-right font-medium sm:table-cell">Out</th>
              <th className="pb-2.5 text-right font-medium">Result</th>
              <th className="pb-2.5 text-right font-medium">{view === 'total' ? 'Balance' : 'Above reserve'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.months.map((row, i) => {
              const belowReserve = floor[i] !== null && row.endBalance < (floor[i] ?? 0);
              const shown = view === 'free' ? row.endBalance - (floor[i] ?? 0) : row.endBalance;
              return (
                <tr key={row.month} className="transition-colors hover:bg-surface-2/60">
                  <td className="py-2.5 font-medium text-ink">{monthShort(row.month)}</td>
                  <td className="hidden py-2.5 text-right text-ink-2 sm:table-cell">{money(row.income)}</td>
                  <td className="hidden py-2.5 text-right text-ink-2 sm:table-cell">{money(row.spending)}</td>
                  <td className={`py-2.5 text-right ${row.result < 0 ? 'text-critical-ink' : 'text-good-ink'}`}>{money(row.result, { sign: true })}</td>
                  <td className="py-2.5 text-right font-semibold text-ink">
                    {money(shown)}
                    {belowReserve && <span className="sr-only"> (below the reserve)</span>}
                    {belowReserve && (
                      <span aria-hidden="true" className="ml-1 text-warning">
                        ▲
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">
          {view === 'total'
            ? `Total at the end of each month (bank + cash − card), the ${reserve} reserve included.`
            : `What is left at the end of each month after setting the ${reserve} reserve aside (from ${shortDate(data.reserve.from)}).`}{' '}
          ▲ below the reserve.
        </p>
      </Card>

      <Card title="Goals" action={edit('settings/goals')}>
        {data.goals.length ? (
          <>
            <ul className="space-y-3">
              {data.goals.map((goal) => (
                <GoalRow key={goal.id} goal={goal} today={data.today} />
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted">
              Goals fill in order, after the {reserve} reserve: a goal counts only what is left once the ones above it are complete. The striped part is
              what the forecast expects you to have saved by the goal&apos;s date.
            </p>
          </>
        ) : (
          <Empty title="No goals yet">Add one in Settings, with or without a date.</Empty>
        )}
      </Card>

      {data.trips.length > 0 && (
        <Card title="Room to spend on trips">
          <ul className="-my-1 divide-y divide-line text-sm">
            {data.trips.map((trip) => (
              <li key={`${trip.label}-${trip.start}`} className="flex items-baseline justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="text-ink">{trip.label}</span>{' '}
                  <span className="text-xs text-muted">
                    {shortDate(trip.start)} – {shortDate(trip.end)}
                  </span>
                </span>
                <span className="num shrink-0 text-[15px] font-semibold text-ink">{money(trip.room)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">The most you can spend from the first day of each trip and still keep the reserve until the month after it.</p>
        </Card>
      )}

      <Card title="What the forecast assumes" action={edit('settings/jobs')}>
        <ul className="space-y-2.5 text-sm text-ink-2">
          {data.assumptions.map((item) => (
            <li key={item} className="flex gap-2.5">
              <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-series-1" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
        {data.notes.length > 0 && (
          <>
            <h3 className="mb-2.5 mt-5 border-t border-line pt-4 text-xs font-medium text-muted">Your notes</h3>
            <ul className="space-y-2.5 text-sm text-ink-2">
              {data.notes.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-baseline" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
