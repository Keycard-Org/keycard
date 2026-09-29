-- Physical KEYCARD: an NFC chip key (Burner / Arx HaLo, slot 1, secp256k1) authorised as a SECOND spend key on the
-- credit account, with its own lower contactless-style limit. Freezing revokes it on-chain.
ALTER TABLE lines ADD COLUMN IF NOT EXISTS card_key_id TEXT UNIQUE;
ALTER TABLE lines ADD COLUMN IF NOT EXISTS card_limit NUMERIC(78,0);
ALTER TABLE lines ADD COLUMN IF NOT EXISTS card_status TEXT;          -- active | frozen
ALTER TABLE lines ADD COLUMN IF NOT EXISTS card_linked_at TIMESTAMPTZ;
