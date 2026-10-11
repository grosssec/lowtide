import { useEffect, useState } from 'react';
import { Shell, type Route, type Tab } from './components/Shell.tsx';
import { Toaster } from './components/overlay.tsx';
import { Splash } from './components/ui.tsx';
import { api, setDemoMode } from './lib/api.ts';
import { freezeToday, shortDate } from './lib/format.ts';
import { LoginPage, type AuthStatus } from './pages/LoginPage.tsx';
import { MonthPage } from './pages/MonthPage.tsx';
import { PlanPage } from './pages/PlanPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { TransactionsPage } from './pages/TransactionsPage.tsx';

const TABS: Tab[] = ['month', 'plan', 'transactions', 'settings'];
const tabFromHash = (): Tab => {
  // "#settings/balances" is the Settings tab with a section open.
  const hash = window.location.hash.replace('#', '').split('/')[0] as Tab;
  return TABS.includes(hash) ? hash : 'month';
};

/** Tab lives in the URL hash, so reloads and the iOS back gesture keep the place. */
function useHashTab(): [Tab, (route: Route) => void] {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  useEffect(() => {
    const onChange = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return [
    tab,
    (next) => {
      window.location.hash = next;
      window.scrollTo({ top: 0 });
    },
  ];
}

/** A quiet strip under the header: this is the public demo, with made-up data, and nothing is saved. */
function DemoBanner({ today }: { today?: string }) {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-1 sm:px-6">
      <div className="flex items-center gap-3 rounded-2xl bg-series-1-soft/60 px-4 py-2.5 text-[13px] text-ink-2">
        <span className="shrink-0 rounded-full bg-series-1 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">Demo</span>
        <span className="min-w-0">
          Made-up data for a fictional student, frozen on{' '}
          <span className="font-medium text-ink">{today ? `${shortDate(today)}, ${today.slice(0, 4)}` : 'one day'}</span>. Look around: nothing you change is saved.
        </span>
      </div>
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [tab, setTab] = useHashTab();

  useEffect(() => {
    api<AuthStatus>('/auth/status')
      .then((s) => {
        if (s.demo) {
          setDemoMode(true);
          if (s.today) freezeToday(s.today);
        }
        setStatus(s);
      })
      .catch(() => setStatus({ signedIn: false, hasPasskey: true, bypass: false }));
  }, []);

  if (!status) return <Splash />;
  if (!status.signedIn) return <LoginPage status={status} onSignedIn={() => window.location.reload()} />;

  return (
    <>
      <Shell tab={tab} onTab={setTab} banner={status.demo ? <DemoBanner today={status.today} /> : undefined}>
        {tab === 'month' && <MonthPage onGo={setTab} />}
        {tab === 'plan' && <PlanPage onGo={setTab} />}
        {tab === 'transactions' && <TransactionsPage />}
        {tab === 'settings' && <SettingsPage />}
      </Shell>
      <Toaster />
    </>
  );
}
