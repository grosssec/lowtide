import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { markSvg } from './shared/brand/mark.ts';

/** Puts the Lowtide mark into index.html's splash, so the first paint (before any script) shows the logo. */
function splash(): Plugin {
  return {
    name: 'lowtide-splash',
    transformIndexHtml: (html) => html.replace('<!-- lowtide-splash -->', markSvg({ id: 'lt-boot' })),
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [splash(), react(), tailwindcss(), cloudflare()],
});
