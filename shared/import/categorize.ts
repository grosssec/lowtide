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
/** The categories, grouped the way a household budget works. Everything else stays Uncategorized until a rule or a person says otherwise. */
export const CATEGORIES = {
  expense: [
    'Rent',
    'Utilities',
    'Phone',
    'Subscriptions',
    'Insurance',
    'Groceries',
    'Dining out',
    'Snacks',
    'Transportation',
    'Health & personal care',
    'Shopping',
    'Fun',
    'Travel',
    'Education',
    'Gifts',
    'Sent to people',
    'Fees',
    'Taxes',
  ],
  income: ['Freelance & side jobs', 'Money from people', 'Refunds'],
  transfer: ['Card payment', 'Between accounts'],
} as const;

/** Names used before the category list above; stored transactions, rules and plans are renamed with it. */
export const RENAMED_CATEGORIES: Record<string, string> = {
  Leisure: 'Fun',
  Transport: 'Transportation',
  Tuition: 'Education',
  'Health insurance': 'Insurance',
  'Received from people': 'Money from people',
  'Side income': 'Freelance & side jobs',
  'Other income': 'Freelance & side jobs',
  'Card rewards': 'Refunds',
  'From Cash App': 'Freelance & side jobs',
  'Paychecks (via Inter)': 'Job pay (via Inter)',
};

export const DEFAULT_RULES: CategoryRule[] = [
  // Moving money between own accounts
  { match: 'discover e-payment|directpay full balance|internet payment - thank you', category: 'Card payment', kind: 'transfer' },
  // Money coming in
  { match: 'statement credit|cashback bonus|rebate|refund|reversal', category: 'Refunds', kind: 'income', sign: 'in' },
  { match: 'payment received .*cash app|prepaid2cash', category: 'Freelance & side jobs', kind: 'income', sign: 'in' },
  // Bills and subscriptions (before stores: Walmart+ and Amazon Prime are subscriptions)
  { match: 'visible|t-mobile|verizon|at&t wireless', category: 'Phone' },
  { match: 'cleco|entergy|swepco|xfinity|comcast|spectrum|at&t internet|water ?works|utilities', category: 'Utilities' },
  { match: 'geico|state farm|progressive|allstate|insurance', category: 'Insurance' },
  {
    match: 'apple\\.com/bill|google \\*workspace|canva|amazon prime|walmart\\^? member|capcut|elevenlabs|higgsfield|openai|chatgpt|grok|anthropic|claude\\.ai|proton ag|name-?cheap|respondus|replicate|spotify|netflix|adobe',
    category: 'Subscriptions',
  },
  { match: '\\birs\\b|treas tax|tax payment|state of lakeside dept rev', category: 'Taxes' },
  { match: 'foreign exch rt adj fee|\\bfee\\b|interest charge', category: 'Fees' },
  // Health and personal care (before Walmart: its pharmacy counts here)
  { match: 'walgreens|\\bcvs\\b|pharmacy|rite aid|great clips|supercuts|sport clips|barber|salon', category: 'Health & personal care' },
  // Food
  { match: 'uber eats|doordash|food svc|snack bar', category: 'Dining out' },
  { match: 'dollar general|wal-?mart|wm supercenter|publix|aldi|super 1 foods|kroger|winn-dixie|rouses|brookshire', category: 'Groceries' },
  { match: 'coca cola|vending|7-eleven|circle ?k|marathon|texaco|casey|on the run|south point|shell|chevron|exxon|valero|racetrac|tobacco|buc-ee', category: 'Snacks' },
  // Fun before the generic Toast/Square restaurant rule (sports venues also use them)
  { match: 'topgolf|golf|\\bzoo\\b|tickpick|ticketmaster|eventbrite|phenomenal sports|sofive|seaworld|cinema|\\bamc\\b|bowling|steam|playstation|xbox|nintendo|nightclub', category: 'Fun' },
  {
    match: 'chick-fil-a|shake shack|mcdonald|chipotle|pizz|eatery|grill|bullritos|newks|patio|hello dolly|raising cane|freddy|buffalo wild|wetzel|kilwins|haagen|polar shake|bakery|croissant|cafe|coffee|starbucks|tamp & grind|hidden grounds|frog pond|austins backyard|javi|phillys|cayefuego|taco|burger|wendy|popeyes|sonic|subway|tst\\*|sq \\*',
    category: 'Dining out',
  },
  { match: 'airlines|delta air|united air|american air|southwest|spirit air|frontier|airbnb|hotel|marriott|hilton|expedia|booking\\.com|greyhound', category: 'Travel' },
  { match: 'uber|ubr\\*|lyft|atrans|tokentransit|transit|parking|pkg', category: 'Transportation' },
  { match: 'amazon|amzn|ross store|marshalls|nike|adidas|old navy|tj ?maxx|best buy|target|ebay|shein|temu|eros negocios', category: 'Shopping' },
  // ACH names are cut at 16 characters ("LAKESIDE CHRIST"), so match the start of the name.
  { match: 'lakeside chri|lakeside col|flywire|chegg|textbook', category: 'Education', sign: 'out' },
  { match: 'gofundme|donation|church|tithe', category: 'Gifts' },
  // People
  { match: 'zelle payment to', category: 'Sent to people' },
  { match: 'zelle payment from', category: 'Money from people', kind: 'income' },
];
