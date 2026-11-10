import { db } from '../client.js';
import { randomBytes } from 'node:crypto';
import { generatePathToken, hashPathToken } from '../../webhooks/path-token.js';

export interface WebhookEndpointRow {
  id: string;
  account_id: string;
  connector_id: string;
  path_token: string;
  path_token_hash: string | null;
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
  const rawToken = generatePathToken();
  const tokenHash = hashPathToken(rawToken);
  const stmt = db.prepare(`
    INSERT INTO webhook_endpoints (id, account_id, connector_id, path_token, path_token_hash, secret_encrypted, secret_hash, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, 1, datetime('now'), datetime('now'))
  `);
  // path_token ne contient que l'empreinte (legacy), jamais le jeton secret.
  stmt.run(id, accountId, connectorId, tokenHash, tokenHash, secretEncrypted ?? null);
  return { id, pathToken: rawToken };
}

export function findByPathToken(pathToken: string): WebhookEndpointRow | undefined {
  const stmt = db.prepare(`
    SELECT id, account_id, connector_id, path_token, path_token_hash, secret_encrypted, secret_hash, active
    FROM webhook_endpoints
    WHERE path_token_hash = ? AND active = 1
  `);
  return stmt.get(hashPathToken(pathToken)) as WebhookEndpointRow | undefined;
}

export function listEndpointsForAccount(accountId: string) {
  return db.prepare(`
    SELECT id, account_id, connector_id, active, created_at, updated_at
    FROM webhook_endpoints
    WHERE account_id = ?
    ORDER BY created_at DESC
  `).all(accountId);
}

export function revokeEndpoint(id: string, accountId: string): boolean {
  const info = db.prepare('UPDATE webhook_endpoints SET active = 0, updated_at = datetime(\'now\') WHERE id = ? AND account_id = ?').run(id, accountId);
  return info.changes > 0;
}

export function rotateEndpointSecret(id: string, accountId: string, secretEncrypted: string): boolean {
  const info = db.prepare(`
    UPDATE webhook_endpoints
    SET secret_encrypted = ?, updated_at = datetime('now')
    WHERE id = ? AND account_id = ? AND active = 1
  `).run(secretEncrypted, id, accountId);
  return info.changes > 0;
}

/** Remplace l'URL (jeton) d'un endpoint ; l'ancienne URL devient invalide. */
export function rotateEndpointToken(id: string, accountId: string, tokenHash: string): boolean {
  const info = db.prepare(`
    UPDATE webhook_endpoints
    SET path_token = ?, path_token_hash = ?, updated_at = datetime('now')
    WHERE id = ? AND account_id = ? AND active = 1
  `).run(tokenHash, tokenHash, id, accountId);
  return info.changes > 0;
}
