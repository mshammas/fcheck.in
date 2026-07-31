// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// fcheck.in — Astro on Cloudflare Workers (static assets + SSR in one deployment).
// Workers rather than Pages so the background jobs in wireframes/pipeline.html
// (re-check, crawler, trending expiry) can run as cron triggers on the same worker.
export default defineConfig({
  site: 'https://fcheck.in',
  output: 'server',
  adapter: cloudflare({
    imageService: 'compile',
  }),
  vite: {
    ssr: {
      external: ['node:crypto'],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: () => 'app',
        },
      },
    },
  },
});
