import { registry } from '../connectors/registry.js';
import { getEventForReply } from '../db/events.store.js';
import { getConnection, findActiveConnection } from '../db/repos/connections.repo.js';
import { bumpOutboundAttempts, exhaustOutboundAttempts, listRetryableOutbound, markOutboundFailed, markOutboundSent } from '../db/repos/outbound.repo.js';
import { decryptToken } from '../crypto/tokens.js';
import { replySubject } from '../connectors/imap.connector.js';

/**
 * Retry automatique des réponses sortantes.
 *
 * Une réponse email peut échouer pour une raison passagère (SMTP momentanément
 * indisponible, coupure réseau). Au lieu de laisser l'utilisateur retenter
 * à la main, on retente périodiquement (3 essais max, fenêtre de 24 h).
 *
 * Choix d'implémentation : un simple timer plutôt qu'un job BullMQ —
 * le volume est faible (quelques réponses) et ça marche avec ou sans Redis.
 */

const INTERVAL_MS = 3 * 60 * 1000;
const MAX_ATTEMPTS = 3;

let timer: ReturnType<typeof setInterval> | null = null;

/** Retente les réponses en attente/échouées. Renvoie le nombre de succès. */
export async function retryPendingOutbound(): Promise<number> {
  const rows = listRetryableOutbound(20);
  let delivered = 0;

  for (const row of rows) {
    try {
      if (!row.eventId) {
        markOutboundFailed(row.id, 'retry impossible : événement manquant');
        exhaustOutboundAttempts(row.id);
        continue;
      }
      const event = getEventForReply(row.eventId);
      if (!event) {
        markOutboundFailed(row.id, 'retry impossible : événement supprimé');
        exhaustOutboundAttempts(row.id);
        continue;
      }
      const connection = row.connectionId
        ? getConnection(row.connectionId, event.accountId)
        : findActiveConnection(event.accountId, event.connector);
      if (!connection) {
        // Définitif : la connexion a été supprimée, retenter ne sert à rien.
        markOutboundFailed(row.id, 'retry impossible : connexion source supprimée');
        exhaustOutboundAttempts(row.id);
        continue;
      }
      if (!connection.active) {
        // Connexion en pause : on laisse retenter plus tard (pas de consumation d'essai).
        continue;
      }

      const connector = registry.get(event.connector);
      if (!connector?.reply) {
        markOutboundFailed(row.id, 'retry impossible : connecteur sans support de réponse');
        exhaustOutboundAttempts(row.id);
        continue;
      }

      let config: Record<string, unknown> = {};
      try { config = connection.config_json ? JSON.parse(connection.config_json) : {}; } catch { config = {}; }
      let tokens: Record<string, unknown> | null = null;
      try {
        tokens = connection.encrypted_tokens_json ? JSON.parse(decryptToken(connection.encrypted_tokens_json)) : null;
      } catch {
        markOutboundFailed(row.id, 'retry impossible : tokens illisibles (clé de chiffrement ?)');
        exhaustOutboundAttempts(row.id);
        continue;
      }

      bumpOutboundAttempts(row.id);
      const result = await connector.reply({
        accountId: event.accountId,
        config,
        tokens,
        to: row.to,
        subject: row.subject ?? replySubject(event.title),
        body: row.body ?? '',
        inReplyTo: event.externalId,
        references: event.externalId ? [event.externalId] : undefined,
      });
      markOutboundSent(row.id, result.messageId);
      delivered++;
      console.log(`Retry outbound ${row.id} : envoyé (tentative ${row.attempts + 1})`);
    } catch (err: any) {
      const message = err?.message || String(err);
      // attempts a déjà été incrémenté avant l'envoi : si on est au max, échec final.
      markOutboundFailed(row.id, `retry (tentative ${row.attempts + 1}/${MAX_ATTEMPTS}) : ${message}`);
    }
  }

  return delivered;
}

export function startOutboundRetry(): void {
  if (timer) return;
  timer = setInterval(() => {
    void retryPendingOutbound().catch((err) => console.error('Retry outbound', err));
  }, INTERVAL_MS);
  // Premier passage au démarrage (après une coupure, on rattrape les retards).
  void retryPendingOutbound().catch((err) => console.error('Retry outbound', err));
  console.log(`Retry des réponses : toutes les ${INTERVAL_MS / 60000} min (max ${MAX_ATTEMPTS} essais)`);
}

export function stopOutboundRetry(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
