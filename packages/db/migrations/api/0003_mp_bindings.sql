-- api (spec 05): the WeChat user linked to each account, keyed by keccak256 of the mini program openid, written only
-- after LINK_WECHAT succeeded on Base. Mini program sign-in reads it. No raw WeChat or phone identifier.
CREATE TABLE IF NOT EXISTS mp_bindings (
  openid_hash CHAR(66) NOT NULL PRIMARY KEY,
  account CHAR(42) NOT NULL UNIQUE,
  binding_hash CHAR(66) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
