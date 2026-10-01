/** Money is always integer cents in the engine, so sums never drift. */
export type Cents = number;

export const fromDollars = (dollars: number): Cents => Math.round(dollars * 100);

export function formatUSD(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const fraction = String(abs % 100).padStart(2, '0');
  return `${sign}$${whole}.${fraction}`;
}
