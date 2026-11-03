import { db } from '../client.js';
import { randomBytes } from 'node:crypto';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export function createUser(email: string, passwordHash: string): UserRow {
  const id = randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, email, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, email.toLowerCase(), passwordHash, now, now);
  return findUserById(id)!;
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined;
}

export function findUserById(id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}
