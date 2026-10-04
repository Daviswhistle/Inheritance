-- Derived monitoring schedules and verified candidates only. The existing
-- finalizer journal/leases remain authoritative for every financial action.
CREATE TABLE IF NOT EXISTS watcher_schedule (
  vault_address TEXT PRIMARY KEY, next_check_at INTEGER NOT NULL,
  initialized INTEGER NOT NULL DEFAULT 0, last_attempt_at INTEGER,
  last_success_at INTEGER, last_error TEXT, error_since_at INTEGER
);
CREATE INDEX IF NOT EXISTS watcher_schedule_due ON watcher_schedule(next_check_at);
CREATE TABLE IF NOT EXISTS execution_candidates (
  vault_address TEXT PRIMARY KEY, observation_token TEXT NOT NULL,
  observed_at INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS execution_candidates_due ON execution_candidates(next_attempt_at,observed_at);

CREATE TABLE IF NOT EXISTS execution_pending_observation (
  scope TEXT NOT NULL, tx_hash TEXT NOT NULL, first_seen_at INTEGER NOT NULL,
  PRIMARY KEY(scope,tx_hash)
);
