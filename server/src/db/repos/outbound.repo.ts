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
