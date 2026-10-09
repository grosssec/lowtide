import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Card({
  title,
  action,
  children,
  className = '',
  hero = false,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  hero?: boolean;
}) {
  return (
    <section className={`rounded-2xl p-5 shadow-card sm:p-6 ${hero ? 'hero' : 'bg-surface'} ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex min-h-7 items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Screen title: a small line above (where you are), the title, and controls on the right. */
export function PageHeader({ eyebrow, title, actions }: { eyebrow?: ReactNode; title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 pb-1 pt-2">
      <div className="min-w-0">
        {eyebrow && <div className="text-[13px] font-medium text-muted">{eyebrow}</div>}
        <h1 className="mt-0.5 truncate text-[28px] font-semibold leading-tight tracking-[-0.03em] text-ink sm:text-[32px]">{title}</h1>
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, note, tone, icon }: { label: string; value: string; note?: ReactNode; tone?: 'good' | 'bad'; icon?: ReactNode }) {
  const color = tone === 'good' ? 'text-good-ink' : tone === 'bad' ? 'text-critical-ink' : 'text-ink';
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[13px] text-muted">
        {icon}
        {label}
      </div>
      <div className={`num mt-1.5 truncate text-[22px] font-semibold tracking-[-0.02em] sm:text-2xl ${color}`}>{value}</div>
      {note && <div className="mt-0.5 text-xs text-muted">{note}</div>}
    </div>
  );
}

/** A small rounded label for state: "Covered", "alert", "this device". */
export function Chip({ children, tone = 'neutral', className = '' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warning' | 'critical' | 'accent'; className?: string }) {
  const styles = {
    neutral: 'bg-surface-2 text-ink-2',
    good: 'bg-good-soft text-good-ink',
    warning: 'bg-warning-soft text-warning-ink',
    critical: 'bg-critical-soft text-critical-ink',
    accent: 'bg-series-1-soft text-series-1-ink',
  }[tone];
  return <span className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${styles} ${className}`}>{children}</span>;
}

/** Nothing here yet: an icon, a line saying so, and what to do about it. */
export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <div className="grid size-11 place-items-center rounded-2xl bg-surface-2 text-muted">
        {icon ?? (
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path d="M4 13.5l2.6-7A2 2 0 0 1 8.5 5h7a2 2 0 0 1 1.9 1.5l2.6 7M4 13.5V18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4.5M4 13.5h4.5l1 2h5l1-2H20" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <p className="mt-3 text-sm font-medium text-ink">{title}</p>
      {children && <p className="mt-1 max-w-xs text-[13px] text-muted">{children}</p>}
    </div>
  );
}

export function Chevron({ direction = 'right', className = 'size-4' }: { direction?: 'left' | 'right' | 'up' | 'down'; className?: string }) {
  const d = { left: 'M10 3.5L5.5 8l4.5 4.5', right: 'M6 3.5L10.5 8 6 12.5', up: 'M3.5 10L8 5.5l4.5 4.5', down: 'M3.5 6L8 10.5 12.5 6' }[direction];
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Small line icons drawn on the same 16-unit grid and stroke as the rest. */
export function CloseIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <path d="M4.5 4.5l7 7m0-7l-7 7" />
    </svg>
  );
}

export function PlusIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

const MINUS = '−';

/** Eases a number toward its new value (once, ~0.7 s); shows the final value right away when motion is reduced. */
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useCountUp(target: number): number {
  const [shown, setShown] = useState(() => (reducedMotion() ? target : 0));
  const from = useRef(0);
  useEffect(() => {
    if (reducedMotion()) return;
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 700);
      const eased = 1 - Math.pow(1 - t, 4);
      setShown(Math.round(origin + (target - origin) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = target;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return reducedMotion() ? target : shown;
}

/** The headline number: a smaller, lifted dollar sign, whole dollars, and a quick count-up. */
export function BigMoney({ cents, className = '' }: { cents: number; className?: string }) {
  const shown = useCountUp(cents);
  const dollars = Math.round(Math.abs(shown) / 100).toLocaleString('en-US');
  const negative = Math.round(cents / 100) < 0;
  return (
    <div className={`num flex items-start font-semibold leading-none tracking-[-0.045em] text-ink ${className}`} aria-label={`${negative ? 'minus ' : ''}$${Math.round(Math.abs(cents) / 100).toLocaleString('en-US')}`}>
      <span aria-hidden="true" className="flex items-start">
        {negative && <span>{MINUS}</span>}
        <span className="mr-0.5 mt-[0.12em] text-[0.5em] font-medium tracking-normal text-muted">$</span>
        <span>{dollars}</span>
      </span>
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
    <ul className="-my-1 divide-y divide-line">
      {items.map((item) => (
        <li key={item.text} className="flex items-start gap-3 py-2.5 text-sm text-ink">
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
  size = 'md',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  const styles = {
    primary: 'bg-ink text-plane shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_2px_rgba(0,0,0,0.12)] hover:bg-ink/88',
    quiet: 'bg-surface text-ink shadow-card hover:bg-surface-2',
    ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
    danger: 'bg-surface text-critical-ink shadow-card hover:bg-critical-soft',
  }[variant];
  const sizes = { sm: 'h-8 gap-1.5 rounded-full px-3 text-[13px]', md: 'h-10 gap-2 rounded-xl px-4 text-sm' }[size];
  return (
    <button
      type="button"
      {...props}
      className={`press inline-flex shrink-0 items-center justify-center font-medium disabled:cursor-not-allowed disabled:opacity-45 ${sizes} ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * A labeled control. One rule everywhere: the label stays on one line, the control sits right under it and any hint
 * goes below the control, so fields side by side always line up (grids use items-start).
 */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0 text-sm">
      <span className="mb-1.5 block truncate text-[13px] font-medium leading-5 text-ink-2" title={label}>
        {label}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** Takes the height of a Field's label, so a checkbox or a value placed beside fields lines up with their controls. */
export const LabelSpace = () => <span className="mb-1.5 block h-5" aria-hidden="true" />;

export const inputClass =
  'h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink shadow-[0_1px_2px_rgba(32,28,16,0.03)] transition-[border-color,box-shadow] duration-150 placeholder:text-muted hover:border-baseline focus:border-series-1 focus:shadow-[0_0_0_3px_var(--focus)] focus:outline-none';

export function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl bg-critical-soft px-3.5 py-2.5 text-sm text-ink">
      <StatusIcon level="critical" className="mt-0.5 size-4" />
      {message}
    </p>
  );
}

/** The first few items of a list, and a button to show the rest. */
export function ShowMore<T>({ items, limit, render, className = '' }: { items: T[]; limit: number; render: (item: T, index: number) => ReactNode; className?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, limit);
  return (
    <>
      <ul className={className}>{shown.map(render)}</ul>
      {items.length > limit && (
        <Button variant="ghost" size="sm" className="-ml-3 mt-2" onClick={() => setAll((a) => !a)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
          <Chevron direction={all ? 'up' : 'down'} className="size-3.5" />
        </Button>
      )}
    </>
  );
}

/** A screen that couldn't load: what happened, and a way to try again. */
export function PageError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="fade-in mx-auto mt-16 flex max-w-sm flex-col items-center rounded-2xl bg-surface px-6 py-10 text-center shadow-card" role="alert">
      <div className="grid size-12 place-items-center rounded-2xl bg-critical-soft text-critical-ink">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
          <path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01" />
        </svg>
      </div>
      <p className="mt-4 text-[15px] font-semibold text-ink">This screen didn&apos;t load</p>
      <p className="mt-1 text-sm text-muted">{message}</p>
      <Button variant="quiet" className="mt-5" onClick={onRetry}>
        Try again
      </Button>
    </div>
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
    <section className="rounded-2xl bg-surface p-5 shadow-card sm:p-6">
      <Skeleton className="h-4 w-28" />
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
      <div className="pb-1 pt-2">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="mt-2 h-8 w-52" />
      </div>
      <SkeletonCard tall rows={2} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SkeletonCard rows={4} />
        <SkeletonCard rows={3} />
      </div>
    </div>
  );
}
