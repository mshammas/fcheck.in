import { defineConfig } from 'vitest/config';

/**
 * Unit tests run in plain Node — the modules under test (auth, provider
 * adapters, pure helpers) deliberately avoid the `cloudflare:workers` import,
 * so no Workers pool is needed. D1 and the Anthropic client are passed in as
 * arguments, so tests inject fakes rather than a real runtime.
 *
 * Node 20+ provides global `crypto.subtle`, `atob`, `fetch`, `TextEncoder` —
 * everything the auth verifier uses at runtime on workerd.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
  },
});
