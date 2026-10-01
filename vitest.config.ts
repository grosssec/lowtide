import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so engine tests run in plain Node, without the Cloudflare plugin.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
