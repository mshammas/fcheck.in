-- Candidates an admin has dismissed from the trending queue "for this instance".
--
-- Ignoring is deliberately not permanent. The watermark is the claim's
-- submission_count at the moment it was ignored; the candidate stays hidden
-- while its count stays at or below that watermark, and resurfaces the moment a
-- fresh submission of the same story pushes the count higher (see
-- incrementSubmissionCount in src/lib/db/claims.ts). So "ignore" means "not now"
-- — the next person to report the same story brings it back to the queue.
--
-- claim_id is the primary key so re-ignoring simply moves the watermark up to
-- the current count (upsert), rather than stacking rows.
CREATE TABLE trending_ignores (
  claim_id          TEXT PRIMARY KEY REFERENCES claims (id),
  ignored_at_count  INTEGER NOT NULL,
  ignored_by        TEXT NOT NULL REFERENCES admin_users (id),
  ignored_at        TEXT NOT NULL
);

-- Widen audit_log.action to record the new 'ignore_trending' decision. SQLite
-- can't alter a CHECK constraint in place, so rebuild the table and copy the
-- existing rows across (no FKs point at audit_log, so this is a plain swap).
CREATE TABLE audit_log_new (
  id            TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES admin_users (id),
  action        TEXT NOT NULL CHECK (action IN ('publish', 'reject', 'edit', 'pin', 'unpin', 'approve_trending', 'ignore_trending', 'remove_trending')),
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('claim', 'report', 'trending_card')),
  entity_id     TEXT NOT NULL,
  diff          TEXT,
  created_at    TEXT NOT NULL
);
INSERT INTO audit_log_new SELECT id, admin_user_id, action, entity_type, entity_id, diff, created_at FROM audit_log;
DROP TABLE audit_log;
ALTER TABLE audit_log_new RENAME TO audit_log;
CREATE INDEX idx_audit_admin_user_id ON audit_log (admin_user_id);
CREATE INDEX idx_audit_entity_type   ON audit_log (entity_type);
CREATE INDEX idx_audit_created_at    ON audit_log (created_at);
