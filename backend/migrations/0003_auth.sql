-- Pages and the notification Worker share this database and session secret.
-- Only nonce hashes are stored. DELETE ... RETURNING consumes one nonce atomically.
CREATE TABLE auth_nonces (
  nonce_hash TEXT PRIMARY KEY,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_nonces_expiry ON auth_nonces(expires_at);

CREATE TABLE auth_rate_limits (
  rate_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_rate_limits_expiry ON auth_rate_limits(expires_at);

-- Serializes registration, unregister and cron/manual checks across isolates.
CREATE TABLE notification_leases (
  vault_address TEXT PRIMARY KEY,
  lock_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
