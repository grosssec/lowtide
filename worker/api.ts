import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { monthKey, type ISODate } from '../shared/engine/index.ts';
import { DEFAULT_RULES, makeCategorizer, toLedgerEntries, type ParsedFile } from '../shared/import/index.ts';
import { buildDashboard, monthlyBudgets, type Balances, type PlanConfig } from '../shared/plan/index.ts';
import type { AppEnv } from './auth.ts';
import { getEntry, getSetting, insertEntries, loadLedger, loadRules, putSetting, updateCategory, type Entry } from './db.ts';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const kind = z.enum(['income', 'expense', 'transfer']);

/** Today in Ricardo's time zone, not UTC. */
const today = (env: Env): ISODate =>
  new Intl.DateTimeFormat('en-CA', { timeZone: env.TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const pickMonth = (value: string | undefined, env: Env) => (value && MONTH.test(value) ? value : monthKey(today(env)));

async function loadPlan(db: D1Database): Promise<{ plan: PlanConfig; balances: Balances }> {
  const [plan, balances] = await Promise.all([getSetting<PlanConfig>(db, 'plan'), getSetting<Balances>(db, 'balances')]);
  if (!plan || !balances) throw new HTTPException(409, { message: 'Plan or balances are missing. Run the seed or fill in Settings.' });
  return { plan, balances };
}

function categoryList(ledger: Entry[], plan: PlanConfig): string[] {
  const names = new Set<string>([
    ...DEFAULT_RULES.map((r) => r.category),
    ...Object.keys(monthlyBudgets(plan)),
    ...ledger.map((e) => e.category),
    'Uncategorized',
    'Other income',
    'Between accounts',
  ]);
  return [...names].sort((a, b) => a.localeCompare(b));
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const patchBody = z.object({
  category: z.string().trim().min(1).max(60),
  kind,
  /** Plain text: every transaction containing it gets this category now and on future imports. */
  applyToSimilar: z.string().trim().min(3).max(80).optional(),
});

const cashBody = z.object({
  date: z.string().regex(ISO),
  amount: z.number().int().refine((n) => n !== 0, 'Amount cannot be zero'),
  description: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60),
  kind,
});

const isoDate = z.string().regex(ISO);
/** Light structural check for a saved plan; the dashboard pass catches the rest. */
const planShape = z.object({
  planEnd: isoDate,
  reserve: z.object({ amount: z.number().int().min(0), from: isoDate }),
  goal: z.object({ label: z.string(), amount: z.number().int(), by: isoDate, averageMonths: z.object({ start: isoDate, end: isoDate }) }),
  jobs: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()),
  mainScenarios: z.array(z.object({ label: z.string(), level: z.enum(['conservative', 'expected']), option: z.string() })).min(1),
  bills: z.array(z.object({ label: z.string(), category: z.string(), amount: z.number().int().min(0) }).passthrough()),
  essentials: z.array(z.object({ label: z.string(), category: z.string(), monthly: z.number().int().min(0) }).passthrough()),
  events: z.array(z.object({ date: isoDate, label: z.string(), category: z.string(), amount: z.number().int() }).passthrough()),
  checkpoints: z.array(z.object({ label: z.string(), date: isoDate, horizonEnd: isoDate })),
});

const importBody = z.object({
  file: z.string().trim().min(1).max(200),
  account: z.enum(['chase', 'discover']),
  statementEnd: z.string().regex(ISO).optional(),
  note: z.string().max(300),
  rows: z
    .array(
      z.object({
        postedDate: z.string().regex(ISO),
        date: z.string().regex(ISO),
        description: z.string().min(1).max(300),
        amount: z.number().int(),
        balance: z.number().int().optional(),
        bankCategory: z.string().max(80).optional(),
      }),
    )
    .max(5_000),
});

const balancesBody = z.object({
  checking: z.number().int(),
  cash: z.number().int(),
  cardOwed: z.number().int().min(0),
  asOf: z.string().regex(ISO),
  cardDueDay: z.number().int().min(1).max(28),
});

export const api = new Hono<AppEnv>()
  .get('/dashboard', async (c) => {
    const { plan, balances } = await loadPlan(c.env.DB);
    const ledger = await loadLedger(c.env.DB);
    return c.json(buildDashboard({ today: today(c.env), month: pickMonth(c.req.query('month'), c.env), config: plan, balances, ledger }));
  })

  // The year plan runs in the browser (it takes longer than the Workers free-plan CPU budget); this sends its inputs.
  .get('/plan', async (c) => c.json(await loadPlan(c.env.DB)))

  .get('/transactions', async (c) => {
    const { plan } = await loadPlan(c.env.DB);
    const ledger = await loadLedger(c.env.DB);
    const month = pickMonth(c.req.query('month'), c.env);
    const entries = ledger.filter((e) => monthKey(e.date) === month).reverse();
    return c.json({ month, entries, categories: categoryList(ledger, plan) });
  })

  .patch('/transactions/:id', async (c) => {
    const body = patchBody.parse(await c.req.json());
    const entry = await getEntry(c.env.DB, c.req.param('id'));
    if (!entry) return c.json({ error: 'Transaction not found' }, 404);
    if (!body.applyToSimilar) {
      await updateCategory(c.env.DB, [entry.id], body.category, body.kind);
      return c.json({ updated: 1 });
    }
    // New personal rule goes first, then every matching transaction is recategorized.
    const pattern = escapeRegex(body.applyToSimilar);
    await c.env.DB.prepare('INSERT INTO rules (match, category, kind, position) VALUES (?, ?, ?, (SELECT COALESCE(MIN(position), 0) - 1 FROM rules))')
      .bind(pattern, body.category, body.kind)
      .run();
    const matcher = new RegExp(pattern, 'i');
    const ids = (await loadLedger(c.env.DB)).filter((e) => matcher.test(e.description)).map((e) => e.id);
    await updateCategory(c.env.DB, ids.includes(entry.id) ? ids : [...ids, entry.id], body.category, body.kind);
    return c.json({ updated: ids.length });
  })

  .post('/transactions', async (c) => {
    const body = cashBody.parse(await c.req.json());
    const id = `cash|${body.date}|${body.amount}|${body.description.toLowerCase()}|${crypto.randomUUID().slice(0, 8)}`;
    await c.env.DB.prepare(
      "INSERT INTO transactions (id, account, date, posted_date, description, amount, category, kind, source) VALUES (?, 'cash', ?, ?, ?, ?, ?, ?, 'manual')",
    )
      .bind(id, body.date, body.date, body.description, body.amount, body.category, body.kind)
      .run();
    // Cash on hand moves with every cash entry.
    const balances = await getSetting<Balances>(c.env.DB, 'balances');
    if (balances) await putSetting(c.env.DB, 'balances', { ...balances, cash: balances.cash + body.amount });
    return c.json({ id }, 201);
  })

  .delete('/transactions/:id', async (c) => {
    const entry = await getEntry(c.env.DB, c.req.param('id'));
    if (!entry) return c.json({ error: 'Transaction not found' }, 404);
    if (entry.source !== 'manual') return c.json({ error: 'Only entries added by hand can be deleted' }, 400);
    await c.env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(entry.id).run();
    const balances = await getSetting<Balances>(c.env.DB, 'balances');
    if (balances && entry.account === 'cash') await putSetting(c.env.DB, 'balances', { ...balances, cash: balances.cash - entry.amount });
    return c.json({ ok: true });
  })

  // Files are parsed in the browser (PDF parsing is too heavy for the Workers free plan); the rows arrive here as JSON.
  .post('/import', async (c) => {
    const body = importBody.parse(await c.req.json());
    const parsed: ParsedFile = { account: body.account, rows: body.rows, statementEnd: body.statementEnd, note: body.note };
    const coverage = (await getSetting<Record<string, ISODate>>(c.env.DB, 'coverage')) ?? {};
    const categorize = makeCategorizer([...(await loadRules(c.env.DB)), ...DEFAULT_RULES]);
    const entries = toLedgerEntries(parsed, body.file, coverage, categorize);
    const added = await insertEntries(c.env.DB, entries);
    if (body.statementEnd && body.statementEnd > (coverage[body.account] ?? '')) {
      await putSetting(c.env.DB, 'coverage', { ...coverage, [body.account]: body.statementEnd });
    }
    await c.env.DB.prepare('INSERT INTO imports (file, account, rows, added, note) VALUES (?, ?, ?, ?, ?)')
      .bind(body.file, body.account, body.rows.length, added, body.note)
      .run();
    return c.json({
      note: body.note,
      rows: body.rows.length,
      added,
      alreadyThere: entries.length - added,
      coveredByStatement: body.rows.length - entries.length,
    });
  })

  .get('/settings', async (c) => {
    const { plan, balances } = await loadPlan(c.env.DB);
    const [rules, ledger, imports] = await Promise.all([
      loadRules(c.env.DB),
      loadLedger(c.env.DB),
      c.env.DB.prepare('SELECT file, account, rows, added, note, created_at FROM imports ORDER BY id DESC LIMIT 10').all(),
    ]);
    return c.json({ plan, balances, rules, categories: categoryList(ledger, plan), imports: imports.results });
  })

  .put('/settings/balances', async (c) => {
    const balances = balancesBody.parse(await c.req.json());
    await putSetting(c.env.DB, 'balances', balances);
    return c.json(balances);
  })

  .put('/settings/plan', async (c) => {
    const plan = (await c.req.json()) as PlanConfig;
    const { balances } = await loadPlan(c.env.DB);
    try {
      // The plan must compute before it is saved (the cheap dashboard pass; the full year plan runs in the browser).
      planShape.parse(plan);
      buildDashboard({ today: today(c.env), month: monthKey(today(c.env)), config: plan, balances, ledger: [] });
      for (const scenario of plan.mainScenarios) {
        if (!plan.jobOptions[scenario.option]) throw new Error(`Scenario "${scenario.label}" uses unknown option "${scenario.option}"`);
      }
    } catch (error) {
      const reason =
        error instanceof z.ZodError ? error.issues.map((i) => `${i.path.join('.') || 'plan'}: ${i.message}`).join('; ') : (error as Error).message;
      return c.json({ error: `Plan not saved: ${reason}` }, 400);
    }
    await putSetting(c.env.DB, 'plan', plan);
    return c.json({ ok: true });
  })

  .delete('/rules/:id', async (c) => {
    await c.env.DB.prepare('DELETE FROM rules WHERE id = ?').bind(Number(c.req.param('id'))).run();
    return c.json({ ok: true });
  });
