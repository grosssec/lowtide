import { useMemo, useRef, useState } from 'react';
import { displayName, suggestKeyword } from '../../shared/import/display.ts';
import type { LedgerEntry } from '../../shared/import/ledger.ts';
import { Button, Card, ErrorNote, Field, inputClass, Loading, StatusIcon } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { dayLabel, monthKeyOf, moneyExact, parseMoneyInput, todayISO } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { MonthSwitcher } from './MonthPage.tsx';

type Entry = LedgerEntry & { note: string | null };
type Filter = 'all' | 'expense' | 'income' | 'transfer' | 'uncategorized';

const TRANSFER_CATEGORIES = new Set(['Card payment', 'Between accounts', 'From Cash App']);
const ACCOUNT: Record<string, string> = { chase: 'Bank', discover: 'Card', cash: 'Cash' };
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['expense', 'Spending'],
  ['income', 'Income'],
  ['transfer', 'Transfers'],
  ['uncategorized', 'No category'],
];

function kindFor(category: string, amount: number): LedgerEntry['kind'] {
  if (TRANSFER_CATEGORIES.has(category)) return 'transfer';
  return amount >= 0 ? 'income' : 'expense';
}

interface ImportResult {
  file: string;
  ok: boolean;
  text: string;
}

export function TransactionsPage() {
  const [month, setMonth] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<{ month: string; entries: Entry[]; categories: string[] }>(
    `/transactions${month ? `?month=${month}` : ''}`,
  );
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [actionError, setActionError] = useState<string>();
  const [similar, setSimilar] = useState<{ entry: Entry; category: string; keyword: string } | null>(null);
  const [showCash, setShowCash] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.entries ?? []).filter((e) => {
      if (filter === 'uncategorized' && !e.category.startsWith('Uncategorized')) return false;
      if (filter !== 'all' && filter !== 'uncategorized' && e.kind !== filter) return false;
      return !q || e.description.toLowerCase().includes(q) || e.category.toLowerCase().includes(q);
    });
  }, [data, filter, query]);

  const byDay = useMemo(() => {
    const groups = new Map<string, Entry[]>();
    for (const e of entries) groups.set(e.date, [...(groups.get(e.date) ?? []), e]);
    return [...groups.entries()];
  }, [entries]);

  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  const currentMonth = monthKeyOf(todayISO());

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setActionError(undefined);
    const done: ImportResult[] = [];
    // The parser (and its PDF library) loads only when importing, and runs here in the browser.
    const { parseBankFile } = await import('../../shared/import/file.ts');
    for (const file of Array.from(files)) {
      try {
        const parsed = await parseBankFile(file.name, new Uint8Array(await file.arrayBuffer()));
        const r = await api<{ note: string; added: number; alreadyThere: number; coveredByStatement: number }>('/import', {
          method: 'POST',
          json: { file: file.name, ...parsed },
        });
        const skipped = r.alreadyThere + r.coveredByStatement;
        done.push({ file: file.name, ok: true, text: `${r.note}. ${r.added} new${skipped ? `, ${skipped} already in` : ''}.` });
      } catch (e) {
        done.push({ file: file.name, ok: false, text: (e as Error).message });
      }
    }
    setResults(done);
    setBusy(false);
    if (fileInput.current) fileInput.current.value = '';
    reload();
  }

  async function changeCategory(entry: Entry, category: string) {
    setActionError(undefined);
    try {
      await api(`/transactions/${encodeURIComponent(entry.id)}`, { method: 'PATCH', json: { category, kind: kindFor(category, entry.amount) } });
      setSimilar({ entry, category, keyword: suggestKeyword(entry.description) });
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  async function applySimilar() {
    if (!similar) return;
    try {
      await api(`/transactions/${encodeURIComponent(similar.entry.id)}`, {
        method: 'PATCH',
        json: { category: similar.category, kind: kindFor(similar.category, similar.entry.amount), applyToSimilar: similar.keyword },
      });
      setSimilar(null);
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  async function remove(entry: Entry) {
    if (!window.confirm(`Delete "${entry.description}"?`)) return;
    try {
      await api(`/transactions/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  return (
    <div className={`space-y-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      <MonthSwitcher month={data.month} canNext={data.month < currentMonth} onChange={setMonth} />

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => fileInput.current?.click()} disabled={busy}>
          {busy ? 'Importing…' : 'Import statements'}
        </Button>
        <Button variant="quiet" onClick={() => setShowCash((v) => !v)}>
          {showCash ? 'Close' : 'Add cash'}
        </Button>
        <input ref={fileInput} type="file" accept=".pdf,.csv" multiple hidden onChange={(e) => importFiles(e.target.files)} />
      </div>
      <p className="-mt-2 text-xs text-muted">Chase statement PDFs, or CSV downloads from chase.com and discover.com. Screenshots can't be read.</p>

      {results.length > 0 && (
        <Card>
          <ul className="space-y-2 text-sm">
            {results.map((r) => (
              <li key={r.file} className="flex items-start gap-2">
                <StatusIcon level={r.ok ? 'good' : 'critical'} className="mt-0.5 size-4" />
                <span>
                  <span className="font-medium">{r.file}</span>: {r.text}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {showCash && (
        <CashForm
          categories={data.categories}
          onDone={() => {
            setShowCash(false);
            reload();
          }}
        />
      )}

      <ErrorNote message={actionError} />

      {similar && (
        <Card>
          <p className="text-sm text-ink">
            Also put every transaction with these words in <span className="font-medium">{similar.category}</span>, now and on future imports?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              className={`${inputClass} max-w-xs flex-1`}
              value={similar.keyword}
              onChange={(e) => setSimilar({ ...similar, keyword: e.target.value })}
              aria-label="Words to match"
            />
            <Button onClick={applySimilar} disabled={similar.keyword.trim().length < 3}>
              Apply to all
            </Button>
            <Button variant="quiet" onClick={() => setSimilar(null)}>
              Just this one
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={`h-8 rounded-full border px-3 text-xs ${filter === key ? 'border-ink bg-ink text-plane' : 'border-line bg-surface text-ink-2 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
        <input className={`${inputClass} ml-auto h-8 w-full sm:w-56`} placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search transactions" />
      </div>

      {byDay.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No transactions here yet. Import a statement or add cash.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {byDay.map(([day, items]) => (
            <Card key={day} className="!p-0">
              <div className="border-b border-line px-4 py-2 text-xs text-muted">{dayLabel(day)}</div>
              <ul className="divide-y divide-line">
                {items.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink" title={entry.description}>
                        {displayName(entry.description)}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="rounded border border-line px-1.5 text-[11px] text-muted">{ACCOUNT[entry.account] ?? entry.account}</span>
                        {entry.source === 'alert' && (
                          <span className="rounded border border-line px-1.5 text-[11px] text-muted" title="From a bank alert email; the statement or CSV replaces it">
                            alert
                          </span>
                        )}
                        <select
                          value={entry.category}
                          onChange={(e) => changeCategory(entry, e.target.value)}
                          className="h-7 max-w-[11rem] rounded-md border border-transparent bg-transparent pr-6 text-xs text-ink-2 hover:border-line focus:border-series-1"
                          aria-label={`Category for ${displayName(entry.description)}`}
                        >
                          {[...new Set([entry.category, ...data.categories])].map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                        {entry.category.startsWith('Uncategorized') && <StatusIcon level="info" className="size-3.5" />}
                      </div>
                    </div>
                    <div className={`num shrink-0 text-sm ${entry.kind === 'transfer' ? 'text-muted' : entry.amount > 0 ? 'text-good-ink' : 'text-ink'}`}>
                      {moneyExact(entry.amount, { sign: true })}
                    </div>
                    {(entry.source === 'manual' || entry.source === 'alert') && (
                      <button type="button" onClick={() => remove(entry)} className="text-muted hover:text-critical-ink" aria-label="Delete entry">
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CashForm({ categories, onDone }: { categories: string[]; onDone: () => void }) {
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Dining out');
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function save(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = parseMoneyInput(amount);
    if (!cents || cents <= 0) return setError('Type an amount, like 20.00');
    setSaving(true);
    try {
      const signed = direction === 'out' ? -cents : cents;
      await api('/transactions', { method: 'POST', json: { date, amount: signed, description, category, kind: kindFor(category, signed) } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Cash">
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <div className="flex gap-2 sm:col-span-2">
          {(['out', 'in'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDirection(d);
                setCategory(d === 'in' ? 'Side income' : 'Dining out');
              }}
              aria-pressed={direction === d}
              className={`h-9 flex-1 rounded-lg border text-sm ${direction === d ? 'border-ink bg-ink text-plane' : 'border-line bg-surface text-ink-2'}`}
            >
              {d === 'out' ? 'Spent' : 'Received'}
            </button>
          ))}
        </div>
        <Field label="Amount">
          <input className={inputClass} inputMode="decimal" placeholder="20.00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        <Field label="Date">
          <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="What">
          <input className={inputClass} placeholder={direction === 'out' ? 'Lunch with team' : 'Sunday game'} value={description} onChange={(e) => setDescription(e.target.value)} required />
        </Field>
        <Field label="Category">
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            {[...new Set([category, ...categories])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <ErrorNote message={error} />
          <Button type="submit" disabled={saving} className="mt-2 w-full sm:w-auto">
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
