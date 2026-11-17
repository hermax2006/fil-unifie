import { db } from '../client.js';
import { randomUUID } from 'node:crypto';

/**
 * Historique des livraisons webhook : chaque POST reçu sur un endpoint
 * (accepté ou rejeté). Purge légère à chaque écriture pour ne pas gonfler.
 */
export interface DeliveryRow {
  id: string;
  endpointId: string;
  accountId: string;
  connectorId: string;
  status: 'accepted' | 'rejected';
  eventsCount: number;
  error?: string;
  sourceIp?: string;
  createdAt: string;
}

export function recordDelivery(input: {
  endpointId: string;
  accountId: string;
  connectorId: string;
  status: 'accepted' | 'rejected';
  eventsCount?: number;
  error?: string;
  sourceIp?: string;
}): void {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO webhook_deliveries (id, endpoint_id, account_id, connector_id, status, events_count, error, source_ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.endpointId,
    input.accountId,
    input.connectorId,
    input.status,
    input.eventsCount ?? 0,
    input.error?.slice(0, 500) ?? null,
    input.sourceIp ?? null,
    new Date().toISOString(),
  );
}

export function listDeliveriesForEndpoint(endpointId: string, limit = 20): DeliveryRow[] {
  const rows = db.prepare(`
    SELECT * FROM webhook_deliveries
    WHERE endpoint_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(endpointId, limit) as any[];
  return rows.map((r) => ({
    id: r.id,
    endpointId: r.endpoint_id,
    accountId: r.account_id,
    connectorId: r.connector_id,
    status: r.status,
    eventsCount: r.events_count ?? 0,
    error: r.error ?? undefined,
    sourceIp: r.source_ip ?? undefined,
    createdAt: r.created_at,
  }));
}

/** Garde l'historique raisonnable : purge au-delà de N jours et par endpoint. */
export function purgeDeliveries(keepDays = 7): number {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();
  const info = db.prepare('DELETE FROM webhook_deliveries WHERE created_at < ?').run(cutoff);
  return info.changes;
}
