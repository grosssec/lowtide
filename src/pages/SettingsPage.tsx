import { startRegistration } from '@simplewebauthn/browser';
import { useState } from 'react';
import type { DailyEssential, MonthlyBill, OneOffEvent } from '../../shared/engine/flows.ts';
import type { CategoryRule } from '../../shared/import/categorize.ts';
import type { Balances, PlanConfig } from '../../shared/plan/config.ts';
import { Button, Card, ErrorNote, Field, inputClass, Loading, StatusIcon } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { parseMoneyInput, shortDate, todayISO } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';

interface SettingsData {
  plan: PlanConfig;
  balances: Balances;
  rules: (CategoryRule & { id: number })[];
  categories: string[];
  imports: { file: string; account: string; rows: number; added: number; note: string; created_at: string }[];
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
      <BalancesCard key={`balances-${JSON.stringify(data.balances)}`} balances={data.balances} onSaved={reload} />
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

function BalancesCard({ balances, onSaved }: { balances: Balances; onSaved: () => void }) {
  const [form, setForm] = useState(balances);
  const [state, setState] = useState('idle');
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
    <Card title="Balances" action={<span className="text-xs text-muted">as of {shortDate(balances.asOf)}</span>}>
      <p className="mb-3 text-sm text-ink-2">Copy these from the Chase and Discover apps once a week, all on the same day.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <MoneyField label="Chase checking" cents={form.checking} onChange={(checking) => setForm({ ...form, checking })} />
        <MoneyField label="Cash in hand" cents={form.cash} onChange={(cash) => setForm({ ...form, cash })} />
        <MoneyField label="Discover owed" cents={form.cardOwed} onChange={(cardOwed) => setForm({ ...form, cardOwed })} hint="Current balance, not just the statement" />
        <Field label="As of">
          <input className={inputClass} type="date" value={form.asOf} onChange={(e) => setForm({ ...form, asOf: e.target.value })} />
        </Field>
        <Field label="Card due day">
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
        <Button onClick={save}>Save balances</Button>
        <Button variant="quiet" onClick={() => setForm({ ...form, asOf: todayISO() })}>
          Set date to today
        </Button>
        <Saved state={state} />
      </div>
    </Card>
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
                <span className="font-mono text-xs text-ink-2">{rule.match.replace(/\\/g, '')}</span> → {rule.category}
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
