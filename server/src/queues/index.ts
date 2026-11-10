import type { NewEvent } from '@fil/shared';
import { processEvent } from './processEvent.js';

/**
 * Pour démarrer : exécution immédiate en mémoire, sans Redis.
 * Plus tard : remplacer le corps de enqueueEvent par un ajout dans une file BullMQ
 * (relances, DLQ). Le reste du code n'aura pas à changer.
 */
export function enqueueEvent(event: NewEvent, userId?: string | null): void {
  setImmediate(() => {
    processEvent(event, userId).catch((err) => console.error('processEvent a échoué', err));
  });
}
