# finance-dashboard

Ricardo's personal finance dashboard. Product decisions and status: vault note `~/Documents/Second Brain/10-Projects/Finance Dashboard.md`.

## Stack
- React 19 + Vite 8 + Tailwind 4 SPA in `src/` (pages in `src/pages`, charts in `src/components/charts.tsx`), Cloudflare Worker API in `worker/` (Hono, D1 via `worker/db.ts`, passkeys in `worker/auth.ts`), Wrangler 4. Schema in `migrations/`.
- Workers free plan = ~10 ms CPU per request: the Worker computes only the Month screen (`buildDashboard`, ~1 ms). The year plan (`buildYearPlan`) and statement parsing (`shared/import/file.ts`, lazy-loads pdf.js) run in the browser. Keep heavy work out of `worker/`.
- Sync: `apps-script/` (Google Apps Script in Ricardo's Google Workspace) posts bank alert emails and timesheet hours to `/api/ingest/*` (`worker/ingest.ts`, bearer `INGEST_TOKEN`, no session). Hourly Cron Trigger → daily push at 8 am Chicago (`worker/notify.ts`, Web Push over WebCrypto in `shared/push/webpush.ts`, service worker `public/sw.js`).
- Domain logic in `shared/engine/` (forecast) and `shared/import/` (statement/CSV parsers, categorizer, ledger): pure TypeScript, no I/O. Shared by the Worker, the UI and `scripts/`.
- Tests in `test/` (Vitest, `vitest.config.ts`, plain Node). Lint: oxlint. Type-check: `tsc -b` (app, node, worker, tools projects).
- Imports use explicit `.ts` extensions so `scripts/` run directly with Node's type stripping (`node scripts/plan.ts`).

## Commands
- `npm run dev`: app + Worker locally (`.dev.vars` `DEV_AUTH_BYPASS=1` skips sign-in on localhost only)
- `npm run db:migrate` / `npm run seed`: local D1 tables / load `data/` into local D1 (`-- --remote` only with Ricardo's OK)
- `node scripts/secrets.ts`: SETUP_TOKEN, INGEST_TOKEN and VAPID keys into `.dev.vars` (`--remote`: into `.env` + `wrangler secret put`). Never print the values.
- `npm test`, `npm run typecheck`, `npm run lint`: run all three before calling work done
- `npm run plan`: cash-flow plan from `data/plan.local.json` (`scripts/plan.example.json` documents the shape)
- `npm run import`: `data/imports/*` (Chase statement PDFs, Chase/Discover CSVs) → `data/ledger.json`. Personal category rules in `data/rules.local.json` run before `DEFAULT_RULES` (`shared/import/categorize.ts`)

## Rules
- Real financial data never enters git or the vault. `data/` is gitignored; secrets only in `.env` / `.dev.vars`.
- Money is integer cents (`Cents`). Dates are ISO strings with UTC math (`shared/engine/dates.ts`).
- Engine changes are test-first: every pay-schedule or projection rule gets a fixture test.
- UI copy in English. Conventional Commits.
- Nothing goes live (deploy, bank connections, DNS, paid services) without Ricardo's OK. Deploy steps: `DEPLOY.md`.
- Data endpoints need a session; state-changing calls need the `X-Requested-With: finance-dashboard` header (the `src/lib/api.ts` wrapper sends it). Only `/api/ingest/*` skips both and uses the bearer token instead.
- Apps Script code (`apps-script/Code.gs`) is plain V8 JavaScript; its pure helpers are tested in `test/apps-script/` through `node:vm`. Gmail access stays read-only (advanced Gmail API, `gmail.readonly`).

## Domain
- Accrual for reports: card purchases count when made. Paying the card bill is a transfer, never an expense. `toCashFlows` gives the checking + cash view (card bill on its due date) for liquidity.
- Live balances (`computeActuals`): last snapshot per account + every entry after it. Checking and cash snapshots are available balances, so entries count by transaction `date`; the card snapshot is the posted balance, so card entries count by `postedDate`. On the snapshot's own day, an entry counts only when both have a time (`at`) and the entry is later.
- Alert emails become entries with `source: 'alert'`. Importing a statement or CSV settles them (`settleAlertEntries`): paired rows replace them (keeping the alert's earlier date and time), unpaired ones older than 5 days inside the file's period are dropped.
- Safe to spend = lowest projected balance minus the floor (the reserve, from its start date), over the horizon: end of next month, or Jan 31 when the date is in November (`defaultHorizonEnd`).
- Income forecast: hours per day (plan segments, closures, holidays, logged actuals) × net hourly rate, grouped into pay periods with pay-date rules (day of month rolled to a business day, or n-th business day).
