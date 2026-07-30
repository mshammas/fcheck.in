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
    /** Cloudflare Access team domain, e.g. "acme.cloudflareaccess.com". */
    CF_ACCESS_TEAM_DOMAIN?: string;
    /** Access application audience tag — binds tokens to this app. */
    CF_ACCESS_AUD?: string;
    /** Local-only admin identity. Ignored unless ENVIRONMENT is 'development'. */
    ADMIN_DEV_EMAIL?: string;
    /** Shared bearer secret for POST /api/jobs/:job. Jobs are inert if unset. */
    CRON_SECRET?: string;
    /** Transactional-email HTTP API endpoint for subscriber notifications. */
    EMAIL_API_URL?: string;
    /** Bearer token for EMAIL_API_URL. Email is inert if unset. */
    EMAIL_API_TOKEN?: string;
    /** From address for notification emails, e.g. "fcheck.in <noreply@fcheck.in>". */
    EMAIL_FROM?: string;
  }
}

interface Env extends Cloudflare.Env {}

declare namespace App {
  interface Locals {
    /** Set by middleware on admin routes; absent everywhere else. */
    admin?: import('./lib/types').AdminUser;
  }
}
