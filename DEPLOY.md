# Deploying Lowtide

Run your own copy on Cloudflare's free plan. It takes about 15 minutes, and nothing here costs money.

You need:

- a free [Cloudflare account](https://dash.cloudflare.com/sign-up);
- a domain on Cloudflare for the app (recommended: passkeys are tied to the domain, and the zone lets you require TLS 1.2+). A `workers.dev` address also works;
- Node 22.18 or newer;
- optionally, a Google account for the email and timesheet sync.

## 1. Set up the project

```bash
git clone https://github.com/grosssec/lowtide.git && cd lowtide
npm install
npx wrangler login                 # a browser window opens; approve it
npx wrangler d1 create finance     # prints a database_id
```

Then edit `wrangler.jsonc`:

- paste the printed `database_id` into `d1_databases`;
- set your domain in `routes` (for example `money.example.com`), or remove `routes` and set `"workers_dev": true`;
- set `TIMEZONE` in `vars` to yours (the daily notification goes out at 8 am there).

The scripts call the database `finance`; keep that name.

## 2. Create the tables and your secrets

```bash
npx wrangler d1 migrations apply finance --remote
node scripts/secrets.ts --remote
```

`secrets.ts` generates the sync token, the key that signs sign-in challenges and the push keys, writes them to `.env` (gitignored, mode 600) and stores them as Worker secrets. It never prints them.

## 3. Bring your data (optional)

You can start empty and type your balances, jobs, bills and budgets in Settings. To start with history instead:

1. Put Chase statement PDFs and Chase / Discover CSV downloads in `data/imports/` (gitignored).
2. `npm run import` turns them into `data/ledger.json`.
3. Copy `scripts/plan.example.json` to `data/plan.local.json` and describe your jobs, bills, budgets and reserve.
4. `npm run seed -- --remote` loads it all. It only adds: what you later change in the app is never overwritten (`-- --force` replaces it).

Once you edit the plan in the app, the database is the source of truth: pull it into `data/plan.local.json` before any `npm run seed -- --plan --remote`.

## 4. Deploy

```bash
npm run deploy
```

On your domain's Cloudflare zone, set **SSL/TLS → Edge Certificates → Minimum TLS version 1.2** and turn on **Always Use HTTPS**. Then check it:

```bash
curl -s https://<your-domain>/api/auth/status     # {"signedIn":false,"hasPasskey":false,"bypass":false,"demo":false}
curl -s https://<your-domain>/api/dashboard       # {"error":"Not signed in"}
curl -s https://<your-domain>/api/ingest/digest   # {"error":"Not allowed"}
```

`bypass` must be `false`: the development bypass only exists in a local `.dev.vars` and only works on localhost.

## 5. Sign in

1. Make a one-time code. It prints in your terminal only, works once and lasts 15 minutes:
   ```bash
   npm run setup-code -- --remote
   ```
2. Open the app → **New device? Use a code** → type the code → confirm with Face ID or Touch ID. On Apple devices the passkey syncs through iCloud Keychain.
3. On a phone, open the app in Safari or Chrome and add it to the Home Screen, then turn on the daily notification in Settings.
4. To add another device later: on a signed-in one, **Settings → Security → Add a device** shows a code to type on the new one.

## 6. Turn on the sync (optional)

Bank alert emails and timesheet hours can flow in by themselves, twice a day, through a Google Apps Script: [apps-script/README.md](apps-script/README.md).

## Updating

```bash
npm test && npm run typecheck && npm run lint
npx wrangler d1 migrations apply finance --remote   # only when migrations/ changed
npm run deploy
```

## The demo and the landing page

This repository also deploys two other sites, which you can skip:

| Site | What | Deploy |
|---|---|---|
| Demo | The same app with made-up data, read-only, frozen on `DEMO_TODAY` (`env.demo` in `wrangler.jsonc`, its own D1 `finance-demo`, no cron, no secrets) | `node scripts/demo.ts --remote`, then `npm run deploy:demo` |
| Landing page | Static files in `site/public` (`site/wrangler.jsonc`) | `npm run deploy:site` |

To move the demo's "today", change `DEMO_TODAY` and run both demo commands again. `node scripts/screenshots.ts` (with the demo running locally) and `node scripts/brand.ts` refresh the screenshots, icons and link previews.

## Where the work runs

The Workers free plan allows about 10 ms of CPU per request, so the Worker computes only the Month screen and the daily notification (about 1 ms each). The 12-month plan (about 15 ms) and statement parsing (50 to 150 ms for a PDF) run in the browser; the Worker only stores the rows it receives. More in [docs/architecture.md](docs/architecture.md#performance-budget).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `wrangler` says you are not authenticated | `npx wrangler login` again; the login expires |
| The sign-in prompt shows no passkey after changing the domain | Passkeys belong to a domain. Make a new code with `npm run setup-code -- --remote` and add the device again |
| Notifications don't arrive on iPhone | Web Push works only in the app opened from the Home Screen, with notifications allowed in iOS Settings |
| Repeated 401 on `/api/ingest/*` in the Worker logs | Someone is guessing the sync token: rotate it (`node scripts/secrets.ts --remote --only INGEST_TOKEN` after removing it from `.env`) and update the script's properties |

Security controls and what to watch in the logs: [SECURITY.md](SECURITY.md).
