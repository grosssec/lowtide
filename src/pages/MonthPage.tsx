import { useState } from 'react';
import type { DashboardData } from '../../shared/plan/index.ts';
import { BudgetList } from '../components/budgets.tsx';
import { BarList, Runway } from '../components/charts.tsx';
import type { Tab } from '../components/Shell.tsx';
import { Alerts, BigMoney, Button, Card, Chevron, Chip, Loading, PageError, PageHeader, Stat, StatusIcon } from '../components/ui.tsx';
import { money, monthLabel, shiftMonth, shortDate } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';

export function MonthSwitcher({ month, canNext, onChange }: { month: string; canNext: boolean; onChange: (month: string) => void }) {
  const arrow = 'press grid size-8 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30';
  return (
    <div className="flex items-center gap-0.5 rounded-full bg-surface p-0.5 shadow-card" role="group" aria-label={`Month: ${monthLabel(month)}`}>
      <button type="button" className={arrow} onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month">
        <Chevron direction="left" />
      </button>
      <button type="button" className={arrow} onClick={() => onChange(shiftMonth(month, 1))} disabled={!canNext} aria-label="Next month">
        <Chevron direction="right" />
      </button>
    </div>
  );
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** "Thursday, Oct 8" for the current month; "Past month" for the others. */
function todayLine(today: string, isCurrent: boolean): string {
  if (!isCurrent) return 'Looking back';
  const [y, m, d] = today.split('-').map(Number);
  return `${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${shortDate(today)}`;
}

const Arrow = ({ up }: { up: boolean }) => (
  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={up ? 'M8 12.5v-9M4.5 7L8 3.5 11.5 7' : 'M8 3.5v9M4.5 9L8 12.5 11.5 9'} />
  </svg>
);

/** "Oct" over "14": a tiny calendar leaf for lists of dates. */
export function DateLeaf({ iso }: { iso: string }) {
  const [month, day] = shortDate(iso).split(' ');
  return (
    <span className="flex w-10 shrink-0 flex-col items-center rounded-xl bg-surface-2 py-1 leading-none">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{month}</span>
      <span className="num mt-0.5 text-[15px] font-semibold text-ink">{day}</span>
    </span>
  );
}

const ACCOUNT_NAMES: Record<string, string> = { chase: 'Bank', discover: 'Card', cash: 'Cash' };

export function MonthPage({ onGo }: { onGo: (tab: Tab) => void }) {
  const [month, setMonth] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<DashboardData>(`/dashboard${month ? `?month=${month}` : ''}`);
  if (!data) return error ? <PageError message={error} onRetry={reload} /> : <Loading />;

  const safe = data.safeToSpend;
  const next = data.nextMonth;
  const freshness = Object.entries(data.dataUntil)
    .map(([account, date]) => `${ACCOUNT_NAMES[account] ?? account} until ${shortDate(date)}`)
    .join(' · ');
  const checkedOn = Object.values(data.checkedOn).sort().at(-1);
  const reserveActive = data.today >= data.reserve.from;

  const result = data.actual.result;
  // Older than a week: the dot by "Bank until …" turns amber.
  const weekAgo = new Date(Date.parse(`${data.today}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const stale = Object.values(data.dataUntil).some((date) => date < weekAgo);
  const outShare = data.actual.income > 0 ? Math.min(1, data.actual.spending / data.actual.income) : null;

  return (
    <div className={`stagger space-y-4 transition-opacity duration-200 ${loading ? 'opacity-60' : ''}`}>
      <PageHeader
        eyebrow={todayLine(data.today, data.isCurrentMonth)}
        title={monthLabel(data.month)}
        actions={<MonthSwitcher month={data.month} canNext={!data.isCurrentMonth} onChange={setMonth} />}
      />

      {safe && (
        <Card hero>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-ink-2">Safe to spend</div>
              <BigMoney cents={safe.amount} className="mt-2 text-[56px] sm:text-[72px]" />
            </div>
            <Chip tone={safe.amount > 0 ? 'good' : 'warning'} className="mt-0.5">
              {safe.amount > 0 ? 'Room to spend' : 'Essentials only'}
            </Chip>
          </div>
          <p className="mt-3 text-[15px] text-ink-2">
            {safe.amount > 0
              ? `About ${money(safe.perDay)} a day until the ${safe.nextPayDate ? shortDate(safe.nextPayDate) : 'next'} paycheck.`
              : `Stick to essentials until the ${safe.nextPayDate ? shortDate(safe.nextPayDate) : 'next'} paycheck.`}
          </p>
          <div className="-mx-1 mt-6">
            <Runway points={data.runway} paydays={data.paydays} low={{ date: safe.low.date, balance: safe.low.balance }} reserve={data.reserve} />
          </div>
          <dl className="mt-5 grid grid-cols-2 divide-x divide-line rounded-xl bg-surface-2/70 py-3 text-sm">
            <div className="px-4">
              <dt className="text-xs text-muted">Lowest total</dt>
              <dd className="num mt-1 font-semibold text-ink">
                {money(safe.low.balance)} <span className="font-normal text-muted">· {shortDate(safe.low.date)}</span>
              </dd>
            </div>
            {data.cashLow && (
              <div className="px-4">
                <dt className="text-xs text-muted" title="What the bank and the wallet hold: the card bill leaves the bank on its due date">
                  Lowest in bank + cash
                </dt>
                <dd className="num mt-1 font-semibold text-ink">
                  {money(data.cashLow.balance)} <span className="font-normal text-muted">· {shortDate(data.cashLow.date)}</span>
                </dd>
              </div>
            )}
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-muted">
            A day-by-day forecast to {shortDate(safe.horizonEnd)}: today&apos;s total plus paychecks, minus bills and budgets. Card purchases count the day you
            make them.
          </p>
        </Card>
      )}

      {data.isCurrentMonth && (
        <Card title="Balances today">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
            <Stat label="Bank" value={money(data.balances.checking)} />
            <Stat label="Cash" value={money(data.balances.cash)} />
            <Stat label="Card owes" value={money(-data.balances.cardOwed)} />
            <Stat label="Total" value={money(data.balances.net)} note="reserve included" tone={data.balances.net < 0 ? 'bad' : undefined} />
          </div>
          <p className="mt-5 border-t border-line pt-4 text-xs text-muted">
            {reserveActive
              ? `${money(data.reserve.amount)} of the total is the reserve. Safe to spend never counts it.`
              : `From ${shortDate(data.reserve.from)} on, ${money(data.reserve.amount)} of the total is the reserve. Safe to spend already keeps it from that day.`}
          </p>
        </Card>
      )}

      <Card title={data.isCurrentMonth ? 'This month so far' : 'This month'}>
        <div className="grid grid-cols-3 gap-4">
          <Stat
            label="In"
            value={money(data.actual.income)}
            icon={
              <span className="grid size-5 place-items-center rounded-full bg-good-soft text-good-ink">
                <Arrow up={false} />
              </span>
            }
          />
          <Stat
            label="Out"
            value={money(data.actual.spending)}
            icon={
              <span className="grid size-5 place-items-center rounded-full bg-surface-2 text-ink-2">
                <Arrow up />
              </span>
            }
          />
          <Stat label="Result" value={money(result, { sign: true })} tone={result > 0 ? 'good' : result < 0 ? 'bad' : undefined} />
        </div>
        {outShare !== null && (
          <div className="mt-5">
            <div className="h-1.5 overflow-hidden rounded-full bg-good-soft" aria-hidden="true">
              <div className={`grow-x h-1.5 rounded-full ${outShare >= 1 ? 'bg-critical' : 'bg-ink-2'}`} style={{ width: `${outShare * 100}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted">{Math.round(outShare * 100)}% of what came in has gone out</p>
          </div>
        )}
        {data.monthEnd && (
          <p className="mt-4 border-t border-line pt-4 text-sm text-ink-2">
            Expected by the end of the month: <span className="num font-semibold text-ink">{money(data.monthEnd.expectedResult, { sign: true })}</span>
            <span className="text-muted">
              {' '}
              · still to come {money(data.monthEnd.incomeLeft)} in, {money(data.monthEnd.spendingLeft)} out
            </span>
          </p>
        )}
      </Card>

      {next && (
        <Card
          title={`Next month · ${monthLabel(next.month)}`}
          action={
            <Chip tone={next.covered ? 'good' : 'critical'}>
              <StatusIcon level={next.covered ? 'good' : 'critical'} className="size-3.5" />
              {next.covered ? 'Covered' : 'Not covered'}
            </Chip>
          }
        >
          <p className="-mt-1 text-sm text-ink-2">{next.covered ? 'Every bill gets paid.' : 'Checking would go negative.'}</p>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-2">
                Income <span className="text-muted">· {money(next.alreadyWorked)} already worked</span>
              </dt>
              <dd className="num text-ink">{money(next.income)}</dd>
            </div>
            {next.byJob.map((job) => (
              <div key={job.jobId} className="flex justify-between gap-2 border-l-2 border-line pl-3 text-xs text-muted">
                <dt>
                  {job.jobName} · {job.paychecks} paycheck{job.paychecks === 1 ? '' : 's'} · {job.weeklyHours} h/week
                  {job.source === 'timesheet' ? ` (your last ${job.weeks} weeks)` : ' (usual)'}
                </dt>
                <dd className="num">{money(job.amount)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-2">
              <dt className="text-ink-2">Bills and day-to-day</dt>
              <dd className="num text-ink">{money(-next.committed)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-t border-line pt-3">
              <dt className="font-medium text-ink">Left over</dt>
              <dd className={`num text-lg font-semibold tracking-[-0.02em] ${next.free < 0 ? 'text-critical-ink' : 'text-ink'}`}>{money(next.free, { sign: true })}</dd>
            </div>
          </dl>
          {next.reserveGap !== null && (
            <div className={`mt-4 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm text-ink ${next.reserveGap > 0 ? 'bg-warning-soft' : 'bg-good-soft'}`}>
              <StatusIcon level={next.reserveGap > 0 ? 'warning' : 'good'} />
              {next.reserveGap > 0 ? `Reserve ${money(next.reserveGap)} short on the tightest day` : 'Reserve stays intact'}
            </div>
          )}
        </Card>
      )}

      {data.alerts.length > 0 && (
        <Card title="Heads up" action={<Chip tone={data.alerts.some((a) => a.level === 'critical') ? 'critical' : 'warning'}>{data.alerts.length}</Chip>}>
          <Alerts items={data.alerts} />
        </Card>
      )}

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <Card
          title="Where it went"
          action={
            <Button variant="ghost" size="sm" className="-mr-2" onClick={() => onGo('settings')}>
              Edit budgets <Chevron className="size-3.5" />
            </Button>
          }
        >
          <BudgetList rows={data.actual.spendingByCategory} />
        </Card>
        <div className="min-w-0 space-y-4">
          <Card title="Where it came from">
            <BarList rows={data.actual.incomeBySource} empty="No income imported for this month yet." />
          </Card>
          {data.upcoming.length > 0 && (
            <Card title="Next 14 days">
              <ul className="-my-1.5 divide-y divide-line text-sm">
                {data.upcoming.map((item) => (
                  <li key={`${item.date}-${item.label}`} className="flex items-center gap-3 py-2.5">
                    <DateLeaf iso={item.date} />
                    <span className="min-w-0 flex-1 truncate text-ink">{item.label}</span>
                    <span className={`num shrink-0 font-medium ${item.amount > 0 ? 'text-good-ink' : 'text-ink'}`}>{money(item.amount, { sign: true })}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-2 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex items-center gap-2">
          <span className={`size-1.5 shrink-0 rounded-full ${stale ? 'bg-warning' : 'bg-good'}`} aria-hidden="true" />
          {freshness || 'No transactions yet'}
          {checkedOn ? ` · balances checked ${shortDate(checkedOn)}` : ''}
        </span>
        <span className="flex gap-2">
          <Button variant="quiet" size="sm" onClick={() => onGo('transactions')}>
            Import statements
          </Button>
          <Button variant="quiet" size="sm" onClick={() => onGo('settings')}>
            Update balances
          </Button>
        </span>
      </div>
    </div>
  );
}
