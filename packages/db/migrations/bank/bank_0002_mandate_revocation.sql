-- bank: the countersigned AgentMandate is kept so the bank can revoke its evidence when the agent key is revoked or
-- replaced (F10); state becomes 'revoked'.
ALTER TABLE mandate_drafts ADD COLUMN signed_credential MEDIUMTEXT NULL;
