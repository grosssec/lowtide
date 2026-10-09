import { useState, type ReactNode } from 'react';
import type { PaidWith } from '../../../shared/engine/flows.ts';
import type { AwayPeriod, Bill, Budget, Goal, JobConfig, Period, PlanConfig, PlannedEvent } from '../../../shared/plan/config.ts';
import type { HoursBasis } from '../../../shared/plan/hours.ts';
import { Button, Card, Field, inputClass } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { money, todayISO } from '../../lib/format.ts';
import { MoneyField, Saved } from './fields.tsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
const PAID_WITH: { value: PaidWith; label: string }[] = [
  { value: 'checking', label: 'Bank' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
];

const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

// ---------- Small inputs ----------

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <Field label={label}>
      <input className={inputClass} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string | undefined; onChange: (value: string | undefined) => void }) {
  return (
    <Field label={label}>
      <input className={inputClass} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} />
    </Field>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        className={`${inputClass} num`}
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-10 items-center gap-2 text-sm text-ink-2">
      <input type="checkbox" className="size-4 accent-[var(--series-1)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <Field label={label}>
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function IconButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="press grid size-10 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}

const Remove = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <IconButton label={label} onClick={onClick}>
    ×
  </IconButton>
);

/** One editable row in a list: fields wrap on a phone, a remove button at the end. */
function Row({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return (
    <li className="flex items-end gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">{children}</div>
      <div className="flex gap-1.5">{actions}</div>
    </li>
  );
}

function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button variant="quiet" className="mt-3 h-9 text-xs" onClick={onClick}>
      + {children}
    </Button>
  );
}

function MonthsOff({ value, onChange }: { value: number[]; onChange: (value: number[]) => void }) {
  return (
    <div className="col-span-2 sm:col-span-4">
      <span className="mb-1 block text-[13px] text-ink-2">Skipped months</span>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Skipped months">
        {MONTHS.map((name, i) => {
          const month = i + 1;
          const off = value.includes(month);
          return (
            <button
              key={name}
              type="button"
              aria-pressed={off}
              title={off ? `${name}: skipped` : `${name}: charged`}
              onClick={() => onChange(off ? value.filter((m) => m !== month) : [...value, month].sort((a, b) => a - b))}
              className={`h-8 w-10 rounded-md border text-xs ${off ? 'border-ink bg-ink text-plane' : 'border-line bg-surface text-ink-2 hover:text-ink'}`}
            >
              {name.slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PeriodFields<T extends Period>({ value, onChange, labelText }: { value: T; onChange: (patch: Partial<T>) => void; labelText: string }) {
  return (
    <>
      <div className="col-span-2">
        <TextInput label={labelText} value={value.label} onChange={(label) => onChange({ label } as Partial<T>)} />
      </div>
      <DateInput label="From" value={value.from} onChange={(from) => from && onChange({ from } as Partial<T>)} />
      <DateInput label="To" value={value.to} onChange={(to) => to && onChange({ to } as Partial<T>)} />
      <div className="col-span-2 flex flex-wrap gap-x-4 sm:col-span-4">
        <Check label="Every year" checked={Boolean(value.yearly)} onChange={(yearly) => onChange({ yearly: yearly || undefined } as Partial<T>)} />
      </div>
    </>
  );
}

function payText(job: JobConfig): string {
  return job.periods
    .map((p) => {
      const hours = p.startDay === 1 && p.endDay === 'end' ? 'the month' : `the ${p.startDay}${p.endDay === 'end' ? '–end' : `–${p.endDay}`}`;
      const day = p.payDate.kind === 'nthBusinessDay' ? `the ${ORDINAL[p.payDate.n] ?? `${p.payDate.n}th`} business day` : `day ${p.payDate.day}`;
      const month = p.payMonthOffset === 0 ? 'the same month' : p.payMonthOffset === 1 ? 'the next month' : `${p.payMonthOffset} months later`;
      return `${hours} is paid on ${day} of ${month}`;
    })
    .join('; ');
}

const currentRate = (job: JobConfig, today: string) =>
  [...job.rates].sort((a, b) => a.from.localeCompare(b.from)).filter((r) => r.from <= today).at(-1)?.centsPerHour ?? job.rates[0]?.centsPerHour ?? 0;

// ---------- The editor ----------

/**
 * Everything the forecast runs on, edited as one draft and saved together:
 * reserve and goals, jobs and their hours, time away, bills, budgets, one-offs and notes.
 */
export function PlanEditor({
  plan,
  categories,
  hoursBasis,
  averages,
  onSaved,
}: {
  plan: PlanConfig;
  categories: string[];
  hoursBasis: HoursBasis[];
  averages: Record<string, number>;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(plan);
  const [state, setState] = useState('idle');
  const dirty = JSON.stringify(draft) !== JSON.stringify(plan);
  const today = todayISO();
  const categoryOptions = (current: string) => [...new Set([current, ...categories])].map((c) => ({ value: c, label: c }));

  type ListKey = 'goals' | 'jobs' | 'away' | 'bills' | 'budgets' | 'events';
  function setItem<K extends ListKey>(key: K, index: number, patch: Partial<PlanConfig[K][number]>) {
    setDraft((d) => ({ ...d, [key]: (d[key] as PlanConfig[K][number][]).map((item, i) => (i === index ? { ...item, ...patch } : item)) }));
  }
  function removeItem(key: ListKey, index: number) {
    setDraft((d) => ({ ...d, [key]: (d[key] as unknown[]).filter((_, i) => i !== index) }));
  }
  function addItem<K extends ListKey>(key: K, item: PlanConfig[K][number]) {
    setDraft((d) => ({ ...d, [key]: [...(d[key] as PlanConfig[K][number][]), item] }));
  }
  function moveGoal(index: number, delta: number) {
    setDraft((d) => {
      const goals = [...d.goals];
      const [goal] = goals.splice(index, 1);
      goals.splice(index + delta, 0, goal);
      return { ...d, goals };
    });
  }

  /** New usual hours apply from today; the days before keep the hours of that time. */
  function setUsualHours(index: number, weeklyHours: number) {
    const job = draft.jobs[index];
    const saved = plan.jobs.find((j) => j.id === job.id);
    const changed = saved && weeklyHours !== saved.weeklyHours;
    setItem('jobs', index, {
      weeklyHours,
      hoursSince: changed ? today : saved?.hoursSince,
      previousWeeklyHours: changed ? saved.weeklyHours : saved?.previousWeeklyHours,
    });
  }
  /** A new rate applies from today. */
  function setRate(index: number, centsPerHour: number) {
    const job = draft.jobs[index];
    setItem('jobs', index, { rates: [...job.rates.filter((r) => r.from !== today), { from: today, centsPerHour }] });
  }
  function setClosure(jobIndex: number, closureIndex: number, patch: Partial<Period>) {
    const job = draft.jobs[jobIndex];
    setItem('jobs', jobIndex, { closures: (job.closures ?? []).map((c, i) => (i === closureIndex ? { ...c, ...patch } : c)) });
  }

  async function save() {
    setState('saving');
    try {
      const clean: PlanConfig = { ...draft, notes: (draft.notes ?? []).map((n) => n.trim()).filter(Boolean) };
      await api('/settings/plan', { method: 'PUT', json: clean });
      setState('saved');
      onSaved();
    } catch (e) {
      setState((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <Card title="Reserve and goals">
        <div className="grid grid-cols-2 gap-3">
          <MoneyField
            label="Reserve (never counted as available)"
            cents={draft.reserve.amount}
            onChange={(amount) => setDraft({ ...draft, reserve: { ...draft.reserve, amount } })}
          />
          <DateInput label="Kept from" value={draft.reserve.from} onChange={(from) => from && setDraft({ ...draft, reserve: { ...draft.reserve, from } })} />
        </div>
        <h3 className="mb-2 mt-5 text-xs font-medium text-muted">Goals, in order of priority (each one fills after the reserve and the goals above it)</h3>
        <ul className="space-y-3">
          {draft.goals.map((goal: Goal, i) => (
            <Row
              key={goal.id}
              actions={
                <>
                  <IconButton label={`Move ${goal.name} up`} onClick={() => moveGoal(i, -1)} disabled={i === 0}>
                    ↑
                  </IconButton>
                  <IconButton label={`Move ${goal.name} down`} onClick={() => moveGoal(i, 1)} disabled={i === draft.goals.length - 1}>
                    ↓
                  </IconButton>
                  <Remove label={`Remove ${goal.name}`} onClick={() => removeItem('goals', i)} />
                </>
              }
            >
              <div className="col-span-2">
                <TextInput label="Goal" value={goal.name} onChange={(name) => setItem('goals', i, { name })} />
              </div>
              <MoneyField label="Target" cents={goal.target} onChange={(target) => setItem('goals', i, { target })} />
              <DateInput label="By (optional)" value={goal.by} onChange={(by) => setItem('goals', i, { by })} />
            </Row>
          ))}
        </ul>
        <AddButton onClick={() => addItem('goals', { id: newId('goal'), name: 'New goal', target: 100_000 })}>Add goal</AddButton>
      </Card>

      <Card title="Jobs and hours">
        <p className="mb-3 text-sm text-ink-2">
          The forecast starts from your usual hours, then follows the average of your last full weeks in the timesheet, never above the most hours counted.
          Extra hours stay extra.
        </p>
        <ul className="space-y-6">
          {draft.jobs.map((job: JobConfig, i) => {
            const basis = hoursBasis.find((h) => h.jobId === job.id);
            return (
              <li key={job.id} className="border-t border-line pt-4 first:border-t-0 first:pt-0">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="col-span-2 sm:col-span-1">
                    <TextInput label="Job" value={job.name} onChange={(name) => setItem('jobs', i, { name })} />
                  </div>
                  <NumberInput label="Usual hours a week" value={job.weeklyHours} step={0.5} max={80} onChange={(h) => setUsualHours(i, h)} />
                  <NumberInput
                    label="Most hours counted"
                    value={job.maxWeeklyHours ?? job.weeklyHours}
                    step={0.5}
                    max={80}
                    onChange={(h) => setItem('jobs', i, { maxWeeklyHours: h })}
                  />
                  <MoneyField label="Pay per hour (net)" cents={currentRate(job, today)} onChange={(cents) => setRate(i, cents)} />
                </div>
                {basis && (
                  <p className="mt-2 text-xs text-ink-2">
                    The forecast counts <span className="num font-medium text-ink">{basis.weeklyHours} h/week</span>{' '}
                    {basis.source === 'timesheet' ? `(average of your last ${basis.weeks} full weeks)` : '(your usual hours until the timesheet has two full weeks)'}.
                  </p>
                )}
                <p className="mt-1 text-xs text-muted">Pay: {payText(job)}.</p>
                <Check label="No work on federal holidays" checked={Boolean(job.skipHolidays)} onChange={(skip) => setItem('jobs', i, { skipHolidays: skip || undefined })} />
                <h3 className="mb-2 mt-3 text-xs font-medium text-muted">When {job.name} has no work (breaks, closures)</h3>
                <ul className="space-y-3">
                  {(job.closures ?? []).map((closure, k) => (
                    <Row
                      key={`${closure.label}-${k}`}
                      actions={
                        <Remove
                          label={`Remove ${closure.label}`}
                          onClick={() => setItem('jobs', i, { closures: (job.closures ?? []).filter((_, n) => n !== k) })}
                        />
                      }
                    >
                      <PeriodFields value={closure} labelText="Break" onChange={(patch) => setClosure(i, k, patch)} />
                    </Row>
                  ))}
                </ul>
                <AddButton onClick={() => setItem('jobs', i, { closures: [...(job.closures ?? []), { label: 'Break', from: today, to: today }] })}>
                  Add break
                </AddButton>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="Time away">
        <p className="mb-3 text-sm text-ink-2">No job pays while you are away. On a trip, the budgets marked for trips drop to a quarter.</p>
        <ul className="space-y-3">
          {draft.away.map((period: AwayPeriod, i) => (
            <Row key={`${period.label}-${i}`} actions={<Remove label={`Remove ${period.label}`} onClick={() => removeItem('away', i)} />}>
              <PeriodFields value={period} labelText="Away" onChange={(patch) => setItem('away', i, patch)} />
              <div className="col-span-2 -mt-2 sm:col-span-4">
                <Check label="Trip (home spending drops)" checked={Boolean(period.trip)} onChange={(trip) => setItem('away', i, { trip: trip || undefined })} />
              </div>
            </Row>
          ))}
        </ul>
        <AddButton onClick={() => addItem('away', { label: 'Trip', from: today, to: today, trip: true })}>Add time away</AddButton>
      </Card>

      <Card title="Monthly budgets (day to day)">
        <ul className="space-y-3">
          {draft.budgets.map((budget: Budget, i) => {
            const lately = averages[budget.category];
            return (
              <Row key={`${budget.label}-${i}`} actions={<Remove label={`Remove ${budget.label}`} onClick={() => removeItem('budgets', i)} />}>
                <TextInput label="Budget" value={budget.label} onChange={(label) => setItem('budgets', i, { label })} />
                <Select label="Category" value={budget.category} options={categoryOptions(budget.category)} onChange={(category) => setItem('budgets', i, { category })} />
                <MoneyField
                  label="Per month"
                  cents={budget.monthly}
                  hint={lately !== undefined ? `Lately ≈ ${money(lately)} a month` : undefined}
                  onChange={(monthly) => setItem('budgets', i, { monthly })}
                />
                <Check label="Less on trips" checked={Boolean(budget.lessOnTrips)} onChange={(less) => setItem('budgets', i, { lessOnTrips: less || undefined })} />
              </Row>
            );
          })}
        </ul>
        <AddButton onClick={() => addItem('budgets', { label: 'New budget', category: categories.find((c) => !draft.budgets.some((b) => b.category === c)) ?? 'Shopping', monthly: 0 })}>
          Add budget
        </AddButton>
      </Card>

      <Card title="Bills">
        <ul className="space-y-3">
          {draft.bills.map((bill: Bill, i) => (
            <Row key={`${bill.label}-${i}`} actions={<Remove label={`Remove ${bill.label}`} onClick={() => removeItem('bills', i)} />}>
              <TextInput label="Bill" value={bill.label} onChange={(label) => setItem('bills', i, { label })} />
              <MoneyField label="Amount" cents={bill.amount} onChange={(amount) => setItem('bills', i, { amount })} />
              {bill.rule ? (
                <Field label="When">
                  <span className="flex h-10 items-center text-xs text-muted">
                    {bill.rule.kind === 'nthBusinessDay' ? `${ORDINAL[bill.rule.n] ?? `${bill.rule.n}th`} business day` : `day ${bill.rule.day}`}
                  </span>
                </Field>
              ) : (
                <NumberInput label="Day of the month" value={bill.day ?? 1} min={1} max={31} onChange={(day) => setItem('bills', i, { day } as Partial<Bill>)} />
              )}
              <Select label="Paid with" value={bill.paidWith ?? 'checking'} options={PAID_WITH} onChange={(paidWith) => setItem('bills', i, { paidWith })} />
              <MonthsOff value={bill.monthsOff ?? []} onChange={(monthsOff) => setItem('bills', i, { monthsOff: monthsOff.length ? monthsOff : undefined })} />
            </Row>
          ))}
        </ul>
        <AddButton onClick={() => addItem('bills', { label: 'New bill', category: 'Subscriptions', amount: 0, day: 1, paidWith: 'card' })}>Add bill</AddButton>
      </Card>

      <Card title="One-offs (trips, gifts, tuition)">
        <ul className="space-y-3">
          {draft.events.map((event: PlannedEvent, i) => (
            <Row key={`${event.label}-${i}`} actions={<Remove label={`Remove ${event.label}`} onClick={() => removeItem('events', i)} />}>
              <div className="col-span-2">
                <TextInput label="What" value={event.label} onChange={(label) => setItem('events', i, { label })} />
              </div>
              <DateInput label="Date" value={event.date} onChange={(date) => date && setItem('events', i, { date })} />
              <MoneyField label="Amount" cents={event.amount} onChange={(amount) => setItem('events', i, { amount })} />
              <Select label="Category" value={event.category} options={categoryOptions(event.category)} onChange={(category) => setItem('events', i, { category })} />
              <Select label="Paid with" value={event.paidWith ?? 'checking'} options={PAID_WITH} onChange={(paidWith) => setItem('events', i, { paidWith })} />
              <div className="col-span-2">
                <Check label="Every year" checked={Boolean(event.yearly)} onChange={(yearly) => setItem('events', i, { yearly: yearly || undefined })} />
              </div>
            </Row>
          ))}
        </ul>
        <AddButton onClick={() => addItem('events', { date: today, label: 'New one-off', category: 'Travel', amount: 0, paidWith: 'checking' })}>Add one-off</AddButton>
      </Card>

      <Card title="Notes on the Plan screen">
        <ul className="space-y-2">
          {(draft.notes ?? []).map((note, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                className={inputClass}
                value={note}
                aria-label={`Note ${i + 1}`}
                onChange={(e) => setDraft({ ...draft, notes: (draft.notes ?? []).map((n, k) => (k === i ? e.target.value : n)) })}
              />
              <Remove label={`Remove note ${i + 1}`} onClick={() => setDraft({ ...draft, notes: (draft.notes ?? []).filter((_, k) => k !== i) })} />
            </li>
          ))}
        </ul>
        <AddButton onClick={() => setDraft({ ...draft, notes: [...(draft.notes ?? []), ''] })}>Add note</AddButton>
      </Card>

      {(dirty || state !== 'idle') && (
        <div className="sticky bottom-24 z-10 sm:bottom-4">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface/90 p-3 shadow-pop backdrop-blur-xl">
            {dirty && <span className="text-sm text-ink-2">Unsaved changes to the plan</span>}
            <Button onClick={save} disabled={!dirty}>
              Save plan
            </Button>
            {dirty && (
              <Button variant="quiet" onClick={() => setDraft(plan)}>
                Undo
              </Button>
            )}
            <Saved state={state} />
          </div>
        </div>
      )}
    </div>
  );
}
