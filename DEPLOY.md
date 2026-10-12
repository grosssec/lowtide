# Deploy (Cloudflare, free plan)

Nothing here runs without Ricardo's OK: it puts the app and his financial history online.

**Live since 2026-10-02:** https://finance.ricardogross.com (custom domain on the ricardogross.com zone, min TLS 1.2, always HTTPS; workers.dev is off)
- D1 `finance` is in Eastern North America.
- Hourly cron.
- Secrets set with `scripts/secrets.ts --remote`.

## One-time setup

1. **Ricardo** creates a free Cloudflare account (dash.cloudflare.com/sign-up) and confirms the email.
2. Log in from the project folder; a browser window opens and Ricardo approves it:
   ```bash
   npx wrangler login
   ```
3. Create the database and paste the printed `database_id` into `wrangler.jsonc` (replacing the placeholder):
   ```bash
   npx wrangler d1 create finance
   ```
4. Create the tables and load the history, plan, balances and rules from `data/`:
   ```bash
   npx wrangler d1 migrations apply finance --remote
   npm run seed -- --remote
   ```
5. Secrets: the sync token for the Apps Script, the key that signs sign-in challenges, and the push keys. This writes them into `.env` (gitignored, never in chat) and stores them as Worker secrets:
   ```bash
   node scripts/secrets.ts --remote
   ```
6. Deploy:
   ```bash
   npm run deploy
   ```
   - The app is served at the custom domain in `wrangler.jsonc` (`routes`). Its zone must be on Cloudflare; set SSL/TLS → Edge Certificates → **Minimum TLS 1.2** and **Always Use HTTPS** there. `workers_dev: false` keeps the workers.dev address off.
   - The hourly Cron Trigger (daily push at 8 am Chicago time) is part of the deploy.

## Check before using it

```bash
curl -s https://<app-url>/api/auth/status   # {"signedIn":false,"hasPasskey":false,"bypass":false}
curl -s https://<app-url>/api/dashboard     # {"error":"Not signed in"}
curl -s https://<app-url>/api/ingest/digest # {"error":"Not allowed"}
```
`bypass` must be `false`: the dev bypass only exists in `.dev.vars` and only works on localhost.

## First sign-in

1. Make a one-time device code (it prints in your terminal only, works once, for 15 minutes):
   ```bash
   npm run setup-code -- --remote
   ```
2. On the Mac (Safari): open the app → **New device? Use a code** → type the code → confirm with Touch ID. The passkey syncs to the iPhone through iCloud Keychain.
3. On the iPhone (Safari): open the app, sign in with Face ID, then Share → **Add to Home Screen**. Open it from the Home Screen → Settings → Daily notification → **Turn on for this device**.
4. Any other device: on a signed-in one, Settings → Security → **Add a device** shows a code; type it on the new device.

## Automatic sync

Follow `apps-script/README.md`:
- bank alerts by email
- the script in Google with `APP_URL` and `INGEST_TOKEN`
- timesheets

## Updates

```bash
npm test && npm run typecheck && npm run lint
npx wrangler d1 migrations apply finance --remote   # only when migrations/ changed
npm run deploy
```

## Public demo

https://demo.ricardogross.com: the same app with made-up data, read-only, frozen on `DEMO_TODAY` (wrangler.jsonc `env.demo`, its own D1 `finance-demo`, no cron, no secrets).

```bash
node scripts/demo.ts --remote   # tables + made-up data (replaces everything in finance-demo)
npm run deploy:demo
```
- Every non-GET request gets 403 on the server; the client answers changes with a toast first.
- To move the demo's "today", change `DEMO_TODAY` and run both commands again.
- Local preview: `node scripts/demo.ts`, then `CLOUDFLARE_ENV=demo npx vite --port 5174`.

## Why some work runs in the browser

The Workers free plan allows about 10 ms of CPU per request.
- On the Worker: the Month screen and the daily push (≈1 ms each).
- In the browser: the year plan (≈15 ms) and statement parsing (PDF ≈50–150 ms). The Worker only stores the rows it receives.

## Security notes

- **Sessions**:
  - Data endpoints require a session cookie (HttpOnly, Secure, SameSite=Strict, 30 days). Session tokens are stored hashed.
  - State-changing calls also need the `X-Requested-With: finance-dashboard` header (CSRF guard).
- **Sync**:
  - `/api/ingest/*` takes no session; it needs `Authorization: Bearer <INGEST_TOKEN>` (compared in constant time).
  - The token can only send alerts and hours and read the morning digest.
  - Emails that fail Gmail's DMARC check, or come from look-alike domains, never touch the numbers.
- **Push**:
  - Subscriptions are accepted only for the browser push services (Apple, Google, Mozilla, Microsoft).
  - The payload is encrypted for each device (RFC 8291).
- **Static assets** ship with a strict CSP and no-framing headers (`public/_headers`). API responses are `no-store`.
- **No bank passwords anywhere.** Data comes only from alert emails, files you import and numbers you type.
- **Detection**: Workers observability is on (`wrangler.jsonc`).
  - Repeated 401/403 on `/api/auth/*` means someone is trying the login.
  - Repeated 401 on `/api/ingest/*` means someone is guessing the sync token: rotate it (apps-script/README.md).
