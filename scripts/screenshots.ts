/**
 * Screenshots of the demo for the README, through Chrome's DevTools protocol (no extra dependencies):
 * fixed viewport, light or dark, reduced motion so every section is fully drawn.
 *
 * Run the demo locally first (node scripts/demo.ts, then CLOUDFLARE_ENV=demo npx vite --port 5174), then:
 *   node scripts/screenshots.ts [base-url]      → docs/screenshots/*.png
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5174';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const PORT = 9333;

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = mkdtempSync(join(tmpdir(), 'finance-shots-'));
const chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'], {
  stdio: 'ignore',
});

try {
  let target: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      .then((r) => r.json() as Promise<{ type: string; webSocketDebuggerUrl: string }[]>)
      .then((list) => list.find((t) => t.type === 'page'))
      .catch(() => undefined);
  }
  if (!target) throw new Error('Chrome did not start');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map<number, (result: Record<string, unknown>) => void>();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: Record<string, unknown> };
    if (message.id !== undefined) pending.get(message.id)?.(message.result ?? {});
  });
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve) => {
      pending.set(++id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });

  mkdirSync(OUT, { recursive: true });
  for (const shot of SHOTS) {
    await send('Emulation.setDeviceMetricsOverride', { width: shot.width, height: shot.height, deviceScaleFactor: 2, mobile: shot.width < 600 });
    await send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-color-scheme', value: shot.dark ? 'dark' : 'light' },
        { name: 'prefers-reduced-motion', value: 'reduce' },
      ],
    });
    await send('Page.navigate', { url: `${BASE}/?shot=${shot.name}${shot.route}` });
    await sleep(3500);
    if (shot.scrollTo) {
      await send('Runtime.evaluate', {
        expression: `(() => { const h = [...document.querySelectorAll('h2')].find((e) => e.textContent === ${JSON.stringify(shot.scrollTo)}); if (h) window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 80); })()`,
      });
      await sleep(600);
    }
    const { data } = (await send('Page.captureScreenshot', { format: 'png' })) as { data: string };
    writeFileSync(`${OUT}${shot.name}.png`, Buffer.from(data, 'base64'));
    console.log(`docs/screenshots/${shot.name}.png`);
  }
  socket.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
