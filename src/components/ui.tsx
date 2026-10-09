import type { ReactNode } from 'react';

export function Card({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          {title && <h2 className="text-[13px] font-medium text-ink-2">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: string; note?: ReactNode; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-good-ink' : tone === 'bad' ? 'text-critical-ink' : 'text-ink';
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-muted">{label}</div>
      <div className={`mt-1 truncate text-2xl font-semibold tracking-tight ${color}`}>{value}</div>
      {note && <div className="mt-1 text-xs text-muted">{note}</div>}
    </div>
  );
}

export type Level = 'critical' | 'warning' | 'info' | 'good';

/** Status always pairs color with an icon and words, never color alone. */
export function StatusIcon({ level, className = 'size-4' }: { level: Level; className?: string }) {
  if (level === 'good') {
    return (
      <svg viewBox="0 0 16 16" className={`${className} shrink-0`} aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="var(--good)" />
        <path d="M4.8 8.2l2.1 2.1 4.3-4.6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (level === 'critical') {
    return (
      <svg viewBox="0 0 16 16" className={`${className} shrink-0`} aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="var(--critical)" />
        <path d="M8 4.3v4.6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="8" cy="11.4" r="1.05" fill="#fff" />
      </svg>
    );
  }
  if (level === 'warning') {
    return (
      <svg viewBox="0 0 16 16" className={`${className} shrink-0`} aria-hidden="true">
        <path d="M8 1.6l7 12.6H1z" fill="var(--warning)" strokeLinejoin="round" />
        <path d="M8 6v3.8" stroke="#0b0b0b" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="8" cy="12" r="0.95" fill="#0b0b0b" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className={`${className} shrink-0`} aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="none" stroke="var(--muted)" strokeWidth="1.4" />
      <path d="M8 7.2v4" stroke="var(--muted)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="4.9" r="0.95" fill="var(--muted)" />
    </svg>
  );
}

const LEVEL_WORD: Record<Level, string> = { critical: 'Urgent', warning: 'Heads up', info: 'Note', good: 'OK' };

export function Alerts({ items }: { items: { level: Level; text: string }[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.text} className="flex items-start gap-2.5 text-sm text-ink">
          <StatusIcon level={item.level} className="mt-0.5 size-4" />
          <span>
            <span className="sr-only">{LEVEL_WORD[item.level]}: </span>
            {item.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'danger' }) {
  const styles = {
    primary: 'bg-ink text-plane hover:opacity-90',
    quiet: 'border border-line bg-surface text-ink hover:bg-surface-2',
    danger: 'border border-line bg-surface text-critical-ink hover:bg-surface-2',
  }[variant];
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-[13px] text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-series-1 focus:outline-none';

export function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink">
      <StatusIcon level="critical" className="mt-0.5 size-4" />
      {message}
    </p>
  );
}

/** Full-screen splash while the app starts: the logo with its bars rising, nothing else. */
export function Splash() {
  return (
    <div className="splash" role="status" aria-label="Loading">
      <svg viewBox="0 0 32 32" className="size-14" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--ink)" />
        <path className="bar" d="M8 22.5V17" stroke="var(--plane)" strokeWidth="2.6" strokeLinecap="round" />
        <path className="bar" d="M13.4 22.5V12" stroke="var(--plane)" strokeWidth="2.6" strokeLinecap="round" />
        <path className="bar" d="M18.7 22.5v-7" stroke="var(--plane)" strokeWidth="2.6" strokeLinecap="round" />
        <path className="bar" d="M24 22.5V9.5" stroke="var(--series-1)" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/** A placeholder block in the shape of the content that is loading. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

/** A card-shaped skeleton: a title line and some rows. */
export function SkeletonCard({ rows = 3, tall = false }: { rows?: number; tall?: boolean }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <Skeleton className="h-3.5 w-28" />
      {tall && <Skeleton className="mt-4 h-12 w-40" />}
      {tall && <Skeleton className="mt-5 h-40 w-full" />}
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className={`h-3.5 ${['w-full', 'w-5/6', 'w-2/3', 'w-3/4'][i % 4]}`} />
        ))}
      </div>
    </section>
  );
}

/** While a screen loads: its outline (a big card, then smaller ones), never a lone "Loading…". */
export function Loading({ variant = 'page' }: { variant?: 'page' | 'inline' }) {
  if (variant === 'inline') {
    return (
      <div className="space-y-3 py-3" role="status" aria-label="Loading">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-3/5" />
      </div>
    );
  }
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <Skeleton className="h-6 w-44" />
      <SkeletonCard tall rows={2} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SkeletonCard rows={4} />
        <SkeletonCard rows={3} />
      </div>
    </div>
  );
}
