CREATE TABLE IF NOT EXISTS watchers (
  vault_address TEXT PRIMARY KEY,
  owner_address TEXT NOT NULL,
  heir_address TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_checked_at TEXT,
  last_claimable INTEGER NOT NULL DEFAULT 0,
  last_vault_balance TEXT NOT NULL DEFAULT '0',
  notified_heir_address TEXT,
  notified_at TEXT,
  last_error TEXT
);
