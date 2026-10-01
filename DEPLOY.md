# Deploy (Cloudflare, free plan)

Nothing here runs without Ricardo's OK: it puts the app and his financial history online.

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
5. Setup code for the first passkey. Generate it into `.env` (gitignored, never in chat), then store it as a Worker secret:
   ```bash
   echo "SETUP_TOKEN=$(openssl rand -base64 24)" >> .env
   grep SETUP_TOKEN .env | cut -d= -f2- | npx wrangler secret put SETUP_TOKEN
   ```
6. Deploy:
   ```bash
   npm run deploy
   ```
   The app is served at `https://finance-dashboard.<account-subdomain>.workers.dev`.

## Check before using it

```bash
curl -s https://<app-url>/api/auth/status   # {"signedIn":false,"hasPasskey":false,"bypass":false}
curl -s https://<app-url>/api/dashboard     # {"error":"Not signed in"}
```
`bypass` must be `false`: the dev bypass only exists in `.dev.vars` and only works on localhost.

## First sign-in

1. On the Mac (Safari): open the URL, type the setup code from `.env`, confirm with Touch ID. The passkey syncs to the iPhone through iCloud Keychain.
2. On the iPhone (Safari): open the URL, sign in with Face ID, then Share → Add to Home Screen.
3. Optional hygiene once a passkey exists: `npx wrangler secret delete SETUP_TOKEN` (new passkeys can then only be added while signed in, from Settings).

## Updates

```bash
npm test && npm run typecheck && npm run lint
npm run deploy
npx wrangler d1 migrations apply finance --remote   # only when migrations/ changed
```

## Why some work runs in the browser

The Workers free plan allows about 10 ms of CPU per request. The Month screen (≈1 ms) is computed on the Worker; the year plan (≈15 ms) and statement parsing (PDF ≈50–150 ms) run in the browser, and the Worker only stores the rows it receives.

## Security notes

- Data endpoints require a session cookie (HttpOnly, Secure, SameSite=Strict, 30 days); session tokens are stored hashed.
- State-changing calls also require the `X-Requested-With: finance-dashboard` header (CSRF guard).
- Static assets ship with a strict CSP and no-framing headers (`public/_headers`); API responses are `no-store`.
- No bank passwords anywhere; data only comes in through files you import or numbers you type.
- Detection: Workers observability is on (`wrangler.jsonc`). Repeated 401/403 on `/api/auth/*` in the logs means someone is trying the login.
