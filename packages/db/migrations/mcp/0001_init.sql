-- mcp (spec 05): per-account agent bearers and OAuth grants (hashes only), payee names given by the owner.
CREATE TABLE IF NOT EXISTS agent_tokens (
  account CHAR(42) NOT NULL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS payee_labels (
  account CHAR(42) NOT NULL,
  address CHAR(42) NOT NULL,
  label VARCHAR(64) NOT NULL,
  PRIMARY KEY (account, address)
);
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id VARCHAR(64) NOT NULL PRIMARY KEY,
  client_secret_hash CHAR(64) NULL,
  client_name VARCHAR(64) NULL,
  redirect_uris TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash CHAR(64) NOT NULL PRIMARY KEY,
  client_id VARCHAR(64) NOT NULL,
  account CHAR(42) NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge VARCHAR(128) NOT NULL,
  scope VARCHAR(64) NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  kind VARCHAR(8) NOT NULL,
  client_id VARCHAR(64) NOT NULL,
  account CHAR(42) NOT NULL,
  scope VARCHAR(64) NOT NULL,
  family CHAR(64) NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  INDEX oauth_tokens_family (family),
  INDEX oauth_tokens_account (account)
);
