import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/client.js';
import { createConnection, deleteConnection } from '../db/repos/connections.repo.js';

const userId = `test-${randomUUID()}`;
const accountId = `acc-${userId}`;
const ids: string[] = [];

beforeAll(() => {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, `${userId}@test.local`, 'x', now, now);
  db.prepare('INSERT INTO accounts (id, user_id, name, created_at) VALUES (?, ?, ?, ?)')
    .run(accountId, userId, 'test', now);
});

afterAll(() => {
  for (const id of ids.splice(0)) deleteConnection(id, accountId);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
});

describe('plusieurs connexions par connecteur', () => {
  it('crée deux connexions IMAP distinctes puis les supprime', () => {
    const id1 = createConnection(accountId, 'imap', { host: 'imap.example.com', user: 'u1' });
    const id2 = createConnection(accountId, 'imap', { host: 'imap2.example.com', user: 'u2' });
    ids.push(id1, id2);

    expect(id1).not.toBe(id2);
    const rows = db.prepare('SELECT id FROM connector_connections WHERE account_id = ? AND connector_id = ?')
      .all(accountId, 'imap') as { id: string }[];
    expect(rows.map((r) => r.id).sort()).toEqual([id1, id2].sort());

    expect(deleteConnection(id1, accountId)).toBe(true);
    expect(deleteConnection(id1, accountId)).toBe(false);
    const rest = db.prepare('SELECT id FROM connector_connections WHERE id = ?').all(id1);
    expect(rest).toHaveLength(0);
  });
});
