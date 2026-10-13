/**
 * Renders every brand asset from shared/brand/mark.ts through headless Chrome (scripts/lib/chrome.ts):
 *   docs/brand/*.svg              the mark, the compact mark and the lockups (light and dark)
 *   public/favicon.svg, *.png     favicon, app icons (192, 512, maskable) and the Apple touch icon
 *   public/og.png                 the link preview (1200 × 630)
 *   docs/social-preview.png       GitHub's social preview (1280 × 640)
 *   site/public/                  the landing page's copies of the mark, icons, link preview and screenshots
 *
 * The social images use the demo screenshots in docs/screenshots (scripts/screenshots.ts makes them).
 * Run: node scripts/brand.ts
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockupSvg, markSvg } from '../shared/brand/mark.ts';
import { withChrome, type Page } from './lib/chrome.ts';

const root = (path: string) => new URL(`../${path}`, import.meta.url).pathname;
const FONT = root('node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2');

mkdirSync(root('docs/brand'), { recursive: true });
writeFileSync(root('docs/brand/lowtide-mark.svg'), `${markSvg({ id: 'm', title: 'Lowtide' })}\n`);
writeFileSync(root('docs/brand/lowtide-mark-compact.svg'), `${markSvg({ id: 'c', variant: 'compact', title: 'Lowtide' })}\n`);
writeFileSync(root('docs/brand/lowtide-lockup.svg'), `${lockupSvg({ theme: 'light' })}\n`);
writeFileSync(root('docs/brand/lowtide-lockup-dark.svg'), `${lockupSvg({ theme: 'dark' })}\n`);
writeFileSync(root('public/favicon.svg'), `${markSvg({ id: 'f', variant: 'compact', title: 'Lowtide' })}\n`);

const page = (body: string, css = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><style>@font-face{font-family:Geist;src:url('file://${FONT}') format('woff2');font-weight:100 900}*{margin:0;box-sizing:border-box}html,body{background:transparent}${css}</style></head><body>${body}</body></html>`;

const work = mkdtempSync(join(tmpdir(), 'lowtide-brand-'));
let n = 0;
async function render(p: Page, html: string, out: string, width: number, height: number, transparent = false) {
  const file = join(work, `${++n}.html`);
  writeFileSync(file, html);
  await p.viewport(width, height, { transparent });
  await p.media({ reducedMotion: true });
  await p.open(`file://${file}`, 900);
  writeFileSync(out, await p.png());
  console.log(out.replace(root(''), ''));
}

const icon = (size: number, options: Parameters<typeof markSvg>[0]) =>
  page(`<div style="width:${size}px;height:${size}px">${markSvg(options)}</div>`, 'svg{display:block;width:100%;height:100%}');

/** The night sea from the mark, drawn wide: a big moon rising behind the horizon, the water fading in from the left. */
function seaSvg(width: number, height: number, moon: { x: number; y: number; r: number }, horizon: number) {
  // A smooth sine: one quadratic arc per half wave, mirrored with T so every crest and trough is round.
  const wave = (y: number, amp: number, from: number, to: number, half: number) => {
    let d = `M${from} ${y} Q${from + half / 2} ${y - amp} ${from + half} ${y}`;
    for (let x = from + half; x < to; x += half) d += ` T${x + half} ${y}`;
    return d;
  };
  const start = Math.round(width * 0.4);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="position:absolute;inset:0">
<defs>
<radialGradient id="halo" cx="${moon.x}" cy="${moon.y}" r="${moon.r * 2.2}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4b93ea" stop-opacity=".4"/><stop offset=".45" stop-color="#2a78d6" stop-opacity=".13"/><stop offset="1" stop-color="#2a78d6" stop-opacity="0"/></radialGradient>
<linearGradient id="moon" x1="0" y1="${moon.y - moon.r}" x2="0" y2="${horizon}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#a9d0f9"/><stop offset=".55" stop-color="#5a9cea"/><stop offset="1" stop-color="#2a78d6"/></linearGradient>
<radialGradient id="glade" cx="${moon.x}" cy="${horizon}" r="${moon.r}" gradientTransform="translate(0 ${horizon}) scale(1 .32) translate(0 ${-horizon})" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4b93ea" stop-opacity=".3"/><stop offset="1" stop-color="#4b93ea" stop-opacity="0"/></radialGradient>
<linearGradient id="fade" x1="${start}" y1="0" x2="${start + width * 0.22}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f7f7f5" stop-opacity="0"/><stop offset="1" stop-color="#f7f7f5" stop-opacity="1"/></linearGradient>
<clipPath id="sky"><rect width="${width}" height="${horizon}"/></clipPath>
</defs>
<rect width="${width}" height="${height}" fill="url(#halo)"/>
<circle cx="${moon.x}" cy="${moon.y}" r="${moon.r}" fill="url(#moon)" clip-path="url(#sky)"/>
<rect y="${horizon}" width="${width}" height="${height - horizon}" fill="url(#glade)"/>
<path d="${wave(horizon, 7, start, width + 60, 70)}" fill="none" stroke="url(#fade)" stroke-width="3" stroke-linecap="round" opacity=".95"/>
<path d="${wave(horizon + 24, 5, start + 40, width + 60, 58)}" fill="none" stroke="url(#fade)" stroke-width="2.2" stroke-linecap="round" opacity=".38"/>
<path d="${wave(horizon + 44, 4, start + 90, width + 60, 48)}" fill="none" stroke="url(#fade)" stroke-width="1.8" stroke-linecap="round" opacity=".17"/>
</svg>`;
}

function social(width: number, height: number) {
  const phoneH = Math.round(height * 0.92);
  const phoneW = Math.round(phoneH * (390 / 844));
  const phoneX = Math.round(width * 0.655);
  const moon = { x: phoneX + phoneW * 0.55, y: height * 0.86, r: height * 0.42 };
  const horizon = Math.round(height * 0.86);
  const css = `
body{width:${width}px;height:${height}px;overflow:hidden;font-family:Geist,sans-serif;background:
 radial-gradient(70% 90% at 80% 100%, #12233a 0%, transparent 70%), linear-gradient(180deg,#0e131a 0%,#0a0a0a 100%);position:relative;color:#f7f7f5}
.text{position:absolute;left:${Math.round(width * 0.06)}px;top:${Math.round(height * 0.12)}px;width:${Math.round(width * 0.52)}px}
.lock svg{height:${Math.round(height * 0.085)}px;width:auto;display:block}
h1{margin-top:${Math.round(height * 0.085)}px;font-size:${Math.round(height * 0.118)}px;line-height:1.02;font-weight:660;letter-spacing:-0.045em}
p{margin-top:${Math.round(height * 0.045)}px;font-size:${Math.round(height * 0.038)}px;line-height:1.42;color:#c4c3bb;letter-spacing:-0.01em;max-width:92%}
.foot{position:absolute;left:${Math.round(width * 0.06)}px;bottom:${Math.round(height * 0.085)}px;display:flex;gap:10px;font-size:${Math.round(height * 0.027)}px;color:#c4c3bb}
.chip{padding:${Math.round(height * 0.012)}px ${Math.round(height * 0.022)}px;border-radius:999px;background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}
.chip b{color:#f7f7f5;font-weight:560}
.phone{position:absolute;left:${phoneX}px;top:${Math.round(height * 0.07)}px;width:${phoneW}px;height:${phoneH}px;border-radius:${Math.round(phoneW * 0.13)}px;overflow:hidden;
 box-shadow:0 0 0 1.5px rgba(255,255,255,.14),0 0 0 ${Math.round(phoneW * 0.035)}px #161616,0 0 0 ${Math.round(phoneW * 0.035) + 1}px rgba(255,255,255,.12),0 40px 80px -20px rgba(0,0,0,.85)}
.phone img{width:100%;display:block}`;
  const body = `${seaSvg(width, height, moon, horizon)}
<div class="text"><div class="lock">${lockupSvg({ theme: 'dark', id: 'og-lock' })}</div>
<h1>Know what's<br>safe to spend.</h1>
<p>A day-by-day forecast of your balance, built for paychecks that change.</p></div>
<div class="foot"><span class="chip"><b>Live demo</b> · demo.ricardogross.com</span><span class="chip">Open source</span></div>
<div class="phone"><img src="file://${root('docs/screenshots/month-phone-dark.png')}"></div>`;
  return page(body, css);
}

try {
  await withChrome(async (p) => {
    await render(p, icon(512, { id: 'a', shape: 'square' }), root('public/icon-512.png'), 512, 512);
    await render(p, icon(512, { id: 'b', shape: 'square' }), root('public/icon-maskable-512.png'), 512, 512);
    await render(p, icon(192, { id: 'c', shape: 'square' }), root('public/icon-192.png'), 192, 192);
    await render(p, icon(180, { id: 'd', shape: 'square' }), root('public/apple-touch-icon.png'), 180, 180);
    await render(p, icon(64, { id: 'e', variant: 'compact' }), root('public/favicon-64.png'), 64, 64, true);
    await render(p, social(1200, 630), root('public/og.png'), 1200, 630);
    await render(p, social(1280, 640), root('docs/social-preview.png'), 1280, 640);
  });
  // The landing page (site/) uses the same mark, icons, link preview and demo screenshots.
  mkdirSync(root('site/public/img'), { recursive: true });
  for (const file of ['og.png', 'favicon.svg', 'apple-touch-icon.png']) copyFileSync(root(`public/${file}`), root(`site/public/${file}`));
  for (const shot of ['month-phone-dark', 'month-desktop', 'plan-desktop', 'transactions-phone', 'plan-goals-phone', 'settings-phone']) {
    copyFileSync(root(`docs/screenshots/${shot}.png`), root(`site/public/img/${shot}.png`));
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
