/**
 * A tiny driver for headless Chrome over the DevTools protocol (no Puppeteer or Playwright), used by the scripts
 * that render screenshots, icons and social images. Chrome comes from CHROME_PATH or the usual install location.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((path): path is string => Boolean(path));

export interface Page {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  viewport(width: number, height: number, options?: { scale?: number; mobile?: boolean; transparent?: boolean }): Promise<void>;
  media(options: { dark?: boolean; reducedMotion?: boolean }): Promise<void>;
  open(url: string, waitMs?: number): Promise<void>;
  evaluate(expression: string): Promise<void>;
  png(): Promise<Buffer>;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withChrome<T>(work: (page: Page) => Promise<T>): Promise<T> {
  const chromePath = CANDIDATES.find((path) => existsSync(path));
  if (!chromePath) throw new Error('Chrome not found: set CHROME_PATH');
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = mkdtempSync(join(tmpdir(), 'lowtide-chrome-'));
  const chrome = spawn(
    chromePath,
    ['--headless=new', '--hide-scrollbars', '--no-first-run', '--allow-file-access-from-files', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'],
    { stdio: 'ignore' },
  );
  try {
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 60 && !target; i++) {
      await sleep(200);
      target = await fetch(`http://127.0.0.1:${port}/json/list`)
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
    const send: Page['send'] = (method, params = {}) =>
      new Promise((resolve) => {
        pending.set(++id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      });

    const page: Page = {
      send,
      async viewport(width, height, { scale = 1, mobile = false, transparent = false } = {}) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
        await send('Emulation.setDefaultBackgroundColorOverride', transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
      },
      async media({ dark = false, reducedMotion = true }) {
        await send('Emulation.setEmulatedMedia', {
          features: [
            { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' },
            { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' },
          ],
        });
      },
      async open(url, waitMs = 800) {
        await send('Page.navigate', { url });
        await sleep(waitMs);
      },
      async evaluate(expression) {
        await send('Runtime.evaluate', { expression, awaitPromise: true });
      },
      async png() {
        const { data } = (await send('Page.captureScreenshot', { format: 'png' })) as { data: string };
        return Buffer.from(data, 'base64');
      },
    };
    const result = await work(page);
    socket.close();
    return result;
  } finally {
    chrome.kill();
    await sleep(250);
    rmSync(profile, { recursive: true, force: true });
  }
}
