-- On-chain index of every KEYCARD network settlement (settlement address -> anyone), rebuilt from Tempo logs.
-- Merchant history reads from here, so it survives deletions of app rows: the chain is the source of truth.
CREATE TABLE IF NOT EXISTS settlements (
  tx_hash      TEXT NOT NULL,
  log_index    INT NOT NULL,
  to_addr      TEXT NOT NULL,
  amount       NUMERIC(78,0) NOT NULL,
  memo         TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  block_time   TIMESTAMPTZ,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS settlements_to_idx ON settlements (to_addr, block_number DESC);
