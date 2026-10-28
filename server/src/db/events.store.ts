import type { UnifiedEvent } from '@fil/shared';

/** Stockage en mémoire pour démarrer. À remplacer par PostgreSQL (dossier db/ à venir). */
const MAX = 500;
const events: UnifiedEvent[] = [];

export function addEvent(e: UnifiedEvent): void {
  events.unshift(e);
  if (events.length > MAX) events.pop();
}

export function listEvents(limit = 100): UnifiedEvent[] {
  return events.slice(0, limit);
}
