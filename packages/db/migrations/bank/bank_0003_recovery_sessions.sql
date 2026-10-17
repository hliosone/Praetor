-- bank: a KYC session can be the bank's own re-KYC for an owner recovery (F10); it carries the new owner key.
ALTER TABLE kyc_sessions ADD COLUMN recovery_key TEXT NULL;
