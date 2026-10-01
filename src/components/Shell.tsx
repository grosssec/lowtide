import type { ReactNode } from 'react';

export type Tab = 'month' | 'plan' | 'transactions' | 'settings';

const ICONS: Record<Tab, ReactNode> = {
  month: <path d="M4 18V9m5.3 9V5m5.4 13v-6m5.3 6V8" strokeLinecap="round" />,
  plan: <path d="M3 17l5-5 4 3 8-8m0 0h-5m5 0v5" strokeLinecap="round" strokeLinejoin="round" />,
  transactions: <path d="M5 7h14M5 12h14M5 17h9" strokeLinecap="round" />,
  settings: (
    <path
      d="M5 6h7m4 0h3M5 12h3m4 0h7M5 18h9m4 0h1M12 4v4m-4 2v4m6 2v4"
      strokeLinecap="round"
    />
  ),
};

const LABELS: Record<Tab, string> = { month: 'Month', plan: 'Plan', transactions: 'Transactions', settings: 'Settings' };
const TABS: Tab[] = ['month', 'plan', 'transactions', 'settings'];

function Icon({ tab }: { tab: Tab }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      {ICONS[tab]}
    </svg>
  );
}

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <path d="M8 22.5V17m5.4 5.5V12m5.3 10.5v-7" stroke="var(--plane)" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M24 22.5V9.5" stroke="var(--series-1)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function Shell({ tab, onTab, children }: { tab: Tab; onTab: (tab: Tab) => void; children: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 pb-28 pt-[max(env(safe-area-inset-top),12px)] sm:px-6 sm:pb-12">
      <header className="flex items-center justify-between py-3">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">Finance</span>
        </div>
        <nav aria-label="Sections" className="hidden gap-1 sm:flex">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTab(t)}
              aria-current={t === tab ? 'page' : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${t === tab ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:text-ink'}`}
            >
              {LABELS[t]}
            </button>
          ))}
        </nav>
      </header>
      <main className="fade-in" key={tab}>
        {children}
      </main>
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-4">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTab(t)}
              aria-current={t === tab ? 'page' : undefined}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] ${t === tab ? 'text-ink' : 'text-muted'}`}
            >
              <Icon tab={t} />
              {LABELS[t]}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
