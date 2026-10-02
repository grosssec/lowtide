import type { CategorySpending } from '../../shared/plan/dashboard.ts';
import { money, shortDate } from '../lib/format.ts';
import { StatusIcon } from './ui.tsx';

/** A budget bar fills as the month's spending grows: amber close to the limit, red over it. */
function Meter({ share, tone }: { share: number; tone: 'normal' | 'near' | 'over' | 'done' }) {
  const color = { normal: 'bg-series-1', near: 'bg-warning', over: 'bg-critical', done: 'bg-good' }[tone];
  return (
    <div className="mt-1.5 h-2 rounded-full bg-surface-2" aria-hidden="true">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(1, Math.max(0, share)) * 100}%` }} />
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-muted">{title}</h3>
      <ul className="space-y-3">{children}</ul>
    </div>
  );
}

/**
 * Spending per category against its budget. Bills show paid or when they are due;
 * day-to-day budgets show what is left; categories without a budget just show the amount.
 */
export function BudgetList({ rows }: { rows: CategorySpending[] }) {
  const bills = rows.filter((r) => r.kind === 'bill');
  const budgets = rows.filter((r) => r.kind === 'budget');
  const other = rows.filter((r) => r.kind === 'other' && r.amount > 0);
  if (!bills.length && !budgets.length && !other.length) return <p className="text-sm text-muted">No spending yet this month.</p>;

  return (
    <div className="space-y-5">
      {budgets.length > 0 && (
        <Group title="Day to day">
          {budgets.map((row) => {
            const budget = row.budget ?? 0;
            const left = budget - row.amount;
            const share = budget ? row.amount / budget : 0;
            const tone = left < 0 ? 'over' : share >= 0.9 ? 'near' : 'normal';
            return (
              <li key={row.name}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate text-ink">{row.name}</span>
                  <span className="num shrink-0 text-ink">
                    {money(row.amount)}
                    <span className="text-muted"> of {money(budget)}</span>
                  </span>
                </div>
                <Meter share={share} tone={tone} />
                <div className={`mt-1 flex items-center gap-1.5 text-xs ${left < 0 ? 'text-critical-ink' : 'text-muted'}`}>
                  {left < 0 && <StatusIcon level="critical" className="size-3.5" />}
                  {left < 0 ? `${money(-left)} over budget` : `${money(left)} left`}
                </div>
              </li>
            );
          })}
        </Group>
      )}

      {bills.length > 0 && (
        <Group title="Bills">
          {bills.map((row) => (
            <li key={row.name}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-ink">{row.name}</span>
                <span className="num shrink-0 text-ink">
                  {money(row.amount)}
                  <span className="text-muted"> of {money(row.budget ?? 0)}</span>
                </span>
              </div>
              <Meter share={row.budget ? row.amount / row.budget : 0} tone={row.paid ? 'done' : 'normal'} />
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                {row.paid && <StatusIcon level="good" className="size-3.5" />}
                {row.paid ? 'Paid' : row.due ? `Due ${shortDate(row.due)}` : 'Not paid yet'}
              </div>
            </li>
          ))}
        </Group>
      )}

      {other.length > 0 && (
        <Group title="No budget">
          {other.map((row) => (
            <li key={row.name} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-ink">{row.name}</span>
              <span className="num shrink-0 text-ink">{money(row.amount)}</span>
            </li>
          ))}
        </Group>
      )}
    </div>
  );
}
