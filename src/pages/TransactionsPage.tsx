import { useMemo, useRef, useState } from 'react';
import { displayName, suggestKeyword } from '../../shared/import/display.ts';
import type { LedgerEntry } from '../../shared/import/ledger.ts';
import { Button, Card, Chip, CloseIcon, Empty, ErrorNote, Field, inputClass, Loading, PageError, PageHeader, StatusIcon } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { dayLabel, monthKeyOf, monthLabel, moneyExact, parseMoneyInput, todayISO } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { confirmDialog, toast } from '../lib/feedback.tsx';
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

/** A rounded square with the merchant's first letter: money in is green, transfers quiet, no category amber. */
function Avatar({ entry }: { entry: Entry }) {
  const tone =
    entry.kind === 'transfer' ? 'bg-surface-2 text-muted' : entry.amount > 0 ? 'bg-good-soft text-good-ink' : entry.category.startsWith('Uncategorized') ? 'bg-warning-soft text-warning-ink' : 'bg-series-1-soft text-series-1-ink';
  const letter = (displayName(entry.description).match(/[A-Za-z0-9]/)?.[0] ?? '·').toUpperCase();
  return (
    <span className={`grid size-9 shrink-0 place-items-center rounded-xl text-[13px] font-semibold ${tone}`} aria-hidden="true">
      {letter}
    </span>
  );
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

  if (!data) return error ? <PageError message={error} onRetry={reload} /> : <Loading />;
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
      toast(`Moved to ${category}`);
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
      toast(`Rule saved: "${similar.keyword}" → ${similar.category}`);
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  async function remove(entry: Entry) {
    const ok = await confirmDialog({
      title: 'Delete this entry?',
      body: `${displayName(entry.description)} · ${moneyExact(entry.amount, { sign: true })}. Balances and the forecast update right away.`,
      confirm: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/transactions/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
      toast('Entry deleted');
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  return (
    <div className={`stagger space-y-4 transition-opacity duration-200 ${loading ? 'opacity-60' : ''}`}>
      <PageHeader
        eyebrow="Transactions"
        title={monthLabel(data.month)}
        actions={<MonthSwitcher month={data.month} canNext={data.month < currentMonth} onChange={setMonth} />}
      />

      <div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => fileInput.current?.click()} disabled={busy}>
            <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" />
            </svg>
            {busy ? 'Importing…' : 'Import statements'}
          </Button>
          <Button variant="quiet" onClick={() => setShowCash((v) => !v)}>
            {showCash ? 'Close' : 'Add cash'}
          </Button>
          <input ref={fileInput} type="file" accept=".pdf,.csv" multiple hidden onChange={(e) => importFiles(e.target.files)} />
        </div>
        <p className="mt-2 text-xs text-muted">Chase statement PDFs, or CSV downloads from chase.com and discover.com. Screenshots can't be read.</p>
      </div>

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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={`press h-8 shrink-0 rounded-full px-3.5 text-[13px] font-medium ${filter === key ? 'bg-ink text-plane' : 'bg-surface text-ink-2 shadow-card hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative sm:ml-auto sm:w-60">
          <svg viewBox="0 0 16 16" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
          <input className={`${inputClass} h-9 rounded-full pl-9`} placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search transactions" />
        </div>
      </div>

      {byDay.length === 0 ? (
        <Card>
          <Empty title={query || filter !== 'all' ? 'Nothing matches' : 'No transactions here yet'}>
            {query || filter !== 'all' ? 'Try another filter or search.' : 'Import a statement or add cash, and they show up here.'}
          </Empty>
        </Card>
      ) : (
        <div className="space-y-5">
          {byDay.map(([day, items]) => {
            const net = items.filter((e) => e.kind !== 'transfer').reduce((sum, e) => sum + e.amount, 0);
            return (
              <section key={day}>
                <div className="mb-2 flex items-baseline justify-between px-1 text-xs">
                  <h2 className="font-medium text-ink-2">{dayLabel(day)}</h2>
                  {net !== 0 && <span className="num text-muted">{moneyExact(net, { sign: true })}</span>}
                </div>
                <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface shadow-card">
                  {items.map((entry) => (
                    <li key={entry.id} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60">
                      <Avatar entry={entry} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink" title={entry.description}>
                          {displayName(entry.description)}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <Chip className="!h-5 !px-2 !text-[11px]">{ACCOUNT[entry.account] ?? entry.account}</Chip>
                          {entry.source === 'alert' && (
                            <Chip tone="accent" className="!h-5 !px-2 !text-[11px]">
                              <span title="From a bank alert email; the statement or CSV replaces it">alert</span>
                            </Chip>
                          )}
                          <select
                            value={entry.category}
                            onChange={(e) => changeCategory(entry, e.target.value)}
                            className="select-sm h-6 max-w-[11rem] truncate rounded-md border border-transparent bg-transparent pl-1 text-xs text-muted transition-colors hover:border-line hover:text-ink-2 focus:border-series-1"
                            aria-label={`Category for ${displayName(entry.description)}`}
                          >
                            {[...new Set([entry.category, ...data.categories])].map((c) => (
                              <option key={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className={`num shrink-0 text-sm font-semibold ${entry.kind === 'transfer' ? 'text-muted' : entry.amount > 0 ? 'text-good-ink' : 'text-ink'}`}>
                        {moneyExact(entry.amount, { sign: true })}
                      </div>
                      {(entry.source === 'manual' || entry.source === 'alert') && (
                        <button
                          type="button"
                          onClick={() => remove(entry)}
                          className="press -mr-1 grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-critical-soft hover:text-critical-ink"
                          aria-label="Delete entry"
                        >
                          <CloseIcon />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
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
      toast('Cash entry saved');
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
        <div className="flex gap-1 rounded-xl bg-surface-2 p-1 sm:col-span-2">
          {(['out', 'in'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDirection(d);
                setCategory(d === 'in' ? 'Side income' : 'Dining out');
              }}
              aria-pressed={direction === d}
              className={`press h-9 flex-1 rounded-lg text-sm font-medium ${direction === d ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink'}`}
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
