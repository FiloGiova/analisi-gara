-- Migrazione additiva e idempotente. I vecchi utenti e i loro ID restano validi.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;
UPDATE users SET activated_at = now() WHERE activated_at IS NULL AND password_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_verified_email ON users (lower(email)) WHERE email_verified_at IS NOT NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS auth_method TEXT NOT NULL DEFAULT 'password';

CREATE TABLE IF NOT EXISTS user_google_identities (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  supabase_user_id UUID NOT NULL UNIQUE,
  google_subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_links (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('activation', 'recovery', 'verify_email')),
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT,
  reset_google BOOLEAN NOT NULL DEFAULT false,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS account_links_user ON account_links(user_id, kind);

CREATE TABLE IF NOT EXISTS oauth_flows (
  token_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'activation', 'link')),
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  link_id INTEGER REFERENCES account_links(id) ON DELETE CASCADE,
  session_hash TEXT,
  auth_version INTEGER,
  code_verifier TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
