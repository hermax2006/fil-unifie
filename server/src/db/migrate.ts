import { db } from './client.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  }
}
