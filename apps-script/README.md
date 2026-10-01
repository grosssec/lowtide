# Finance sync (Google Apps Script)

Runs inside Google, on your work email account (Google Workspace), every 15 minutes:

- **Bank alerts**: reads Chase and Discover alert emails (read-only Gmail access) and sends them to the app. Each one becomes a transaction or a balance update.
- **Hours**: reads the UMM and Bookstore timesheets (read-only) and sends the hours, so the paycheck forecast uses real hours instead of the plan.
- **Email digest**: at 8 am, emails you if something is urgent or needs a look (backup for the push notification).

The script can't send, change or delete email (its Gmail access is read-only). Its email digest uses a separate send permission, and it only ever writes to you.

## 1. Turn on the bank alerts (by email, to your work email)

Chase (chase.com or the app → Profile → Alerts → Account alerts), checking account:
- Debit card transactions: any amount (the lowest it allows)
- Zelle payments sent and received; direct deposits; ATM withdrawals and outgoing transfers
- A daily balance summary, if offered

Discover (discover.com or the app → Manage → Alerts):
- Transaction alert: the lowest amount it allows
- Payment posted
- Balance alert (daily or current balance), if offered

Use email, not only push or text: the script only sees email.

## 2. Create the script

1. Open script.google.com (signed in with your work email) → **New project** → rename it **Finance sync**.
2. **Project Settings** (gear icon):
   - check **Show "appsscript.json" manifest file in editor**
   - set the time zone to **(GMT-05:00) Central Time - Chicago**
3. **Editor**:
   - replace everything in `Code.gs` with this folder's `Code.gs`
   - replace everything in `appsscript.json` with this folder's `appsscript.json` (this also turns on the Gmail API service)
4. **Project Settings → Script properties → Add script property**:
   - `APP_URL` = the app address, e.g. `https://finance-dashboard.<your-subdomain>.workers.dev`
   - `INGEST_TOKEN` = the value in the project's `.env` file (created by `node scripts/secrets.ts --remote`). Copy it from the file; never send it in a chat or email.

## 3. Timesheets

In `Code.gs`, fill in `CONFIG.hours`, one entry per sheet:
- spreadsheet id (from the sheet's URL)
- tab name
- first data row
- the date column
- either the hours column or the start + end columns
- for a shared company sheet: `nameColumn` + `name`, so only your rows count

Then select **previewHours** and press **Run**. The log shows the days and hours it read; check them against the sheet.

## 4. Authorize and start

1. Select **previewAlerts** → **Run**. Google asks for permission; allow it.
   - If it says the app isn't verified: **Advanced** → **Go to Finance sync**. It's your own script.
2. The log lists recent alert emails. `verified: true` means Gmail confirmed the sender (DMARC).
3. Select **setup** → **Run**. This creates the timers and syncs once.

From then on it runs by itself. Google emails you if a run fails.

## Check it in the app

Settings → Automatic sync:
- the time of the last alert email, and the logged hours per job
- **Show received alerts** lists every email with what the app did with it:
  - **unparsed**: the app didn't understand the email (a new format). Share the subject and text, without account numbers, so the parser can learn it.
  - **ignored**: a reminder, statement notice, security or marketing email. These never become spending.

Bank statements and CSVs you import later replace the alert entries; the bank's own rows are the record.

## Security

- The token only allows these calls: send alerts, send hours, read the morning digest. It can't see transactions or change settings.
- Emails that fail Gmail's DMARC check (forged senders) are stored as "ignored" and never touch the numbers.
- If the token leaks:
  1. Delete the `INGEST_TOKEN` line from `.env`.
  2. Run `node scripts/secrets.ts --remote` (creates and stores a new one).
  3. Update the script property.
