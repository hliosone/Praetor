-- api (spec 05): users, passkeys, approval requests. No KYC data.
CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  email VARCHAR(200) NOT NULL,
  account CHAR(42) NULL UNIQUE,
  salt_nonce VARCHAR(24) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS passkeys (
  credential_id VARCHAR(255) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  cred_id_hash CHAR(66) NOT NULL,
  x VARCHAR(80) NOT NULL,
  y VARCHAR(80) NOT NULL,
  INDEX passkeys_user (user_id)
);
CREATE TABLE IF NOT EXISTS approval_requests (
  id CHAR(36) NOT NULL PRIMARY KEY,
  account CHAR(42) NOT NULL,
  calls MEDIUMTEXT NOT NULL,
  call_hash CHAR(66) NOT NULL,
  nonce VARCHAR(24) NOT NULL,
  expires_at VARCHAR(24) NOT NULL,
  digest CHAR(66) NOT NULL,
  reason VARCHAR(64) NOT NULL,
  summary VARCHAR(280) NOT NULL,
  state VARCHAR(10) NOT NULL,
  channel VARCHAR(10) NULL,
  register_tx CHAR(66) NULL,
  execute_tx CHAR(66) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX approvals_account (account, state)
);
