-- Member services (bank, regulator, operator; one database each): staff passkeys that authorise consortium
-- signatures, and whether the one-time enrolment token was used (Q28, D24).
CREATE TABLE IF NOT EXISTS staff_passkeys (
  credential_id VARCHAR(66) NOT NULL PRIMARY KEY,
  x VARCHAR(80) NOT NULL,
  y VARCHAR(80) NOT NULL,
  label TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS staff_settings (
  name VARCHAR(64) NOT NULL PRIMARY KEY,
  flag BOOLEAN NOT NULL
);
