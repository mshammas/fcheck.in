-- Archive search for the direct fact-check-site fallback.
--
-- Feeds (migration 0006) only surface a source's *recent* articles, so an older
-- debunked story is out of reach. A source's own search page covers its whole
-- archive — the scrape adapter GETs `search_url` with `{q}` substituted and pulls
-- the on-site result links.
--
-- Only sources whose search page renders results in the initial HTML to a plain
-- HTTP client are seeded here (verified July 2026). Others render search
-- client-side or block bots (e.g. Factly 403s, Snopes 402s, Full Fact is
-- JS-rendered) — an admin can add a working template for those at runtime.
UPDATE fact_checkers SET search_url = 'https://www.altnews.in/?s={q}'         WHERE id = 'fc-altnews';
UPDATE fact_checkers SET search_url = 'https://www.boomlive.in/search?search={q}' WHERE id = 'fc-boom';
UPDATE fact_checkers SET search_url = 'https://www.politifact.com/search/?q={q}'  WHERE id = 'fc-politifact';
