import { db } from '../client.js';
import { randomBytes } from 'node:crypto';

export interface AccountRow {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export function createAccount(userId: string, name = 'Mon compte'): AccountRow {
  const id = randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO accounts (id, user_id, name, created_at) VALUES (?, ?, ?, ?)').run(id, userId, name, now);
  return { id, user_id: userId, name, created_at: now };
}

export function findOrCreateAccountForUser(userId: string, name = 'Mon compte'): AccountRow {
  const existing = db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC LIMIT 1').get(userId) as AccountRow | undefined;
  if (existing) return existing;
  return createAccount(userId, name);
}

export function findAccountById(id: string): AccountRow | undefined {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
}

export function listAccountsForUser(userId: string): AccountRow[] {
  return db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC').all(userId) as AccountRow[];
}
