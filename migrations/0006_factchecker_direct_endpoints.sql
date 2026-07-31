-- Direct fact-check-site search — the fallback beneath the Google aggregator.
--
-- When the Google Fact Check Tools API returns nothing for a claim, the pipeline
-- queries the sources themselves (no AI, no API key). Two config fields drive it:
--
--   api_endpoint  a source's RSS/Atom feed URL   (feed adapter — preferred)
--   search_url    a source's HTML search page,     (search-scrape adapter —
--                 with a `{q}` placeholder          last resort, best-effort)
--
-- Both are optional per source: a source with neither stays Google-only, so this
-- is inert until populated, matching the repo's "configure to enable" convention.

ALTER TABLE fact_checkers ADD COLUMN search_url TEXT;

-- Seed the feeds verified to serve a standard RSS/Atom document to a plain HTTP
-- client. Others are intentionally left NULL — many fact-checkers render search
-- (and some feeds) client-side, which a fetch can't read; an admin can add a
-- working feed or a server-rendered search_url for those at runtime.
UPDATE fact_checkers SET api_endpoint = 'https://fullfact.org/feed/all/'  WHERE id = 'fc-fullfact';
UPDATE fact_checkers SET api_endpoint = 'https://africacheck.org/feed'     WHERE id = 'fc-africacheck';
UPDATE fact_checkers SET api_endpoint = 'https://www.factcheck.org/feed/'  WHERE id = 'fc-factcheckorg';
UPDATE fact_checkers SET api_endpoint = 'https://www.politifact.com/rss/all/' WHERE id = 'fc-politifact';
