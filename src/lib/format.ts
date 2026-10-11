const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MINUS = '−';

/** Whole dollars for summaries: $1,234 · −$403. */
export function money(cents: number, options: { sign?: boolean } = {}): string {
  const dollars = Math.round(Math.abs(cents) / 100).toLocaleString('en-US');
  const sign = cents < 0 && Math.round(Math.abs(cents) / 100) !== 0 ? MINUS : options.sign && cents > 0 ? '+' : '';
  return `${sign}$${dollars}`;
}

/** Exact amounts for transaction lists: $3.60 · −$1,234.56. */
export function moneyExact(cents: number, options: { sign?: boolean } = {}): string {
  const abs = Math.abs(cents);
  const text = `$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `${MINUS}${text}` : options.sign && cents > 0 ? `+${text}` : text;
}

/** "20.00" / "$1,234" / "-3.6" → cents; null when it is not a number. */
export function parseMoneyInput(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '').replace(MINUS, '-');
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith('-');
  const [whole, fraction = ''] = cleaned.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return negative ? -cents : cents;
}

const parts = (iso: string) => iso.split('-').map(Number);

export function monthLabel(key: string): string {
  const [year, month] = parts(key);
  return `${MONTHS[month - 1]} ${year}`;
}

export function monthShort(key: string): string {
  const [year, month] = parts(key);
  return `${MONTHS[month - 1].slice(0, 3)} ’${String(year).slice(2)}`;
}

export function shiftMonth(key: string, delta: number): string {
  const [year, month] = parts(key);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function shortDate(iso: string): string {
  const [, month, day] = parts(iso);
  return `${MONTHS[month - 1].slice(0, 3)} ${day}`;
}

export function dayLabel(iso: string): string {
  const [year, month, day] = parts(iso);
  return `${WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}, ${shortDate(iso)}`;
}

/** The public demo is frozen on one day (set from /api/auth/status); everywhere else it is the device's today. */
let frozenToday: string | null = null;
export const freezeToday = (iso: string) => {
  frozenToday = iso;
};

export function todayISO(): string {
  if (frozenToday) return frozenToday;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const monthKeyOf = (iso: string): string => iso.slice(0, 7);
