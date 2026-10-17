-- api (spec 06 F7 step 1): standing orders the agent proposed, waiting for the owner. Labels and merchant codes only.
CREATE TABLE IF NOT EXISTS standing_order_proposals (
  id CHAR(36) NOT NULL PRIMARY KEY,
  account CHAR(42) NOT NULL,
  payee CHAR(42) NULL,
  merchant VARCHAR(64) NULL,
  amount VARCHAR(40) NOT NULL,
  period VARCHAR(10) NOT NULL,
  summary VARCHAR(280) NOT NULL,
  state VARCHAR(10) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX proposals_account (account, state)
);
