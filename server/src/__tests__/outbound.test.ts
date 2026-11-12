import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../db/client.js';
import { createOutbound, markOutboundFailed, markOutboundSent } from '../db/repos/outbound.repo.js';

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

  it('enregistre un échec', () => {
    const id = createOutbound({ accountId: 'acc-test', to: ['dest@example.com'], body: 'Bonjour' });
    ids.push(id);
    markOutboundFailed(id, 'SMTP refusé');

    const row = db.prepare('SELECT status, error FROM outbound_messages WHERE id = ?').get(id) as any;
    expect(row.status).toBe('failed');
    expect(row.error).toBe('SMTP refusé');
  });
});
