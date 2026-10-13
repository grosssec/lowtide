import { useEffect, useState, type ReactNode } from 'react';
import { Lockup } from './Brand.tsx';

export type Tab = 'month' | 'plan' | 'transactions' | 'settings';
/** A tab, or a Settings section ("settings/goals"). */
export type Route = Tab | `settings/${string}`;

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

/** True once the page has scrolled a little: the header then gets its glass background. */
function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return scrolled;
}

export function Shell({ tab, onTab, children, banner }: { tab: Tab; onTab: (tab: Tab) => void; children: ReactNode; banner?: ReactNode }) {
  const scrolled = useScrolled();
  return (
    <div className="min-h-dvh">
      <header
        className={`sticky top-0 z-30 pt-[env(safe-area-inset-top)] transition-[background-color,box-shadow] duration-200 ${
          scrolled ? 'bg-plane/80 shadow-[0_1px_0_var(--line)] backdrop-blur-xl backdrop-saturate-150' : 'bg-transparent'
        }`}
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <button type="button" onClick={() => onTab('month')} className="press rounded-lg" aria-label="Lowtide, go to Month">
            <Lockup size={32} />
          </button>
          <nav aria-label="Sections" className="hidden rounded-full bg-surface-2 p-1 shadow-[inset_0_0_0_1px_var(--ring)] sm:flex">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTab(t)}
                aria-current={t === tab ? 'page' : undefined}
                className={`press h-8 rounded-full px-4 text-[13px] font-medium ${t === tab ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink'}`}
              >
                {LABELS[t]}
              </button>
            ))}
          </nav>
        </div>
      </header>
      {banner}
      <main className="stagger-host mx-auto max-w-5xl px-4 pb-32 pt-1 sm:px-6 sm:pb-16" key={tab}>
        {children}
      </main>
      <nav
        aria-label="Sections"
        className="fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),12px)] z-30 mx-auto max-w-md rounded-[26px] bg-surface/80 p-1.5 shadow-pop backdrop-blur-xl backdrop-saturate-150 sm:hidden"
      >
        <div className="grid grid-cols-4 gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTab(t)}
              aria-current={t === tab ? 'page' : undefined}
              className={`press flex flex-col items-center gap-0.5 rounded-[20px] py-2 text-[11px] font-medium ${t === tab ? 'bg-surface-2 text-ink' : 'text-muted'}`}
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
