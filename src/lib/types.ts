/**
 * Shared domain types.
 *
 * These mirror the Enumerated Values table in wireframes/data-model.html and
 * the CHECK constraints in migrations/0001_init.sql. If you change one, change
 * all three.
 */

/** Response TYPE 1–4, in hierarchy order. First match wins. */
export type SourceType = 'original' | 'external' | 'preliminary' | 'submitted';

/** submitted → processing → draft → under_review → published | rejected */
export type ClaimStatus = 'processing' | 'draft' | 'under_review' | 'published' | 'rejected';

export type Verdict = 'TRUE' | 'FALSE' | 'MISLEADING' | 'UNVERIFIABLE' | 'OUTDATED' | 'SATIRE';

export type ReportType = 'original' | 'external' | 'preliminary';

export type Channel = 'web' | 'whatsapp' | 'telegram' | 'email' | 'extension' | 'api';

export type NotifyVia = 'email' | 'whatsapp' | 'telegram' | 'web_push';

export type FactCheckerTier = 1 | 2;

/** Maps a source_type to the TYPE number users and docs refer to. */
export const TYPE_NUMBER: Record<SourceType, 1 | 2 | 3 | 4> = {
  original: 1,
  external: 2,
  preliminary: 3,
  submitted: 4,
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  TRUE: 'True',
  FALSE: 'False',
  MISLEADING: 'Misleading',
  UNVERIFIABLE: 'Unverifiable',
  OUTDATED: 'Outdated',
  SATIRE: 'Satire',
};

/** Plain-language meaning, for tooltips and the article page. No jargon. */
export const VERDICT_MEANINGS: Record<Verdict, string> = {
  TRUE: 'Claim is accurate and supported by evidence',
  FALSE: 'Claim is factually incorrect',
  MISLEADING: 'Claim contains partial truth presented deceptively',
  UNVERIFIABLE: 'Insufficient evidence to confirm or deny',
  OUTDATED: 'Was true at the time but no longer accurate',
  SATIRE: 'Claim originates from a satirical source',
};

// ── Row shapes ────────────────────────────────────────────────

export interface ClaimRow {
  id: string;
  fingerprint: string;
  canonical_text: string;
  source_type: SourceType;
  status: ClaimStatus;
  verdict: Verdict | null;
  confidence: number | null;
  submission_count: number;
  published_at: string | null;
  promoted_from: SourceType | null;
  promoted_at: string | null;
  last_rechecked_at: string | null;
  created_at: string;
}

export interface ReportRow {
  id: string;
  claim_id: string;
  report_type: ReportType;
  slug: string | null;
  headline: string;
  summary: string;
  body: string;
  evidence: string; // JSON — parse with parseEvidence()
  tags: string; // JSON string[]
  country: string | null;
  language: string | null;
  external_url: string | null;
  fact_checker_id: string | null;
  published_by: string | null;
  published_at: string;
}

export interface FactCheckerRow {
  id: string;
  name: string;
  slug: string;
  tier: FactCheckerTier;
  countries: string; // JSON string[]
  languages: string; // JSON string[]
  api_endpoint: string | null;
  homepage_url: string;
  active: number;
}

/**
 * A single piece of cited evidence.
 *
 * Editorial rule: every AI-generated assertion must carry a source. An evidence
 * item without a `url` is dropped rather than displayed.
 */
export interface EvidenceItem {
  source: string;
  url: string;
  snippet: string;
  date?: string;
}

export function parseEvidence(json: string | null | undefined): EvidenceItem[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    // Unsourced items never reach the user.
    return parsed.filter(
      (e): e is EvidenceItem =>
        e && typeof e.source === 'string' && typeof e.url === 'string' && e.url.length > 0
    );
  } catch {
    return [];
  }
}

export function parseTags(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

// ── API contract ──────────────────────────────────────────────

/** What POST /api/v1/check accepts. Any combination of fields is valid. */
export interface CheckRequest {
  text?: string;
  urls?: string[];
  /** Media is accepted and recorded, but not yet analysed — see deepCheck. */
  files?: { name: string; type: string; size: number }[];
  channel?: Channel;
  countries?: string[];
  languages?: string[];
}

/** What POST /api/v1/check returns. */
export interface CheckResponse {
  claim_id: string;
  source_type: SourceType;
  type: 1 | 2 | 3 | 4;
  status: ClaimStatus;
  verdict: Verdict | null;
  confidence: number | null;
  canonical_text: string;
  headline: string | null;
  summary: string | null;
  evidence: EvidenceItem[];
  attribution: {
    name: string;
    url: string;
    tier: FactCheckerTier | null;
    published_at: string | null;
  } | null;
  /** True for TYPE 3 — the UI must label this provisional. */
  provisional: boolean;
  cached: boolean;
  url: string;
  notes: string[];
}
