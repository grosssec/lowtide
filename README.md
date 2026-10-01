# finance-dashboard

Personal finance dashboard: what came in, what went out, the month's result, a forecast of hourly income, and how much is **safe to spend** without touching the reserve or next month.

## Screens
- **Month**:
  - safe to spend, and the projected balance until next month ends (paydays, tightest day, reserve)
  - balances today (bank, cash, card, total with the reserve included)
  - money in / out / result, and the expected result by month end
  - next month: covered or not
  - spending by category vs budget, income by source, the next 14 days, alerts
- **Plan**:
  - balance at each month end until the plan end, for a worst case and a likely case: the total, or what is above the reserve
  - spending room at checkpoints (e.g. trips)
  - the savings goal under every work option
  - assumptions to check
- **Transactions**:
  - import Chase statement PDFs and Chase / Discover CSV exports
  - add cash
  - recategorize, optionally as a rule for similar transactions
  - entries from bank alert emails carry an "alert" badge
- **Settings**:
  - balances (typed in, or updated by balance alerts), daily notification, sync status and received alert emails
  - reserve and goal, budgets, bills, one-off events, rules, passkeys, the full plan as JSON

## How the numbers stay current
- **Bank alerts**: a Google Apps Script (`apps-script/`) forwards Chase and Discover alert emails to `/api/ingest/email`.
  - Each email becomes a transaction or a balance update.
  - Statements and CSVs imported later replace the alert entries.
- **Hours**: the same script sends the timesheets to `/api/ingest/hours`; logged hours replace the plan's hours in the paycheck forecast.
- **Daily push** at 8 am (Cron Trigger): "Balance $X · Available $Y" plus the one thing worth knowing today. The script also emails urgent alerts.
- Live balance = the last balance typed in (or from a balance alert) + every transaction after it.

## Status
- ✅ Engine, importer, Worker API (D1), React app, passkey login, PWA, alert email sync, timesheet sync, web push.
- ⏳ Deploy: needs a Cloudflare account (see DEPLOY.md), then the Apps Script setup (see apps-script/README.md).

## Setup
```bash
npm install
npm run db:migrate      # local D1 tables
npm run seed            # local D1 ← data/ledger.json, data/plan.local.json, data/rules.local.json
node scripts/secrets.ts # local secrets (setup code, sync token, push keys) → .dev.vars
```
`.dev.vars` (gitignored) holds local secrets; `DEV_AUTH_BYPASS=1` skips sign-in on localhost only.

## Run
```bash
npm run dev     # React app + Worker API on http://localhost:5173
npm run plan    # the plan in the terminal
npm run import  # bank files in data/imports → data/ledger.json
```

## Test and check
```bash
npm test           # Vitest
npm run typecheck  # tsc -b
npm run lint       # oxlint
```

## Stack
React 19 + Vite 8 + Tailwind 4, Cloudflare Workers (Vite plugin, Wrangler 4, Cron Triggers), Hono, D1, Zod, SimpleWebAuthn, unpdf (browser only), Web Push over WebCrypto (no library), Google Apps Script, Vitest, oxlint.

## Privacy
- No real financial data in git: statements, balances and plan inputs stay in `data/`, secrets stay in `.env` / `.dev.vars`.
- The app only reads data and never moves money.
- The Apps Script reads Gmail read-only and only looks at Chase and Discover emails.
