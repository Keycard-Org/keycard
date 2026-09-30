-- One username namespace for all accounts (passkey and password). Lower-case, unique.
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (username) WHERE username IS NOT NULL;
UPDATE users u SET username = p.username FROM password_logins p WHERE p.wallet = u.wallet AND u.username IS NULL;
