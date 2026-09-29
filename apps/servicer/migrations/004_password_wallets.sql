-- Users can hold either a WebAuthn passkey or a password-locked device key (secp256k1).
ALTER TABLE users ADD COLUMN IF NOT EXISTS key_type TEXT NOT NULL DEFAULT 'webauthn';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_key_type_check;
ALTER TABLE users ADD CONSTRAINT users_key_type_check CHECK (key_type IN ('webauthn','secp256k1'));
