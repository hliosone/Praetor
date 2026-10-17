-- bank-service KYC (spec 05): personal data only in kyc_records.sealed (AES-256-GCM, KYC_ENC_KEY).
CREATE TABLE IF NOT EXISTS bank_identity (
  k VARCHAR(32) NOT NULL PRIMARY KEY,
  v VARCHAR(255) NOT NULL
);
CREATE TABLE IF NOT EXISTS kyc_sessions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_ref VARCHAR(64) NOT NULL,
  account CHAR(42) NOT NULL,
  method VARCHAR(8) NOT NULL,
  state VARCHAR(8) NOT NULL,
  eudi_tx VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX kyc_sessions_user (user_ref)
);
CREATE TABLE IF NOT EXISTS kyc_records (
  user_ref VARCHAR(64) NOT NULL PRIMARY KEY,
  account CHAR(42) NOT NULL,
  method VARCHAR(8) NOT NULL,
  state VARCHAR(10) NOT NULL,
  reason VARCHAR(16) NULL,
  sealed TEXT NULL,
  age_over_18 BOOLEAN NULL,
  jurisdiction CHAR(2) NULL,
  kyc_level INT NULL,
  sanctions_screened CHAR(10) NULL,
  risk_profile VARCHAR(16) NULL,
  user_weid VARCHAR(80) NULL,
  credential MEDIUMTEXT NULL,
  credential_hash VARCHAR(80) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS mandate_drafts (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_ref VARCHAR(64) NOT NULL,
  account CHAR(42) NOT NULL,
  inner_credential MEDIUMTEXT NOT NULL,
  challenge CHAR(66) NOT NULL,
  state VARCHAR(8) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
