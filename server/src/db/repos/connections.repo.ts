import { db } from '../client.js';
import { randomBytes } from 'node:crypto';

export interface ConnectorConnectionRow {
  id: string;
  account_id: string;
  connector_id: string;
  active: number;
  config_json: string | null;
  encrypted_tokens_json: string | null;
  created_at: string;
  updated_at: string;
}

export function upsertConnection(accountId: string, connectorId: string, config?: unknown) {
  const existing = db.prepare('SELECT id FROM connector_connections WHERE account_id = ? AND connector_id = ?').get(accountId, connectorId) as { id: string } | undefined;
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(`UPDATE connector_connections SET config_json = ?, active = 1, updated_at = ? WHERE id = ?`).run(config ? JSON.stringify(config) : null, now, existing.id);
    return existing.id;
  }
  const id = randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO connector_connections (id, account_id, connector_id, active, config_json, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)`)
    .run(id, accountId, connectorId, config ? JSON.stringify(config) : null, now, now);
  return id;
}

export function listConnections(accountId: string): ConnectorConnectionRow[] {
  return db.prepare('SELECT * FROM connector_connections WHERE account_id = ? ORDER BY created_at DESC').all(accountId) as ConnectorConnectionRow[];
}

export function setConnectionActive(id: string, accountId: string, active: boolean): boolean {
  const info = db.prepare("UPDATE connector_connections SET active = ?, updated_at = datetime('now') WHERE id = ? AND account_id = ?").run(active ? 1 : 0, id, accountId);
  return info.changes > 0;
}

export function setConnectionTokens(id: string, accountId: string, encryptedTokensJson: string | null): boolean {
  const info = db.prepare("UPDATE connector_connections SET encrypted_tokens_json = ?, updated_at = datetime('now') WHERE id = ? AND account_id = ?").run(encryptedTokensJson, id, accountId);
  return info.changes > 0;
}

export interface PollingConnectionRow extends ConnectorConnectionRow {
  user_id: string;
}

/** Connexions actives, avec le propriétaire (pour attribuer les événements). */
export function listActiveConnectionsForPolling(): PollingConnectionRow[] {
  return db.prepare(`
    SELECT cc.*, a.user_id
    FROM connector_connections cc
    JOIN accounts a ON a.id = cc.account_id
    WHERE cc.active = 1
    ORDER BY cc.updated_at ASC
  `).all() as PollingConnectionRow[];
}

export function updateConnection(
  id: string,
  accountId: string,
  patch: { active?: boolean; config?: unknown },
): boolean {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (patch.active !== undefined) {
    fields.push('active = ?');
    params.push(patch.active ? 1 : 0);
  }
  if (patch.config !== undefined) {
    fields.push('config_json = ?');
    params.push(patch.config === null ? null : JSON.stringify(patch.config));
  }
  if (fields.length === 0) return false;
  fields.push("updated_at = datetime('now')");
  params.push(id, accountId);
  const info = db.prepare(`UPDATE connector_connections SET ${fields.join(', ')} WHERE id = ? AND account_id = ?`).run(...params);
  return info.changes > 0;
}

export function getConnection(id: string, accountId: string): ConnectorConnectionRow | undefined {
  return db.prepare('SELECT * FROM connector_connections WHERE id = ? AND account_id = ?')
    .get(id, accountId) as ConnectorConnectionRow | undefined;
}

/** Connexion active d'un type donné pour un compte (ex. IMAP pour répondre). */
export function findActiveConnection(accountId: string, connectorId: string): ConnectorConnectionRow | undefined {
  return db.prepare(`
    SELECT * FROM connector_connections
    WHERE account_id = ? AND connector_id = ? AND active = 1
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(accountId, connectorId) as ConnectorConnectionRow | undefined;
}
