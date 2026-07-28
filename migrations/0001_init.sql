-- fcheck.in — initial schema
-- Source of truth: wireframes/data-model.html. Column names, types, nullability
-- and indexes match that document. Do not drift from it without updating it too.

-- ─────────────────────────────────────────────────────────────
-- claims — the central entity. Everything else references it.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE claims (
  id                TEXT PRIMARY KEY,
  fingerprint       TEXT NOT NULL,
  canonical_text    TEXT NOT NULL,
  source_type       TEXT NOT NULL CHECK (source_type IN ('original', 'external', 'preliminary', 'submitted')),
  status            TEXT NOT NULL CHECK (status IN ('processing', 'draft', 'under_review', 'published', 'rejected')),
  verdict           TEXT CHECK (verdict IS NULL OR verdict IN ('TRUE', 'FALSE', 'MISLEADING', 'UNVERIFIABLE', 'OUTDATED', 'SATIRE')),
  confidence        INTEGER CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  submission_count  INTEGER NOT NULL DEFAULT 1,
  published_at      TEXT,
  promoted_from     TEXT,
  promoted_at       TEXT,
  last_rechecked_at TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX idx_claims_fingerprint   ON claims (fingerprint);
CREATE INDEX idx_claims_status        ON claims (status);
CREATE INDEX idx_claims_published_at  ON claims (published_at);

-- ─────────────────────────────────────────────────────────────
-- reports — published articles (TYPE 1 original, TYPE 2 external, TYPE 3 draft)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE reports (
  id              TEXT PRIMARY KEY,
  claim_id        TEXT NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  report_type     TEXT NOT NULL CHECK (report_type IN ('original', 'external', 'preliminary')),
  slug            TEXT UNIQUE,
  headline        TEXT NOT NULL,
  summary         TEXT NOT NULL,
  body            TEXT NOT NULL,
  evidence        TEXT NOT NULL DEFAULT '[]',  -- JSON array of {source, url, snippet, date}
  tags            TEXT NOT NULL DEFAULT '[]',  -- JSON array of category strings
  country         TEXT,
  language        TEXT,
  external_url    TEXT,
  fact_checker_id TEXT REFERENCES fact_checkers (id),
  published_by    TEXT REFERENCES admin_users (id),
  published_at    TEXT NOT NULL
);

CREATE INDEX idx_reports_claim_id     ON reports (claim_id);
CREATE INDEX idx_reports_report_type  ON reports (report_type);
CREATE INDEX idx_reports_published_at ON reports (published_at);
CREATE INDEX idx_reports_country      ON reports (country);
CREATE INDEX idx_reports_language     ON reports (language);

-- ─────────────────────────────────────────────────────────────
-- submissions — one row per user input, many per claim
-- ─────────────────────────────────────────────────────────────
CREATE TABLE submissions (
  id              TEXT PRIMARY KEY,
  claim_id        TEXT NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('web', 'whatsapp', 'telegram', 'email', 'extension', 'api')),
  raw_input       TEXT NOT NULL,  -- JSON: original submitted content (text, URLs, file refs)
  user_identifier TEXT,           -- anonymised phone/email hash; null for anonymous web
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_submissions_claim_id   ON submissions (claim_id);
CREATE INDEX idx_submissions_channel    ON submissions (channel);
CREATE INDEX idx_submissions_created_at ON submissions (created_at);

-- ─────────────────────────────────────────────────────────────
-- subscribers — notify on promotion
-- ─────────────────────────────────────────────────────────────
CREATE TABLE subscribers (
  id          TEXT PRIMARY KEY,
  claim_id    TEXT NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  notify_via  TEXT NOT NULL CHECK (notify_via IN ('email', 'whatsapp', 'telegram', 'web_push')),
  contact     TEXT NOT NULL,
  notified_at TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_subscribers_claim_id   ON subscribers (claim_id);
CREATE INDEX idx_subscribers_notify_via ON subscribers (notify_via);

-- ─────────────────────────────────────────────────────────────
-- fact_checkers — the authenticated fact-checker network
-- ─────────────────────────────────────────────────────────────
CREATE TABLE fact_checkers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  tier         INTEGER NOT NULL CHECK (tier IN (1, 2)),
  countries    TEXT NOT NULL DEFAULT '[]',  -- JSON array of ISO 3166 codes
  languages    TEXT NOT NULL DEFAULT '[]',  -- JSON array of BCP 47 tags
  api_endpoint TEXT,
  homepage_url TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE INDEX idx_fact_checkers_tier   ON fact_checkers (tier);
CREATE INDEX idx_fact_checkers_active ON fact_checkers (active);

-- ─────────────────────────────────────────────────────────────
-- trending_cards — admin-managed homepage queue
-- ─────────────────────────────────────────────────────────────
CREATE TABLE trending_cards (
  id             TEXT PRIMARY KEY,
  claim_id       TEXT NOT NULL REFERENCES claims (id) ON DELETE CASCADE,
  report_id      TEXT NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  pinned         INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  queue_position INTEGER NOT NULL DEFAULT 0,
  expires_at     TEXT,  -- null when pinned; 48h from approval otherwise
  approved_by    TEXT NOT NULL REFERENCES admin_users (id),
  approved_at    TEXT NOT NULL
);

CREATE INDEX idx_trending_pinned     ON trending_cards (pinned);
CREATE INDEX idx_trending_expires_at ON trending_cards (expires_at);
CREATE INDEX idx_trending_position   ON trending_cards (queue_position);

-- ─────────────────────────────────────────────────────────────
-- audit_log — every admin action, for editorial transparency
-- ─────────────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES admin_users (id),
  action        TEXT NOT NULL CHECK (action IN ('publish', 'reject', 'edit', 'pin', 'unpin', 'approve_trending', 'remove_trending')),
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('claim', 'report', 'trending_card')),
  entity_id     TEXT NOT NULL,
  diff          TEXT,  -- JSON before/after snapshot for edit actions
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_audit_admin_user_id ON audit_log (admin_user_id);
CREATE INDEX idx_audit_entity_type   ON audit_log (entity_type);
CREATE INDEX idx_audit_created_at    ON audit_log (created_at);

-- ─────────────────────────────────────────────────────────────
-- admin_users — dashboard access
-- ─────────────────────────────────────────────────────────────
CREATE TABLE admin_users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('super_admin', 'editor', 'reviewer')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_login_at TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_admin_users_email  ON admin_users (email);
CREATE INDEX idx_admin_users_role   ON admin_users (role);
CREATE INDEX idx_admin_users_active ON admin_users (active);
