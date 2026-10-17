-- operator (spec 05): the audit entries whose hashes are on the FISCO AuditLog, and the watchers' cursors.
CREATE TABLE IF NOT EXISTS audit_entries (
  seq INT NOT NULL PRIMARY KEY,
  source_key VARCHAR(100) NOT NULL UNIQUE,
  account CHAR(42) NOT NULL,
  at_ms BIGINT NOT NULL,
  entry MEDIUMTEXT NOT NULL,
  ref_id CHAR(66) NOT NULL,
  state VARCHAR(10) NOT NULL,
  INDEX audit_account (account, at_ms)
);
CREATE TABLE IF NOT EXISTS audit_cursors (
  name VARCHAR(32) NOT NULL PRIMARY KEY,
  block BIGINT NOT NULL
);
