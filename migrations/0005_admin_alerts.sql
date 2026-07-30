-- fcheck.in — admin alert dedup state
-- Source of truth: wireframes/data-model.html. Keep in sync if the schema drifts.

-- ─────────────────────────────────────────────────────────────
-- admin_alert_state — one row per alert kind, so the alerts job does not
-- re-notify admins about the same backlog on every scheduled run.
--
--   new_drafts   watermark = the created_at of the newest draft already
--                alerted about; a run only alerts on drafts newer than it.
--   low_trending watermark = 'low' while we have alerted and the queue is
--                still low; cleared to 'ok' once it recovers, so the next
--                drop re-alerts (edge-triggered, no recovery email, no spam).
--
-- `watermark` advances only after a send actually lands, mirroring the
-- subscriber notified_at contract, so an inert email transport leaves the
-- alert pending until the keys are set.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE admin_alert_state (
  kind            TEXT PRIMARY KEY CHECK (kind IN ('new_drafts', 'low_trending')),
  watermark       TEXT,
  last_alerted_at TEXT,
  updated_at      TEXT NOT NULL
);
