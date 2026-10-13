import { useId } from 'react';
import { markSvg } from '../../shared/brand/mark.ts';

/** Element ids from useId() carry characters that url(#…) references can't use. */
const safeId = (id: string) => `lt${id.replace(/[^a-zA-Z0-9]/g, '')}`;

/**
 * The Lowtide mark (shared/brand/mark.ts). The markup is a fixed string built in this repo, never user input,
 * so setting it as HTML is safe; it keeps one drawing for the app, the icons and the docs.
 */
export function Logo({ size = 32, className = '' }: { size?: number; className?: string }) {
  const id = safeId(useId());
  return (
    <span
      className={`inline-block shrink-0 overflow-hidden rounded-[22%] shadow-[0_1px_2px_rgba(12,12,11,0.18)] [&>svg]:block [&>svg]:size-full ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: markSvg({ id, variant: size <= 32 ? 'compact' : 'full' }) }}
    />
  );
}

/** Mark + name, as in the header and on the sign-in card. */
export function Lockup({ size = 32 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Logo size={size} />
      <span className="font-[640] tracking-[-0.04em] text-ink" style={{ fontSize: Math.round(size * 0.62) }}>
        lowtide
      </span>
    </span>
  );
}

/** Full-screen splash while the app starts: the moon rising over the water. Same markup as the static one in index.html. */
export function Splash() {
  return <div className="splash" role="status" aria-label="Loading" dangerouslySetInnerHTML={{ __html: markSvg({ id: 'lt-splash' }) }} />;
}
