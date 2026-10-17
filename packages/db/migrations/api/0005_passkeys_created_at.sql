-- api: when each passkey was registered, so a user's passkeys list in that order and the account's first passkey (the
-- one its address and first userOp were derived from) comes first, whatever its credential id (F10 devices, recovery).
ALTER TABLE passkeys ADD COLUMN created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
