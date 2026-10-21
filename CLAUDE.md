# Lowtide

A personal cash-flow forecast: what is safe to spend before the next paycheck. Public repo (github.com/ricardoogross/lowtide, MIT); the owner's deployment is finance.ricardogross.com, the demo demo.ricardogross.com, the landing page lowtide.ricardogross.com. Product status for the owner: vault note `10-Projects/Finance Dashboard.md`.

## Stack
- React 19 + Vite 8 + Tailwind 4 app in `src/` (pages in `src/pages`, charts in `src/components/charts.tsx`), Cloudflare Worker API in `worker/` (Hono, D1 via `worker/db.ts`, passkeys in `worker/auth.ts`), Wrangler 4. Schema in `migrations/`.
- Workers free plan = ~10 ms CPU per request: the Worker computes only the Month screen (`buildDashboard`, ~1 ms). The year plan (`buildYearPlan`) and statement parsing (`shared/import/file.ts`, lazy-loads pdf.js) run in the browser. Keep heavy work out of `worker/`.
- Sync: `apps-script/` (Google Apps Script) posts bank alert emails and timesheet hours to `/api/ingest/*` (`worker/ingest.ts`, bearer `INGEST_TOKEN`, no session). Hourly Cron Trigger → daily push at 8 am in `TIMEZONE` (`worker/notify.ts`, Web Push over WebCrypto in `shared/push/webpush.ts`, service worker `public/sw.js`).
- Domain logic in `shared/` (engine, plan, import, push, brand): pure TypeScript, no I/O, shared by the Worker, the UI and `scripts/`.
- Brand: the mark and outlined wordmark are drawn once in `shared/brand/mark.ts` (used by `src/components/Brand.tsx`, index.html's splash via the Vite plugin in `vite.config.ts`, and `scripts/brand.ts`). Guide: `docs/brand.md`.
- Landing page: static files in `site/public` (own `site/wrangler.jsonc`). Demo: `env.demo` in `wrangler.jsonc` (read-only, frozen `DEMO_TODAY`, data from `scripts/demo.ts`).
- Tests in `test/` (Vitest, plain Node). Lint: oxlint. Type-check: `tsc -b` (app, node, worker, tools projects). CI: `.github/workflows/ci.yml`.
- Imports use explicit `.ts` extensions so `scripts/` run directly with Node's type stripping (`node scripts/plan.ts`).

## Commands
- `npm run dev`: app + Worker locally (`.dev.vars` `DEV_AUTH_BYPASS=1` skips sign-in on localhost only). Demo locally: `node scripts/demo.ts`, then `CLOUDFLARE_ENV=demo npx vite --port 5174`
- `npm run db:migrate` / `npm run seed`: local D1 tables / load `data/` into local D1 without overwriting app edits (`-- --plan` replaces only the plan, `-- --force` replaces everything, `-- --remote` only with the owner's OK)
- `node scripts/secrets.ts`: INGEST_TOKEN, CHALLENGE_KEY and VAPID keys into `.dev.vars` (`--remote`: into `.env` + `wrangler secret put`; `--only NAME` for one). Never print the values, and never print `.env` or `.dev.vars`.
- `npm run setup-code` (`-- --remote`): one-time device code for a first passkey or recovery. The owner runs the remote one himself.
- `npm test`, `npm run typecheck`, `npm run lint`: run all three before calling work done
- `npm run deploy` / `deploy:demo` / `deploy:site`: the app, the demo, the landing page (see DEPLOY.md)
- `node scripts/screenshots.ts` (demo running on :5174) then `node scripts/brand.ts`: README/landing screenshots, icons, link previews
- `npm run plan`: cash-flow plan from `data/plan.local.json` (`scripts/plan.example.json` documents the shape)
- `npm run import`: `data/imports/*` (Chase statement PDFs, Chase/Discover CSVs) → `data/ledger.json`. Personal category rules in `data/rules.local.json` run before `DEFAULT_RULES` (`shared/import/categorize.ts`)

## Rules
- Real financial data never enters git, the vault or the public docs. `data/` is gitignored; secrets only in `.env` / `.dev.vars`. Fixtures and the demo use made-up names, places and amounts.
- Money is integer cents (`Cents`). Dates are ISO strings with UTC math (`shared/engine/dates.ts`).
- Engine changes are test-first: every pay-schedule or projection rule gets a fixture test.
- UI copy in English, in the voice of `docs/brand.md`. Conventional Commits.
- Nothing goes live (deploy, bank connections, DNS, paid services) without the owner's OK. Deploy steps: `DEPLOY.md`.
- Production D1 is the source of truth for the plan and balances once they are edited in the app. Pull them into `data/plan.local.json` before any `seed -- --plan --remote`, or those edits are lost.
- Data endpoints need a session; state-changing calls need the `X-Requested-With: finance-dashboard` header (the `src/lib/api.ts` wrapper sends it). Only `/api/ingest/*` skips both and uses the bearer token instead.
- Apps Script code (`apps-script/Code.gs`) is plain V8 JavaScript; its pure helpers are tested in `test/apps-script/` through `node:vm`. Gmail access stays read-only (advanced Gmail API, `gmail.readonly`).

## Domain
- Accrual for reports: card purchases count when made. Paying the card bill is a transfer, never an expense. `toCashFlows` gives the checking + cash view (card bill on its due date) for liquidity.
- Live balances (`computeActuals`): last snapshot per account + every entry after it. Checking and cash snapshots are available balances, so entries count by transaction `date`; the card snapshot is the posted balance, so card entries count by `postedDate`. On the snapshot's own day, an entry counts only when both have a time (`at`) and the entry is later.
- Alert emails become entries with `source: 'alert'`. Importing a statement or CSV settles them (`settleAlertEntries`): paired rows replace them (keeping the alert's earlier date and time), unpaired ones older than 5 days inside the file's period are dropped.
- Safe to spend = lowest projected balance minus the floor (the reserve, from its start date), over the horizon: end of next month, or Jan 31 when the date is in November (`defaultHorizonEnd`).
- Plan format is versioned (`PlanConfig.version`, now 2). Older stored plans are migrated on read (`migratePlan`, `worker/state.ts`). Change the shape → bump the version and add a migration with a test.
- One forecast, no scenarios (`planFlows`, `forwardFlows`):
  - Hours per job: logged days as they are. After the last logged day, the average of the last full weeks since `hoursSince`, capped at `maxWeeklyHours` (extra hours stay extra). The usual `weeklyHours` until two weeks are logged (`weeklyHoursBasis`).
  - Hours × net rate are grouped into pay periods with pay-date rules (day of month rolled to a business day, or the n-th business day).
  - Time away (`away`) and job closures pay nothing. Both can repeat yearly (`occurrences`).
- Goals fill in list order after the reserve; trips get the room that keeps the reserve until the month after them. The Plan screen always shows the next 12 months (`buildYearPlan`).
