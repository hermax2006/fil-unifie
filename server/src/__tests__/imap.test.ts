import { describe, expect, it } from 'vitest';
import { ImapConnector, replySubject } from '../connectors/imap.connector.js';
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

  it('prépare le sujet de réponse sans empiler Re:', () => {
    expect(replySubject('Bonjour')).toBe('Re: Bonjour');
    expect(replySubject('Re: Bonjour')).toBe('Re: Bonjour');
    expect(replySubject('RE : Bonjour')).toBe('RE : Bonjour');
    expect(replySubject()).toBe('Re: (sans objet)');
  });

  it('refuse une réponse sans configuration SMTP', async () => {
    const connector = new ImapConnector();
    await expect(connector.reply({ accountId: 'a', config: {}, tokens: null, to: ['x@y.z'], body: 'hi' }))
      .rejects.toThrow(/SMTP/);
    await expect(connector.reply({ accountId: 'a', config: { host: 'imap.example.com', user: 'u' }, tokens: null, to: ['x@y.z'], body: 'hi' }))
      .rejects.toThrow(/mot de passe/);
  });

  it('est disponible dans le registre', () => {
    expect(registry.get('imap')?.info.status).toBe('available');
  });
});
