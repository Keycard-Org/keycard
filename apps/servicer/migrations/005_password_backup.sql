-- Encrypted password-wallet backups for sign-in on any device. KEYCARD stores only:
--   * the wallet vault encrypted client-side (AES-GCM, key = PBKDF2(password, random salt)), and
--   * a scrypt hash of a SEPARATE client-derived login proof (PBKDF2(password, 'keycard-auth:'+username)).
-- Neither the password nor the vault key ever reaches the server.
CREATE TABLE IF NOT EXISTS password_logins (
  username        TEXT PRIMARY KEY,               -- lower-case
  wallet          TEXT NOT NULL UNIQUE REFERENCES users(wallet),
  vault           JSONB NOT NULL,
  auth_salt       TEXT NOT NULL,
  auth_hash       TEXT NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
