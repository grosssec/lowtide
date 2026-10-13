# Contributing to Lowtide

Thanks for taking a look. Lowtide is a personal project, so the bar for a change is simple: it keeps the forecast honest, the code small and the money private.

## Getting set up

```bash
npm install
node scripts/demo.ts                       # a local database with made-up data
CLOUDFLARE_ENV=demo npx vite --port 5174   # the app and its Worker
```

To work against your own local data instead, see [DEPLOY.md](DEPLOY.md) (`npm run db:migrate`, `npm run seed`, `npm run dev`).

## Before you open a pull request

```bash
npm test && npm run typecheck && npm run lint
```

CI runs the same checks plus a production build.

## How the code is written

- **The engine is pure.** Anything about money, dates or the forecast goes in `shared/` with no I/O, so the Worker, the app and the scripts share it and the tests can call it directly.
- **Test first for rules.** A new pay schedule, projection rule or parser format comes with a fixture test in `test/`.
- **Money is integer cents; dates are ISO strings** with UTC math (`shared/engine/dates.ts`). No floats, no `Date` arithmetic in local time.
- **Mind the CPU budget.** The Worker has about 10 ms per request on the free plan; heavy work runs in the browser.
- **Plan format changes** bump `PlanConfig.version` and add a migration with a test (`shared/plan/migrate.ts`).
- **Copy follows the brand voice** in [docs/brand.md](docs/brand.md): plain, specific, calm, no exclamation marks.
- **Commits follow [Conventional Commits](https://www.conventionalcommits.org/)** (`feat:`, `fix:`, `docs:`, `chore:`…).

## Data and secrets

Never commit real financial data or secrets. `data/`, `.env` and `.dev.vars` are gitignored; fixtures and the demo use made-up names, places and amounts.

## Security

Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md#reporting-a-vulnerability), not in an issue.
