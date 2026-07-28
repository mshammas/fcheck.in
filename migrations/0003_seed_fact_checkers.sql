-- The authenticated fact-checker network, as listed in CLAUDE.md.
-- Tier 1 = global, Tier 2 = regional. Admins can add/remove/re-tier at runtime;
-- this is the starting set.
--
-- api_endpoint is null for every source below: they are all indexed by the
-- Google Fact Check Tools API via their ClaimReview markup, which is the first
-- call in every external search. A direct endpoint is only set when a source
-- offers one that we query separately.

INSERT INTO fact_checkers (id, name, slug, tier, countries, languages, api_endpoint, homepage_url, active) VALUES
  -- ── Tier 1 — Global ──────────────────────────────────────────
  ('fc-snopes',      'Snopes',             'snopes',       1, '["US"]',                          '["en"]',            NULL, 'https://www.snopes.com',                    1),
  ('fc-reuters',     'Reuters Fact Check', 'reuters',      1, '["GB","US"]',                     '["en"]',            NULL, 'https://www.reuters.com/fact-check',        1),
  ('fc-ap',          'AP Fact Check',      'ap',           1, '["US"]',                          '["en"]',            NULL, 'https://apnews.com/hub/ap-fact-check',      1),
  ('fc-afp',         'AFP Fact Check',     'afp',          1, '["FR","US","GB","IN","ZA","BR"]', '["en","fr","es","pt","ar"]', NULL, 'https://factcheck.afp.com',       1),
  ('fc-politifact',  'PolitiFact',         'politifact',   1, '["US"]',                          '["en"]',            NULL, 'https://www.politifact.com',                1),
  ('fc-factcheckorg','FactCheck.org',      'factcheck-org',1, '["US"]',                          '["en"]',            NULL, 'https://www.factcheck.org',                 1),
  ('fc-fullfact',    'Full Fact',          'full-fact',    1, '["GB"]',                          '["en"]',            NULL, 'https://fullfact.org',                      1),
  ('fc-bbc',         'BBC Reality Check',  'bbc-reality-check', 1, '["GB"]',                     '["en"]',            NULL, 'https://www.bbc.co.uk/news/reality_check',  1),

  -- ── Tier 2 — Regional ────────────────────────────────────────
  ('fc-boom',        'Boom Live',          'boom-live',    2, '["IN","BD","MM"]',                '["en","hi","bn"]',  NULL, 'https://www.boomlive.in',                   1),
  ('fc-altnews',     'Alt News',           'alt-news',     2, '["IN"]',                          '["en","hi"]',       NULL, 'https://www.altnews.in',                    1),
  ('fc-factly',      'Factly',             'factly',       2, '["IN"]',                          '["en","te","hi"]',  NULL, 'https://factly.in',                         1),
  ('fc-africacheck', 'Africa Check',       'africa-check', 2, '["ZA","NG","KE","SN"]',           '["en","fr"]',       NULL, 'https://africacheck.org',                   1),
  ('fc-chequeado',   'Chequeado',          'chequeado',    2, '["AR","CL","CO","MX","PE"]',      '["es"]',            NULL, 'https://chequeado.com',                     1),
  ('fc-maldita',     'Maldita',            'maldita',      2, '["ES"]',                          '["es"]',            NULL, 'https://maldita.es',                        1),
  ('fc-correctiv',   'Correctiv',          'correctiv',    2, '["DE"]',                          '["de"]',            NULL, 'https://correctiv.org/faktencheck',         1);
