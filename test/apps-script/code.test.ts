import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/** Script properties and spreadsheets the stand-ins serve. */
const properties: Record<string, string> = {};
const spreadsheets: Record<string, { tabs: string[][][] }> = {};

/** Loads apps-script/Code.gs with small stand-ins for the Google services its helpers use. */
function loadScript() {
  const source = readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8');
  const Utilities = {
    base64DecodeWebSafe: (text: string) => [...Buffer.from(text, 'base64url')],
    newBlob: (bytes: number[]) => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
    formatDate: (date: Date, timeZone: string, pattern: string) => {
      if (pattern === 'yyyy-MM-dd') return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
      if (pattern === 'H') return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(date);
      throw new Error(`pattern ${pattern}`);
    },
  };
  const SpreadsheetApp = {
    openById: (id: string) => ({
      getSpreadsheetTimeZone: () => 'America/Chicago',
      getSheets: () =>
        spreadsheets[id].tabs.map((rows) => ({
          // Dates arrive as text here; real sheets may hand over Date objects for the same cells.
          getDataRange: () => ({ getValues: () => rows, getDisplayValues: () => rows }),
        })),
      getSheetByName: () => null,
    }),
  };
  const context = createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => properties[key] ?? null }) },
    SpreadsheetApp,
    Utilities,
    console: { log: () => undefined },
  });
  runInContext(source, context);
  return context as Record<string, (...args: never[]) => unknown>;
}

const gs = loadScript();
const web64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

describe('Apps Script helpers', () => {
  it('reads spreadsheet columns, dates and hours the way timesheets write them', () => {
    expect([gs.column_('A' as never), gs.column_('d' as never), gs.column_('AA' as never)]).toEqual([0, 3, 26]);
    expect(gs.isoDate_('' as never, '9/8/2026' as never, 'America/Chicago' as never)).toBe('2026-09-08');
    expect(gs.isoDate_('' as never, '2026-10-01' as never, 'America/Chicago' as never)).toBe('2026-10-01');
    expect(gs.isoDate_('' as never, 'Total' as never, 'America/Chicago' as never)).toBeNull();
    expect(gs.isoDate_('' as never, 'Oct 1, 2026' as never, 'America/Chicago' as never)).toBe('2026-10-01');
    expect(gs.isoDate_('' as never, 'September 30 2026' as never, 'America/Chicago' as never)).toBe('2026-09-30');
    expect([gs.duration_('3.5' as never), gs.duration_('3:30' as never), gs.duration_('2,25 h' as never), gs.duration_('' as never)]).toEqual([3.5, 3.5, 2.25, 0]);
    expect(gs.span_('9:00 AM' as never, '1:30 PM' as never)).toBe(4.5);
    expect(gs.span_('12:15 PM' as never, '12:45 PM' as never)).toBe(0.5);
    expect(gs.span_('22:00' as never, '02:00' as never)).toBe(4);
    expect(gs.span_('' as never, '5:00 PM' as never)).toBe(0);
  });

  it('trusts an alert only when Gmail saw a DMARC pass for Chase or Discover', () => {
    const pass = 'mx.google.com; dkim=pass header.i=@chase.com; spf=pass; dmarc=pass (p=REJECT) header.from=chase.com';
    expect(gs.dmarcPass_(pass as never)).toBe(true);
    expect(gs.dmarcPass_('mx.google.com; dmarc=pass header.from=services.discover.com' as never)).toBe(true);
    expect(gs.dmarcPass_('mx.google.com; dmarc=fail (p=REJECT) header.from=chase.com' as never)).toBe(false);
    expect(gs.dmarcPass_('mx.google.com; dmarc=pass header.from=evilchase.com' as never)).toBe(false);
    expect(gs.dmarcPass_('' as never)).toBe(false);
  });

  it('turns a Gmail API message into the alert the app expects', () => {
    const message = {
      id: 'm1',
      internalDate: String(Date.UTC(2026, 9, 1, 14, 20)),
      payload: {
        mimeType: 'multipart/alternative',
        headers: [
          { name: 'From', value: 'Chase <no.reply.alerts@chase.com>' },
          { name: 'Subject', value: 'Your $12.40 debit card transaction with TEST COFFEE' },
          { name: 'Authentication-Results', value: 'mx.google.com; dmarc=pass (p=REJECT) header.from=chase.com' },
        ],
        parts: [
          { mimeType: 'text/html', body: { data: web64('<p>You made a <b>$12.40</b> transaction</p>') } },
          { mimeType: 'text/plain', body: { data: web64('You made a $12.40 transaction with TEST COFFEE.') } },
        ],
      },
    };
    expect(gs.toAlert_(message as never)).toEqual({
      id: 'm1',
      from: 'Chase <no.reply.alerts@chase.com>',
      subject: 'Your $12.40 debit card transaction with TEST COFFEE',
      body: 'You made a $12.40 transaction with TEST COFFEE.',
      date: '2026-10-01T14:20:00.000Z',
      authenticated: true,
    });
    // HTML-only emails lose their tags.
    const htmlOnly = { mimeType: 'text/html', body: { data: web64('<style>p{}</style><p>Balance:&nbsp;<b>$1.00</b></p>') } };
    expect(gs.bodyText_(htmlOnly as never)).toBe('Balance: $1.00');
  });

  it('finds the columns from header rows and reads every block of every tab', () => {
    expect(gs.headerColumns_(['', 'Date', 'Day', 'Time In', 'Time Out', 'Total Hours', '', 'Summary Scorecard', ''] as never)).toEqual({
      date: 1,
      hours: 5,
      start: 3,
      end: 4,
    });
    expect(gs.headerColumns_(['', '1st - 15th Pay Period', '', ''] as never)).toBeNull();

    // A timesheet laid out like the agency's: one tab per month, a block per pay period (fake hours).
    const block = (title: string, rows: string[][]) => [['', title, '', '', '', ''], ['', 'Date', 'Day', 'Time In', 'Time Out', 'Total Hours'], ...rows];
    spreadsheets.sheet1 = {
      tabs: [
        [
          ...block('1st - 15th Pay Period', [
            ['', 'Oct 1, 2026', 'Thursday', '10:00:00 PM', '11:55 PM', '1.92'],
            ['', 'Oct 2, 2026', 'Friday', '8:10 AM', '11:30 AM', ''],
            ['', 'Oct 5, 2026', 'Monday', '', '', ''],
          ]),
          ...block('16th - EOM Pay Period', [['', 'Oct 16, 2026', 'Friday', '', '', '4']]),
        ],
        block('1st - 15th Pay Period', [['', 'Sep 30, 2026', 'Wednesday', '', '', '2.5']]),
      ],
    };
    properties.AGENCY_SHEET = 'sheet1';
    const payload = gs.readHours_({ jobId: 'agency', sheetIdProperty: 'AGENCY_SHEET', filledDaily: true } as never, new Date('2026-10-20T15:00:00Z') as never);
    expect(payload).toEqual({
      jobId: 'agency',
      from: '2026-09-05',
      to: '2026-10-20',
      // Oct 2 has no total yet, so its hours come from Time In / Time Out.
      days: [
        { date: '2026-09-30', hours: 2.5 },
        { date: '2026-10-01', hours: 1.92 },
        { date: '2026-10-02', hours: 3.33 },
        { date: '2026-10-16', hours: 4 },
      ],
      through: '2026-10-19',
    });
  });

  it('skips a timesheet that is not set up yet', () => {
    expect(gs.readHours_({ jobId: 'campus', sheetIdProperty: 'MISSING' } as never)).toBeNull();
  });
});
