/**
 * Screenshots of the demo for the README and the landing page, through headless Chrome (scripts/lib/chrome.ts):
 * fixed viewport, light or dark, reduced motion so every section is fully drawn.
 *
 * Run the demo locally first (node scripts/demo.ts, then CLOUDFLARE_ENV=demo npx vite --port 5174), then:
 *   node scripts/screenshots.ts [base-url]      → docs/screenshots/*.png
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { sleep, withChrome } from './lib/chrome.ts';

const BASE = process.argv[2] ?? 'http://localhost:5174';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;

const SHOTS: { name: string; route: string; width: number; height: number; dark?: boolean; scrollTo?: string }[] = [
  { name: 'month-desktop', route: '#month', width: 1280, height: 900 },
  { name: 'month-desktop-dark', route: '#month', width: 1280, height: 900, dark: true },
  { name: 'plan-desktop', route: '#plan', width: 1280, height: 900 },
  { name: 'month-phone', route: '#month', width: 390, height: 844 },
  { name: 'month-phone-dark', route: '#month', width: 390, height: 844, dark: true },
  { name: 'transactions-phone', route: '#transactions', width: 390, height: 844 },
  { name: 'plan-goals-phone', route: '#plan', width: 390, height: 844, scrollTo: 'Goals' },
  { name: 'settings-phone', route: '#settings', width: 390, height: 844 },
];

await withChrome(async (page) => {
  mkdirSync(OUT, { recursive: true });
  for (const shot of SHOTS) {
    await page.viewport(shot.width, shot.height, { scale: 2, mobile: shot.width < 600 });
    await page.media({ dark: shot.dark, reducedMotion: true });
    await page.open(`${BASE}/?shot=${shot.name}${shot.route}`, 300);
    // The app must be signed in (the demo always is) and the screen drawn; a sign-in page here means the server was not ready.
    await page.waitFor("document.querySelector('main h1') && !document.querySelector('.login-bg')");
    await sleep(1800);
    if (shot.scrollTo) {
      await page.call(
        "(title) => { const h = [...document.querySelectorAll('h2')].find((e) => e.textContent === title); if (h) window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 80); }",
        shot.scrollTo,
      );
      await sleep(600);
    }
    writeFileSync(`${OUT}${shot.name}.png`, await page.png());
    console.log(`docs/screenshots/${shot.name}.png`);
  }
});
