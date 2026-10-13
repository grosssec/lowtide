# Security

Lowtide, a single-user personal finance app, holds a person's whole financial picture: balances, every transaction, pay, plans. This document says what the app protects, from whom, how, what it deliberately leaves out, and what two security reviews found and fixed.

## What is worth protecting

| Asset | Where it lives | Why it matters |
|---|---|---|
| Transactions, balances, plan, hours | Cloudflare D1 | Financial privacy; also a map of someone's habits and whereabouts |
| Sessions | `sessions` table (SHA-256 of the token) + `__Host-` cookie | A session is full read/write access |
| Passkeys | `credentials` table (public keys only) | The only way in; there are no passwords |
| Sync token (`INGEST_TOKEN`) | Worker secret + the Apps Script's properties | Lets a caller add transactions and hours |
| Challenge key (`CHALLENGE_KEY`) | Worker secret | Signs sign-in challenges |
| Push keys (VAPID) | Worker secret | Let the app send notifications to the owner's devices |

There are no bank credentials anywhere. Data comes in only from bank alert emails, files the owner imports, and numbers the owner types.

## Architecture and trust boundaries

```
 Browser / iPhone PWA ──(passkey session, HTTPS)──▶ Cloudflare Worker (Hono) ──▶ D1
                                                         ▲          │
 Google Apps Script ──(bearer INGEST_TOKEN, HTTPS)───────┘          └──(Web Push, encrypted)──▶ Apple / Google push
   reads: Gmail (read-only API), the owner's timesheets
```

1. **Internet → Worker.** Everything under `/api/*` is untrusted until proven otherwise.
2. **Apps Script → Worker.** A separate, narrower credential (`INGEST_TOKEN`) that can only post alerts and hours and read the morning digest.
3. **Bank email → Apps Script.** An email claiming to be from a bank is only trusted when Gmail's DMARC result passes for that bank's domain.
4. **Worker → push services.** Only official browser push hosts are ever contacted; payloads are end-to-end encrypted for the device.

## Threat model

| Adversary | Goal | Main defenses |
|---|---|---|
| Anonymous attacker on the internet | Read or change data | Passkey-only sign-in; every data route needs a session; CSRF header; strict CORS (none) |
| Attacker trying to take the app down | Burn the free plan's daily D1 write quota | Unauthenticated routes write nothing (signed challenges, read-only code checks); body size limits; rate-limit bindings |
| Someone who steals a device or a session cookie | Keep access | HttpOnly `__Host-` cookie; sessions visible and revocable in Settings → Security; lost device's passkey removable |
| Phishing / forged bank email | Inject fake spending or balances | DMARC check in the script, exact sender domain check on the server, parser ignores reminders, statements and marketing |
| Leaked sync token | Inject data, read the digest | Token can't read transactions or settings; constant-time comparison; rotation documented |
| Malicious push payload / open redirect | Send the user elsewhere | Only the server holds the VAPID key; the service worker opens same-origin URLs only |
| Supply chain | Malicious or vulnerable dependency | Small dependency set, `npm audit` clean, overrides for vulnerable transitive packages, no dependency install scripts allowed (npm 11 blocks them; none are needed), Dependabot updates |

Out of scope: a compromised Cloudflare or Google account, a compromised owner device with the app unlocked, and Cloudflare-level volumetric DDoS (handled by the platform).

## Controls

### Authentication
- **Passkeys only** (WebAuthn via SimpleWebAuthn), with user verification required (Face ID / Touch ID). Nothing to guess, reuse or phish.
- **Signed, stateless challenges.** A challenge is `challenge.expires.HMAC(purpose.challenge.expires)` with `CHALLENGE_KEY`:
  - it is bound to its purpose (sign-in vs. adding a passkey) and expires in 5 minutes;
  - it is recorded as spent only *after* a passkey verifies;
  - asking for one writes nothing, so sign-in can't be used to fill the database.
- **New devices** join with a one-time code:
  - 8 characters from a 32-symbol alphabet (40 bits), valid 10–15 minutes, single use;
  - shown on a signed-in device (Settings → Security → Add a device) or printed by `npm run setup-code` for recovery;
  - only its SHA-256 is stored, and checking a code is a read.
- **The last passkey can't be removed**, so the owner can't lock themselves out by accident.

### Sessions
- 256-bit random token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie with the `__Host-` prefix: no subdomain can set or read it.
- Only the SHA-256 of the token is stored, so a database leak hands out no sessions. A new token is issued at every sign-in (no fixation).
- 30-day lifetime. Every session is listed with device, place (city and country from Cloudflare, no IP stored) and last activity, and can be ended from any other session ("Sign out all other devices").

### Requests
- **CSRF:** state-changing calls need `X-Requested-With: finance-dashboard`. Browsers won't send it cross-site without CORS, and the API grants no CORS.
- **Validation:** every body is parsed with zod (types, ranges, lengths). Unknown or out-of-range values are rejected, not coerced.
- **Size limits:** 1 MB per request body, 6 MB for statement imports.
- **SQL:** every query is parameterized (D1 prepared statements). Merchant rules created from the UI are regex-escaped.
- **Errors:** clients get generic messages; details stay in the Worker logs.

### Sync (`/api/ingest/*`)
- Bearer token compared in constant time. An empty secret never matches. No cookies involved.
- An email counts only if:
  - Gmail's DMARC result passes for `chase.com` or `discover.com`, with the domain ending exactly there;
  - **and** the server confirms the sender's domain is exactly the bank's or one of its subdomains;
  - **and** the parser recognizes a transaction or balance. Reminders, statements, security and marketing emails are ignored.
- Alert entries are reconciled against the bank's own statement/CSV rows, which always win.

### Push notifications
- Web Push implemented directly on WebCrypto:
  - VAPID ES256 JWT (RFC 8292);
  - aes128gcm payload encryption (RFC 8291 / 8188), with a fresh ECDH key and salt per message.
- Subscriptions are accepted only for official push hosts (Apple, Google, Mozilla, Microsoft), https, with no port or credentials in the URL. This blocks SSRF through the subscribe endpoint.
- The service worker only opens the app's own origin when a notification is tapped.

### Transport and headers
- Custom domain on Cloudflare: **TLS 1.2 minimum**, TLS 1.3 on, **HTTP → HTTPS redirect**, HSTS. The API also refuses TLS 1.0/1.1 itself (426), in case the zone setting ever changes.
- Static assets:
  - a strict CSP (`default-src 'self'`, no inline or remote scripts, `frame-ancestors 'none'`);
  - plus `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, and a restrictive `Permissions-Policy`.
- API responses: `Cache-Control: no-store`, plus secure headers (COOP, CORP, nosniff).

### Logging and detection
- **Security log** (Settings → Security): sign-ins, sign-outs, passkeys added or removed, devices signed out remotely, device codes made. It is written only after a passkey verified or with a session.
- **Failed sign-ins and rate-limited requests** go to the Worker logs (observability on), never to the database.
- **Signals worth watching in the logs:**
  - repeated `sign-in rejected` or 401/403 on `/api/auth/*`: someone trying to sign in;
  - repeated 401 on `/api/ingest/*`: someone guessing the sync token, so rotate it;
  - an unexpected `passkey_added` or sign-in from an unknown place in the security log: end the sessions and remove the passkey.

### Secrets and data hygiene
- Secrets live only in Cloudflare Worker secrets and the gitignored `.env` / `.dev.vars` (mode 600). `scripts/secrets.ts` generates them and stores them without ever printing them.
- Real financial data never enters git: `data/` is gitignored, and fixtures use fake names and numbers.

## Accepted risks and limits

| Risk | Why it is accepted |
|---|---|
| Cloudflare's rate-limit bindings are permissive and eventually consistent | They are an extra layer only; the real fix is that unauthenticated routes write nothing |
| A passkey response replayed within its 5-minute window, before it is marked spent | Needs the victim's own signed assertion (TLS-protected) |
| Session lifetime is 30 days with no idle timeout | Single owner on personal devices; sessions are visible and revocable |
| The app owner (database access) can read the data | It is a single-user app on the owner's account; there is no per-user encryption |
| `unsafe-inline` styles in the CSP | Needed by the UI's inline style attributes; scripts stay strict |
| Discover has no email alerts | The card is updated by a weekly CSV import, with an in-app reminder after 8 days |

## Review history

### Round 1: automated scans, manual review, live probing
| Finding | Severity | Fix |
|---|---|---|
| Every sign-in request stored a challenge row, so anyone could exhaust the free D1 write quota (DoS) | Medium | Signed, stateless challenges; spent-marks written only after a passkey verifies |
| 500 responses returned internal error messages | Low | Generic message, details in logs; malformed JSON returns 400 |
| Session cookie without the `__Host-` prefix | Low | `__Host-fd_session` on https |
| Vulnerable `sharp` in the dev toolchain (CVE) | Low (dev only) | Updated tooling and pinned the patched version |

Clean in this round:
- secret scan of the full git history;
- semgrep, 84 rules over 91 files;
- `npm audit` of production dependencies;
- route probing: all data routes 401 without a session, path and case tricks, forged cookie, token and `Host` header.

### Round 2: Trail of Bits sharp-edges review and an OWASP Top 10 test
| Finding | Severity | Fix |
|---|---|---|
| `sameSecret('', '')` returned true (latent bypass for any future caller) | Low | Empty secrets never match |
| Challenges usable for either sign-in or adding a passkey | Low | Purpose bound into the HMAC |
| Script DMARC check accepted `header.from=chase.com.evil.net` | Low (server still checked the domain) | Domain must end at `.com` |
| No request body size limit | Low | 1 MB / 6 MB limits |
| Service worker would open any URL from a notification | Low | Same-origin only |
| Push endpoints accepted an explicit port | Low | Port and credentials rejected |
| TLS 1.0/1.1 accepted on the workers.dev address | Medium | Custom domain with minimum TLS 1.2, HTTPS-only; API refuses old TLS itself |

Clean in this round:
- SQL injection in every parameter;
- stored XSS through transaction descriptions (React escapes it);
- mass assignment on balances and plan;
- SSRF bypass encodings: lookalike domains, fragments, internal IPs, the cloud metadata IP, `http`, userinfo, trailing dot.

### Round 3: before publishing the repository
| Check | Result |
|---|---|
| Secret scan of the whole git history: every real secret value compared against every version of every file, plus common key patterns (cloud keys, tokens, private keys, JWTs) | Clean |
| Personal details in fixtures and history (names, places, pay rates) | Replaced with made-up ones; history rewritten before the first push; commits use a no-reply address |
| An unused secret from an older sign-in flow | Removed from every environment |
| Repository settings | Private vulnerability reporting, CodeQL code scanning, secret scanning with push protection and Dependabot updates are on |
| Landing page | Static files only, with a strict CSP (no inline or remote scripts), `nosniff`, no framing and HSTS |

## Supported versions

Only the latest `main`, and the deployment built from it, gets security fixes.

## Reporting a vulnerability

Please report privately: **GitHub → Security → Report a vulnerability** on this repository, not a public issue. Include the steps to reproduce and what you expected; you will get a reply within a week. The [public demo](https://demo.ricardogross.com) is read-only and fine to look at closely; please don't load-test it, and never test against someone else's deployment.
