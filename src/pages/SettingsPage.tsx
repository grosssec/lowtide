import { startRegistration } from '@simplewebauthn/browser';
import { useEffect, useState } from 'react';
import type { DailyEssential, MonthlyBill, OneOffEvent } from '../../shared/engine/flows.ts';
import type { CategoryRule } from '../../shared/import/categorize.ts';
import type { Actuals, Balances, PlanConfig } from '../../shared/plan/config.ts';
import { Button, Card, ErrorNote, Field, inputClass, Loading, StatusIcon, type Level } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { money, parseMoneyInput, shortDate, todayISO } from '../lib/format.ts';
import { pushState, turnPushOff, turnPushOn, type PushState } from '../lib/push.ts';
import { useApi } from '../lib/useApi.ts';

interface SettingsData {
  plan: PlanConfig;
  balances: Balances;
  actuals: Actuals;
  rules: (CategoryRule & { id: number })[];
  categories: string[];
  imports: { file: string; account: string; rows: number; added: number; note: string; created_at: string }[];
  sync: { lastAlertAt: string | null; hours: { jobId: string; through: string; syncedAt: string }[]; ready: boolean };
  push: { ready: boolean; devices: number };
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

function MoneyField({ label, cents, onChange, hint }: { label: string; cents: number; onChange: (cents: number) => void; hint?: string }) {
  const [text, setText] = useState(dollars(cents));
  const [shown, setShown] = useState(cents);
  // The parent changed the value (e.g. "Undo changes"): show it. Typing keeps the user's own text.
  if (cents !== shown) {
    setShown(cents);
    setText(dollars(cents));
  }
  return (
    <Field label={label} hint={hint}>
      <input
        className={`${inputClass} num`}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseMoneyInput(e.target.value);
          if (parsed !== null) {
            setShown(parsed);
            onChange(parsed);
          }
        }}
      />
    </Field>
  );
}

function Saved({ state }: { state: 'idle' | 'saving' | 'saved' | string }) {
  if (state === 'idle') return null;
  if (state === 'saving') return <span className="text-xs text-muted">Saving…</span>;
  if (state === 'saved')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
        <StatusIcon level="good" className="size-3.5" /> Saved
      </span>
    );
  return <ErrorNote message={state} />;
}

export function SettingsPage() {
  const { data, error, reload } = useApi<SettingsData>('/settings');
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
      <BalancesCard key={`balances-${JSON.stringify(data.balances)}`} balances={data.balances} actuals={data.actuals} onSaved={reload} />
      <NotificationsCard push={data.push} onChanged={reload} />
      <SyncCard sync={data.sync} jobs={data.plan.jobs} />
      <PlanCards key={`plan-${JSON.stringify(data.plan)}`} plan={data.plan} onSaved={reload} />
      <RulesCard rules={data.rules} onChanged={reload} />
      <SecurityCard />
      {data.imports.length > 0 && (
        <Card title="Recent imports">
          <ul className="divide-y divide-line text-sm">
            {data.imports.map((imp) => (
              <li key={`${imp.file}-${imp.created_at}`} className="py-2">
                <div className="truncate text-ink">{imp.file}</div>
                <div className="text-xs text-muted">
                  {imp.note} · {imp.added} new · {imp.created_at.slice(0, 16)}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <AdvancedCard key={`advanced-${JSON.stringify(data.plan)}`} plan={data.plan} onSaved={reload} />
    </div>
  );
}

const ACCOUNTS = [
  { key: 'checking', label: 'Chase checking', hint: 'Available balance in the Chase app' },
  { key: 'cash', label: 'Cash in hand', hint: 'What is in your wallet' },
  { key: 'cardOwed', label: 'Discover owed', hint: 'Current balance in the Discover app' },
] as const;

function BalancesCard({ balances, actuals, onSaved }: { balances: Balances; actuals: Actuals; onSaved: () => void }) {
  const [form, setForm] = useState(balances);
  const [state, setState] = useState('idle');
  const dirty = JSON.stringify(form) !== JSON.stringify(balances);
  async function save() {
    setState('saving');
    try {
      await api('/settings/balances', { method: 'PUT', json: form });
      setState('saved');
      onSaved();
    } catch (e) {
      setState((e as Error).message);
    }
  }
  return (
    <Card title="Balances">
      <p className="mb-3 text-sm text-ink-2">
        Type what the apps show and the day you looked. Everything after that day is added by itself (bank alerts, imports, cash entries); a balance alert from
        the bank also updates these.
      </p>
      <ul className="space-y-3">
        {ACCOUNTS.map((account) => (
          <li key={account.key} className="grid grid-cols-[1fr_9.5rem] items-start gap-x-3 gap-y-1 sm:grid-cols-[1fr_10rem_9rem]">
            <MoneyField
              label={account.label}
              hint={account.hint}
              cents={form[account.key].amount}
              // A new amount is what the app shows right now.
              onChange={(amount) => setForm({ ...form, [account.key]: { amount, asOf: todayISO(), at: new Date().toISOString() } })}
            />
            <Field label="Checked on">
              <input
                className={inputClass}
                type="date"
                value={form[account.key].asOf}
                // Another day: the whole day counts as included.
                onChange={(e) => setForm({ ...form, [account.key]: { amount: form[account.key].amount, asOf: e.target.value } })}
              />
            </Field>
            <div className="col-span-2 text-xs text-muted sm:col-span-1 sm:pt-6 sm:leading-10">
              Now: <span className="num text-sm text-ink">{money(account.key === 'cardOwed' ? -actuals.cardOwed : actuals[account.key])}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid grid-cols-[1fr_9.5rem] gap-3 sm:grid-cols-[1fr_10rem_9rem]">
        <span className="self-end pb-2 text-sm text-ink-2">Card bill paid in full on</span>
        <Field label="Day of the month">
          <input
            className={`${inputClass} num`}
            type="number"
            min={1}
            max={28}
            value={form.cardDueDay}
            onChange={(e) => setForm({ ...form, cardDueDay: Number(e.target.value) })}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!dirty}>
          Save balances
        </Button>
        {dirty && (
          <Button variant="quiet" onClick={() => setForm(balances)}>
            Undo changes
          </Button>
        )}
        <Saved state={state} />
      </div>
    </Card>
  );
}

const PUSH_TEXT: Record<PushState, string> = {
  unsupported: 'This browser cannot show notifications.',
  'needs-home-screen': 'On iPhone: Share → Add to Home Screen, open Finance from the Home Screen, then turn notifications on there.',
  blocked: 'Notifications are blocked for this app. Allow them in the browser settings (iPhone: Settings → Notifications → Finance).',
  off: 'Off on this device.',
  on: 'On for this device.',
};

function NotificationsCard({ push, onChanged }: { push: SettingsData['push']; onChanged: () => void }) {
  const [device, setDevice] = useState<PushState | null>(null);
  const [state, setState] = useState('idle');
  const [sent, setSent] = useState<string>();
  useEffect(() => {
    let alive = true;
    pushState().then((value) => alive && setDevice(value));
    return () => {
      alive = false;
    };
  }, []);

  async function run(action: () => Promise<void>) {
    setState('saving');
    setSent(undefined);
    try {
      await action();
      setDevice(await pushState());
      setState('idle');
      onChanged();
    } catch (e) {
      setState((e as Error).message);
    }
  }
  async function test() {
    setState('saving');
    try {
      const result = await api<{ sent: number; failed: number; message: { title: string; body: string } }>('/push/test', { method: 'POST', json: {} });
      setSent(`Sent to ${result.sent} device${result.sent === 1 ? '' : 's'}${result.failed ? ` (${result.failed} failed)` : ''}: ${result.message.title} · ${result.message.body}`);
      setState('idle');
    } catch (e) {
      setState((e as Error).message);
    }
  }

  return (
    <Card title="Daily notification">
      <p className="text-sm text-ink-2">Every day at 8 am: balance (bank + cash) and what is safe to spend, plus a bill due soon or anything urgent.</p>
      <p className="mt-2 flex items-center gap-2 text-sm text-ink">
        <StatusIcon level={device === 'on' ? 'good' : device === 'off' || device === null ? 'info' : 'warning'} />
        {device ? PUSH_TEXT[device] : 'Checking…'}
        <span className="text-muted">
          · {push.devices} device{push.devices === 1 ? '' : 's'} in total
        </span>
      </p>
      {!push.ready && <p className="mt-2 text-xs text-muted">The server has no push keys yet (VAPID secrets), so nothing can be sent.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {device === 'off' && (
          <Button onClick={() => run(turnPushOn)} disabled={!push.ready}>
            Turn on for this device
          </Button>
        )}
        {device === 'on' && (
          <Button variant="quiet" onClick={() => run(turnPushOff)}>
            Turn off
          </Button>
        )}
        {push.devices > 0 && (
          <Button variant="quiet" onClick={test}>
            Send it now
          </Button>
        )}
        <Saved state={state} />
      </div>
      {sent && <p className="mt-2 text-xs text-ink-2">{sent}</p>}
    </Card>
  );
}

interface AlertItem {
  id: string;
  received_at: string;
  subject: string;
  status: 'transaction' | 'balance' | 'ignored' | 'unparsed';
  note: string | null;
}

const ALERT_LEVEL: Record<AlertItem['status'], Level> = { transaction: 'good', balance: 'good', ignored: 'info', unparsed: 'warning' };
const when = (iso: string) => `${shortDate(iso.slice(0, 10))} ${iso.slice(11, 16)}`;

function SyncCard({ sync, jobs }: { sync: SettingsData['sync']; jobs: PlanConfig['jobs'] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card title="Automatic sync">
      <ul className="space-y-2 text-sm">
        <li className="flex items-start gap-2">
          <StatusIcon level={sync.lastAlertAt ? 'good' : 'info'} className="mt-0.5 size-4" />
          <span>
            Bank alert emails: {sync.lastAlertAt ? `last one ${when(sync.lastAlertAt)} UTC` : 'nothing received yet'}
          </span>
        </li>
        {jobs.map((job) => {
          const hours = sync.hours.find((h) => h.jobId === job.id);
          return (
            <li key={job.id} className="flex items-start gap-2">
              <StatusIcon level={hours ? 'good' : 'info'} className="mt-0.5 size-4" />
              <span>
                {job.name} hours: {hours ? `logged through ${shortDate(hours.through)}` : 'not synced yet (the plan’s hours are used)'}
              </span>
            </li>
          );
        })}
      </ul>
      {!sync.ready && <p className="mt-2 text-xs text-muted">Sync is not set up on the server yet (INGEST_TOKEN secret).</p>}
      <details className="mt-3 text-sm text-ink-2">
        <summary className="cursor-pointer text-ink">How it works</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Chase and Discover email an alert for every purchase, deposit and payment, plus a daily balance.</li>
          <li>A Google Apps Script in your email account reads those emails and the timesheets every 15 minutes and sends them here.</li>
          <li>Bank statements and CSVs you import later replace the alert entries (the bank’s rows are the record).</li>
        </ol>
        <p className="mt-2 text-xs text-muted">Setup steps: apps-script/README.md in the project.</p>
      </details>
      <div className="mt-3">
        <Button variant="quiet" className="h-8 px-3 text-xs" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide received alerts' : 'Show received alerts'}
        </Button>
      </div>
      {open && <AlertList />}
    </Card>
  );
}

function AlertList() {
  const { data, error } = useApi<{ alerts: AlertItem[] }>('/alerts');
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  if (!data.alerts.length) return <p className="mt-3 text-sm text-muted">No alert emails yet.</p>;
  return (
    <ul className="mt-3 divide-y divide-line text-sm">
      {data.alerts.map((alert) => (
        <li key={alert.id} className="flex items-start gap-2 py-2">
          <StatusIcon level={ALERT_LEVEL[alert.status]} className="mt-0.5 size-4" />
          <div className="min-w-0">
            <div className="truncate text-ink">{alert.subject}</div>
            <div className="text-xs text-muted">
              {when(alert.received_at)} · {alert.note ?? alert.status}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function PlanCards({ plan, onSaved }: { plan: PlanConfig; onSaved: () => void }) {
  const [draft, setDraft] = useState(plan);
  const [state, setState] = useState('idle');
  const dirty = JSON.stringify(draft) !== JSON.stringify(plan);

  async function save() {
    setState('saving');
    try {
      await api('/settings/plan', { method: 'PUT', json: draft });
      setState('saved');
      onSaved();
    } catch (e) {
      setState((e as Error).message);
    }
  }

  const setEssential = (i: number, patch: Partial<DailyEssential>) =>
    setDraft({ ...draft, essentials: draft.essentials.map((e, k) => (k === i ? { ...e, ...patch } : e)) });
  const setBill = (i: number, patch: Partial<MonthlyBill>) =>
    setDraft({ ...draft, bills: draft.bills.map((b, k) => (k === i ? ({ ...b, ...patch } as MonthlyBill) : b)) });
  const setEvent = (i: number, patch: Partial<OneOffEvent>) =>
    setDraft({ ...draft, events: draft.events.map((e, k) => (k === i ? { ...e, ...patch } : e)) });

  const saveBar = (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={save} disabled={!dirty}>
        Save plan
      </Button>
      {dirty && (
        <Button variant="quiet" onClick={() => setDraft(plan)}>
          Undo changes
        </Button>
      )}
      <Saved state={state} />
    </div>
  );

  return (
    <>
      <Card title="Reserve and goal">
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyField label="Reserve (never available to spend)" cents={draft.reserve.amount} onChange={(amount) => setDraft({ ...draft, reserve: { ...draft.reserve, amount } })} />
          <Field label="Reserve applies from">
            <input className={inputClass} type="date" value={draft.reserve.from} onChange={(e) => setDraft({ ...draft, reserve: { ...draft.reserve, from: e.target.value } })} />
          </Field>
          <MoneyField label={draft.goal.label} cents={draft.goal.amount} onChange={(amount) => setDraft({ ...draft, goal: { ...draft.goal, amount } })} />
          <Field label="Goal date">
            <input className={inputClass} type="date" value={draft.goal.by} onChange={(e) => setDraft({ ...draft, goal: { ...draft.goal, by: e.target.value } })} />
          </Field>
        </div>
        <div className="mt-3">{saveBar}</div>
      </Card>

      <Card title="Monthly budgets (day to day)">
        <ul className="space-y-2">
          {draft.essentials.map((item, i) => (
            <li key={item.label} className="grid grid-cols-[1fr_8rem] items-end gap-3">
              <span className="pb-2 text-sm text-ink">{item.label}</span>
              <MoneyField label="per month" cents={item.monthly} onChange={(monthly) => setEssential(i, { monthly })} />
            </li>
          ))}
        </ul>
        <div className="mt-3">{saveBar}</div>
      </Card>

      <Card title="Bills">
        <ul className="space-y-3">
          {draft.bills.map((bill, i) => (
            <li key={`${bill.label}-${i}`} className="grid grid-cols-[1fr_5.5rem_auto] items-end gap-2 sm:grid-cols-[1fr_7rem_5.5rem_auto]">
              <div className="col-span-3 sm:col-span-1">
                <Field label="Bill">
                  <input className={inputClass} value={bill.label} onChange={(e) => setBill(i, { label: e.target.value })} />
                </Field>
              </div>
              <MoneyField label="Amount" cents={bill.amount} onChange={(amount) => setBill(i, { amount })} />
              {bill.rule ? (
                <Field label="When">
                  <span className="flex h-10 items-center text-xs text-muted">{bill.rule.kind === 'nthBusinessDay' ? `${bill.rule.n}th bus. day` : `day ${bill.rule.day}`}</span>
                </Field>
              ) : (
                <Field label="Day">
                  <input className={`${inputClass} num`} type="number" min={1} max={31} value={bill.day} onChange={(e) => setBill(i, { day: Number(e.target.value) })} />
                </Field>
              )}
              <Button variant="danger" className="px-3" aria-label={`Remove ${bill.label}`} onClick={() => setDraft({ ...draft, bills: draft.bills.filter((_, k) => k !== i) })}>
                ×
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button
            variant="quiet"
            onClick={() => setDraft({ ...draft, bills: [...draft.bills, { label: 'New bill', category: 'Subscriptions', amount: 0, day: 1, paidWith: 'card' }] })}
          >
            Add bill
          </Button>
          {saveBar}
        </div>
      </Card>

      <Card title="One-off events (trips, gifts, tuition)">
        <ul className="space-y-3">
          {draft.events.map((event, i) => (
            <li key={`${event.label}-${i}`} className="grid grid-cols-[1fr_7rem_auto] items-end gap-2 sm:grid-cols-[9rem_1fr_7rem_auto]">
              <div className="col-span-3 sm:order-2 sm:col-span-1">
                <Field label="What">
                  <input className={inputClass} value={event.label} onChange={(e) => setEvent(i, { label: e.target.value })} />
                </Field>
              </div>
              <div className="sm:order-1">
                <Field label="Date">
                  <input className={inputClass} type="date" value={event.date} onChange={(e) => setEvent(i, { date: e.target.value })} />
                </Field>
              </div>
              <div className="sm:order-3">
                <MoneyField label="Amount" cents={event.amount} onChange={(amount) => setEvent(i, { amount })} />
              </div>
              <Button variant="danger" className="px-3 sm:order-4" aria-label={`Remove ${event.label}`} onClick={() => setDraft({ ...draft, events: draft.events.filter((_, k) => k !== i) })}>
                ×
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button
            variant="quiet"
            onClick={() => setDraft({ ...draft, events: [...draft.events, { date: todayISO(), label: 'New event', category: 'Travel', amount: 0, paidWith: 'card' }] })}
          >
            Add event
          </Button>
          {saveBar}
        </div>
      </Card>
    </>
  );
}

/** The rule's pattern as words: "ugly mug|\\bumm\\b" → "ugly mug · umm". */
const ruleLabel = (match: string) =>
  match
    .replace(/\\b/g, '')
    .replace(/\\(.)/g, '$1')
    .split('|')
    .join(' · ');

function RulesCard({ rules, onChanged }: { rules: SettingsData['rules']; onChanged: () => void }) {
  const [error, setError] = useState<string>();
  async function remove(id: number) {
    try {
      await api(`/rules/${id}`, { method: 'DELETE' });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Card title="Your category rules">
      {rules.length === 0 ? (
        <p className="text-sm text-muted">None yet. Change a category in Transactions and choose "Apply to all".</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate">
                <span className="font-mono text-xs text-ink-2">{ruleLabel(rule.match)}</span>
                {rule.sign && <span className="ml-1.5 rounded border border-line px-1 text-[11px] text-muted">{rule.sign === 'in' ? 'money in' : 'money out'}</span>} →{' '}
                {rule.category}
              </span>
              <button type="button" className="text-muted hover:text-critical-ink" onClick={() => remove(rule.id)} aria-label={`Delete rule ${rule.match}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote message={error} />
    </Card>
  );
}

function SecurityCard() {
  const [state, setState] = useState('idle');
  async function addPasskey() {
    setState('saving');
    try {
      const { options, challengeId } = await api<{ options: Parameters<typeof startRegistration>[0]['optionsJSON']; challengeId: string }>('/auth/register/options', {
        method: 'POST',
        json: {},
      });
      const response = await startRegistration({ optionsJSON: options });
      await api('/auth/register/verify', { method: 'POST', json: { challengeId, response, label: navigator.platform } });
      setState('saved');
    } catch (e) {
      setState((e as Error).message);
    }
  }
  async function signOut() {
    await api('/auth/logout', { method: 'POST', json: {} }).catch(() => undefined);
    window.location.reload();
  }
  return (
    <Card title="Security">
      <p className="text-sm text-ink-2">Sign-in uses passkeys (Face ID / Touch ID). Add one for each device you use.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="quiet" onClick={addPasskey}>
          Add this device
        </Button>
        <Button variant="danger" onClick={signOut}>
          Sign out
        </Button>
        <Saved state={state} />
      </div>
    </Card>
  );
}

function AdvancedCard({ plan, onSaved }: { plan: PlanConfig; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => JSON.stringify(plan, null, 2));
  const [state, setState] = useState('idle');
  async function save() {
    setState('saving');
    try {
      await api('/settings/plan', { method: 'PUT', json: JSON.parse(text) });
      setState('saved');
      onSaved();
    } catch (e) {
      setState((e as Error).message);
    }
  }
  return (
    <Card title="Advanced: full plan" action={<Button variant="quiet" className="h-8 px-3 text-xs" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'}</Button>}>
      <p className="text-sm text-ink-2">Jobs, pay schedules, hours per scenario, budgets and checkpoints. Amounts are in cents.</p>
      {open && (
        <>
          <textarea
            className="mt-3 h-96 w-full rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs text-ink"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Plan as JSON"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={save}>Save plan</Button>
            <span className="text-xs text-muted">The plan is checked before it is saved.</span>
            <Saved state={state} />
          </div>
        </>
      )}
    </Card>
  );
}
