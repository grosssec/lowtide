# Deploy (Cloudflare, free plan)

Nothing here runs without Ricardo's OK: it puts the app and his financial history online.

**Live since 2026-10-02:** https://finance.ricardogross.com (custom domain on the ricardogross.com zone; the workers.dev address is being retired)
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
5. Secrets: the setup code for the first passkey, the sync token for the Apps Script, and the push keys. This writes them into `.env` (gitignored, never in chat) and stores them as Worker secrets:
   ```bash
   node scripts/secrets.ts --remote
   ```
6. Deploy:
   ```bash
   npm run deploy
   ```
   - The app is served at `https://finance-dashboard.<account-subdomain>.workers.dev`.
   - The hourly Cron Trigger (daily push at 8 am Chicago time) is part of the deploy.
   - A new account first needs a workers.dev subdomain. Opening Workers & Pages in the dashboard creates one, or register it through the API. This account uses `ricardogross`.

## Check before using it

```bash
curl -s https://<app-url>/api/auth/status   # {"signedIn":false,"hasPasskey":false,"bypass":false}
curl -s https://<app-url>/api/dashboard     # {"error":"Not signed in"}
curl -s https://<app-url>/api/ingest/digest # {"error":"Not allowed"}
```
`bypass` must be `false`: the dev bypass only exists in `.dev.vars` and only works on localhost.

## First sign-in

1. On the Mac (Safari):
   1. Open the URL.
   2. Type the setup code (`SETUP_TOKEN` in `.env`).
   3. Confirm with Touch ID. The passkey syncs to the iPhone through iCloud Keychain.
2. On the iPhone (Safari):
   1. Open the URL and sign in with Face ID.
   2. Share → **Add to Home Screen**.
   3. Open **Finance** from the Home Screen → Settings → Daily notification → **Turn on for this device**. iOS only allows web notifications for apps added to the Home Screen.
3. Optional hygiene once a passkey exists: `npx wrangler secret delete SETUP_TOKEN`. After that, new passkeys can only be added while signed in, from Settings.

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
