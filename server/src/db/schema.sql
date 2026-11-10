CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);

CREATE TABLE IF NOT EXISTS connector_connections (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  encrypted_tokens_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  UNIQUE(account_id, connector_id)
);

CREATE INDEX IF NOT EXISTS idx_connector_connections_account ON connector_connections(account_id);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  path_token TEXT NOT NULL UNIQUE,
  secret_encrypted TEXT,
  secret_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_token ON webhook_endpoints(path_token);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_account ON webhook_endpoints(account_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  account_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  external_id TEXT,
  dedup_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  author_json TEXT,
  title TEXT,
  body TEXT NOT NULL,
  url TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  read_at TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_events_received_at ON events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_account ON events(account_id);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_dedup ON events(dedup_key);

-- Métadonnées de pièces jointes (pas le contenu binaire)
CREATE TABLE IF NOT EXISTS event_attachments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_attachments_event ON event_attachments(event_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Curseur de synchronisation par connexion (RSS, IMAP...)
CREATE TABLE IF NOT EXISTS sync_state (
  connection_id TEXT NOT NULL,
  resource TEXT NOT NULL DEFAULT 'default',
  cursor TEXT,
  last_polled_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (connection_id, resource),
  FOREIGN KEY (connection_id) REFERENCES connector_connections(id) ON DELETE CASCADE
);

-- Historique léger des synchronisations (échecs + succès avec événements)
CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  events_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  FOREIGN KEY (connection_id) REFERENCES connector_connections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_connection ON sync_runs(connection_id, started_at DESC);
