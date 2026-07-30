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
    /** Deployed app origin, e.g. "https://fcheck.in". Used for links in alert emails. */
    APP_BASE_URL?: string;
    /** Transactional-email HTTP API endpoint for subscriber notifications. */
    EMAIL_API_URL?: string;
    /** Bearer token for EMAIL_API_URL. Email is inert if unset. */
    EMAIL_API_TOKEN?: string;
    /** From address for notification emails, e.g. "fcheck.in <noreply@fcheck.in>". */
    EMAIL_FROM?: string;
    /** Workers AI — claim embeddings for semantic matching. Absent → hash + FTS. */
    AI?: Ai;
    /** Vectorize index of claim embeddings. Must be provisioned; see docs/setup.md. */
    CLAIM_VECTORS?: VectorizeIndex;
    /** WhatsApp Business Cloud API — the bot channel is inert without these. */
    WHATSAPP_ACCESS_TOKEN?: string;
    WHATSAPP_PHONE_NUMBER_ID?: string;
    /** Shared value we echo during Meta's webhook verification handshake. */
    WHATSAPP_VERIFY_TOKEN?: string;
    /** App secret, for validating inbound X-Hub-Signature-256. */
    WHATSAPP_APP_SECRET?: string;
    /** Graph API version override; defaults to v21.0. */
    WHATSAPP_API_VERSION?: string;
    /** Telegram Bot API token (from BotFather) — the bot channel is inert without it. */
    TELEGRAM_BOT_TOKEN?: string;
    /** Secret we set on setWebhook and check on every inbound X-Telegram-Bot-Api-Secret-Token. */
    TELEGRAM_WEBHOOK_SECRET?: string;
  }
}

interface Env extends Cloudflare.Env {}

declare namespace App {
  interface Locals {
    /** Set by middleware on admin routes; absent everywhere else. */
    admin?: import('./lib/types').AdminUser;
  }
}
