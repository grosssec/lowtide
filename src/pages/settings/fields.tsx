import { useState } from 'react';
import type { CategoryRule } from '../../../shared/import/categorize.ts';
import type { Actuals, Balances, PlanConfig } from '../../../shared/plan/config.ts';
import type { HoursBasis } from '../../../shared/plan/hours.ts';
import { ErrorNote, Field, inputClass, StatusIcon } from '../../components/ui.tsx';
import { parseMoneyInput } from '../../lib/format.ts';

export interface SettingsData {
  plan: PlanConfig;
  balances: Balances;
  actuals: Actuals;
  rules: (CategoryRule & { id: number })[];
  categories: string[];
  imports: { file: string; account: string; rows: number; added: number; note: string; created_at: string }[];
  sync: { lastAlertAt: string | null; hours: { jobId: string; through: string; syncedAt: string }[]; ready: boolean };
  push: { ready: boolean; devices: number };
  hoursBasis: HoursBasis[];
  /** Average spending per category per month over the last 90 days of data. */
  averages: { from: string; to: string; perMonth: Record<string, number> } | null;
}


const dollars = (cents: number) => (cents / 100).toFixed(2);

export function MoneyField({ label, cents, onChange, hint }: { label: string; cents: number; onChange: (cents: number) => void; hint?: string }) {
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

export function Saved({ state }: { state: 'idle' | 'saving' | 'saved' | string }) {
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

