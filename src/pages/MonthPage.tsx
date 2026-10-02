import { useState } from 'react';
import type { DashboardData } from '../../shared/plan/index.ts';
import { BudgetList } from '../components/budgets.tsx';
import { BarList, Runway } from '../components/charts.tsx';
import type { Tab } from '../components/Shell.tsx';
import { Alerts, Button, Card, ErrorNote, Loading, Stat, StatusIcon } from '../components/ui.tsx';
import { money, monthLabel, shiftMonth, shortDate } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';

export function MonthSwitcher({ month, canNext, onChange }: { month: string; canNext: boolean; onChange: (month: string) => void }) {
  const arrow = 'grid size-9 place-items-center rounded-lg border border-line bg-surface text-ink-2 hover:text-ink disabled:opacity-40';
  return (
    <div className="flex items-center justify-between gap-3">
      <button type="button" className={arrow} onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month">
        ‹
      </button>
      <h1 className="text-lg font-semibold tracking-tight">{monthLabel(month)}</h1>
      <button type="button" className={arrow} onClick={() => onChange(shiftMonth(month, 1))} disabled={!canNext} aria-label="Next month">
        ›
      </button>
    </div>
  );
}

const ACCOUNT_NAMES: Record<string, string> = { chase: 'Bank', discover: 'Card', cash: 'Cash' };

export function MonthPage({ onGo }: { onGo: (tab: Tab) => void }) {
  const [month, setMonth] = useState<string | null>(null);
  const { data, error, loading } = useApi<DashboardData>(`/dashboard${month ? `?month=${month}` : ''}`);
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;

  const safe = data.safeToSpend;
  const next = data.nextMonth;
  const freshness = Object.entries(data.dataUntil)
    .map(([account, date]) => `${ACCOUNT_NAMES[account] ?? account} until ${shortDate(date)}`)
    .join(' · ');
  const checkedOn = Object.values(data.checkedOn).sort().at(-1);
  const reserveActive = data.today >= data.reserve.from;

  return (
    <div className={`space-y-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      <MonthSwitcher month={data.month} canNext={!data.isCurrentMonth} onChange={setMonth} />

      {safe && (
        <Card>
          <div>
            <div className="text-[13px] text-ink-2">Safe to spend</div>
            <div className="mt-1 text-5xl font-semibold tracking-tight sm:text-6xl">{money(safe.amount)}</div>
            <p className="mt-2 text-sm text-ink-2">
              {safe.amount > 0
                ? `≈ ${money(safe.perDay)} a day until the ${safe.nextPayDate ? shortDate(safe.nextPayDate) : 'next'} paycheck`
                : `Essentials only until the ${safe.nextPayDate ? shortDate(safe.nextPayDate) : 'next'} paycheck`}
            </p>
          </div>
          <div className="mt-4">
            <Runway points={data.runway} paydays={data.paydays} low={{ date: safe.low.date, balance: safe.low.balance }} />
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Tightest day</dt>
              <dd className="num text-ink">
                {shortDate(safe.low.date)} · {money(safe.low.balance)}
              </dd>
            </div>
            {data.cashLow && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Lowest in checking + cash</dt>
                <dd className="num text-ink">
                  {shortDate(data.cashLow.date)} · {money(data.cashLow.balance)}
                </dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      {data.isCurrentMonth && (
        <Card title="Balances today">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Bank" value={money(data.balances.checking)} />
            <Stat label="Cash" value={money(data.balances.cash)} />
            <Stat label="Card owes" value={money(-data.balances.cardOwed)} />
            <Stat label="Total" value={money(data.balances.net)} note="reserve included" tone={data.balances.net < 0 ? 'bad' : undefined} />
          </div>
          <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
            {reserveActive
              ? `${money(data.reserve.amount)} of the total is the reserve. Safe to spend never counts it.`
              : `From ${shortDate(data.reserve.from)} on, ${money(data.reserve.amount)} of the total is the reserve. Safe to spend already keeps it from that day.`}
          </p>
        </Card>
      )}

      <Card title={data.isCurrentMonth ? 'This month so far' : 'This month'}>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="In" value={money(data.actual.income)} />
          <Stat label="Out" value={money(data.actual.spending)} />
          <Stat label="Result" value={money(data.actual.result, { sign: true })} tone={data.actual.result > 0 ? 'good' : data.actual.result < 0 ? 'bad' : undefined} />
        </div>
        {data.monthEnd && (
          <p className="mt-3 border-t border-line pt-3 text-sm text-ink-2">
            Expected by the end of the month:{' '}
            <span className="num font-medium text-ink">{money(data.monthEnd.expectedResult, { sign: true })}</span>
            <span className="text-muted">
              {' '}
              (still to come: {money(data.monthEnd.incomeLeft)} in, {money(data.monthEnd.spendingLeft)} out)
            </span>
          </p>
        )}
      </Card>

      {next && (
        <Card title={`Next month · ${monthLabel(next.month)}`}>
          <div className="flex items-center gap-2 text-sm font-medium">
            <StatusIcon level={next.covered ? 'good' : 'critical'} />
            {next.covered ? 'Covered: every bill gets paid' : 'Not covered: checking would go negative'}
          </div>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-2">
                Income <span className="text-muted">({money(next.alreadyWorked)} already worked)</span>
              </dt>
              <dd className="num">{money(next.income)}</dd>
            </div>
            {next.byJob.map((job) => (
              <div key={job.jobId} className="flex justify-between gap-2 pl-3 text-xs text-muted">
                <dt>
                  {job.jobName} · {job.paychecks} paycheck{job.paychecks === 1 ? '' : 's'} · {job.weeklyHours} h/week
                  {job.source === 'timesheet' ? ` (your last ${job.weeks} weeks)` : ' (usual)'}
                </dt>
                <dd className="num">{money(job.amount)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-2">
              <dt className="text-ink-2">Bills and day-to-day</dt>
              <dd className="num">{money(-next.committed)}</dd>
            </div>
            <div className="flex justify-between gap-2 border-t border-line pt-1.5 font-medium">
              <dt>Left over</dt>
              <dd className="num">{money(next.free, { sign: true })}</dd>
            </div>
          </dl>
          {next.reserveGap !== null && (
            <div className="mt-3 flex items-center gap-2 text-sm text-ink">
              <StatusIcon level={next.reserveGap > 0 ? 'warning' : 'good'} />
              {next.reserveGap > 0 ? `Reserve ${money(next.reserveGap)} short on the tightest day` : 'Reserve stays intact'}
            </div>
          )}
        </Card>
      )}

      {data.alerts.length > 0 && (
        <Card title="Heads up">
          <Alerts items={data.alerts} />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card
          title="Where it went"
          action={
            <Button variant="quiet" className="h-7 px-2.5 text-xs" onClick={() => onGo('settings')}>
              Edit budgets
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
              <ul className="divide-y divide-line text-sm">
                {data.upcoming.map((item) => (
                  <li key={`${item.date}-${item.label}`} className="flex items-center justify-between gap-3 py-2">
                    <span className="w-14 shrink-0 text-muted">{shortDate(item.date)}</span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className={`num shrink-0 ${item.amount > 0 ? 'text-good-ink' : 'text-ink'}`}>{money(item.amount, { sign: true })}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span>
          {freshness || 'No transactions yet'}
          {checkedOn ? ` · balances checked ${shortDate(checkedOn)}` : ''}
        </span>
        <span className="flex gap-2">
          <Button variant="quiet" className="h-8 px-3 text-xs" onClick={() => onGo('transactions')}>
            Import statements
          </Button>
          <Button variant="quiet" className="h-8 px-3 text-xs" onClick={() => onGo('settings')}>
            Update balances
          </Button>
        </span>
      </div>
    </div>
  );
}
