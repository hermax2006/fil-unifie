import { describe, expect, it } from 'vitest';
import { validateConnectorConfig } from '../connectors/schemas.js';

describe('validateConnectorConfig', () => {
  it('accepte une config IMAP valide', () => {
    expect(validateConnectorConfig('imap', { host: 'imap.example.com', user: 'u', mailboxes: ['INBOX'] }).ok).toBe(true);
  });

  it('refuse une config IMAP sans hôte ni champ inconnu', () => {
    expect(validateConnectorConfig('imap', { user: 'u' }).ok).toBe(false);
    expect(validateConnectorConfig('imap', { host: 'imap.example.com', user: 'u', champInconnu: 1 }).ok).toBe(false);
  });

  it('valide l\'URL du flux RSS', () => {
    expect(validateConnectorConfig('rss', { url: 'pas-une-url' }).ok).toBe(false);
    expect(validateConnectorConfig('rss', { url: 'https://exemple.com/flux.xml' }).ok).toBe(true);
  });

  it('laisse passer les connecteurs sans schéma', () => {
    expect(validateConnectorConfig('webhook', { nimporte: 1 }).ok).toBe(true);
  });
});
