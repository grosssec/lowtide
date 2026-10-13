# Changelog

All notable changes to Lowtide. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-13

The first public release.

### The forecast

- Safe to spend: the lowest projected balance before the horizon (the end of next month, or January 31 in November), minus the reserve, and what that is per day until the next paycheck.
- Hours become paychecks: pay periods, pay-date rules (a day of the month rolled to a business day, or the n-th business day), rate changes, US federal holidays, job breaks and time away.
- Hours learned from timesheets: the average of recent full weeks, capped so extra hours stay extra; the usual hours until two weeks are logged.
- Budgets spread per day, with only what is left of them counting for the current month; trips cut home budgets to a quarter; bills with skipped months; yearly one-offs.
- A rolling 12-month plan with savings goals in priority order, room to spend on each trip, and the assumptions written from the plan.
- A versioned plan format, migrated on read.

### Getting data in

- Chase statement PDFs and Chase / Discover CSVs, parsed in the browser.
- Bank alert emails through a Google Apps Script, accepted only when DMARC passes for the bank's exact domain; statements settle the alert entries.
- Timesheet hours from Google Sheets, twice a day.
- Personal category rules created from a transaction in one tap, then built-in merchant rules.

### The app

- Month, Plan, Transactions and Settings screens, light and dark, installable as a web app.
- A daily push notification at 8 am with Web Push implemented on WebCrypto (VAPID and aes128gcm).
- Passkey-only sign-in with signed, stateless challenges; one-time codes to add a device; a Security screen with devices, passkeys and an activity log.
- The Lowtide brand: the Moonrise mark, app icons, an animated splash, a landing page and a brand guide.

### Security

- Strict headers and CSP, TLS 1.2+, rate limits, body-size limits, CSRF header, zod validation, generic errors.
- Three review rounds, written up in [SECURITY.md](SECURITY.md).

### Public demo

- A read-only copy with six months of made-up data, frozen on one day, at [demo.ricardogross.com](https://demo.ricardogross.com).

[1.0.0]: https://github.com/grosssec/lowtide/releases/tag/v1.0.0
