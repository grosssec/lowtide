import { useEffect, useState, type ReactNode } from 'react';
import { Card, Chevron, Loading, PageError, PageHeader, ShowMore } from '../components/ui.tsx';
import { money, shortDate } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { BalancesCard, NotificationsCard, SyncCard } from './settings/account.tsx';
import type { SettingsData } from './settings/fields.tsx';
import { AdvancedCard, RulesCard } from './settings/misc.tsx';
import { PlanEditor, type PlanPart } from './settings/plan-editor.tsx';
import { SecurityCard } from './settings/security.tsx';

type SectionId = 'balances' | 'spending' | 'goals' | 'events' | 'jobs' | 'away' | 'sync' | 'rules' | 'notifications' | 'security' | 'advanced';
type Tone = 'accent' | 'good' | 'warning' | 'neutral';

interface Section {
  id: SectionId;
  title: string;
  tone: Tone;
  icon: ReactNode;
  summary: (data: SettingsData) => string;
  parts?: PlanPart[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// 24-unit line icons, one stroke weight, drawn for this list.
const ICON = {
  wallet: <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V8M4 7.5v10A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 8h-13A1.5 1.5 0 0 1 4 7.5Zm12 6.5h.01" />,
  receipt: <path d="M6 3.5h12v17l-2.5-1.5-2 1.5-1.5-1.5-1.5 1.5-2-1.5L6 20.5Zm3 5h6m-6 3.5h6m-6 3.5h3.5" />,
  flag: <path d="M5.5 20.5V4m0 0h10.5l-1.8 4 1.8 4H5.5" />,
  calendar: <path d="M4.5 7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2Zm0 3h15M8.5 3v4m7-4v4" />,
  briefcase: <path d="M4 9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Zm5-2V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M4 12.5h16" />,
  plane: <path d="M10.5 13.5 4 11l1.5-1.5 7 1 4-4a2 2 0 0 1 3 3l-4 4 1 7L15 22l-2.5-6.5-3 3V21L8 19.5 6.5 16 3 14.5l2-1.5h3" />,
  sync: <path d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1M17.5 3v4h-4m-7 14v-4h4" />,
  tag: <path d="M4 4.5v6.2a1.5 1.5 0 0 0 .44 1.06l7.8 7.8a1.5 1.5 0 0 0 2.12 0l5.2-5.2a1.5 1.5 0 0 0 0-2.12l-7.8-7.8A1.5 1.5 0 0 0 10.7 4H4.5a.5.5 0 0 0-.5.5ZM8.5 8.5h.01" />,
  bell: <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5Zm4 4.5h3" />,
  fingerprint: <path d="M6.6 17.5A9 9 0 0 1 6 14a6 6 0 0 1 12 0m-9 6.5a12 12 0 0 1-.5-6.5 3.5 3.5 0 0 1 7 0c0 2 .2 3.6.8 5.5M12 14c0 2.4.5 4.6 1.3 6.5M4.3 10.5A8.5 8.5 0 0 1 19.7 10.5" />,
  code: <path d="M8.5 7.5 4 12l4.5 4.5m7-9L20 12l-4.5 4.5m-2-11-3 13" />,
};

const SECTIONS: { group: string; items: Section[] }[] = [
  {
    group: 'Money',
    items: [
      {
        id: 'balances',
        title: 'Balances',
        tone: 'accent',
        icon: ICON.wallet,
        summary: (d) => `Bank ${money(d.actuals.checking)} · Cash ${money(d.actuals.cash)} · Card ${money(-d.actuals.cardOwed)}`,
      },
      {
        id: 'spending',
        title: 'Budgets and bills',
        tone: 'accent',
        icon: ICON.receipt,
        summary: (d) => `${plural(d.plan.budgets.length, 'budget')} · ${plural(d.plan.bills.length, 'bill')}`,
        parts: ['budgets', 'bills'],
      },
      {
        id: 'goals',
        title: 'Reserve and goals',
        tone: 'accent',
        icon: ICON.flag,
        summary: (d) => `Reserve ${money(d.plan.reserve.amount)} · ${plural(d.plan.goals.length, 'goal')}`,
        parts: ['goals'],
      },
      {
        id: 'events',
        title: 'One-offs and notes',
        tone: 'accent',
        icon: ICON.calendar,
        summary: (d) => `${plural(d.plan.events.length, 'one-off')} · ${plural((d.plan.notes ?? []).length, 'note')}`,
        parts: ['events', 'notes'],
      },
    ],
  },
  {
    group: 'Income',
    items: [
      {
        id: 'jobs',
        title: 'Jobs and hours',
        tone: 'good',
        icon: ICON.briefcase,
        summary: (d) => d.plan.jobs.map((j) => `${j.name} ${d.hoursBasis.find((h) => h.jobId === j.id)?.weeklyHours ?? j.weeklyHours} h/wk`).join(' · ') || 'No jobs yet',
        parts: ['jobs'],
      },
      {
        id: 'away',
        title: 'Time away',
        tone: 'good',
        icon: ICON.plane,
        summary: (d) => plural(d.plan.away.length, 'period'),
        parts: ['away'],
      },
    ],
  },
  {
    group: 'Data',
    items: [
      {
        id: 'sync',
        title: 'Sync and imports',
        tone: 'warning',
        icon: ICON.sync,
        summary: (d) => (d.sync.lastAlertAt ? `Last bank alert ${shortDate(d.sync.lastAlertAt.slice(0, 10))}` : d.sync.ready ? 'Connected, no alerts yet' : 'Not connected'),
      },
      {
        id: 'rules',
        title: 'Category rules',
        tone: 'warning',
        icon: ICON.tag,
        summary: (d) => plural(d.rules.length, 'rule'),
      },
      {
        id: 'notifications',
        title: 'Daily notification',
        tone: 'warning',
        icon: ICON.bell,
        summary: (d) => (d.push.devices ? `On for ${plural(d.push.devices, 'device')}` : 'Off'),
      },
    ],
  },
  {
    group: 'Account',
    items: [
      { id: 'security', title: 'Security', tone: 'neutral', icon: ICON.fingerprint, summary: () => 'Passkeys, devices and activity' },
      { id: 'advanced', title: 'Advanced', tone: 'neutral', icon: ICON.code, summary: () => 'The whole plan as JSON' },
    ],
  },
];

const ALL = SECTIONS.flatMap((g) => g.items);
const TONE: Record<Tone, string> = {
  accent: 'bg-series-1-soft text-series-1-ink',
  good: 'bg-good-soft text-good-ink',
  warning: 'bg-warning-soft text-warning-ink',
  neutral: 'bg-surface-3 text-ink-2',
};

function SectionIcon({ section }: { section: Section }) {
  return (
    <span className={`grid size-9 shrink-0 place-items-center rounded-[10px] ${TONE[section.tone]}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        {section.icon}
      </svg>
    </span>
  );
}

/** The open section lives in the hash (#settings/balances), so the back gesture and reloads keep it. */
function useSection(): [SectionId | null, (id: SectionId | null) => void] {
  const read = () => {
    const id = window.location.hash.split('/')[1] as SectionId | undefined;
    return id && ALL.some((s) => s.id === id) ? id : null;
  };
  const [section, setSection] = useState(read);
  useEffect(() => {
    const onChange = () => setSection(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return [
    section,
    (id) => {
      window.location.hash = id ? `settings/${id}` : 'settings';
      window.scrollTo({ top: 0 });
    },
  ];
}

export function SettingsPage() {
  const { data, error, reload } = useApi<SettingsData>('/settings');
  const [sectionId, open] = useSection();
  if (!data) return error ? <PageError message={error} onRetry={reload} /> : <Loading />;

  const section = ALL.find((s) => s.id === sectionId);
  if (!section) {
    return (
      <div className="stagger space-y-6" key="hub">
        <PageHeader eyebrow="Balances, plan, sync and security" title="Settings" />
        <div className="grid items-start gap-x-4 gap-y-6 md:grid-cols-2">
          {SECTIONS.map((group) => (
            <section key={group.group}>
              <h2 className="mb-2 px-1 text-[13px] font-medium text-muted">{group.group}</h2>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface shadow-card">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => open(item.id)}
                      className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/70 active:bg-surface-2"
                    >
                      <SectionIcon section={item} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium text-ink">{item.title}</span>
                        <span className="num mt-0.5 block truncate text-[13px] text-muted">{item.summary(data)}</span>
                      </span>
                      <Chevron className="size-4 shrink-0 text-baseline" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    );
  }

  const planEditor = section.parts && (
    <PlanEditor
      key={`plan-${section.id}-${JSON.stringify(data.plan)}`}
      parts={section.parts}
      plan={data.plan}
      categories={data.categories}
      hoursBasis={data.hoursBasis}
      averages={data.averages?.perMonth ?? {}}
      onSaved={reload}
    />
  );

  return (
    <div className="stagger space-y-4" key={section.id}>
      <div className="pt-2">
        <button
          type="button"
          onClick={() => open(null)}
          className="press -ml-1.5 inline-flex h-8 items-center gap-1 rounded-full pl-1 pr-3 text-[13px] font-medium text-series-1-ink hover:bg-surface-2"
        >
          <Chevron direction="left" /> Settings
        </button>
        <div className="mt-2 flex items-center gap-3">
          <SectionIcon section={section} />
          <h1 className="truncate text-[28px] font-semibold leading-tight tracking-[-0.03em] text-ink sm:text-[32px]">{section.title}</h1>
        </div>
      </div>
      {section.id === 'balances' && <BalancesCard key={`balances-${JSON.stringify(data.balances)}`} balances={data.balances} actuals={data.actuals} onSaved={reload} />}
      {section.id === 'notifications' && <NotificationsCard push={data.push} onChanged={reload} />}
      {section.id === 'sync' && (
        <>
          <SyncCard sync={data.sync} jobs={data.plan.jobs} />
          {data.imports.length > 0 && (
            <Card title="Recent imports">
              <ShowMore
                items={data.imports}
                limit={5}
                className="-my-1 divide-y divide-line text-sm"
                render={(imp) => (
                  <li key={`${imp.file}-${imp.created_at}`} className="py-2.5">
                    <div className="truncate text-ink">{imp.file}</div>
                    <div className="text-xs text-muted">
                      {imp.note} · {imp.added} new · {imp.created_at.slice(0, 16)}
                    </div>
                  </li>
                )}
              />
            </Card>
          )}
        </>
      )}
      {planEditor}
      {section.id === 'rules' && <RulesCard rules={data.rules} onChanged={reload} />}
      {section.id === 'security' && <SecurityCard />}
      {section.id === 'advanced' && <AdvancedCard key={`advanced-${JSON.stringify(data.plan)}`} plan={data.plan} onSaved={reload} />}
    </div>
  );
}
