import { useEffect, useState } from 'react';
import { Shell, type Tab } from './components/Shell.tsx';
import { Splash } from './components/ui.tsx';
import { api } from './lib/api.ts';
import { LoginPage, type AuthStatus } from './pages/LoginPage.tsx';
import { MonthPage } from './pages/MonthPage.tsx';
import { PlanPage } from './pages/PlanPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { TransactionsPage } from './pages/TransactionsPage.tsx';

const TABS: Tab[] = ['month', 'plan', 'transactions', 'settings'];
const tabFromHash = (): Tab => {
  const hash = window.location.hash.replace('#', '') as Tab;
  return TABS.includes(hash) ? hash : 'month';
};

/** Tab lives in the URL hash, so reloads and the iOS back gesture keep the place. */
function useHashTab(): [Tab, (tab: Tab) => void] {
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

export default function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [tab, setTab] = useHashTab();

  useEffect(() => {
    api<AuthStatus>('/auth/status')
      .then(setStatus)
      .catch(() => setStatus({ signedIn: false, hasPasskey: true, bypass: false }));
  }, []);

  if (!status) return <Splash />;
  if (!status.signedIn) return <LoginPage status={status} onSignedIn={() => window.location.reload()} />;

  return (
    <Shell tab={tab} onTab={setTab}>
      {tab === 'month' && <MonthPage onGo={setTab} />}
      {tab === 'plan' && <PlanPage onGo={setTab} />}
      {tab === 'transactions' && <TransactionsPage />}
      {tab === 'settings' && <SettingsPage />}
    </Shell>
  );
}
