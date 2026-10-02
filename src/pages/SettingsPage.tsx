import { Card, ErrorNote, Loading } from '../components/ui.tsx';
import { useApi } from '../lib/useApi.ts';
import { BalancesCard, NotificationsCard, SyncCard } from './settings/account.tsx';
import type { SettingsData } from './settings/fields.tsx';
import { AdvancedCard, RulesCard, SecurityCard } from './settings/misc.tsx';
import { PlanEditor } from './settings/plan-editor.tsx';

export function SettingsPage() {
  const { data, error, reload } = useApi<SettingsData>('/settings');
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
      <BalancesCard key={`balances-${JSON.stringify(data.balances)}`} balances={data.balances} actuals={data.actuals} onSaved={reload} />
      <NotificationsCard push={data.push} onChanged={reload} />
      <SyncCard sync={data.sync} jobs={data.plan.jobs} />
      <PlanEditor
        key={`plan-${JSON.stringify(data.plan)}`}
        plan={data.plan}
        categories={data.categories}
        hoursBasis={data.hoursBasis}
        averages={data.averages?.perMonth ?? {}}
        onSaved={reload}
      />
      <RulesCard rules={data.rules} onChanged={reload} />
      <SecurityCard />
      {data.imports.length > 0 && (
        <Card title="Recent imports">
          <ul className="divide-y divide-line text-sm">
            {data.imports.map((imp) => (
              <li key={`${imp.file}-${imp.created_at}`} className="py-2">
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
