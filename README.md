# finance-dashboard

Personal finance dashboard: what came in, what went out, the month's result, a forecast of hourly income, and how much is **safe to spend** without touching the reserve or next month.

## Screens
- **Month**: safe to spend, projected balance until the next month ends (paydays, tightest day, reserve), money in / out / result, next month covered or not, spending by category vs budget, income by source, next 14 days, alerts.
- **Plan**: month-end balance until the plan end for a worst case and a likely case, spending room at checkpoints (e.g. trips), the savings goal under every scenario.
- **Transactions**: import Chase statement PDFs and Chase / Discover CSV exports, add cash, recategorize (optionally as a rule for similar transactions).
- **Settings**: balances, reserve and goal, budgets, bills, one-off events, rules, passkeys, full plan as JSON.

## Status
- ✅ Engine, importer, Worker API (D1), React app, passkey login, PWA icons. 60 tests.
- ⏳ Deploy (needs a Cloudflare account, see DEPLOY.md), then alerts (daily balance + available, bills, reserve) and hours from Google Sheets.

## Setup
```bash
npm install
npm run db:migrate      # local D1 tables
npm run seed            # local D1 ← data/ledger.json, data/plan.local.json, data/rules.local.json
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
React 19 + Vite 8 + Tailwind 4, Cloudflare Workers (Vite plugin, Wrangler 4), Hono, D1, Zod, SimpleWebAuthn, unpdf (browser only), Vitest, oxlint.

## Privacy
No real financial data in git. Statements, balances and plan inputs stay in `data/`; secrets stay in `.env` / `.dev.vars`. The app only reads data and never moves money.
