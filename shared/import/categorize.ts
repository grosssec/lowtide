import type { Cents } from '../engine/money.ts';

/** income and expense count in the month's result; transfers (card payments, moving money between own accounts) never do. */
export type EntryKind = 'income' | 'expense' | 'transfer';

export interface CategoryRule {
  /** Case-insensitive regular expression tested against the description. */
  match: string;
  category: string;
  /** Defaults to income for money in and expense for money out. */
  kind?: EntryKind;
  /** Only money coming in, or only money going out (e.g. a school is tuition when paid, payroll when it pays you). */
  sign?: 'in' | 'out';
}

interface Compiled {
  pattern: RegExp;
  category: string;
  kind?: EntryKind;
  sign?: 'in' | 'out';
}

/** First matching rule wins, so specific rules go before broad ones (and personal rules before defaults). */
export function makeCategorizer(rules: CategoryRule[]) {
  const compiled: Compiled[] = rules.map((rule) => ({
    pattern: new RegExp(rule.match, 'i'),
    category: rule.category,
    kind: rule.kind,
    sign: rule.sign,
  }));
  return (description: string, amount: Cents): { category: string; kind: EntryKind } => {
    const direction = amount >= 0 ? 'in' : 'out';
    const rule = compiled.find((r) => (!r.sign || r.sign === direction) && r.pattern.test(description));
    if (rule) return { category: rule.category, kind: rule.kind ?? (amount >= 0 ? 'income' : 'expense') };
    return amount >= 0 ? { category: 'Uncategorized income', kind: 'income' } : { category: 'Uncategorized', kind: 'expense' };
  };
}

/** Merchant rules that apply to anyone. Personal ones (landlord, employers, family) live in data/rules.local.json. */
export const DEFAULT_RULES: CategoryRule[] = [
  // Moving money between own accounts
  { match: 'discover e-payment|directpay full balance|internet payment - thank you', category: 'Card payment', kind: 'transfer' },
  { match: 'payment received .*cash app', category: 'From Cash App', kind: 'transfer' },
  { match: 'statement credit|cashback bonus|rebate', category: 'Card rewards', kind: 'income' },
  { match: 'prepaid2cash', category: 'Other income', kind: 'income' },
  // Bills and subscriptions (before stores: Walmart+ and Amazon Prime are subscriptions)
  { match: 'visible', category: 'Phone' },
  {
    match: 'apple\\.com/bill|google \\*workspace|canva|amazon prime|walmart\\^? member|capcut|elevenlabs|higgsfield|openai|chatgpt|grok|anthropic|claude\\.ai|proton ag|name-?cheap|respondus|replicate|spotify|netflix|adobe',
    category: 'Subscriptions',
  },
  { match: 'foreign exch rt adj fee|\\bfee\\b', category: 'Fees' },
  // Food
  { match: 'uber eats|doordash|food svc|snack bar', category: 'Dining out' },
  { match: 'dollar general|wal-?mart|wm supercenter|publix|aldi|super 1 foods|kroger|winn-dixie|rouses|brookshire', category: 'Groceries' },
  { match: 'coca cola|vending|7-eleven|circle ?k|marathon|texaco|casey|on the run|south point|shell|chevron|exxon|valero|racetrac|tobacco', category: 'Snacks' },
  // Leisure before the generic Toast/Square restaurant rule (sports venues also use them)
  { match: 'topgolf|golf|\\bzoo\\b|tickpick|phenomenal sports|sofive|seaworld|cinema|bowling', category: 'Leisure' },
  {
    match: 'chick-fil-a|shake shack|mcdonald|chipotle|pizz|eatery|grill|bullritos|newks|patio|hello dolly|raising cane|freddy|buffalo wild|wetzel|kilwins|haagen|polar shake|bakery|croissant|cafe|coffee|starbucks|tamp & grind|hidden grounds|frog pond|austins backyard|javi|phillys|cayefuego|taco|burger|wendy|popeyes|sonic|subway|tst\\*|sq \\*',
    category: 'Dining out',
  },
  { match: 'uber|ubr\\*|lyft|atrans|tokentransit|transit|parking|pkg', category: 'Transport' },
  { match: 'amazon|amzn|ross store|marshalls|nike|adidas|old navy|tj ?maxx|best buy|target|ebay|shein|temu|eros negocios', category: 'Shopping' },
  { match: 'lakeside christian|lakeside college|flywire', category: 'Tuition', sign: 'out' },
  // People
  { match: 'zelle payment to', category: 'Sent to people' },
  { match: 'zelle payment from', category: 'Received from people', kind: 'income' },
];
