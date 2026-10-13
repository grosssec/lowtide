# Lowtide sync (Google Apps Script)

A small script that runs inside your Google account, twice a day (around 7 am and 7 pm; change `CONFIG.syncHours` for other times), and feeds the app:

- **Bank alerts:** reads Chase and Discover alert emails (read-only Gmail access) and sends them to the app. Each one becomes a transaction or a balance update.
- **Hours:** reads your timesheets in Google Sheets and sends the hours, so the paycheck forecast uses real hours instead of the plan's usual ones. (Google only lets a script open a sheet with the full Sheets permission; the code only reads.)
- **Email digest:** at 8 am, emails you if something is urgent or needs a look, as a backup for the push notification.

The script can't send, change or delete email: its Gmail access is read-only. The digest uses a separate send permission and only ever writes to you.

## 1. Turn on bank alerts by email

Send the alerts to the Gmail (or Google Workspace) inbox the script will read. Avoid forwarding from another address: many mail systems block automatic forwarding, and a forwarded email can fail the check that it really came from the bank.

**Chase** (chase.com → Profile & settings → Alerts), for the checking account. Set the alert email, then turn on:

- debit card transactions, any amount (the lowest it allows);
- Zelle payments sent and received, direct deposits, ATM withdrawals and outgoing transfers;
- the daily balance summary, if offered.

**Discover** sends alerts by push or text only, so import the card's CSV instead (Discover website → Activity → Download → CSV), for example once a week. The app reminds you when the card's data is more than eight days old.

## 2. Create the script

1. Open [script.google.com](https://script.google.com) with that Google account → **New project** → rename it **Lowtide sync**.
2. **Project Settings** (gear icon): check **Show "appsscript.json" manifest file in editor**, and set your time zone.
3. In the editor, replace everything in `Code.gs` with this folder's `Code.gs`, and everything in `appsscript.json` with this folder's `appsscript.json` (which also turns on the Gmail API service).
4. **Project Settings → Script properties**, add:
   - `APP_URL`: your app's address, for example `https://money.example.com`;
   - `INGEST_TOKEN`: the value in the project's `.env` file (created by `node scripts/secrets.ts --remote`). Copy it from the file; never paste it into a chat or an email;
   - one property per timesheet with the sheet's id (the long id in its URL, `docs.google.com/spreadsheets/d/<id>/edit`), named as in `CONFIG.hours` below. A missing one is simply skipped.

## 3. Timesheets

`CONFIG.hours` in `Code.gs` lists the sheets to read. It ships with the author's two jobs as an example:

```js
hours: [
  { jobId: 'umm', sheetIdProperty: 'UMM_SHEET_ID', tabsNamed: 'Ricardo', filledDaily: true },
  { jobId: 'bookstore', sheetIdProperty: 'BOOKSTORE_SHEET_ID', skipTabsNamed: 'Week', thisMonthOnly: true },
],
```

- `jobId` must match the job's `id` in your plan.
- `filledDaily`: the sheet is filled day by day, so a past day without hours counts as a day off. Without it (a sheet filled at the end of the month), the forecast keeps the job's usual hours until the month is in.
- `tabsNamed` / `skipTabsNamed`: read only the tabs whose name contains (or doesn't contain) a word, for example your name in a shared sheet.
- `thisMonthOnly`: the sheet only holds the current month; hours from earlier months, already sent, stay as they were.

There is nothing else to map: the script reads the tabs, finds the columns from each header row with **Date** and **Total Hours** (or **Time In** and **Time Out**), and counts the time between in and out when a total is missing. Month names in English or Portuguese both work.

Select **previewHours** and press **Run**: the log shows the days and hours read from each sheet, to check against the sheets.

## 4. Authorize and start

1. Select **previewAlerts** → **Run**, and allow the permissions Google asks for. If it says the app isn't verified: **Advanced** → **Go to Lowtide sync** (it is your own script).
2. The log lists recent alert emails. `verified: true` means Gmail confirmed the sender (DMARC).
3. Select **setup** → **Run**. This creates the timers and syncs once. To sync right away later, run **syncAll**.

From then on it runs by itself, and Google emails you if a run fails.

## Check it in the app

**Settings → Sync and imports** shows the time of the last alert email and the hours logged per job. **Show received alerts** lists every email with what the app did with it:

- **unparsed:** a format the app doesn't know yet. Share the subject and text, without account numbers, so the parser can learn it;
- **ignored:** a reminder, statement notice, security or marketing email. These never become spending.

Statements and CSVs you import later replace the alert entries: the bank's own rows are the record.

## Security

- The token only allows three calls: send alerts, send hours, read the morning digest. It can't read transactions or change settings.
- Emails that fail Gmail's DMARC check (forged senders) are kept as "ignored" and never touch the numbers; the server also checks that the sender's domain is exactly the bank's.
- If the token leaks: delete the `INGEST_TOKEN` line from `.env`, run `node scripts/secrets.ts --remote --only INGEST_TOKEN` (creates and stores a new one), and update the script property.
