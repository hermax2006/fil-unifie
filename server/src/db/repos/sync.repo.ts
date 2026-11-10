import { db } from '../client.js';
import { randomBytes } from 'node:crypto';

export interface SyncStateRow {
  connection_id: string;
  resource: string;
  cursor: string | null;
  last_polled_at: string | null;
  updated_at: string;
}

export interface SyncRunRow {
  id: string;
  connection_id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'ok' | 'error';
  events_count: number;
  error: string | null;
}

export function getSyncState(connectionId: string, resource = 'default'): SyncStateRow | undefined {
  return db.prepare(
    'SELECT * FROM sync_state WHERE connection_id = ? AND resource = ?',
  ).get(connectionId, resource) as SyncStateRow | undefined;
}

/** Enregistre le curseur et la date du dernier polling réussi. */
export function saveSyncState(
  connectionId: string,
  cursor: string | null,
  lastPolledAt: string,
  resource = 'default',
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sync_state (connection_id, resource, cursor, last_polled_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(connection_id, resource) DO UPDATE SET
      cursor = excluded.cursor,
      last_polled_at = excluded.last_polled_at,
      updated_at = excluded.updated_at
  `).run(connectionId, resource, cursor, lastPolledAt, now);
}

export function startSyncRun(connectionId: string, startedAt = new Date().toISOString()): string {
  const id = randomBytes(12).toString('hex');
  db.prepare(`
    INSERT INTO sync_runs (id, connection_id, started_at, status)
    VALUES (?, ?, ?, 'running')
  `).run(id, connectionId, startedAt);
  return id;
}

export function finishSyncRun(
  id: string,
  status: 'ok' | 'error',
  eventsCount = 0,
  error?: string,
): void {
  db.prepare(`
    UPDATE sync_runs
    SET finished_at = ?, status = ?, events_count = ?, error = ?
    WHERE id = ?
  `).run(new Date().toISOString(), status, eventsCount, error ?? null, id);
}

export function getLatestSyncRun(connectionId: string): SyncRunRow | undefined {
  return db.prepare(
    'SELECT * FROM sync_runs WHERE connection_id = ? ORDER BY started_at DESC LIMIT 1',
  ).get(connectionId) as SyncRunRow | undefined;
}

/** Purge l'historique au-delà de N jours (appelable plus tard par une tâche planifiée). */
export function purgeSyncRuns(olderThanDays = 30): number {
  const info = db.prepare(
    "DELETE FROM sync_runs WHERE started_at < datetime('now', ?)",
  ).run(`-${olderThanDays} days`);
  return info.changes;
}
