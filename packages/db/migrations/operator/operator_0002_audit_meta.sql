-- operator: which FISCO AuditLog the stored entries belong to (a redeployed consortium starts a new chain).
CREATE TABLE IF NOT EXISTS audit_meta (
  name VARCHAR(32) NOT NULL PRIMARY KEY,
  value VARCHAR(100) NOT NULL
);
