import { Hono } from 'hono';
import { z } from 'zod';
import { addDays, monthKey, toDayNumber, type ISODate } from '../shared/engine/index.ts';
import { DEFAULT_RULES, makeCategorizer, parseBankAlert, type LedgerEntry } from '../shared/import/index.ts';
import { buildDashboard, dailyMessage, type Balances } from '../shared/plan/index.ts';
import { sameSecret, type AppEnv } from './auth.ts';
import { getSetting, insertEntries, loadRules, putSetting, replaceHours, saveAlerts, type AlertRow } from './db.ts';
import { loadPlan, loadState } from './state.ts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const emailBody = z.object({
  emails: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        from: z.string().max(300),
        subject: z.string().max(500),
        body: z.string().max(20_000),
        date: z.iso.datetime({ offset: true }),
        /** The script checks Gmail's DMARC result; a failed check means the sender may be forged. */
        authenticated: z.boolean().optional(),
      }),
    )
    .max(50),
});

const hoursBody = z.object({
  jobId: z.string().min(1).max(40),
  /** The window the sheet covers: days inside it that are not in `days` are removed. Defaults to the first and last day sent. */
  from: isoDate.optional(),
  to: isoDate.optional(),
  days: z.array(z.object({ date: isoDate, hours: z.number().min(0).max(24) })).max(400),
});

/** Bank rows already in the books within this many days count as the same transaction as a new alert. */
const TWIN_DAYS = 4;
const daysApart = (a: ISODate, b: ISODate) => Math.abs(toDayNumber(a) - toDayNumber(b));
const preview = (text: string, max: number) => text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Called by the Google Apps Script with `Authorization: Bearer <INGEST_TOKEN>`.
 * No session cookie is involved, so these routes skip the session and CSRF checks.
 */
export const ingest = new Hono<AppEnv>()
  .use('*', async (c, next) => {
    if (!c.env.INGEST_TOKEN) return c.json({ error: 'Sync is not set up: INGEST_TOKEN is missing' }, 503);
    const header = c.req.header('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!token || !sameSecret(token, c.env.INGEST_TOKEN)) return c.json({ error: 'Not allowed' }, 401);
    return next();
  })

  // Bank alert emails: each becomes a transaction (unless the bank file already has it), a balance update, or a note.
  .post('/email', async (c) => {
    const { emails } = emailBody.parse(await c.req.json());
    const db = c.env.DB;
    if (emails.length === 0) return c.json({ received: 0 });

    const ids = emails.map((e) => e.id);
    const known = new Set(
      (await db.prepare(`SELECT id FROM alerts WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string }>()).results.map((r) => r.id),
    );
    const fresh = emails.filter((e) => !known.has(e.id));
    if (fresh.length === 0) return c.json({ received: emails.length, new: 0 });

    const parsed = fresh.map((email) => ({ email, alert: parseBankAlert(email, c.env.TIMEZONE) }));
    const dates = parsed.flatMap(({ alert }) => (alert.status === 'transaction' ? [alert.date] : []));
    const earliest = dates.length ? addDays(dates.sort()[0], -TWIN_DAYS) : null;

    // Bank rows (from statements and CSVs) near these dates, minus the ones an earlier alert already pointed to.
    const bankRows = earliest
      ? (
          await db
            .prepare("SELECT id, account, date, posted_date, amount FROM transactions WHERE source NOT IN ('alert', 'manual') AND posted_date >= ?")
            .bind(earliest)
            .all<{ id: string; account: string; date: ISODate; posted_date: ISODate; amount: number }>()
        ).results
      : [];
    const claimed = new Set(
      (await db.prepare('SELECT transaction_id FROM alerts WHERE transaction_id IS NOT NULL').all<{ transaction_id: string }>()).results.map(
        (r) => r.transaction_id,
      ),
    );

    const categorize = makeCategorizer([...(await loadRules(db)), ...DEFAULT_RULES]);
    const balances = await getSetting<Balances>(db, 'balances');
    let balancesChanged = false;
    const entries: LedgerEntry[] = [];
    const rows: AlertRow[] = [];
    const counts = { transactions: 0, alreadyInBooks: 0, balances: 0, ignored: 0, unparsed: 0 };

    for (const { email, alert } of parsed) {
      const row: AlertRow = {
        id: email.id,
        received_at: email.date,
        sender: email.from.slice(0, 200),
        subject: preview(email.subject, 300),
        body: preview(email.body, 600),
        status: alert.status,
        note: null,
        transaction_id: null,
      };
      rows.push(row);

      if (email.authenticated === false && alert.status !== 'ignored') {
        row.status = 'ignored';
        row.note = 'Sender not verified (DMARC failed): not used';
        counts.ignored++;
        continue;
      }
      if (alert.status === 'ignored' || alert.status === 'unparsed') {
        row.note = alert.note;
        counts[alert.status]++;
        continue;
      }
      if (alert.status === 'balance') {
        counts.balances++;
        const key = alert.account === 'chase' ? 'checking' : 'cardOwed';
        const at = new Date(email.date).toISOString();
        const saved = balances?.[key];
        const newer = saved && (alert.date > saved.asOf || (alert.date === saved.asOf && (!saved.at || at > saved.at)));
        if (balances && newer) {
          balances[key] = { amount: alert.amount, asOf: alert.date, at };
          balancesChanged = true;
          row.note = `${key === 'checking' ? 'Checking' : 'Card'} balance set to $${(alert.amount / 100).toFixed(2)} on ${alert.date}`;
        } else row.note = 'Older than the saved balance: not used';
        continue;
      }

      const twin = bankRows.find(
        (r) =>
          !claimed.has(r.id) &&
          r.account === alert.account &&
          r.amount === alert.amount &&
          Math.min(daysApart(r.date, alert.date), daysApart(r.posted_date, alert.date)) <= TWIN_DAYS,
      );
      if (twin) {
        claimed.add(twin.id);
        row.transaction_id = twin.id;
        row.note = 'Already in the books from a bank file';
        counts.alreadyInBooks++;
        continue;
      }
      const id = `alert|${email.id}`;
      const category = alert.category && alert.kind ? { category: alert.category, kind: alert.kind } : categorize(alert.description, alert.amount);
      entries.push({
        id,
        account: alert.account,
        date: alert.date,
        postedDate: alert.date,
        at: new Date(email.date).toISOString(),
        description: alert.description,
        amount: alert.amount,
        ...category,
        source: 'alert',
      });
      row.transaction_id = id;
      row.note = `${alert.description}: ${category.category}`;
      counts.transactions++;
    }

    await insertEntries(db, entries);
    await saveAlerts(db, rows);
    if (balances && balancesChanged) await putSetting(db, 'balances', balances);
    return c.json({ received: emails.length, new: fresh.length, ...counts });
  })

  // Hours from a timesheet: they replace the planned hours for the days the sheet covers.
  .post('/hours', async (c) => {
    const body = hoursBody.parse(await c.req.json());
    const { plan } = await loadPlan(c.env.DB);
    if (!plan.jobs.some((job) => job.id === body.jobId)) {
      return c.json({ error: `Unknown job "${body.jobId}". Jobs: ${plan.jobs.map((j) => j.id).join(', ')}` }, 400);
    }
    // Several rows on the same day (two shifts) add up.
    const perDay = new Map<ISODate, number>();
    for (const day of body.days) perDay.set(day.date, Math.min(24, (perDay.get(day.date) ?? 0) + day.hours));
    const dates = [...perDay.keys()].sort();
    const from = body.from ?? dates[0];
    const to = body.to ?? dates[dates.length - 1];
    if (!from || !to) return c.json({ jobId: body.jobId, days: 0 });
    if (from > to) return c.json({ error: '"from" is after "to"' }, 400);
    const rows = dates.filter((d) => d >= from && d <= to).map((date) => ({ date, hours: Math.round(perDay.get(date)! * 100) / 100 }));
    await replaceHours(c.env.DB, body.jobId, from, to, rows);
    return c.json({ jobId: body.jobId, from, to, days: rows.length, hours: rows.reduce((total, r) => total + r.hours, 0) });
  })

  // What the script emails: today's numbers plus the alerts worth a heads-up.
  .get('/digest', async (c) => {
    const { plan, ledger, actuals, today } = await loadState(c.env);
    const data = buildDashboard({ month: monthKey(today), config: plan, actuals, ledger });
    return c.json({
      today,
      ...dailyMessage(data),
      alerts: data.alerts.filter((a) => a.level !== 'info'),
    });
  });
