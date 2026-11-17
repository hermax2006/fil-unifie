import { db } from '../client.js';
import { randomUUID } from 'node:crypto';

export interface OutboundInput {
  eventId?: string;
  connectionId?: string;
  accountId: string;
  userId?: string;
  to: string[];
  subject?: string;
  body: string;
}

export function createOutbound(input: OutboundInput): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO outbound_messages (
      id, event_id, connection_id, account_id, user_id, to_json, subject, body, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    id,
    input.eventId ?? null,
    input.connectionId ?? null,
    input.accountId,
    input.userId ?? null,
    JSON.stringify(input.to),
    input.subject ?? null,
    input.body,
    new Date().toISOString(),
  );
  return id;
}

export function markOutboundSent(id: string, providerMessageId?: string): void {
  db.prepare(`
    UPDATE outbound_messages
    SET status = 'sent', provider_message_id = ?, sent_at = ?
    WHERE id = ?
  `).run(providerMessageId ?? null, new Date().toISOString(), id);
}

export function markOutboundFailed(id: string, error: string): void {
  db.prepare(`
    UPDATE outbound_messages SET status = 'failed', error = ? WHERE id = ?
  `).run(error.slice(0, 2000), id);
}

/** Incrémente le compteur de tentatives avant un nouvel essai. */
export function bumpOutboundAttempts(id: string): void {
  db.prepare('UPDATE outbound_messages SET attempts = attempts + 1 WHERE id = ?').run(id);
}

/** Échec définitif (ex. connexion supprimée) : on épuise le compteur pour ne plus retenter. */
export function exhaustOutboundAttempts(id: string): void {
  db.prepare('UPDATE outbound_messages SET attempts = 3 WHERE id = ?').run(id);
}

/**
 * Réponses à retenter : « pending » (envoi interrompu) ou « failed »,
 * pas encore au bout de 3 tentatives, recentes (24 h), et pas en cours
 * d'envoi (on laisse 2 minutes aux envois fraîchement créés).
 */
export function listRetryableOutbound(limit = 20): (OutboundRow & { attempts: number })[] {
  const now2min = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const now24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT * FROM outbound_messages
    WHERE status IN ('pending', 'failed')
      AND attempts < 3
      AND created_at >= ?
      AND created_at <= ?
    ORDER BY created_at ASC
    LIMIT ?
  `).all(now24h, now2min, limit) as any[];
  return rows.map((r) => ({ ...mapRow(r), attempts: r.attempts ?? 0 }));
}


export interface OutboundRow {
  id: string;
  eventId?: string;
  connectionId?: string;
  accountId: string;
  to: string[];
  subject?: string;
  body?: string;
  status: string;
  error?: string;
  attempts?: number;
  providerMessageId?: string;
  createdAt: string;
  sentAt?: string;
}

function mapRow(r: any): OutboundRow {
  let to: string[] = [];
  try { to = JSON.parse(r.to_json) as string[]; } catch { to = []; }
  return {
    id: r.id,
    eventId: r.event_id ?? undefined,
    connectionId: r.connection_id ?? undefined,
    accountId: r.account_id,
    to,
    subject: r.subject ?? undefined,
    status: r.status,
    error: r.error ?? undefined,
    providerMessageId: r.provider_message_id ?? undefined,
    createdAt: r.created_at,
    sentAt: r.sent_at ?? undefined,
  };
}

/** Historique des réponses d'un événement (access control via l'événement si userId). */
export function listOutboundForEvent(eventId: string, userId?: string): OutboundRow[] {
  const rows = (userId
    ? db.prepare(`
        SELECT o.* FROM outbound_messages o
        JOIN events e ON e.id = o.event_id
        WHERE o.event_id = ? AND (e.user_id = ? OR e.user_id IS NULL)
        ORDER BY o.created_at DESC
      `).all(eventId, userId)
    : db.prepare('SELECT * FROM outbound_messages WHERE event_id = ? ORDER BY created_at DESC').all(eventId)) as any[];
  return rows.map(mapRow);
}

/** Historique récent des réponses d'un compte (pour une vue « envoyés » côté UI). */
export function listOutboundForAccounts(accountIds: string[], limit = 50): OutboundRow[] {
  if (accountIds.length === 0) return [];
  const placeholders = accountIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT * FROM outbound_messages
    WHERE account_id IN (${placeholders})
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...accountIds, limit) as any[];
  return rows.map(mapRow);
}
