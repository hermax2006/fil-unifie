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
