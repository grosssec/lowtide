import { useMemo, useState } from 'react';
import type { Actuals, PlanConfig } from '../../shared/plan/config.ts';
import { buildYearPlan, type GoalStatus } from '../../shared/plan/year.ts';
import { MonthLines } from '../components/charts.tsx';
import type { Tab } from '../components/Shell.tsx';
import { Button, Card, ErrorNote, Loading, StatusIcon } from '../components/ui.tsx';
import { money, monthLabel, monthShort, shortDate } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';

const longDate = (iso: string, today: string) => (iso.slice(0, 4) === today.slice(0, 4) ? shortDate(iso) : `${shortDate(iso)}, ${iso.slice(0, 4)}`);

function GoalRow({ goal, today }: { goal: GoalStatus; today: string }) {
  const nowShare = Math.min(1, goal.now / goal.target);
  const projectedShare = Math.min(1, goal.projected / goal.target);
  const when = goal.hasDate ? `by ${longDate(goal.date, today)}` : 'no date';
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate font-medium text-ink">{goal.name}</span>
        <span className="num shrink-0 text-ink-2">
          {money(goal.target)} <span className="text-muted">{when}</span>
        </span>
      </div>
      <div className="relative mt-2 h-2.5 rounded-full bg-surface-2" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 rounded-full bg-series-1-soft" style={{ width: `${projectedShare * 100}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-series-1" style={{ width: `${nowShare * 100}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          Now <span className="num text-ink">{money(goal.now)}</span>
        </span>
        <span>
          {goal.hasDate ? `On ${longDate(goal.date, today)}` : 'In 12 months'}: <span className="num text-ink">{money(goal.projected)}</span>
        </span>
      </div>
      <p className="mt-1.5 flex items-center gap-2 text-sm text-ink">
        <StatusIcon level={goal.reached ? 'good' : 'warning'} />
        {goal.reached ? 'On track with the forecast' : `${money(goal.shortBy)} short · save ≈ ${money(goal.perMonth)} more a month to make it`}
      </p>
    </li>
  );
}

export function PlanPage({ onGo }: { onGo: (tab: Tab) => void }) {
  const { data: inputs, error } = useApi<{ plan: PlanConfig; actuals: Actuals }>('/plan');
  // Computed here, not on the Worker: it needs more CPU than the free plan allows per request.
  const data = useMemo(() => (inputs ? buildYearPlan(inputs.plan, inputs.actuals) : undefined), [inputs]);
  const [view, setView] = useState<'total' | 'free'>('total');
  if (!data || !inputs) return error ? <ErrorNote message={error} /> : <Loading />;

  const months = data.months.map((m) => m.month);
  const floor = months.map((m) => (`${m}-31` >= data.reserve.from ? data.reserve.amount : null));
  const reserve = money(data.reserve.amount);
  const toggle = 'h-7 rounded-md px-2.5 text-xs font-medium transition';
  const edit = (
    <Button variant="quiet" className="h-7 px-2.5 text-xs" onClick={() => onGo('settings')}>
      Edit
    </Button>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          Next 12 months <span className="font-normal text-muted">· until {monthLabel(months[months.length - 1])}</span>
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          One forecast from today&apos;s total of {money(inputs.actuals.net)} (bank + cash − card, the {reserve} reserve included). It updates itself as
          transactions and hours come in.
        </p>
      </div>

      <Card title="Balance at the end of each month">
        <MonthLines months={months.map(monthShort)} series={[{ label: 'Forecast', color: 'var(--series-1)', values: data.months.map((m) => m.endBalance) }]} floor={floor} />
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
              <th className="hidden py-1.5 text-right font-normal sm:table-cell">In</th>
              <th className="hidden py-1.5 text-right font-normal sm:table-cell">Out</th>
              <th className="py-1.5 text-right font-normal">Result</th>
              <th className="py-1.5 text-right font-normal">{view === 'total' ? 'Balance' : 'Above reserve'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.months.map((row, i) => {
              const belowReserve = floor[i] !== null && row.endBalance < (floor[i] ?? 0);
              const shown = view === 'free' ? row.endBalance - (floor[i] ?? 0) : row.endBalance;
              return (
                <tr key={row.month}>
                  <td className="py-2 text-ink-2">{monthShort(row.month)}</td>
                  <td className="hidden py-2 text-right text-ink-2 sm:table-cell">{money(row.income)}</td>
                  <td className="hidden py-2 text-right text-ink-2 sm:table-cell">{money(row.spending)}</td>
                  <td className={`py-2 text-right ${row.result < 0 ? 'text-critical-ink' : 'text-ink-2'}`}>{money(row.result, { sign: true })}</td>
                  <td className="py-2 text-right text-ink">
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
        <p className="mt-2 text-xs text-muted">
          {view === 'total'
            ? `Total at the end of each month (bank + cash − card), the ${reserve} reserve included.`
            : `What is left at the end of each month after setting the ${reserve} reserve aside (from ${shortDate(data.reserve.from)}).`}{' '}
          ▲ below the reserve.
        </p>
      </Card>

      <Card title="Goals" action={edit}>
        {data.goals.length ? (
          <>
            <ul className="space-y-5">
              {data.goals.map((goal) => (
                <GoalRow key={goal.id} goal={goal} today={data.today} />
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted">
              Goals fill in order, after the {reserve} reserve: a goal counts only what is left once the ones above it are complete. Dark bar: now. Light bar:
              the forecast on the goal&apos;s date.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">No goals yet. Add one in Settings, with or without a date.</p>
        )}
      </Card>

      {data.trips.length > 0 && (
        <Card title="Room to spend on trips">
          <ul className="divide-y divide-line text-sm">
            {data.trips.map((trip) => (
              <li key={`${trip.label}-${trip.start}`} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="text-ink">{trip.label}</span>{' '}
                  <span className="text-xs text-muted">
                    {shortDate(trip.start)} – {shortDate(trip.end)}
                  </span>
                </span>
                <span className="num shrink-0 font-medium text-ink">{money(trip.room)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">The most you can spend from the first day of each trip and still keep the reserve until the month after it.</p>
        </Card>
      )}

      <Card title="What the forecast assumes" action={edit}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          {data.assumptions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        {data.notes.length > 0 && (
          <>
            <h3 className="mb-1.5 mt-4 text-xs font-medium text-muted">Your notes</h3>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
              {data.notes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
