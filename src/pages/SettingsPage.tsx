import { Card, Loading, PageError, PageHeader } from '../components/ui.tsx';
import { useApi } from '../lib/useApi.ts';
import { BalancesCard, NotificationsCard, SyncCard } from './settings/account.tsx';
import type { SettingsData } from './settings/fields.tsx';
import { AdvancedCard, RulesCard } from './settings/misc.tsx';
import { PlanEditor } from './settings/plan-editor.tsx';
import { SecurityCard } from './settings/security.tsx';

const SECTIONS = [
  ['balances', 'Balances'],
  ['sync', 'Notifications & sync'],
  ['plan', 'Plan'],
  ['rules', 'Category rules'],
  ['security', 'Security'],
] as const;

export function SettingsPage() {
  const { data, error, reload } = useApi<SettingsData>('/settings');
  if (!data) return error ? <PageError message={error} onRetry={reload} /> : <Loading />;
  return (
    <div className="stagger space-y-4">
      <PageHeader eyebrow="Balances, plan, sync and security" title="Settings" />
      <nav aria-label="Settings sections" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {SECTIONS.map(([id, label]) => (
          <a
            key={id}
            href={`#settings`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="press inline-flex h-8 shrink-0 items-center rounded-full bg-surface px-3.5 text-[13px] font-medium text-ink-2 shadow-card hover:text-ink"
          >
            {label}
          </a>
        ))}
      </nav>
      <div id="balances" className="scroll-mt-20">
        <BalancesCard key={`balances-${JSON.stringify(data.balances)}`} balances={data.balances} actuals={data.actuals} onSaved={reload} />
      </div>
      <div id="sync" className="scroll-mt-20 space-y-4">
        <NotificationsCard push={data.push} onChanged={reload} />
        <SyncCard sync={data.sync} jobs={data.plan.jobs} />
      </div>
      <div id="plan" className="scroll-mt-20 space-y-4">
        <PlanEditor
          key={`plan-${JSON.stringify(data.plan)}`}
          plan={data.plan}
          categories={data.categories}
          hoursBasis={data.hoursBasis}
          averages={data.averages?.perMonth ?? {}}
          onSaved={reload}
        />
      </div>
      <div id="rules" className="scroll-mt-20">
        <RulesCard rules={data.rules} onChanged={reload} />
      </div>
      <div id="security" className="scroll-mt-20">
        <SecurityCard />
      </div>
      {data.imports.length > 0 && (
        <Card title="Recent imports">
          <ul className="-my-1 divide-y divide-line text-sm">
            {data.imports.map((imp) => (
              <li key={`${imp.file}-${imp.created_at}`} className="py-2.5">
                <div className="truncate text-ink">{imp.file}</div>
                <div className="text-xs text-muted">
                  {imp.note} · {imp.added} new · {imp.created_at.slice(0, 16)}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <AdvancedCard key={`advanced-${JSON.stringify(data.plan)}`} plan={data.plan} onSaved={reload} />
    </div>
  );
}
