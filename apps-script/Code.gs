/**
 * Finance sync: runs inside Google (Apps Script) on the work email account (Google Workspace).
 *
 *   syncBankAlerts  Chase / Discover alert emails  → POST {APP_URL}/api/ingest/email
 *   syncHours       timesheets in Google Sheets    → POST {APP_URL}/api/ingest/hours
 *   emailDigest     8 am: emails you the urgent alerts (backup for the push notification)
 *
 * Gmail is read with the read-only Gmail API: this script cannot send, change or delete email.
 * Setup: apps-script/README.md. Secrets live in Project Settings → Script properties (APP_URL, INGEST_TOKEN), never here.
 */

const CONFIG = {
  /** Gmail search for bank alerts. Spam and trash are never searched. */
  alertQuery: '(from:chase.com OR from:discover.com)',
  /** First run looks this far back; later runs only look at the last few days. */
  firstSyncDays: 30,
  /**
   * One entry per timesheet (fill in after looking at each sheet, then run previewHours):
   *   jobId          'umm' or 'bookstore' (the job ids in the plan)
   *   spreadsheetId  the long id in the sheet's URL: docs.google.com/spreadsheets/d/<id>/edit
   *   sheet          tab name
   *   firstRow       first row with data (after the headers)
   *   dateColumn     column with the work date
   *   hoursColumn    column with hours worked (3.5 or 3:30)  - or -  startColumn + endColumn (9:00 AM / 13:30)
   *   nameColumn + name  optional: only rows with this name (a shared company sheet)
   */
  hours: [
    // { jobId: 'umm', spreadsheetId: '', sheet: 'Sheet1', firstRow: 2, dateColumn: 'A', hoursColumn: 'D' },
    // { jobId: 'bookstore', spreadsheetId: '', sheet: 'Sheet1', firstRow: 2, dateColumn: 'A', startColumn: 'B', endColumn: 'C' },
  ],
  /** Days of hours resent every run, so fixes in the sheet are picked up. */
  hoursDays: 45,
  /** Local hour (project time zone) of the email digest. */
  digestHour: 8,
  /** true: email every morning; false: only when something is urgent or needs a look. */
  dailyEmail: false,
};

const PROPS = PropertiesService.getScriptProperties();

/** Run once after pasting the code and filling in the script properties. Creates the timers and syncs right away. */
function setup() {
  settings_();
  ScriptApp.getProjectTriggers().forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('syncAll').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('emailDigest').timeBased().everyHours(1).create();
  syncAll();
  console.log('Set up: sync every 15 minutes, digest check every hour.');
}

/** Timer entry point. Errors are thrown at the end, so Google emails a failure report. */
function syncAll() {
  const errors = [];
  try {
    syncBankAlerts();
  } catch (error) {
    errors.push(`Bank alerts: ${error.message}`);
  }
  try {
    syncHours();
  } catch (error) {
    errors.push(`Hours: ${error.message}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
}

// ---------- Bank alerts ----------

function syncBankAlerts() {
  const lastSync = Number(PROPS.getProperty('alertsSyncedAt') || 0);
  const started = Date.now();
  const days = lastSync ? 3 : CONFIG.firstSyncDays;
  const emails = [];
  for (const id of messageIds_(`${CONFIG.alertQuery} newer_than:${days}d`)) {
    const message = Gmail.Users.Messages.get('me', id, { format: 'full' });
    const receivedAt = Number(message.internalDate);
    // Two hours of overlap with the last run; the app ignores emails it already has.
    if (receivedAt < lastSync - 2 * 3600 * 1000) continue;
    emails.push(toAlert_(message));
  }
  for (let i = 0; i < emails.length; i += 50) {
    console.log(JSON.stringify(call_('post', '/api/ingest/email', { emails: emails.slice(i, i + 50) })));
  }
  PROPS.setProperty('alertsSyncedAt', String(started));
  console.log(`${emails.length} alert emails sent`);
}

/** Dry run: shows what the next sync would send, without sending it. */
function previewAlerts() {
  messageIds_(`${CONFIG.alertQuery} newer_than:7d`)
    .slice(0, 10)
    .forEach((id) => {
      const alert = toAlert_(Gmail.Users.Messages.get('me', id, { format: 'full' }));
      console.log(`${alert.date} | ${alert.from} | ${alert.subject} | verified: ${alert.authenticated}\n${alert.body.slice(0, 300)}`);
    });
}

function messageIds_(query) {
  const ids = [];
  let pageToken;
  do {
    const page = Gmail.Users.Messages.list('me', { q: query, maxResults: 100, pageToken });
    (page.messages || []).forEach((m) => ids.push(m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < 500);
  return ids;
}

function toAlert_(message) {
  const headers = {};
  (message.payload.headers || []).forEach((h) => {
    const name = h.name.toLowerCase();
    if (!(name in headers)) headers[name] = h.value;
  });
  return {
    id: message.id,
    from: headers.from || '',
    subject: headers.subject || '',
    body: bodyText_(message.payload).slice(0, 8000),
    date: new Date(Number(message.internalDate)).toISOString(),
    authenticated: dmarcPass_(headers['authentication-results'] || ''),
  };
}

/**
 * Gmail's own check that the email really comes from Chase or Discover (DMARC). A forged sender fails it,
 * and the app then keeps the email out of the numbers.
 */
function dmarcPass_(results) {
  return /\bdmarc=pass\b/i.test(results) && /header\.from=(?:[\w-]+\.)*(?:chase|discover)\.com\b/i.test(results);
}

/** Plain text of the email: the text/plain part, or the HTML part without tags. */
function bodyText_(payload) {
  const plain = findPart_(payload, 'text/plain');
  if (plain) return decode_(plain.body.data);
  const html = findPart_(payload, 'text/html');
  if (!html) return '';
  return decode_(html.body.data)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#36;/g, '$')
    .replace(/\s+/g, ' ')
    .trim();
}

function findPart_(part, mimeType) {
  if (part.mimeType === mimeType && part.body && part.body.data) return part;
  for (const child of part.parts || []) {
    const found = findPart_(child, mimeType);
    if (found) return found;
  }
  return null;
}

/** The advanced service returns bytes either as a byte array or as web-safe base64, depending on the field. */
function decode_(data) {
  const bytes = typeof data === 'string' ? Utilities.base64DecodeWebSafe(data) : data;
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}

// ---------- Hours ----------

function syncHours() {
  CONFIG.hours.forEach((source) => {
    const payload = readHours_(source);
    console.log(`${source.jobId}: ${JSON.stringify(call_('post', '/api/ingest/hours', payload))}`);
  });
}

/** Dry run: shows the days and hours read from each timesheet, without sending them. */
function previewHours() {
  if (!CONFIG.hours.length) console.log('No timesheets in CONFIG.hours yet.');
  CONFIG.hours.forEach((source) => {
    const payload = readHours_(source);
    const total = payload.days.reduce((sum, d) => sum + d.hours, 0);
    console.log(`${source.jobId}: ${payload.days.length} days, ${total} hours from ${payload.from} to ${payload.to}`);
    payload.days.slice(-10).forEach((d) => console.log(`  ${d.date}  ${d.hours} h`));
  });
}

function readHours_(source) {
  const spreadsheet = SpreadsheetApp.openById(source.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(source.sheet);
  if (!sheet) throw new Error(`No tab "${source.sheet}" in the ${source.jobId} timesheet`);
  const timeZone = spreadsheet.getSpreadsheetTimeZone();
  const range = sheet.getDataRange();
  const values = range.getValues();
  const shown = range.getDisplayValues();
  const from = Utilities.formatDate(new Date(Date.now() - CONFIG.hoursDays * 86400000), timeZone, 'yyyy-MM-dd');
  const to = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
  const days = [];

  for (let r = (source.firstRow || 2) - 1; r < values.length; r++) {
    if (source.nameColumn && String(shown[r][column_(source.nameColumn)] || '').trim().toLowerCase() !== String(source.name).trim().toLowerCase()) continue;
    const date = isoDate_(values[r][column_(source.dateColumn)], shown[r][column_(source.dateColumn)], timeZone);
    if (!date || date < from || date > to) continue;
    const hours = source.hoursColumn
      ? duration_(shown[r][column_(source.hoursColumn)])
      : span_(shown[r][column_(source.startColumn)], shown[r][column_(source.endColumn)]);
    if (hours > 0) days.push({ date, hours: Math.round(hours * 100) / 100 });
  }
  return { jobId: source.jobId, from, to, days };
}

/** "A" → 0, "D" → 3, "AA" → 26. */
function column_(letters) {
  return String(letters)
    .toUpperCase()
    .split('')
    .reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

function isoDate_(value, text, timeZone) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, timeZone, 'yyyy-MM-dd');
  const pad = (n) => String(n).padStart(2, '0');
  const t = String(text || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(m[1])}-${pad(m[2])}`;
  return null;
}

/** "3.5", "3.5 h", "3:30", "3:30:00" → hours. Read from the shown text, which avoids the sheet's time-zone math. */
function duration_(text) {
  const t = String(text || '').trim();
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60 + Number(clock[3] || 0) / 3600;
  const number = /-?\d+(?:[.,]\d+)?/.exec(t);
  return number ? Number(number[0].replace(',', '.')) : 0;
}

/** Start and end times ("9:00 AM", "13:30") → hours; an end before the start means past midnight. */
function span_(startText, endText) {
  const minutes = (text) => {
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/.exec(String(text || '').trim());
    if (!m) return null;
    let hour = Number(m[1]) % (m[3] ? 12 : 24);
    if (m[3] && m[3].toUpperCase() === 'PM') hour += 12;
    return hour * 60 + Number(m[2]);
  };
  const start = minutes(startText);
  const end = minutes(endText);
  if (start === null || end === null) return 0;
  return ((end - start + 24 * 60) % (24 * 60)) / 60;
}

// ---------- Email digest ----------

/** Hourly timer; acts once a day at CONFIG.digestHour. */
function emailDigest() {
  const timeZone = Session.getScriptTimeZone();
  const now = new Date();
  if (Number(Utilities.formatDate(now, timeZone, 'H')) !== CONFIG.digestHour) return;
  const today = Utilities.formatDate(now, timeZone, 'yyyy-MM-dd');
  if (PROPS.getProperty('digestSentOn') === today) return;
  PROPS.setProperty('digestSentOn', today);

  const digest = call_('get', '/api/ingest/digest');
  const alerts = digest.alerts || [];
  if (!alerts.length && !CONFIG.dailyEmail) return;
  const lines = [
    digest.body,
    '',
    ...alerts.map((a) => `${a.level === 'critical' ? 'URGENT' : 'Heads up'}: ${a.text}`),
    '',
    settings_().url,
  ];
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), `Finance: ${digest.title}`, lines.join('\n'));
}

// ---------- App calls ----------

function settings_() {
  const url = PROPS.getProperty('APP_URL');
  const token = PROPS.getProperty('INGEST_TOKEN');
  if (!url || !token) throw new Error('Fill in APP_URL and INGEST_TOKEN in Project Settings → Script properties.');
  return { url: url.replace(/\/+$/, ''), token };
}

function call_(method, path, payload) {
  const { url, token } = settings_();
  const options = { method, headers: { Authorization: `Bearer ${token}` }, muteHttpExceptions: true };
  if (payload) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  const response = UrlFetchApp.fetch(url + path, options);
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code >= 300) throw new Error(`${method.toUpperCase()} ${path} → ${code}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
