import type { UnifiedEvent } from '@fil/shared';
import { addEventRow, listEvents as listEventsRepo, markEventRead as markEventReadRepo, countUnread as countUnreadRepo, markAllRead as markAllReadRepo, getEventForReply as getEventForReplyRepo, type EventFilters } from './repos/events.repo.js';
import { db } from './client.js';

const MAX = 500;

export function addEvent(e: UnifiedEvent, userId?: string | null): void {
  addEventRow({ ...e, userId: userId ?? null });
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

export function listEvents(limit = 100, userId?: string, filters: EventFilters = {}): UnifiedEvent[] {
  return listEventsRepo(limit, userId, filters);
}

export function markEventRead(id: string, userId?: string): boolean {
  return markEventReadRepo(id, userId);
}


export function countUnread(userId?: string): number {
  return countUnreadRepo(userId);
}

export function markAllRead(userId?: string): number {
  return markAllReadRepo(userId);
}


export function getEventForReply(id: string, userId?: string) {
  return getEventForReplyRepo(id, userId);
}
