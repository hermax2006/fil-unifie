import { db } from '../client.js';
import { randomBytes } from 'node:crypto';

export interface WebhookEndpointRow {
  id: string;
  account_id: string;
  connector_id: string;
  path_token: string;
  secret_encrypted: string | null;
  secret_hash: string | null;
  active: number;
}

export function createEndpoint(accountId: string, connectorId: string, secretEncrypted?: string | null) {
  // En dev, créer le compte + utilisateur s'ils n'existent pas pour faciliter les tests
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get('dev');
  if (!user) {
    db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))")
      .run('dev', 'dev@local.test', 'x');
  }
  const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId);
  if (!account) {
    db.prepare("INSERT OR IGNORE INTO accounts (id, user_id, name, created_at) VALUES (?, ?, ?, datetime('now'))")
      .run(accountId, 'dev', accountId);
  }

  const id = randomBytes(16).toString('hex');
  const pathToken = randomBytes(24).toString('hex');
  const stmt = db.prepare(`
    INSERT INTO webhook_endpoints (id, account_id, connector_id, path_token, secret_encrypted, secret_hash, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, 1, datetime('now'), datetime('now'))
  `);
  stmt.run(id, accountId, connectorId, pathToken, secretEncrypted ?? null);
  return { id, pathToken };
}

export function findByPathToken(pathToken: string): WebhookEndpointRow | undefined {
  const stmt = db.prepare(`
    SELECT id, account_id, connector_id, path_token, secret_encrypted, secret_hash, active
    FROM webhook_endpoints
    WHERE path_token = ? AND active = 1
  `);
  return stmt.get(pathToken) as WebhookEndpointRow | undefined;
}
