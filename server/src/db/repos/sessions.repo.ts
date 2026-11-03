import { db } from '../client.js';
import { randomBytes } from 'node:crypto';

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string;
}

export function createSession(userId: string, ttlDays = 7): SessionRow {
  const id = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(id, userId, expiresAt);
  return { id, user_id: userId, expires_at: expiresAt };
}

export function getSession(sessionId: string): SessionRow | undefined {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return undefined;
  }
  return row;
}

export function deleteSession(sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function deleteSessionsForUser(userId: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
