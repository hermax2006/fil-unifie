import { db } from '../client.js';
import type { UnifiedEvent } from '@fil/shared';
import { createHash } from 'node:crypto';

export function makeDedupKey(e: UnifiedEvent): string {
  const base = [
    e.connector,
    e.accountId,
    e.externalId ?? '',
    e.kind,
    e.url ?? '',
    e.title ?? '',
    e.body,
  ].join('|');
  return createHash('sha256').update(base).digest('hex');
}

export function addEventRow(e: UnifiedEvent & { userId?: string | null; dedupKey?: string }): boolean {
  const dedupKey = e.dedupKey ?? makeDedupKey(e);
  const stmt = db.prepare(`
    INSERT INTO events (
      id, user_id, account_id, connector_id, external_id, dedup_key, kind, author_json, title, body, url, occurred_at, received_at, read_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  try {
    stmt.run(
      e.id,
      e.userId ?? null,
      e.accountId,
      e.connector,
      e.externalId ?? null,
      dedupKey,
      e.kind,
      e.author ? JSON.stringify(e.author) : null,
      e.title ?? null,
      e.body,
      e.url ?? null,
      e.occurredAt,
      e.receivedAt,
      e.readAt ?? null,
    );
    return true;
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return false; // déjà existant
    }
    throw err;
  }
}

export interface EventFilters {
  connector?: string;
  kind?: string;
  read?: 'all' | 'read' | 'unread';
}

export function listEvents(limit = 100, userId?: string, filters: EventFilters = {}): UnifiedEvent[] {
  const where: string[] = [];
  const params: any[] = [];

  if (userId) {
    where.push('(user_id = ? OR user_id IS NULL)');
    params.push(userId);
  }
  if (filters.connector) {
    where.push('connector_id = ?');
    params.push(filters.connector);
  }
  if (filters.kind) {
    where.push('kind = ?');
    params.push(filters.kind);
  }
  if (filters.read === 'read') where.push('read_at IS NOT NULL');
  if (filters.read === 'unread') where.push('read_at IS NULL');

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const stmt = db.prepare(`
    SELECT id, connector_id as connector, account_id as accountId, external_id as externalId, kind, author_json, title, body, url, occurred_at as occurredAt, received_at as receivedAt, read_at as readAt
    FROM events
    ${whereSql}
    ORDER BY received_at DESC
    LIMIT ?
  `);
  params.push(limit);
  const rows = stmt.all(...params) as any[];

  return rows.map((r) => ({
    id: r.id,
    connector: r.connector,
    accountId: r.accountId,
    externalId: r.externalId ?? undefined,
    kind: r.kind,
    author: r.author_json ? JSON.parse(r.author_json) : undefined,
    title: r.title ?? undefined,
    body: r.body,
    url: r.url ?? undefined,
    occurredAt: r.occurredAt,
    receivedAt: r.receivedAt,
    readAt: r.readAt ?? undefined,
  }));
}

export function markEventRead(id: string, userId?: string): boolean {
  const now = new Date().toISOString();
  const stmt = userId
    ? db.prepare('UPDATE events SET read_at = COALESCE(read_at, ?) WHERE id = ? AND (user_id = ? OR user_id IS NULL)')
    : db.prepare('UPDATE events SET read_at = COALESCE(read_at, ?) WHERE id = ?');
  const info = userId ? stmt.run(now, id, userId) : stmt.run(now, id);
  return info.changes > 0;
}

/*
 * REPOSITORY ÉVÉNEMENTS
 * ---------------------
 * - makeDedupKey() : génère une clé unique pour éviter les doublons
 *   (basée sur connecteur, compte, identifiant externe, contenu...)
 * - addEventRow() : insère en BDD, retourne false si doublon (UNIQUE sur dedup_key)
 * - listEvents() : récupère les événements, filtrable par utilisateur
 */
