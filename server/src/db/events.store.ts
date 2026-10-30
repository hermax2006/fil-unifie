import type { UnifiedEvent } from '@fil/shared';
import { db } from './client.js';

const MAX = 500;

export function addEvent(e: UnifiedEvent): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO events (
      id, connector, account_id, external_id, kind, author_json, title, body, url, occurred_at, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    e.id,
    e.connector,
    e.accountId,
    e.externalId ?? null,
    e.kind,
    e.author ? JSON.stringify(e.author) : null,
    e.title ?? null,
    e.body,
    e.url ?? null,
    e.occurredAt,
    e.receivedAt,
  );

  // Garder uniquement les MAX derniers
  const count = db.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number };
  if (count.c > MAX) {
    const toDelete = count.c - MAX;
    db.prepare(`
      DELETE FROM events WHERE id IN (
        SELECT id FROM events ORDER BY received_at ASC LIMIT ?
      )
    `).run(toDelete);
  }
}

export function listEvents(limit = 100): UnifiedEvent[] {
  const rows = db.prepare(`
    SELECT id, connector, account_id, external_id, kind, author_json, title, body, url, occurred_at, received_at
    FROM events
    ORDER BY received_at DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map((r) => ({
    id: r.id,
    connector: r.connector,
    accountId: r.account_id,
    externalId: r.external_id ?? undefined,
    kind: r.kind,
    author: r.author_json ? JSON.parse(r.author_json) : undefined,
    title: r.title ?? undefined,
    body: r.body,
    url: r.url ?? undefined,
    occurredAt: r.occurred_at,
    receivedAt: r.received_at,
  }));
}
