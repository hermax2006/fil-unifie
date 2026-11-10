import { describe, expect, it } from 'vitest';
import { ImapConnector } from '../connectors/imap.connector.js';
import { registry } from '../connectors/registry.js';

describe('ImapConnector', () => {
  it('exige host, user puis tokens.pass', async () => {
    const connector = new ImapConnector();
    await expect(connector.poll({ accountId: 'a', config: {}, tokens: null }))
      .rejects.toThrow(/config\.host/);
    await expect(connector.poll({ accountId: 'a', config: { host: 'imap.example.com' }, tokens: null }))
      .rejects.toThrow(/config\.user/);
    await expect(connector.poll({ accountId: 'a', config: { host: 'imap.example.com', user: 'u' }, tokens: null }))
      .rejects.toThrow(/tokens\.pass/);
  });

  it('est disponible dans le registre', () => {
    expect(registry.get('imap')?.info.status).toBe('available');
  });
});
