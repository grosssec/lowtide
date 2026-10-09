import { useEffect, useState } from 'react';
import type { Actuals, Balances, PlanConfig } from '../../../shared/plan/config.ts';
import { Button, Card, ErrorNote, Field, inputClass, Loading, StatusIcon, type Level } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { money, shortDate, todayISO } from '../../lib/format.ts';
import { pushState, turnPushOff, turnPushOn, type PushState } from '../../lib/push.ts';
import { useApi } from '../../lib/useApi.ts';
import { MoneyField, Saved, type SettingsData } from './fields.tsx';

const ACCOUNTS = [
  { key: 'checking', label: 'Chase checking', hint: 'Available balance in the Chase app' },
  { key: 'cash', label: 'Cash in hand', hint: 'What is in your wallet' },
  { key: 'cardOwed', label: 'Discover owed', hint: 'Current balance in the Discover app' },
] as const;

export function BalancesCard({ balances, actuals, onSaved }: { balances: Balances; actuals: Actuals; onSaved: () => void }) {
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

export function NotificationsCard({ push, onChanged }: { push: SettingsData['push']; onChanged: () => void }) {
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

export function SyncCard({ sync, jobs }: { sync: SettingsData['sync']; jobs: PlanConfig['jobs'] }) {
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
          <li>A Google Apps Script in your email account reads those emails and the timesheets twice a day (around 7 am and 7 pm) and sends them here.</li>
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
  if (!data) return error ? <ErrorNote message={error} /> : <Loading variant="inline" />;
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

