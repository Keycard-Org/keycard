-- Merchant network: anyone verified can become a merchant. Cards pay the KEYCARD settlement address
-- with the merchant code in the TIP-20 memo; the servicer settles the merchant (USDC today, fiat later).
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS code TEXT UNIQUE;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS owner_wallet TEXT REFERENCES users(wallet);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS settle_to TEXT;          -- where settlement goes (merchant wallet)
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS settlement TEXT NOT NULL DEFAULT 'usdc'; -- usdc | fiat (future)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('borrower','guarantor','merchant'));

CREATE TABLE IF NOT EXISTS payments (
  id            BIGSERIAL PRIMARY KEY,
  pay_tx        TEXT NOT NULL,
  log_index     INT NOT NULL,
  line_id       BIGINT REFERENCES lines(id),
  merchant_code TEXT REFERENCES merchants(code),
  payer         TEXT NOT NULL,             -- credit account
  amount        NUMERIC(78,0) NOT NULL,
  memo          TEXT NOT NULL,
  settle_tx     TEXT,
  status        TEXT NOT NULL DEFAULT 'received', -- received|settled|unmatched|failed
  error         TEXT,
  block_number  BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at    TIMESTAMPTZ,
  UNIQUE (pay_tx, log_index)
);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments(status);
