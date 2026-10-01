import type { Cents } from '../engine/money.ts';

/** "-1,234.56", "- 3.60", "$821.67" → cents, without going through floats. */
export function parseMoney(text: string): Cents {
  const cleaned = text.replace(/[\s$,]/g, '');
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(cleaned);
  if (!match) throw new Error(`Not a money amount: "${text}"`);
  const cents = Number(match[2]) * 100 + Number(match[3]);
  return match[1] ? -cents : cents;
}

export const isMoney = (text: string): boolean => /^-?\d+\.\d{2}$/.test(text.replace(/[\s$,]/g, ''));
