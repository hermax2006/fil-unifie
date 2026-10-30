CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  connector TEXT NOT NULL,
  account_id TEXT NOT NULL,
  external_id TEXT,
  kind TEXT NOT NULL,
  author_json TEXT,
  title TEXT,
  body TEXT NOT NULL,
  url TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_received_at ON events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_account ON events(account_id);
