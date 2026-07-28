-- Demo data — one claim per response TYPE, so every UI state is reachable
-- before the pipeline is wired up. Safe to delete once real claims exist.

INSERT INTO admin_users (id, name, email, role, active, last_login_at, created_at) VALUES
  ('admin-001', 'fcheck.in Editorial', 'editorial@fcheck.in', 'super_admin', 1, NULL, '2026-07-01T09:00:00Z');

-- ═════════════════════════════════════════════════════════════
-- TYPE 1 — fcheck.in original, reviewed and published
-- ═════════════════════════════════════════════════════════════
INSERT INTO claims (id, fingerprint, canonical_text, source_type, status, verdict, confidence, submission_count, published_at, promoted_from, promoted_at, last_rechecked_at, created_at) VALUES
  ('claim-demo-1', 'seed-demo-1', 'Drinking warm water cures viral infections.', 'original', 'published', 'FALSE', 96, 214, '2026-07-14T11:20:00Z', 'preliminary', '2026-07-14T11:20:00Z', NULL, '2026-07-12T08:05:00Z');

INSERT INTO reports (id, claim_id, report_type, slug, headline, summary, body, evidence, tags, country, language, external_url, fact_checker_id, published_by, published_at) VALUES
  ('report-demo-1', 'claim-demo-1', 'original', 'warm-water-does-not-cure-viral-infections',
   'Warm water does not cure viral infections',
   'Warm water has no antiviral properties. It may soothe a sore throat, but it cannot kill viruses or cure an infection.',
   '## What is being claimed

A message circulating widely on WhatsApp claims that drinking warm water at regular intervals "flushes out" viruses before they reach the lungs, and that this can cure a viral infection.

## What the evidence shows

Viruses replicate inside host cells. Once an infection is established, drinking any liquid — at any temperature — cannot reach or destroy those cells. Water passes into the digestive tract, not the respiratory tract where respiratory viruses replicate.

Staying hydrated is genuinely useful when you are unwell: it helps with fever, and warm liquids can ease throat discomfort. Neither of those is a cure, and neither prevents a virus from spreading in the body.

## Verdict

The claim is false. Warm water provides symptomatic comfort only. It has no antiviral effect and does not cure infection.',
   '[{"source":"World Health Organization","url":"https://www.who.int/emergencies/diseases/novel-coronavirus-2019/advice-for-public/myth-busters","snippet":"Drinking water does not prevent or cure viral infection.","date":"2026-03-02"},{"source":"NHS — Treating a cold","url":"https://www.nhs.uk/conditions/common-cold/","snippet":"There is no cure for a viral cold; treatment eases symptoms only.","date":"2026-01-18"}]',
   '["Health","Viral message"]', 'IN', 'en', NULL, NULL, 'admin-001', '2026-07-14T11:20:00Z');

-- ═════════════════════════════════════════════════════════════
-- TYPE 2 — external authenticated fact-checker, attributed
-- ═════════════════════════════════════════════════════════════
INSERT INTO claims (id, fingerprint, canonical_text, source_type, status, verdict, confidence, submission_count, published_at, promoted_from, promoted_at, last_rechecked_at, created_at) VALUES
  ('claim-demo-2', 'seed-demo-2', 'A viral video shows a newly built bridge collapsing in Bihar in July 2026.', 'external', 'published', 'MISLEADING', 88, 47, '2026-07-22T15:40:00Z', 'submitted', '2026-07-22T15:40:00Z', NULL, '2026-07-21T19:12:00Z');

INSERT INTO reports (id, claim_id, report_type, slug, headline, summary, body, evidence, tags, country, language, external_url, fact_checker_id, published_by, published_at) VALUES
  -- No slug: only fcheck.in originals get an /article/ URL. External reports
  -- are read on their TYPE 2 page, which links out to the original publisher.
  ('report-demo-2', 'claim-demo-2', 'external', NULL,
   'Video of bridge collapse is from 2022, not a new structure',
   'The footage is genuine but predates the claim by four years. It shows a bridge that collapsed during construction in 2022, not a newly completed structure.',
   'Boom Live traced the footage to news reports published in June 2022. The bridge in the video was still under construction when a span gave way; it had not been opened to traffic. The claim that this shows a newly built and inaugurated bridge failing is not supported by the source material.',
   '[{"source":"Boom Live","url":"https://www.boomlive.in","snippet":"Reverse image search matched the footage to June 2022 news coverage of a bridge under construction.","date":"2026-07-22"}]',
   '["Infrastructure","Old video"]', 'IN', 'en', 'https://www.boomlive.in', 'fc-boom', NULL, '2026-07-22T15:40:00Z');

-- ═════════════════════════════════════════════════════════════
-- TYPE 3 — AI preliminary. Draft queued for admin. NOT published.
-- ═════════════════════════════════════════════════════════════
INSERT INTO claims (id, fingerprint, canonical_text, source_type, status, verdict, confidence, submission_count, published_at, promoted_from, promoted_at, last_rechecked_at, created_at) VALUES
  ('claim-demo-3', 'seed-demo-3', 'A new government rule requires all bank accounts to be re-verified in person before August 2026 or they will be frozen.', 'preliminary', 'draft', 'MISLEADING', 71, 63, NULL, NULL, NULL, '2026-07-27T06:00:00Z', '2026-07-26T21:33:00Z');

INSERT INTO reports (id, claim_id, report_type, slug, headline, summary, body, evidence, tags, country, language, external_url, fact_checker_id, published_by, published_at) VALUES
  ('report-demo-3', 'claim-demo-3', 'preliminary', NULL,
   'Re-verification rule applies to a limited set of accounts, not all of them',
   'A periodic KYC update requirement does exist, but it applies on a risk-based schedule to specific accounts — not to every account, and not with a blanket August deadline.',
   'Preliminary analysis. Regulator guidance describes periodic KYC updating on a risk-based cycle, with the interval depending on account risk category. Nothing in the published guidance sets a single universal deadline, and re-verification can generally be completed remotely rather than in person. The viral message appears to compress a real but narrower requirement into a universal one.

This analysis is provisional and awaiting editorial review.',
   '[{"source":"Reserve Bank of India — Master Direction on KYC","url":"https://www.rbi.org.in","snippet":"Periodic updation shall be carried out at least once every two/eight/ten years for high/medium/low risk customers respectively.","date":"2026-05-10"}]',
   '["Finance","Government policy"]', 'IN', 'en', NULL, NULL, NULL, '2026-07-27T06:00:00Z');

-- ═════════════════════════════════════════════════════════════
-- TYPE 4 — submitted, insufficient evidence. No verdict shown.
-- ═════════════════════════════════════════════════════════════
INSERT INTO claims (id, fingerprint, canonical_text, source_type, status, verdict, confidence, submission_count, published_at, promoted_from, promoted_at, last_rechecked_at, created_at) VALUES
  ('claim-demo-4', 'seed-demo-4', 'A factory in Coimbatore laid off 400 workers overnight last week without notice.', 'submitted', 'processing', NULL, NULL, 3, NULL, NULL, NULL, '2026-07-28T04:00:00Z', '2026-07-27T22:47:00Z');

-- ═════════════════════════════════════════════════════════════
-- Submissions — feeds submission_count and the admin queue sort
-- ═════════════════════════════════════════════════════════════
INSERT INTO submissions (id, claim_id, channel, raw_input, user_identifier, created_at) VALUES
  ('sub-demo-1', 'claim-demo-1', 'whatsapp', '{"text":"Forwarded many times: drink warm water every 15 min, it kills the virus"}', NULL, '2026-07-12T08:05:00Z'),
  ('sub-demo-2', 'claim-demo-2', 'web',      '{"text":"Is this bridge collapse video real?","urls":["https://example.com/post/123"]}', NULL, '2026-07-21T19:12:00Z'),
  ('sub-demo-3', 'claim-demo-3', 'whatsapp', '{"text":"URGENT: all bank accounts must be re-verified before August or they freeze"}', NULL, '2026-07-26T21:33:00Z'),
  ('sub-demo-4', 'claim-demo-4', 'web',      '{"text":"Did a Coimbatore factory lay off 400 people overnight?"}', NULL, '2026-07-27T22:47:00Z');

-- ═════════════════════════════════════════════════════════════
-- Trending queue — only TYPE 1 and TYPE 2 are eligible
-- ═════════════════════════════════════════════════════════════
INSERT INTO trending_cards (id, claim_id, report_id, pinned, queue_position, expires_at, approved_by, approved_at) VALUES
  ('trend-demo-1', 'claim-demo-1', 'report-demo-1', 1, 0, NULL,                   'admin-001', '2026-07-14T12:00:00Z'),
  ('trend-demo-2', 'claim-demo-2', 'report-demo-2', 0, 1, '2026-07-30T15:40:00Z', 'admin-001', '2026-07-28T15:40:00Z');
