const CARD_PREFIX = /^(Recurring Card Purchase|Card Purchase With Pin|Card Purchase|Payment Received)\s+\d{2}\/\d{2}\s+/i;
const FX_FEE = /^Foreign Exch Rt ADJ Fee\s+\d{2}\/\d{2}\s+/i;
// Zelle references end the line and always contain a digit (names do not).
const ZELLE = /^Zelle Payment (To|From) (.+?)(?: (?=[A-Za-z0-9]*\d)[A-Za-z0-9]{8,})?$/i;

/** A short, readable name for a bank description ("Dollar General #13419 Austin TX", "Zelle to Jane Roe"). */
export function displayName(description: string): string {
  let text = description.replace(/\s+/g, ' ').trim();
  if (FX_FEE.test(text)) return `FX fee · ${displayName(text.replace(FX_FEE, ''))}`;
  text = text.replace(CARD_PREFIX, '');
  const zelle = ZELLE.exec(text);
  if (zelle) return `Zelle ${zelle[1].toLowerCase()} ${zelle[2]}`;
  return text
    .replace(/\s+(PPD ID|Web ID):\s*\S+/gi, '')
    .replace(/\s+Br Real .*$/i, '')
    .replace(/\s*APPLE PAY ENDING IN \d{4}\S*/i, '')
    // Banks often repeat the city or the payer ("Round Rock TX Round Rock TX", "Payroll Payroll").
    .replace(/\b(.+?)(?:\s+\1)+$/i, '$1')
    .trim();
}

/** Words to match similar transactions: the merchant or the person, never store numbers or references. */
export function suggestKeyword(description: string): string {
  const name = displayName(description).replace(/^FX fee · /, '');
  const zelle = /^Zelle (?:to|from) (.+)$/.exec(name);
  if (zelle) return zelle[1];
  const words = name.split(' ').filter((word) => !/^#?\d+$/.test(word) && !/^\d[\d-]+$/.test(word));
  const keyword = words.slice(0, 2).join(' ');
  return description.toLowerCase().includes(keyword.toLowerCase()) ? keyword : name;
}
