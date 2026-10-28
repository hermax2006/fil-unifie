import { randomUUID } from 'node:crypto';
import type { NewEvent, UnifiedEvent } from '@fil/shared';
import { addEvent } from '../db/events.store.js';
import { broadcast } from '../sse/index.js';

/** Logique d'un job : compléter l'événement, le stocker, le pousser au client. */
export async function processEvent(input: NewEvent): Promise<void> {
  const event: UnifiedEvent = {
    ...input,
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
  };
  addEvent(event);
  broadcast(event);
}
