-- api: web push subscriptions (spec 05 "push subscriptions"), one row per browser endpoint.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint VARCHAR(512) NOT NULL PRIMARY KEY,
  account CHAR(42) NOT NULL,
  p256dh VARCHAR(256) NOT NULL,
  auth VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX push_subscriptions_account (account)
);
