-- Full-text search over published reports. Backs pipeline stage 4
-- (fcheck.in database search → TYPE 1) and GET /api/v1/search.
--
-- External-content FTS5 table: the index stores no copy of the text, it points
-- back at reports via rowid. Triggers keep it in sync on write.

CREATE VIRTUAL TABLE reports_fts USING fts5 (
  headline,
  summary,
  body,
  content='reports',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER reports_fts_insert AFTER INSERT ON reports BEGIN
  INSERT INTO reports_fts (rowid, headline, summary, body)
  VALUES (new.rowid, new.headline, new.summary, new.body);
END;

CREATE TRIGGER reports_fts_delete AFTER DELETE ON reports BEGIN
  INSERT INTO reports_fts (reports_fts, rowid, headline, summary, body)
  VALUES ('delete', old.rowid, old.headline, old.summary, old.body);
END;

CREATE TRIGGER reports_fts_update AFTER UPDATE ON reports BEGIN
  INSERT INTO reports_fts (reports_fts, rowid, headline, summary, body)
  VALUES ('delete', old.rowid, old.headline, old.summary, old.body);
  INSERT INTO reports_fts (rowid, headline, summary, body)
  VALUES (new.rowid, new.headline, new.summary, new.body);
END;

-- Claims are searched by canonical_text too — a claim can exist before any
-- report does (TYPE 3 and TYPE 4), so it needs its own index.
CREATE VIRTUAL TABLE claims_fts USING fts5 (
  canonical_text,
  content='claims',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER claims_fts_insert AFTER INSERT ON claims BEGIN
  INSERT INTO claims_fts (rowid, canonical_text) VALUES (new.rowid, new.canonical_text);
END;

CREATE TRIGGER claims_fts_delete AFTER DELETE ON claims BEGIN
  INSERT INTO claims_fts (claims_fts, rowid, canonical_text)
  VALUES ('delete', old.rowid, old.canonical_text);
END;

CREATE TRIGGER claims_fts_update AFTER UPDATE ON claims BEGIN
  INSERT INTO claims_fts (claims_fts, rowid, canonical_text)
  VALUES ('delete', old.rowid, old.canonical_text);
  INSERT INTO claims_fts (rowid, canonical_text) VALUES (new.rowid, new.canonical_text);
END;
