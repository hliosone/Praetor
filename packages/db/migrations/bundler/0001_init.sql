-- Bundler (D22): accounts the paymaster may sponsor, submitted userOps, refused-op counters for rate limits.
CREATE TABLE IF NOT EXISTS accounts (
  address CHAR(42) NOT NULL PRIMARY KEY,
  registered_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS userops (
  user_op_hash CHAR(66) NOT NULL PRIMARY KEY,
  sender CHAR(42) NOT NULL,
  validator VARCHAR(16) NOT NULL,
  tx_hash CHAR(66) NULL,
  success BOOLEAN NULL,
  reasons JSON NOT NULL,
  refusal_log_tx CHAR(66) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX userops_sender (sender)
);
CREATE TABLE IF NOT EXISTS refusals (
  account CHAR(42) NOT NULL,
  day INT NOT NULL,
  count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (account, day)
);
