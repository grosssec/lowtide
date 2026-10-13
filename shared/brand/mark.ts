/**
 * The Lowtide mark: a blue moon rising above the water line, with two ripples below (the moon pulls the tide).
 * One source for every place the brand appears: the app (Logo, Splash), index.html's splash (vite.config.ts),
 * the icons and social images (scripts/brand.ts) and the files in docs/brand.
 *
 * Plain TypeScript returning SVG markup, so Node scripts can use it without a JSX build.
 * Classes (lt-halo, lt-moon, lt-wave, lt-ripple) are hooks for the splash animation in index.css / index.html.
 */

export interface MarkOptions {
  /** 'full' from 40 px up; 'compact' (bigger moon, one wave) for 16–32 px. */
  variant?: 'full' | 'compact';
  /** 'rounded' for use on a page; 'square' for app icons (the OS rounds the corners itself). */
  shape?: 'rounded' | 'square';
  /** Prefix for the gradient and clip ids, unique per mark on a page. */
  id?: string;
  /** Accessible name; without it the mark is decorative (aria-hidden). */
  title?: string;
  className?: string;
}

const WAVE = 'M9 37.2 C14.5 34.6 19 34.6 24.5 37.2 C30 39.8 34 39.8 39.5 37.2 C45 34.6 49.5 34.6 55 37.2';
const RIPPLE_1 = 'M14.5 45 C18.8 43 22.2 43 26.5 45 C30.8 47 34.2 47 38.5 45 C42.8 43 46.2 43 49.5 44.6';
const RIPPLE_2 = 'M21 52.4 C24.2 51 27 51 30.2 52.4 C33.4 53.8 36.2 53.8 39.4 52.4 C41 51.7 42.5 51.5 43.6 51.8';
/** Everything above the water line: the moon is cut exactly along the wave, so the two meet without a seam. */
const SKY = 'M0 0 H64 V37.2 H55 C49.5 34.6 45 34.6 39.5 37.2 C34 39.8 30 39.8 24.5 37.2 C19 34.6 14.5 34.6 9 37.2 H0 Z';

const COMPACT_WAVE = 'M7 40 C13.5 36.6 19 36.6 25.5 40 C32 43.4 37 43.4 43.5 40 C49 37.2 53 37 57 38.6';
const COMPACT_SKY = 'M0 0 H64 V38.6 H57 C53 37 49 37.2 43.5 40 C37 43.4 32 43.4 25.5 40 C19 36.6 13.5 36.6 7 40 H0 Z';

export const BRAND = {
  name: 'Lowtide',
  tagline: "Know what's safe to spend.",
  colors: {
    ink: '#0c0c0b',
    plane: '#f5f5f1',
    moonLight: '#9cc8f7',
    tide: '#2a78d6',
    tideBright: '#4b93ea',
    night: '#1f2a3a',
  },
} as const;

function defs(id: string, compact: boolean): string {
  return `<defs>
<linearGradient id="${id}-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f2a3a"/><stop offset=".55" stop-color="#0f141b"/><stop offset="1" stop-color="#0a0a0a"/></linearGradient>
<radialGradient id="${id}-halo" cx="32" cy="${compact ? 37 : 34}" r="${compact ? 25 : 22}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4b93ea" stop-opacity=".55"/><stop offset=".55" stop-color="#2a78d6" stop-opacity=".16"/><stop offset="1" stop-color="#2a78d6" stop-opacity="0"/></radialGradient>
<linearGradient id="${id}-moon" x1="0" y1="${compact ? 21 : 22.5}" x2="0" y2="${compact ? 40 : 37}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#9cc8f7"/><stop offset=".5" stop-color="#5a9cea"/><stop offset="1" stop-color="#2a78d6"/></linearGradient>
<clipPath id="${id}-sky"><path d="${compact ? COMPACT_SKY : SKY}"/></clipPath>
</defs>`;
}

/** The mark as an <svg> element (viewBox 64 × 64). */
export function markSvg({ variant = 'full', shape = 'rounded', id = 'lt', title, className }: MarkOptions = {}): string {
  const compact = variant === 'compact';
  const rx = shape === 'rounded' ? ' rx="14.5"' : '';
  const label = title ? ` role="img" aria-label="${title}"` : ' aria-hidden="true"';
  const cls = className ? ` class="${className}"` : '';
  const water = compact
    ? `<path class="lt-wave" d="${COMPACT_WAVE}" fill="none" stroke="#f7f7f5" stroke-width="5.2" stroke-linecap="round"/>`
    : `<path class="lt-wave" d="${WAVE}" fill="none" stroke="#f7f7f5" stroke-width="3.4" stroke-linecap="round"/>
<path class="lt-ripple" d="${RIPPLE_1}" fill="none" stroke="#f7f7f5" stroke-width="2.6" stroke-linecap="round" opacity=".42"/>
<path class="lt-ripple lt-ripple-2" d="${RIPPLE_2}" fill="none" stroke="#f7f7f5" stroke-width="2.2" stroke-linecap="round" opacity=".2"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"${cls}${label}>${defs(id, compact)}
<rect width="64" height="64"${rx} fill="url(#${id}-bg)"/>
<rect class="lt-halo" width="64" height="64"${rx} fill="url(#${id}-halo)"/>
<g clip-path="url(#${id}-sky)"><circle class="lt-moon" cx="32" cy="${compact ? 37 : 34.5}" r="${compact ? 16 : 12}" fill="url(#${id}-moon)"/></g>
${water}
</svg>`;
}

/**
 * "lowtide" in Geist at weight 640 with -0.04em tracking, outlined, so it looks the same everywhere (no font needed).
 * Drawn at a font size of 100: 344.6 wide, glyphs from y 28.5 (ascenders) to 101.7 (baseline overshoot).
 */
export const WORDMARK = {
  width: 344.6,
  top: 28.49,
  bottom: 101.7,
  path: 'M20.13 100.5Q13.99 100.5 10.42 97.38Q6.85 94.26 6.85 87.33V29.5H20.53V85.91Q20.53 88.09 21.59 89.08Q22.66 90.08 24.64 90.08H28.43V100.5ZM56.78 101.7Q48.76 101.7 42.75 98.25Q36.75 94.8 33.44 88.51Q30.12 82.21 30.12 73.76Q30.12 65.26 33.44 59.01Q36.75 52.76 42.75 49.29Q48.76 45.82 56.78 45.82Q64.8 45.82 70.77 49.29Q76.75 52.76 80.06 59.01Q83.38 65.26 83.38 73.76Q83.38 82.21 80.06 88.51Q76.75 94.8 70.77 98.25Q64.8 101.7 56.78 101.7ZM56.78 90.87Q62.73 90.87 65.99 86.36Q69.25 81.86 69.25 73.76Q69.25 65.71 65.99 61.18Q62.73 56.65 56.78 56.65Q50.82 56.65 47.54 61.18Q44.25 65.71 44.25 73.76Q44.25 81.86 47.54 86.36Q50.82 90.87 56.78 90.87ZM101.32 100.5 85.3 47.02H99.21L109.11 84.88L119.5 47.02H131.1L141.54 84.88L151.49 47.02H165.4L149.38 100.5H135.61L125.3 65.62L115.04 100.5ZM192.05 100.5Q183.94 100.5 180.13 96.74Q176.32 92.99 176.32 84.88V34.48H190V83.44Q190 87.23 191.62 88.65Q193.25 90.08 196.6 90.08H204.1V100.5ZM167.85 57.44V47.02H204.1V57.44ZM209.75 100.5V47.02H223.43V100.5ZM209.5 40.11V28.49H223.68V40.11ZM252.19 101.7Q245.38 101.7 240.43 98.28Q235.48 94.85 232.8 88.58Q230.12 82.31 230.12 73.76Q230.12 65.21 232.82 58.94Q235.52 52.67 240.5 49.24Q245.48 45.82 252.19 45.82Q257.82 45.82 262.03 48.14Q266.24 50.46 268.39 54.61V29.5H282.07V100.5H269.05L268.75 92.6Q266.55 96.9 262.17 99.3Q257.79 101.7 252.19 101.7ZM256.48 90.87Q260.32 90.87 262.97 88.9Q265.62 86.93 267 83.11Q268.39 79.28 268.39 73.76Q268.39 68.14 267 64.34Q265.62 60.54 262.97 58.59Q260.32 56.65 256.48 56.65Q250.87 56.65 247.56 61.23Q244.25 65.81 244.25 73.76Q244.25 81.56 247.59 86.22Q250.92 90.87 256.48 90.87ZM315.23 101.7Q307.16 101.7 301.2 98.25Q295.25 94.8 291.99 88.51Q288.72 82.21 288.72 73.76Q288.72 65.31 291.99 59.06Q295.25 52.82 301.15 49.32Q307.05 45.82 315.02 45.82Q322.79 45.82 328.59 49.26Q334.4 52.7 337.56 59.14Q340.73 65.58 340.73 74.58V77.51H302.9Q303.26 84.28 306.59 87.65Q309.92 91.01 315.42 91.01Q319.52 91.01 322.25 89.21Q324.97 87.41 326.08 83.98L339.98 84.83Q337.83 92.7 331.23 97.2Q324.64 101.7 315.23 101.7ZM302.9 68.67H326.63Q326.27 62.41 323.12 59.36Q319.96 56.32 315.02 56.32Q310.08 56.32 306.85 59.51Q303.62 62.71 302.9 68.67Z',
} as const;

/** Mark + wordmark side by side (viewBox 256 × 64): the logo for headers, the README and documents. */
export function lockupSvg({ theme = 'light', id = 'lt-lockup' }: { theme?: 'light' | 'dark'; id?: string } = {}): string {
  const scale = 0.503; // the wordmark's size against the 64-unit mark (44 px text next to a 56 px mark)
  const glyphs = (WORDMARK.bottom - WORDMARK.top) * scale;
  const y = 32 - glyphs / 2 - WORDMARK.top * scale; // glyphs centered on the mark
  const color = theme === 'dark' ? '#f7f7f5' : BRAND.colors.ink;
  const mark = markSvg({ id }).replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true">', '<svg width="64" height="64" viewBox="0 0 64 64">');
  const width = Math.ceil(82 + WORDMARK.width * scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 64" role="img" aria-label="Lowtide">
${mark}
<path transform="translate(82 ${y.toFixed(2)}) scale(${scale})" fill="${color}" d="${WORDMARK.path}"/>
</svg>`;
}
