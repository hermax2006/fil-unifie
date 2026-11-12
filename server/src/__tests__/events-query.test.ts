import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/client.js';
import { addEventRow, countUnread, listEvents, markAllRead } from '../db/repos/events.repo.js';

const userId = `test-${randomUUID()}`;
const accountId = `acc-${userId}`;

beforeAll(() => {
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, `${userId}@test.local`, 'x', new Date().toISOString(), new Date().toISOString());
  db.prepare('INSERT INTO accounts (id, user_id, name, created_at) VALUES (?, ?, ?, ?)')
    .run(accountId, userId, 'test', new Date().toISOString());
});

function add(over: Record<string, unknown>) {
  addEventRow({
    id: randomUUID(),
    connector: 'webhook',
    accountId,
    kind: 'message',
    body: 'corps',
    occurredAt: '2026-01-01T09:00:00.000Z',
    receivedAt: '2026-01-01T09:00:00.000Z',
    userId,
    ...over,
  } as any);
}

afterEach(() => {
  db.prepare('DELETE FROM events WHERE user_id = ?').run(userId);
});

afterAll(() => {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
});

describe('requêtes du fil', () => {
  it('recherche dans le titre, le corps et l’auteur', () => {
    add({ title: 'Rapport mensuel', body: 'chiffres', receivedAt: '2026-01-01T10:00:00.000Z' });
    add({ title: 'Autre', body: 'contient alpha', receivedAt: '2026-01-01T11:00:00.000Z' });
    add({ title: 'Message', body: 'rien', author: { name: 'Alice' }, receivedAt: '2026-01-01T12:00:00.000Z' });

    expect(listEvents(10, userId, { search: 'rapport' })).toHaveLength(1);
    expect(listEvents(10, userId, { search: 'alpha' })).toHaveLength(1);
    expect(listEvents(10, userId, { search: 'alice' })).toHaveLength(1);
  });

  it('pagine avec le curseur before', () => {
    add({ body: 'un', receivedAt: '2026-01-01T10:00:00.000Z' });
    add({ body: 'deux', receivedAt: '2026-01-01T11:00:00.000Z' });
    add({ body: 'trois', receivedAt: '2026-01-01T12:00:00.000Z' });

    const page = listEvents(10, userId, { before: '2026-01-01T11:30:00.000Z' });
    expect(page.map((e) => e.body)).toEqual(['deux', 'un']);
  });

  it('compte et marque tous les non-lus', () => {
    add({ body: 'a', receivedAt: '2026-01-01T10:00:00.000Z' });
    add({ body: 'b', receivedAt: '2026-01-01T11:00:00.000Z' });

    expect(countUnread(userId)).toBe(2);
    expect(markAllRead(userId)).toBe(2);
    expect(countUnread(userId)).toBe(0);
  });
});
