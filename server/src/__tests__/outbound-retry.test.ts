import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createOutbound, bumpOutboundAttempts, markOutboundFailed, listRetryableOutbound, markOutboundSent } from '../db/repos/outbound.repo.js';
import { retryPendingOutbound } from '../outbound/retry.js';
import { findOrCreateAccountForUser } from '../db/repos/accounts.repo.js';
import { createUser } from '../db/repos/users.repo.js';
import { addEventRow } from '../db/repos/events.repo.js';
import { db } from '../db/client.js';
import { randomUUID } from 'node:crypto';

/**
 * Attention : les tests partagent la base du serveur. On ne compare jamais
 * « tout le tableau » (l'utilisateur a peut-être des réponses en attente),
 * on cherche toujours NOS lignes par id, et on nettoie en afterAll.
 */
describe('Retry des réponses sortantes', () => {
  let accountId: string;
  let eventId: string;
  let userId: string;
  const ids: string[] = [];

  function aged(id: string, minutesAgo: number) {
    db.prepare('UPDATE outbound_messages SET created_at = ? WHERE id = ?')
      .run(new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(), id);
  }

  beforeAll(() => {
    // Nettoyage des reliquats d'anciens runs de CE test uniquement :
    //  - comptes de test retry-*/repro-manual-*  -> leurs réponses sortantes
    //  - événements de test (external_id retry-test-*) -> avec user_id NULL ils
    //    pollueraient countUnread de tous les autres tests.
    db.prepare(`
      DELETE FROM outbound_messages WHERE account_id IN (
        SELECT a.id FROM accounts a JOIN users u ON u.id = a.user_id
        WHERE u.email LIKE 'retry-%@test.local' OR u.email LIKE 'repro-manual-%'
      )
    `).run();
    db.prepare(`DELETE FROM event_attachments WHERE event_id IN (
      SELECT id FROM events WHERE external_id LIKE 'retry-test-%' OR external_id LIKE 'repro-%@x'
    )`).run();
    db.prepare(`DELETE FROM events WHERE external_id LIKE 'retry-test-%' OR external_id LIKE 'repro-%@x'`).run();
    const suffix = Date.now();
    const user = createUser(`retry-${suffix}@test.local`, 'hash');
    userId = user.id;
    accountId = findOrCreateAccountForUser(user.id).id;
    eventId = randomUUID();
    addEventRow({
      id: eventId,
      connector: 'imap',
      accountId,
      // user_id explicite : un événement sans user compte comme non-lu pour tout le monde.
      userId,
      externalId: `retry-test-${suffix}@test.local`,
      kind: 'message',
      title: 'Test retry',
      body: 'corps',
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    });
  });

  afterAll(() => {
    // Nettoyage : on ne laisse rien de retentable derrière nous.
    db.prepare(`DELETE FROM outbound_messages WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
    db.prepare('DELETE FROM accounts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });

  it('les réponses récentes (< 2 min) ne sont pas reprises tout de suite', () => {
    const id = createOutbound({ eventId, connectionId: 'conn-x', accountId, to: ['a@b.c'], subject: 'Re: x', body: 'yo' });
    ids.push(id);
    expect(listRetryableOutbound().find((r) => r.id === id)).toBeUndefined();
  });

  it('une réponse échouée de plus de 2 min devient retentable, jusqu’à 3 essais', async () => {
    const id = createOutbound({ eventId, connectionId: 'conn-x', accountId, to: ['a@b.c'], subject: 'Re: x', body: 'yo' });
    ids.push(id);
    markOutboundFailed(id, 'SMTP indisponible');
    aged(id, 10);

    expect(listRetryableOutbound().find((r) => r.id === id)).toBeDefined();

    // Connexion 'conn-x' inexistante : échec définitif, essais épuisés d'office.
    await retryPendingOutbound();
    const row = db.prepare('SELECT attempts, status FROM outbound_messages WHERE id = ?').get(id) as any;
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(3);
    expect(listRetryableOutbound().find((r) => r.id === id)).toBeUndefined();
  });

  it('les envois réussis ne sont jamais retentés', () => {
    const id = createOutbound({ eventId, connectionId: 'conn-x', accountId, to: ['a@b.c'], subject: 'Re: x', body: 'yo' });
    ids.push(id);
    markOutboundSent(id, 'msg-1');
    aged(id, 30);
    expect(listRetryableOutbound().find((r) => r.id === id)).toBeUndefined();
  });
});
