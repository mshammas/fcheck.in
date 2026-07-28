/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

/**
 * Binding types for `DB` and `ENVIRONMENT` are generated from wrangler.jsonc by
 * `npm run cf-typegen`. Secrets aren't in that file — by design — so they're
 * declared here.
 */
declare namespace Cloudflare {
  interface Env {
    /** Claim extraction and AI deep-check. */
    ANTHROPIC_API_KEY?: string;
    /** External fact-checker search (TYPE 2). */
    GOOGLE_FACT_CHECK_API_KEY?: string;
  }
}

interface Env extends Cloudflare.Env {}
