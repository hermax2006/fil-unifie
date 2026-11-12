import { db } from './client.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPathToken } from '../webhooks/path-token.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getVersion(): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);`);
  const row = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number } | undefined;
  return row?.version ?? 0;
}

function setVersion(v: number) {
  db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(v);
}

export function migrate() {
  let current = getVersion();

  if (current < 1) {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);
    current = 1;
    setVersion(1);
  }

  // v2: ajout read_at sur events (si absent)
  if (current < 2) {
    try {
      db.exec('ALTER TABLE events ADD COLUMN read_at TEXT');
    } catch (e: any) {
      if (!String(e?.message || '').includes('duplicate column name')) throw e;
    }
    setVersion(2);
    current = 2;
  }

  // v3: curseur de synchronisation + historique des runs
  if (current < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        connection_id TEXT NOT NULL,
        resource TEXT NOT NULL DEFAULT 'default',
        cursor TEXT,
        last_polled_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (connection_id, resource),
        FOREIGN KEY (connection_id) REFERENCES connector_connections(id) ON DELETE CASCADE
      );

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
    `);
    setVersion(3);
    current = 3;
  }

  // v4: métadonnées de pièces jointes
  if (current < 4) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS event_attachments (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        content_type TEXT,
        size INTEGER,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_event_attachments_event ON event_attachments(event_id);
    `);
    setVersion(4);
    current = 4;
  }

  // v5: hash des jetons d'URL webhook (les URL existantes doivent être régénérées)
  if (current < 5) {
    try {
      db.exec('ALTER TABLE webhook_endpoints ADD COLUMN path_token_hash TEXT');
    } catch (e: any) {
      if (!String(e?.message || '').includes('duplicate column name')) throw e;
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_endpoints_token_hash ON webhook_endpoints(path_token_hash)');

    const rows = db.prepare(`
      SELECT id, path_token FROM webhook_endpoints
      WHERE path_token_hash IS NULL OR path_token <> path_token_hash
    `).all() as { id: string; path_token: string }[];
    const update = db.prepare('UPDATE webhook_endpoints SET path_token = ?, path_token_hash = ? WHERE id = ?');
    for (const row of rows) {
      const hash = hashPathToken(row.path_token);
      update.run(hash, hash, row.id);
    }

    setVersion(5);
    current = 5;
  }

  // v6: lien événement -> connexion + réponses sortantes (SMTP)
  if (current < 6) {
    try {
      db.exec('ALTER TABLE events ADD COLUMN connection_id TEXT');
    } catch (e: any) {
      if (!String(e?.message || '').includes('duplicate column name')) throw e;
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_events_connection ON events(connection_id)');
    db.exec(`
      CREATE TABLE IF NOT EXISTS outbound_messages (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        connection_id TEXT,
        account_id TEXT NOT NULL,
        user_id TEXT,
        to_json TEXT NOT NULL,
        subject TEXT,
        body TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        provider_message_id TEXT,
        created_at TEXT NOT NULL,
        sent_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_outbound_event ON outbound_messages(event_id);
      CREATE INDEX IF NOT EXISTS idx_outbound_account ON outbound_messages(account_id);
    `);
    setVersion(6);
  }
}
