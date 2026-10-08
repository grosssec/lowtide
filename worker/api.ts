import { Hono } from 'hono';
import { z } from 'zod';
import { addDays, holidaySet, monthKey, parts, toDayNumber, type ISODate } from '../shared/engine/index.ts';
import { CATEGORIES, DEFAULT_RULES, makeCategorizer, settleAlertEntries, toLedgerEntries, type ParsedFile } from '../shared/import/index.ts';
import { buildDashboard, computeActuals, monthlyBudgets, weeklyHoursBasis, type PlanConfig } from '../shared/plan/index.ts';
import type { AppEnv } from './auth.ts';
import { deleteEntries, getEntry, getSetting, insertEntries, loadLedger, loadRules, putSetting, updateCategory, type Entry } from './db.ts';
import { PUSH_HOSTS, sendDaily } from './notify.ts';
import { loadPlan, loadState, todayIn } from './state.ts';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const kind = z.enum(['income', 'expense', 'transfer']);
const isoDate = z.string().regex(ISO);

const pickMonth = (value: string | undefined, today: ISODate) => (value && MONTH.test(value) ? value : monthKey(today));

function categoryList(ledger: Entry[], plan: PlanConfig): string[] {
  const names = new Set<string>([
    ...CATEGORIES.expense,
    ...CATEGORIES.income,
    ...CATEGORIES.transfer,
    ...plan.jobs.map((job) => job.name),
    ...Object.keys(monthlyBudgets(plan)),
    ...ledger.map((e) => e.category),
    'Uncategorized',
  ]);
  return [...names].sort((a, b) => a.localeCompare(b));
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const patchBody = z.object({
  category: z.string().trim().min(1).max(60),
  kind,
  /** Plain text: every transaction containing it (same direction, in or out) gets this category now and on future imports. */
  applyToSimilar: z.string().trim().min(3).max(80).optional(),
});

const cashBody = z.object({
  date: isoDate,
  amount: z.number().int().refine((n) => n !== 0, 'Amount cannot be zero'),
  description: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60),
  kind,
});

const label = z.string().trim().min(1).max(80);
const cents = z.number().int().min(0).max(100_000_000);
const hours = z.number().min(0).max(80);
const periodFields = { label, from: isoDate, to: isoDate, yearly: z.boolean().optional() };
const inOrder = (p: { from: string; to: string }) => p.from <= p.to;
const period = z.object(periodFields).refine(inOrder, 'The end is before the start');

/** The plan as Settings saves it (version 2). The dashboard pass afterwards catches anything the shape can't. */
const planShape = z.object({
  version: z.literal(2),
  reserve: z.object({ amount: cents, from: isoDate }),
  goals: z.array(z.object({ id: z.string().min(1).max(40), name: label, target: cents.min(1), by: isoDate.optional() })).max(20),
  jobs: z
    .array(
      z.looseObject({
        id: z.string().min(1).max(40),
        name: label,
        rates: z.array(z.object({ from: isoDate, centsPerHour: cents })).min(1),
        periods: z.array(z.looseObject({})).min(1),
        weeklyHours: hours,
        maxWeeklyHours: hours.optional(),
        hoursSince: isoDate.optional(),
        closures: z.array(period).max(20).optional(),
      }),
    )
    .max(10),
  away: z.array(z.object({ ...periodFields, trip: z.boolean().optional() }).refine(inOrder, 'The end is before the start')).max(30),
  bills: z.array(z.looseObject({ label, category: label, amount: cents, monthsOff: z.array(z.number().int().min(1).max(12)).optional() })).max(50),
  budgets: z.array(z.looseObject({ label, category: label, monthly: cents, lessOnTrips: z.boolean().optional() })).max(50),
  events: z.array(z.looseObject({ date: isoDate, label, category: label, amount: z.number().int(), yearly: z.boolean().optional() })).max(100),
  notes: z.array(z.string().trim().max(300)).max(30).optional(),
});

/** Average spending per category over the last 90 days of data, per month: a starting point for budgets. */
function recentAverages(ledger: Entry[]): { from: ISODate; to: ISODate; perMonth: Record<string, number> } | null {
  const spending = ledger.filter((e) => e.kind === 'expense');
  if (!spending.length) return null;
  const to = spending.reduce((max, e) => (e.date > max ? e.date : max), spending[0].date);
  const first = spending.reduce((min, e) => (e.date < min ? e.date : min), spending[0].date);
  const from = addDays(to, -89) > first ? addDays(to, -89) : first;
  const days = toDayNumber(to) - toDayNumber(from) + 1;
  const totals: Record<string, number> = {};
  for (const e of spending) if (e.date >= from) totals[e.category] = (totals[e.category] ?? 0) - e.amount;
  const perMonth = Object.fromEntries(Object.entries(totals).map(([category, total]) => [category, Math.round((total / days) * (365 / 12))]));
  return { from, to, perMonth };
}

const importBody = z.object({
  file: z.string().trim().min(1).max(200),
  account: z.enum(['chase', 'discover']),
  statementEnd: isoDate.optional(),
  note: z.string().max(300),
  rows: z
    .array(
      z.object({
        postedDate: isoDate,
        date: isoDate,
        description: z.string().min(1).max(300),
        amount: z.number().int(),
        balance: z.number().int().optional(),
        bankCategory: z.string().max(80).optional(),
      }),
    )
    .max(5_000),
});

const snapshot = z.object({ amount: z.number().int(), asOf: isoDate, at: z.iso.datetime().optional() });
const balancesBody = z.object({
  checking: snapshot,
  cash: snapshot,
  cardOwed: snapshot.extend({ amount: z.number().int().min(0) }),
  cardDueDay: z.number().int().min(1).max(28),
});

const subscribeBody = z.object({
  endpoint: z
    .url()
    .max(1_000)
    .refine((url) => {
      const { protocol, hostname, port, username } = new URL(url);
      return protocol === 'https:' && !port && !username && PUSH_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    }, 'Not a browser push service'),
  keys: z.object({ p256dh: z.string().min(40).max(200), auth: z.string().min(10).max(100) }),
});

export const api = new Hono<AppEnv>()
  .get('/dashboard', async (c) => {
    const { plan, ledger, actuals, today } = await loadState(c.env);
    return c.json(buildDashboard({ month: pickMonth(c.req.query('month'), today), config: plan, actuals, ledger }));
  })

  // The year plan runs in the browser (it takes longer than the Workers free-plan CPU budget); this sends its inputs.
  .get('/plan', async (c) => {
    const { plan, actuals } = await loadState(c.env);
    return c.json({ plan, actuals });
  })

  .get('/transactions', async (c) => {
    const { plan } = await loadPlan(c.env.DB);
    const ledger = await loadLedger(c.env.DB);
    const month = pickMonth(c.req.query('month'), todayIn(c.env.TIMEZONE));
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
    // New personal rule goes first, then every matching transaction in the same direction is recategorized.
    const pattern = escapeRegex(body.applyToSimilar);
    const sign = entry.amount >= 0 ? 'in' : 'out';
    await c.env.DB.prepare(
      'INSERT INTO rules (match, category, kind, sign, position) VALUES (?, ?, ?, ?, (SELECT COALESCE(MIN(position), 0) - 1 FROM rules))',
    )
      .bind(pattern, body.category, body.kind, sign)
      .run();
    const matcher = new RegExp(pattern, 'i');
    const ids = (await loadLedger(c.env.DB))
      .filter((e) => matcher.test(e.description) && (e.amount >= 0 ? 'in' : 'out') === sign)
      .map((e) => e.id);
    await updateCategory(c.env.DB, ids.includes(entry.id) ? ids : [...ids, entry.id], body.category, body.kind);
    return c.json({ updated: ids.length });
  })

  // Cash entries; the cash balance follows from the last cash count plus every entry after it.
  .post('/transactions', async (c) => {
    const body = cashBody.parse(await c.req.json());
    const id = `cash|${body.date}|${body.amount}|${body.description.toLowerCase()}|${crypto.randomUUID().slice(0, 8)}`;
    // Typed in now: if the cash was counted earlier today, this still counts.
    await c.env.DB.prepare(
      "INSERT INTO transactions (id, account, date, posted_date, description, amount, category, kind, source, at) VALUES (?, 'cash', ?, ?, ?, ?, ?, ?, 'manual', ?)",
    )
      .bind(id, body.date, body.date, body.description, body.amount, body.category, body.kind, new Date().toISOString())
      .run();
    return c.json({ id }, 201);
  })

  // Hand-made entries and alert-made entries can be removed; bank file rows are the record and stay.
  .delete('/transactions/:id', async (c) => {
    const entry = await getEntry(c.env.DB, c.req.param('id'));
    if (!entry) return c.json({ error: 'Transaction not found' }, 404);
    if (entry.source !== 'manual' && entry.source !== 'alert') return c.json({ error: 'Only cash entries and alert entries can be deleted' }, 400);
    await deleteEntries(c.env.DB, [entry.id]);
    return c.json({ ok: true });
  })

  // Files are parsed in the browser (PDF parsing is too heavy for the Workers free plan); the rows arrive here as JSON.
  .post('/import', async (c) => {
    const body = importBody.parse(await c.req.json());
    const db = c.env.DB;
    const parsed: ParsedFile = { account: body.account, rows: body.rows, statementEnd: body.statementEnd, note: body.note };
    const coverage = (await getSetting<Record<string, ISODate>>(db, 'coverage')) ?? {};
    const categorize = makeCategorizer([...(await loadRules(db)), ...DEFAULT_RULES]);
    const entries = toLedgerEntries(parsed, body.file, coverage, categorize);
    const added = await insertEntries(db, entries);
    if (body.statementEnd && body.statementEnd > (coverage[body.account] ?? '')) {
      await putSetting(db, 'coverage', { ...coverage, [body.account]: body.statementEnd });
    }

    // Entries made from alert emails give way to the bank's rows.
    const ledger = await loadLedger(db);
    const byId = new Map(ledger.map((e) => [e.id, e]));
    const { replaced, superseded } = settleAlertEntries(
      ledger.filter((e) => e.source === 'alert' && e.account === body.account),
      entries,
    );
    const statements: D1PreparedStatement[] = [];
    for (const { alertId, rowId, date, at } of replaced) {
      const alert = byId.get(alertId)!;
      const row = byId.get(rowId);
      if (!row) continue;
      // Keep what the alert knew: the earlier date, a category picked by hand, a note.
      const keepCategory = row.category === 'Uncategorized' && alert.category !== 'Uncategorized';
      statements.push(
        db
          .prepare('UPDATE transactions SET date = ?, at = ?, category = ?, kind = ?, note = COALESCE(note, ?) WHERE id = ?')
          .bind(date, at ?? null, keepCategory ? alert.category : row.category, keepCategory ? alert.kind : row.kind, alert.note, rowId),
        db.prepare('UPDATE alerts SET transaction_id = ? WHERE transaction_id = ?').bind(rowId, alertId),
      );
    }
    if (statements.length) await db.batch(statements);
    await deleteEntries(db, [...replaced.map((r) => r.alertId), ...superseded]);

    await db
      .prepare('INSERT INTO imports (file, account, rows, added, note) VALUES (?, ?, ?, ?, ?)')
      .bind(body.file, body.account, body.rows.length, added, body.note)
      .run();
    return c.json({
      note: body.note,
      rows: body.rows.length,
      added,
      alreadyThere: entries.length - added,
      coveredByStatement: body.rows.length - entries.length,
      alertsReplaced: replaced.length,
      alertsDropped: superseded.length,
    });
  })

  .get('/settings', async (c) => {
    const db = c.env.DB;
    const { plan, balances, ledger, actuals, today } = await loadState(c.env);
    const year = parts(today).year;
    const holidays = holidaySet(year - 1, year + 1);
    const [rules, imports, lastAlert, hours, devices] = await Promise.all([
      loadRules(db),
      db.prepare('SELECT file, account, rows, added, note, created_at FROM imports ORDER BY id DESC LIMIT 10').all(),
      db.prepare('SELECT MAX(created_at) AS at FROM alerts').first<{ at: string | null }>(),
      db.prepare('SELECT job_id, MAX(date) AS through, MAX(updated_at) AS synced_at FROM hours GROUP BY job_id').all<{
        job_id: string;
        through: ISODate;
        synced_at: string;
      }>(),
      db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{ n: number }>(),
    ]);
    return c.json({
      plan,
      balances,
      actuals,
      rules,
      categories: categoryList(ledger, plan),
      imports: imports.results,
      sync: {
        lastAlertAt: lastAlert?.at ?? null,
        hours: hours.results.map((h) => ({ jobId: h.job_id, through: h.through, syncedAt: h.synced_at })),
        ready: Boolean(c.env.INGEST_TOKEN),
      },
      push: { ready: Boolean(c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_JWK), devices: devices?.n ?? 0 },
      hoursBasis: plan.jobs.map((job) => weeklyHoursBasis(job, plan.away, actuals.hours?.[job.id], holidays)),
      averages: recentAverages(ledger),
    });
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
      const today = todayIn(c.env.TIMEZONE);
      buildDashboard({ month: monthKey(today), config: plan, actuals: computeActuals(balances, [], today), ledger: [] });
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
  })

  // Bank alert emails as the sync saw them, newest first: shows what was used and why the rest was not.
  .get('/alerts', async (c) => {
    const { results } = await c.env.DB.prepare(
      'SELECT id, received_at, sender, subject, status, note, transaction_id FROM alerts ORDER BY received_at DESC LIMIT 50',
    ).all();
    return c.json({ alerts: results });
  })

  .get('/notifications', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT title, body, created_at FROM notifications ORDER BY id DESC LIMIT 14').all();
    return c.json({ notifications: results });
  })

  .get('/push/key', (c) => c.json({ publicKey: c.env.VAPID_PUBLIC_KEY || null }))

  .post('/push/subscribe', async (c) => {
    const body = subscribeBody.parse(await c.req.json());
    await c.env.DB.prepare(
      'INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth',
    )
      .bind(body.endpoint, body.keys.p256dh, body.keys.auth)
      .run();
    // The push services want a contact URL for the sender: the app's own address.
    await putSetting(c.env.DB, 'app_origin', new URL(c.req.url).origin);
    return c.json({ ok: true }, 201);
  })

  .post('/push/unsubscribe', async (c) => {
    const { endpoint } = z.object({ endpoint: z.string().max(1_000) }).parse(await c.req.json());
    await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
    return c.json({ ok: true });
  })

  // Sends today's message right now (to check that notifications arrive).
  .post('/push/test', async (c) => c.json(await sendDaily(c.env)));
