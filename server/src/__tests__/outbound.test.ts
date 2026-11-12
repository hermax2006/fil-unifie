import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db/client.js';
import { createOutbound, markOutboundFailed, markOutboundSent, listOutboundForEvent, listOutboundForAccounts } from '../db/repos/outbound.repo.js';

const ids: string[] = [];

afterEach(() => {
  for (const id of ids.splice(0)) {
    db.prepare('DELETE FROM outbound_messages WHERE id = ?').run(id);
  }
});

describe('outbound_messages', () => {
  it('enregistre une réponse envoyée', () => {
    const id = createOutbound({
      accountId: 'acc-test',
      to: ['dest@example.com'],
      subject: 'Re: Test',
      body: 'Bonjour',
    });
    ids.push(id);
    markOutboundSent(id, '<msg@example.com>');

    const row = db.prepare('SELECT status, provider_message_id FROM outbound_messages WHERE id = ?').get(id) as any;
    expect(row.status).toBe('sent');
    expect(row.provider_message_id).toBe('<msg@example.com>');
  });

  it('liste l historique par événement et par compte', () => {
    const eventId = `evt-${randomUUID()}`;
    const id = createOutbound({ eventId, accountId: 'acc-list', to: ['a@b.c'], subject: 'Re: X', body: 'ok' });
    ids.push(id);
    markOutboundSent(id, '<m@example.com>');

    expect(listOutboundForEvent(eventId)).toHaveLength(1);
    expect(listOutboundForEvent(eventId)[0].status).toBe('sent');
    expect(listOutboundForAccounts(['acc-list'])).toHaveLength(1);
    expect(listOutboundForAccounts(['autre-compte'])).toHaveLength(0);
  });

  it('enregistre un échec', () => {
    const id = createOutbound({ accountId: 'acc-test', to: ['dest@example.com'], body: 'Bonjour' });
    ids.push(id);
    markOutboundFailed(id, 'SMTP refusé');

    const row = db.prepare('SELECT status, error FROM outbound_messages WHERE id = ?').get(id) as any;
    expect(row.status).toBe('failed');
    expect(row.error).toBe('SMTP refusé');
  });
});
