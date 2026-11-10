import { randomUUID } from 'node:crypto';
import type { NewEvent, UnifiedEvent } from '@fil/shared';
import { addEvent } from '../db/events.store.js';
import { broadcast } from '../sse/index.js';

/** Logique d'un job : compléter l'événement, le stocker, le pousser au client. */
export async function processEvent(input: NewEvent, userId?: string | null): Promise<void> {
  const event: UnifiedEvent = {
    ...input,
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
  };
  addEvent(event, userId ?? null);
  broadcast(event);
}

/*
 * TRAITEMENT D'UN ÉVÉNEMENT
 * ------------------------
 * 1. On reçoit un NouvelEvenement depuis le connecteur
 * 2. On lui ajoute un identifiant unique (uuid) et la date de réception
 * 3. On l'ajoute au magasin (SQLite) via events.store
 * 4. On le diffuse en temps réel via SSE à tous les clients connectés
 *    (À isoler par utilisateur une fois l'authentification active)
 */
