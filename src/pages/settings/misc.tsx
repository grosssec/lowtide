import { useState } from 'react';
import type { PlanConfig } from '../../../shared/plan/config.ts';
import { Button, Card, CloseIcon, ErrorNote } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { Saved, type SettingsData } from './fields.tsx';

/** The rule's pattern as words: "ugly mug|\\bumm\\b" → "ugly mug · umm". */
const ruleLabel = (match: string) =>
  match
    .replace(/\\b/g, '')
    .replace(/\\(.)/g, '$1')
    .split('|')
    .join(' · ');

export function RulesCard({ rules, onChanged }: { rules: SettingsData['rules']; onChanged: () => void }) {
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
            <li key={rule.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 truncate">
                <span className="font-mono text-xs text-ink-2">{ruleLabel(rule.match)}</span>
                {rule.sign && <span className="ml-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{rule.sign === 'in' ? 'money in' : 'money out'}</span>} →{' '}
                {rule.category}
              </span>
              <button
                type="button"
                className="press grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-critical-soft hover:text-critical-ink"
                onClick={() => remove(rule.id)}
                aria-label={`Delete rule ${rule.match}`}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote message={error} />
    </Card>
  );
}

export function AdvancedCard({ plan, onSaved }: { plan: PlanConfig; onSaved: () => void }) {
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
    <Card title="Advanced: full plan" action={<Button variant="quiet" size="sm" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'}</Button>}>
      <p className="text-sm text-ink-2">Jobs, pay schedules, hours per scenario, budgets and checkpoints. Amounts are in cents.</p>
      {open && (
        <>
          <textarea
            className="mt-3 h-96 w-full rounded-xl border border-line bg-surface-2 p-3 font-mono text-xs text-ink"
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
