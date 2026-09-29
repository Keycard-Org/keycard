-- KEYCARD servicer schema v1

CREATE TABLE IF NOT EXISTS users (
  wallet              TEXT PRIMARY KEY,              -- passkey root account = identity + income wallet
  role                TEXT NOT NULL CHECK (role IN ('borrower','guarantor')),
  passkey_id          TEXT NOT NULL,                 -- WebAuthn credential id (base64url)
  passkey_public_key  TEXT NOT NULL,                 -- uncompressed P-256 public key (hex)
  residence_country   TEXT NOT NULL,                 -- self-declared ISO-3166 alpha-3; IND is refused
  residence_declared_at TIMESTAMPTZ NOT NULL,
  signup_ip_country   TEXT,                          -- from edge header, if available
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attestations (
  wallet          TEXT PRIMARY KEY REFERENCES users(wallet),
  nullifier_hash  TEXT NOT NULL UNIQUE,
  flags           INT  NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  nationality     TEXT,                              -- only disclosed for guarantors
  source          TEXT NOT NULL,                     -- 'self'
  self_session_id TEXT,
  tx_hash         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS self_sessions (
  id          TEXT PRIMARY KEY,
  wallet      TEXT NOT NULL REFERENCES users(wallet),
  role        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',       -- pending|valid|invalid|expired|error
  raw         JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A line being prepared (mandate not yet on-chain) has linebook_id NULL.
CREATE TABLE IF NOT EXISTS lines (
  id                  BIGSERIAL PRIMARY KEY,
  linebook_id         BIGINT UNIQUE,
  borrower_wallet     TEXT NOT NULL REFERENCES users(wallet),
  credit_account      TEXT NOT NULL UNIQUE,
  credit_root_enc     TEXT NOT NULL,                 -- AES-256-GCM encrypted private key
  spend_key_id        TEXT,                          -- keyId (address) of the borrower passkey on the credit account
  repay_key_id        TEXT NOT NULL,                 -- keyId of the mandate key on the income wallet
  repay_key_enc       TEXT NOT NULL,
  mandate_cap         NUMERIC(78,0) NOT NULL,        -- max per period the mandate can pull
  token               TEXT NOT NULL,
  credit_limit        NUMERIC(78,0) NOT NULL,        -- current tier
  period_seconds      INT NOT NULL,
  term_end            TIMESTAMPTZ NOT NULL,
  opened_at           TIMESTAMPTZ,
  next_due            TIMESTAMPTZ,
  statement_seq       INT NOT NULL DEFAULT 0,
  amount_due          NUMERIC(78,0) NOT NULL DEFAULT 0,
  grace_until         TIMESTAMPTZ,
  on_time_count       INT NOT NULL DEFAULT 0,
  missed_count        INT NOT NULL DEFAULT 0,
  guarantor_wallet    TEXT,
  guar_key_id         TEXT,
  guar_key_enc        TEXT,
  guaranteed          NUMERIC(78,0) NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'preparing', -- preparing|active|grace|frozen|defaulted|closed
  freeze_reason       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lines_due_idx ON lines (status, next_due);
CREATE UNIQUE INDEX IF NOT EXISTS one_live_line_per_borrower
  ON lines (borrower_wallet) WHERE status IN ('preparing','active','grace','frozen');

CREATE TABLE IF NOT EXISTS guarantee_invites (
  id                   TEXT PRIMARY KEY,           -- random url-safe token
  line_id              BIGINT NOT NULL REFERENCES lines(id),
  requested            NUMERIC(78,0) NOT NULL,
  guarantor_wallet     TEXT REFERENCES users(wallet),
  monthly_income       NUMERIC(78,0),
  monthly_obligations  NUMERIC(78,0),
  max_allowed          NUMERIC(78,0),
  cap                  NUMERIC(78,0),
  consent_text_hash    TEXT,
  consented_at         TIMESTAMPTZ,
  guar_key_id          TEXT,
  guar_key_enc         TEXT,
  status               TEXT NOT NULL DEFAULT 'open', -- open|prepared|active|withdrawn|expired
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every money movement KEYCARD initiates. memo is unique => idempotent.
CREATE TABLE IF NOT EXISTS movements (
  id          BIGSERIAL PRIMARY KEY,
  line_id     BIGINT NOT NULL REFERENCES lines(id),
  kind        TEXT NOT NULL CHECK (kind IN ('FUND','INST','GUAR','TOPUP')),
  seq         INT NOT NULL,
  memo        TEXT NOT NULL UNIQUE,
  amount      NUMERIC(78,0) NOT NULL,
  from_addr   TEXT NOT NULL,
  to_addr     TEXT NOT NULL,
  tx_hash     TEXT,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending|confirmed|failed
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Borrower spends, indexed from AccessKeySpend + Transfer on credit accounts.
CREATE TABLE IF NOT EXISTS spends (
  tx_hash      TEXT NOT NULL,
  log_index    INT NOT NULL,
  line_id      BIGINT NOT NULL REFERENCES lines(id),
  merchant     TEXT NOT NULL,
  amount       NUMERIC(78,0) NOT NULL,
  block_number BIGINT NOT NULL,
  block_time   TIMESTAMPTZ,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS merchants (
  address     TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  url         TEXT,
  kind        TEXT NOT NULL DEFAULT 'merchant',  -- merchant|mpp
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  line_id    BIGINT,
  actor      TEXT NOT NULL,       -- servicer|borrower|guarantor|admin|chain
  action     TEXT NOT NULL,
  detail     JSONB,
  tx_hash    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cursors (
  name        TEXT PRIMARY KEY,
  last_block  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
