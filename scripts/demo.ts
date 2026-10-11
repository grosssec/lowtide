/**
 * Fills the public demo's database with made-up data: a fictional grad student in Austin who works at a design
 * studio and the campus library. Six months of transactions, timesheet hours, bank alerts, imports, a plan,
 * balances, rules and a security log, all dated around the demo's frozen "today" (DEMO_TODAY in wrangler.jsonc).
 *
 * Nothing here is real: names, merchants' amounts, places and devices are invented. Same output on every run.
 *
 * Run: node scripts/demo.ts            → the local copy of the demo database (preview with CLOUDFLARE_ENV=demo npm run dev)
 *      node scripts/demo.ts --remote   → the deployed demo database (finance-demo)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const demoToday = /"DEMO_TODAY":\s*"(\d{4}-\d{2}-\d{2})"/.exec(config.slice(config.indexOf('"demo"')))?.[1];
if (!demoToday) throw new Error('No DEMO_TODAY in the demo env of wrangler.jsonc');
const TODAY: string = demoToday;
const START = '2026-04-01';

// ---------- Deterministic randomness and dates ----------

let seed = 20261008;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (min: number, max: number) => Math.round(min + random() * (max - min));
const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
const chance = (p: number) => random() < p;

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => iso(new Date(toDate(day).getTime() + n * 86_400_000));
const weekday = (day: string) => toDate(day).getUTCDay();
const days: string[] = [];
for (let d = START; d <= TODAY; d = addDays(d, 1)) days.push(d);
const mmdd = (day: string) => `${day.slice(5, 7)}/${day.slice(8, 10)}`;
/** Weekend pay dates move to the Friday before. */
const businessBefore = (day: string) => (weekday(day) === 6 ? addDays(day, -1) : weekday(day) === 0 ? addDays(day, -2) : day);

// ---------- The plan ----------

const plan = {
  version: 2,
  reserve: { amount: 150000, from: '2026-06-01' },
  goals: [
    { id: 'emergency', name: 'Emergency fund', target: 300000, by: '2027-05-31' },
    { id: 'laptop', name: 'New laptop', target: 160000 },
  ],
  jobs: [
    {
      id: 'studio',
      name: 'Design studio',
      rates: [
        { from: '2025-09-01', centsPerHour: 2000 },
        { from: '2026-08-01', centsPerHour: 2200 },
      ],
      periods: [
        { startDay: 1, endDay: 15, payMonthOffset: 0, payDate: { kind: 'dayOfMonth', day: 20, roll: 'backward' } },
        { startDay: 16, endDay: 'end', payMonthOffset: 1, payDate: { kind: 'dayOfMonth', day: 5, roll: 'backward' } },
      ],
      weeklyHours: 18,
      maxWeeklyHours: 22,
      hoursSince: '2026-08-01',
      previousWeeklyHours: 15,
      skipHolidays: true,
    },
    {
      id: 'library',
      name: 'Campus library',
      rates: [{ from: '2025-08-15', centsPerHour: 1350 }],
      periods: [{ startDay: 1, endDay: 'end', payMonthOffset: 1, payDate: { kind: 'nthBusinessDay', n: 1 } }],
      weeklyHours: 10,
      maxWeeklyHours: 12,
      hoursSince: '2026-08-24',
      skipHolidays: true,
      closures: [
        { label: 'Winter break', from: '2026-12-12', to: '2027-01-11', yearly: true },
        { label: 'Summer break', from: '2027-05-15', to: '2027-08-23', yearly: true },
      ],
    },
  ],
  away: [
    { label: 'Thanksgiving with family', from: '2026-11-25', to: '2026-11-29', yearly: true, trip: true },
    { label: 'Winter holidays', from: '2026-12-20', to: '2027-01-02', yearly: true, trip: true },
  ],
  bills: [
    { label: 'Rent', category: 'Rent', amount: 72500, day: 1, from: '2026-01-01', paidWith: 'checking' },
    { label: 'Electricity', category: 'Utilities', amount: 6800, day: 18, from: '2026-01-01', paidWith: 'checking' },
    { label: 'Internet', category: 'Utilities', amount: 5500, day: 12, from: '2026-01-01', paidWith: 'card' },
    { label: 'Phone', category: 'Phone', amount: 3500, day: 24, from: '2026-01-01', paidWith: 'card' },
    { label: 'Spotify', category: 'Subscriptions', amount: 1199, day: 7, from: '2026-01-01', paidWith: 'card' },
    { label: 'Car insurance', category: 'Insurance', amount: 9200, day: 15, from: '2026-01-01', paidWith: 'checking' },
  ],
  budgets: [
    { label: 'Groceries', category: 'Groceries', monthly: 30000, paidWith: 'checking', lessOnTrips: true },
    { label: 'Dining out', category: 'Dining out', monthly: 11000, paidWith: 'card', lessOnTrips: true },
    { label: 'Snacks + coffee', category: 'Snacks', monthly: 3500, paidWith: 'checking', lessOnTrips: true },
    { label: 'Gas', category: 'Transportation', monthly: 8000, paidWith: 'card' },
    { label: 'Shopping', category: 'Shopping', monthly: 9000, paidWith: 'card' },
    { label: 'Fun', category: 'Fun', monthly: 6000, paidWith: 'card' },
  ],
  events: [
    { date: '2026-10-24', label: "Maya's wedding gift", category: 'Gifts', amount: 12000, paidWith: 'checking' },
    { date: '2027-01-11', label: 'Spring textbooks', category: 'Education', amount: 26000, paidWith: 'card' },
    { date: '2027-03-14', label: 'Spring break trip', category: 'Travel', amount: 45000, paidWith: 'card' },
  ],
  notes: ['The tax refund (about $400 in March) is left out until it arrives.', 'Laptop: waiting for the back-to-school sale in July.'],
};

// ---------- Hours ----------

const hours: { job: string; date: string; hours: number }[] = [];
const libraryOpen = (day: string) => !(day >= '2026-05-16' && day <= '2026-08-23');
for (const day of days) {
  if (day >= TODAY) break; // the timesheet runs through yesterday
  const wd = weekday(day);
  if (wd >= 1 && wd <= 5 && day !== '2026-05-25' && day !== '2026-07-03' && day !== '2026-09-07') {
    const base = day >= '2026-08-01' ? [4, 4, 3.5, 4, 3.5] : [3, 3, 3, 3, 3];
    hours.push({ job: 'studio', date: day, hours: base[wd - 1] + pick([0, 0, 0, 0.5, 1]) });
  }
  if (libraryOpen(day) && (wd === 2 || wd === 4 || wd === 6)) hours.push({ job: 'library', date: day, hours: wd === 6 ? 4 : 3 + pick([0, 0.5]) });
}
const workedCents = (job: string, from: string, to: string) =>
  hours
    .filter((h) => h.job === job && h.date >= from && h.date <= to)
    .reduce((sum, h) => sum + h.hours * (job === 'library' ? 1350 : h.date >= '2026-08-01' ? 2200 : 2000), 0);

// ---------- Transactions ----------

interface Entry {
  id: string;
  account: 'chase' | 'discover' | 'cash';
  date: string;
  postedDate: string;
  description: string;
  amount: number;
  category: string;
  kind: 'income' | 'expense' | 'transfer';
  source: string;
  at?: string;
}
const entries: Entry[] = [];
const ids = new Map<string, number>();
function add(account: Entry['account'], date: string, description: string, amount: number, category: string, kind: Entry['kind']) {
  if (date > TODAY || date < START) return;
  const posted = account === 'cash' ? date : addDays(date, account === 'discover' ? between(1, 2) : between(0, 1));
  const key = `${account}|${posted}|${amount}|${description.toLowerCase()}`;
  const n = (ids.get(key) ?? 0) + 1;
  ids.set(key, n);
  // The last two days arrived as bank alert emails; earlier rows came from statements and CSV downloads.
  const recent = date >= addDays(TODAY, -1) && account !== 'cash';
  entries.push({
    id: `${key}|${n}`,
    account,
    date,
    postedDate: posted > TODAY ? TODAY : posted,
    description,
    amount,
    category,
    kind,
    source: account === 'cash' ? 'manual' : recent ? 'alert' : account === 'chase' ? 'Chase_Activity_20261006.csv' : 'Discover-RecentActivity-20261006.csv',
    ...(recent || account === 'cash' ? { at: `${date}T${String(between(14, 23)).padStart(2, '0')}:${String(between(10, 59)).padStart(2, '0')}:00Z` } : {}),
  });
}
const card = (date: string, merchant: string, cents: number, category: string) => add('discover', date, merchant, -cents, category, 'expense');
const debit = (date: string, merchant: string, cents: number, category: string) => add('chase', date, `Card Purchase ${mmdd(date)} ${merchant}`, -cents, category, 'expense');

const GROCERS = ['H-E-B #412 Austin TX', "Trader Joe's #541 Austin TX", 'H-E-B #412 Austin TX', 'Sprouts Farmers Mkt Austin TX'];
const DINING = ['Torchys Tacos Austin TX', 'Chipotle 2214 Austin TX', 'Pho Saigon Austin TX', 'Via 313 Pizza Austin TX', 'Veracruz Tacos Austin TX', 'Uber Eats Help.Uber.Com CA'];
const SNACKS = ['Epoch Coffee Austin TX', 'Bennu Coffee Austin TX', '7-Eleven 34217 Austin TX', 'Campus Market UT Austin TX'];
const GAS = ['Shell Oil 57442 Austin TX', 'Exxon Mobil 4471 Austin TX', 'H-E-B Fuel #412 Austin TX'];
const SHOPPING = ['Target T-1897 Austin TX', 'Amazon.Com*2K81L Amzn.Com/Bill WA', 'Uniqlo Domain Austin TX', 'Half Price Books Austin TX'];
const FUN = ['Alamo Drafthouse Austin TX', 'Barton Springs Pool Austin TX', 'Steam Games 425-889-9642 WA', 'Austin Bouldering Proj TX'];
const HEALTH = ['CVS/Pharmacy #7731 Austin TX', 'Great Clips #812 Austin TX'];

for (const day of days) {
  const month = day.slice(0, 7);
  const dom = Number(day.slice(8, 10));
  const wd = weekday(day);
  const away = day >= '2026-06-20' && day <= '2026-06-28'; // a week at a summer workshop, spending less

  // Paychecks
  if (businessBefore(`${month}-20`) === day) add('chase', day, 'Northline Studio Payroll PPD ID: 4728193650', Math.round(workedCents('studio', `${month}-01`, `${month}-15`)), 'Design studio', 'income');
  if (businessBefore(`${month}-05`) === day) {
    const prev = addDays(`${month}-01`, -1);
    add('chase', day, 'Northline Studio Payroll PPD ID: 4728193650', Math.round(workedCents('studio', `${prev.slice(0, 7)}-16`, prev)), 'Design studio', 'income');
  }
  const firstBusiness = [1, 2, 3, 4].map((d) => `${month}-0${d}`).find((d) => weekday(d) >= 1 && weekday(d) <= 5);
  if (day === firstBusiness) {
    const prev = addDays(`${month}-01`, -1);
    const pay = Math.round(workedCents('library', `${prev.slice(0, 7)}-01`, prev));
    if (pay > 0) add('chase', day, 'Univ Payroll Direct Dep PPD ID: 1746000111', pay, 'Campus library', 'income');
  }

  // Bills
  if (dom === 1) add('chase', day, 'Zelle Payment To Riverside Commons Leasing', -72500, 'Rent', 'expense');
  if (dom === 18) add('chase', day, 'Austin Energy Web Pymt PPD ID: 1746000159', -between(5200, 8900), 'Utilities', 'expense');
  if (dom === 12) card(day, 'Spectrum Internet 855-707-7328 TX', 5500, 'Utilities');
  if (dom === 24) card(day, 'Mint Mobile 888-646-8226 CA', 3500, 'Phone');
  if (dom === 7) card(day, 'Spotify USA 877-778-1161 NY', 1199, 'Subscriptions');
  if (dom === 15) add('chase', day, 'Progressive Insurance PPD ID: 9100143511', -9200, 'Insurance', 'expense');

  // Card bill: the statement closes on the 26th and is paid in full on the 22nd of the next month.
  if (dom === 22) {
    const prev = addDays(`${month}-01`, -1).slice(0, 7);
    const before = addDays(`${prev}-01`, -1).slice(0, 7);
    const statement = entries
      .filter((e) => e.account === 'discover' && e.kind === 'expense' && e.postedDate > `${before}-26` && e.postedDate <= `${prev}-26`)
      .reduce((sum, e) => sum - e.amount, 0);
    if (statement > 0) {
      add('chase', day, 'Discover E-Payment 4413 Web ID: 2510020270', -statement, 'Card payment', 'transfer');
      add('discover', day, 'Internet Payment - Thank You', statement, 'Card payment', 'transfer');
    }
  }

  // Day to day
  if ((wd === 0 || wd === 3) && !away) debit(day, pick(GROCERS), between(3100, 7600), 'Groceries');
  if (wd === 5 && chance(0.35) && !away) debit(day, 'Costco Whse #1086 Austin TX', between(5400, 9800), 'Groceries');
  if ((wd === 5 || wd === 6 || (wd === 2 && chance(0.4))) && chance(away ? 0.3 : 0.75)) card(day, pick(DINING), between(950, 2650), 'Dining out');
  if (wd >= 1 && wd <= 5 && chance(0.32)) debit(day, pick(SNACKS), between(325, 690), 'Snacks');
  if (dom % 9 === 3) card(day, pick(GAS), between(2800, 4300), 'Transportation');
  if ((dom === 9 || dom === 23) && chance(0.85)) card(day, pick(SHOPPING), between(1400, 5900), 'Shopping');
  if ((dom === 13 || dom === 27) && chance(0.8)) card(day, pick(FUN), between(1200, 3400), 'Fun');
  if (dom === 16 && chance(0.6)) debit(day, pick(HEALTH), between(900, 2600), 'Health & personal care');

  // People and cash
  if (dom === 18) add('chase', day, 'Zelle From Jordan Kim', between(2600, 3400), 'Money from people', 'income'); // roommate's half of electricity
  if (dom === 28 && chance(0.5)) add('chase', day, 'Venmo Cashout PPD ID: 5264681992', between(1500, 4500), 'Freelance & side jobs', 'income');
  if (dom === 2 && month >= '2026-07') add('cash', day, 'Food truck lunch', -between(1100, 1600), 'Dining out', 'expense');
  if (dom === 19 && chance(0.5)) add('cash', day, 'Farmers market', -between(800, 1800), 'Groceries', 'expense');
}
// One freelance logo job, and a refund, so the income list has some variety.
add('chase', '2026-08-29', 'Zelle From Bluebonnet Bakery Logo Project', 35000, 'Freelance & side jobs', 'income');
add('discover', '2026-09-11', 'Amazon.Com Refund Amzn.Com/Bill WA', 2399, 'Refunds', 'income');

entries.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

// ---------- Balances, rules, alerts, imports, security ----------

const balances = {
  checking: { amount: 274912, asOf: TODAY, at: `${TODAY}T23:59:00Z` },
  cash: { amount: 4500, asOf: TODAY, at: `${TODAY}T23:59:00Z` },
  cardOwed: { amount: 31877, asOf: TODAY, at: `${TODAY}T23:59:00Z` },
  cardDueDay: 22,
};
const rules = [
  { match: 'northline studio', category: 'Design studio', kind: 'income', sign: 'in' },
  { match: 'univ payroll', category: 'Campus library', kind: 'income', sign: 'in' },
  { match: 'riverside commons', category: 'Rent' },
  { match: 'zelle from jordan kim', category: 'Money from people', kind: 'income', sign: 'in' },
  { match: 'bluebonnet bakery', category: 'Freelance & side jobs', kind: 'income', sign: 'in' },
];
const alerts = entries
  .filter((e) => e.source === 'alert')
  .map((e, i) => ({
    id: `demo-alert-${i + 1}`,
    received_at: e.at!.replace('T', ' ').replace('Z', ''),
    sender: e.account === 'chase' ? 'no.reply.alerts@chase.com' : 'discover@services.discover.com',
    subject:
      e.account === 'chase'
        ? `You made a $${(-e.amount / 100).toFixed(2)} transaction with ${e.description.replace(/^Card Purchase \d\d\/\d\d /, '').replace(/ [A-Z]{2}$/, '')}`
        : `Transaction alert: $${(-e.amount / 100).toFixed(2)} at ${e.description.replace(/ [A-Z]{2}$/, '')}`,
    transaction_id: e.id,
  }));
alerts.push({
  id: 'demo-alert-balance',
  received_at: `${addDays(TODAY, -1)} 13:02:00`,
  sender: 'no.reply.alerts@chase.com',
  subject: 'Your daily account summary',
  transaction_id: '',
});
const imports = [
  { file: 'Chase_Activity_20261006.csv', account: 'chase', rows: 146, added: 9, note: 'Chase CSV, 146 rows', created_at: '2026-10-06 18:42:00' },
  { file: 'Discover-RecentActivity-20261006.csv', account: 'discover', rows: 58, added: 7, note: 'Discover CSV, 58 rows', created_at: '2026-10-06 18:41:00' },
  { file: 'Chase-Statement-2026-09.pdf', account: 'chase', rows: 61, added: 0, note: 'Chase statement, Aug 27 – Sep 26', created_at: '2026-09-28 20:15:00' },
  { file: 'Discover-Statement-20260926.csv', account: 'discover', rows: 24, added: 3, note: 'Discover CSV, 24 rows', created_at: '2026-09-28 20:14:00' },
  { file: 'Chase-Statement-2026-08.pdf', account: 'chase', rows: 57, added: 2, note: 'Chase statement, Jul 26 – Aug 26', created_at: '2026-08-29 09:03:00' },
  { file: 'Discover-Statement-20260826.csv', account: 'discover', rows: 22, added: 0, note: 'Discover CSV, 22 rows', created_at: '2026-08-29 09:02:00' },
];
const sessions = [
  { id: 'demo', device: 'iPhone · Safari', place: 'Austin, US', created_at: '2026-09-02 15:20:00', last_seen_at: `${TODAY} 14:05:00` },
  { id: 'demo-mac-session-7f3a9c', device: 'Mac · Chrome', place: 'Austin, US', created_at: '2026-09-02 15:12:00', last_seen_at: `${addDays(TODAY, -1)} 21:40:00` },
];
const credentials = [
  { id: 'demo-passkey-mac', label: 'Mac · Chrome', created_at: '2026-09-02 15:11:00', last_used_at: `${addDays(TODAY, -1)} 21:40:00` },
  { id: 'demo-passkey-iphone', label: 'iPhone · Safari', created_at: '2026-09-02 15:19:00', last_used_at: '2026-09-02 15:20:00' },
];
const events = [
  { at: '2026-09-02 15:11:00', type: 'passkey_added', device: 'Mac · Chrome', place: 'Austin, US', detail: 'Mac · Chrome' },
  { at: '2026-09-02 15:12:00', type: 'sign_in', device: 'Mac · Chrome', place: 'Austin, US', detail: null },
  { at: '2026-09-02 15:17:00', type: 'device_code_created', device: 'Mac · Chrome', place: 'Austin, US', detail: null },
  { at: '2026-09-02 15:19:00', type: 'passkey_added', device: 'iPhone · Safari', place: 'Austin, US', detail: 'iPhone · Safari' },
  { at: '2026-09-02 15:20:00', type: 'sign_in', device: 'iPhone · Safari', place: 'Austin, US', detail: null },
  { at: '2026-09-21 10:02:00', type: 'sign_in', device: 'iPad · Safari', place: 'Houston, US', detail: null },
  { at: '2026-09-24 19:31:00', type: 'session_ended', device: 'Mac · Chrome', place: 'Austin, US', detail: 'iPad · Safari' },
  { at: '2026-10-01 08:45:00', type: 'sign_in', device: 'Mac · Chrome', place: 'Austin, US', detail: null },
];

// ---------- SQL ----------

const text = (value: string | null | undefined) => (value == null ? 'NULL' : `'${value.replace(/'/g, "''")}'`);
const setting = (key: string, value: unknown) => `INSERT INTO settings (key, value) VALUES ('${key}', ${text(JSON.stringify(value))});`;
const lastLogged = (job: string) => hours.filter((h) => h.job === job).at(-1)?.date ?? TODAY;

const sql = [
  'DELETE FROM transactions;',
  'DELETE FROM rules;',
  'DELETE FROM settings;',
  'DELETE FROM imports;',
  'DELETE FROM alerts;',
  'DELETE FROM hours;',
  'DELETE FROM sessions;',
  'DELETE FROM credentials;',
  'DELETE FROM security_events;',
  'DELETE FROM push_subscriptions;',
  'DELETE FROM notifications;',
  'DELETE FROM challenges;',
  'DELETE FROM device_codes;',
  ...entries.map(
    (e) =>
      `INSERT INTO transactions (id, account, date, posted_date, description, amount, category, kind, source, at) VALUES (${text(e.id)}, ${text(e.account)}, ${text(e.date)}, ${text(e.postedDate)}, ${text(e.description)}, ${e.amount}, ${text(e.category)}, ${text(e.kind)}, ${text(e.source)}, ${text(e.at)});`,
  ),
  ...rules.map(
    (r, i) => `INSERT INTO rules (match, category, kind, sign, position) VALUES (${text(r.match)}, ${text(r.category)}, ${text(r.kind ?? null)}, ${text(r.sign ?? null)}, ${i});`,
  ),
  setting('plan', plan),
  setting('balances', balances),
  setting('hours_through', { studio: lastLogged('studio'), library: addDays(TODAY, -1) }),
  ...hours.map((h) => `INSERT INTO hours (job_id, date, hours, updated_at) VALUES (${text(h.job)}, ${text(h.date)}, ${h.hours}, '${TODAY} 12:00:00');`),
  ...alerts.map(
    (a) =>
      `INSERT INTO alerts (id, received_at, sender, subject, body, status, note, transaction_id) VALUES (${text(a.id)}, ${text(a.received_at)}, ${text(a.sender)}, ${text(a.subject)}, '(demo)', '${a.transaction_id ? 'transaction' : 'balance'}', ${text(a.transaction_id ? 'Added as a transaction' : 'Checking balance updated')}, ${text(a.transaction_id || null)});`,
  ),
  ...imports.map(
    (i) => `INSERT INTO imports (file, account, rows, added, note, created_at) VALUES (${text(i.file)}, ${text(i.account)}, ${i.rows}, ${i.added}, ${text(i.note)}, ${text(i.created_at)});`,
  ),
  ...sessions.map(
    (s) =>
      `INSERT INTO sessions (id, expires_at, created_at, device, place, last_seen_at) VALUES (${text(s.id)}, '2099-01-01 00:00:00', ${text(s.created_at)}, ${text(s.device)}, ${text(s.place)}, ${text(s.last_seen_at)});`,
  ),
  ...credentials.map(
    (c) =>
      `INSERT INTO credentials (id, public_key, counter, transports, label, created_at, last_used_at) VALUES (${text(c.id)}, 'demo', 0, NULL, ${text(c.label)}, ${text(c.created_at)}, ${text(c.last_used_at)});`,
  ),
  ...events.map(
    (e) => `INSERT INTO security_events (at, type, device, place, detail) VALUES (${text(e.at)}, ${text(e.type)}, ${text(e.device)}, ${text(e.place)}, ${text(e.detail)});`,
  ),
];

const dir = new URL('../data/demo/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}seed.sql`, `${sql.join('\n')}\n`);
console.log(`data/demo/seed.sql: ${entries.length} transactions, ${hours.length} days of hours, ${alerts.length} alerts, today = ${TODAY}`);

const target = process.argv.includes('--remote') ? '--remote' : '--local';
execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'finance-demo', '--env', 'demo', target], { stdio: ['pipe', 'inherit', 'inherit'], input: 'y\n' });
execFileSync('npx', ['wrangler', 'd1', 'execute', 'finance-demo', '--env', 'demo', target, `--file=${dir}seed.sql`], { stdio: ['pipe', 'inherit', 'inherit'], input: 'y\n' });
