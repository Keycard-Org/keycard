-- Line lifecycle recovery paths: renewing a revoked auto-debit mandate, and settling after default.
ALTER TABLE lines ADD COLUMN IF NOT EXISTS pending_repay_key_id TEXT;
ALTER TABLE lines ADD COLUMN IF NOT EXISTS pending_repay_key_enc TEXT;
ALTER TABLE lines ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
