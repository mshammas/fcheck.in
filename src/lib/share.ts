/**
 * TL;DR share text — the platform-appropriate summaries offered on published
 * report pages.
 *
 * Two sources produce the same `TldrVariants` shape: an AI call scoped strictly
 * to the report (`generateTldr` in ../providers/anthropic.ts) and the pure
 * `fallbackTldr` here, used when the API key is absent or the call fails. The
 * share link itself is appended by the client, never by the model — so a
 * hallucinated URL can't leak into a share.
 *
 * Everything here is pure and unit-tested; the char budgets are enforced on
 * both paths (the model is clipped server-side to the same limits).
 */
import type { Verdict } from './types';
import { VERDICT_LABELS } from './types';

export interface TldrVariants {
  /** Roomy — WhatsApp/Telegram forwards. */
  whatsapp: string;
  /** Tight — must fit a tweet alongside a ~23-char t.co link. */
  twitter: string;
  /** Neutral one-liner for copy-to-clipboard and native share. */
  generic: string;
}

export const TWITTER_MAX = 230;
export const WHATSAPP_MAX = 600;
export const GENERIC_MAX = 200;

const VERDICT_EMOJI: Record<Verdict, string> = {
  TRUE: '✅',
  FALSE: '❌',
  MISLEADING: '⚠️',
  UNVERIFIABLE: '🤔',
  OUTDATED: '🕰️',
  SATIRE: '🎭',
};

export interface TldrInput {
  headline: string;
  summary: string;
  verdict: Verdict | null;
  /** TYPE 1 (fcheck.in original) vs TYPE 2 (attributed external report). */
  attributedTo?: string | null;
}

/** Word-boundary truncation with an ellipsis, never mid-word. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function verdictTag(verdict: Verdict | null): string {
  if (!verdict) return 'Checked';
  return `${VERDICT_EMOJI[verdict]} ${VERDICT_LABELS[verdict]}`;
}

/**
 * Deterministic TL;DRs built only from the report's own fields — no new claims,
 * no extrapolation. This is both the no-key fallback and the shape the AI path
 * must match.
 */
export function fallbackTldr(input: TldrInput): TldrVariants {
  const tag = verdictTag(input.verdict);
  const credit = input.attributedTo ? ` (via ${input.attributedTo})` : '';

  return {
    generic: clip(`${tag}: ${input.headline}`, GENERIC_MAX),
    twitter: clip(`${tag}: ${input.headline}${credit}`, TWITTER_MAX),
    whatsapp: clip(`*${tag}* — fact-checked by fcheck.in${credit}\n\n${input.headline}\n\n${input.summary}`, WHATSAPP_MAX),
  };
}

/** Clamps any TldrVariants (e.g. the AI output) to the per-platform budgets. */
export function clampVariants(v: TldrVariants): TldrVariants {
  return {
    generic: clip(v.generic, GENERIC_MAX),
    twitter: clip(v.twitter, TWITTER_MAX),
    whatsapp: clip(v.whatsapp, WHATSAPP_MAX),
  };
}
