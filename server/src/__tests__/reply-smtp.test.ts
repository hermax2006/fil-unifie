import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SMTPServer } from 'smtp-server';
import { ImapConnector } from '../connectors/imap.connector.js';

const messages: string[] = [];
let smtp: SMTPServer;
let port = 0;

beforeAll(async () => {
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onAuth(_auth, _session, callback) {
      callback(null, { user: 'test' });
    },
    onData(stream, _session, callback) {
      let raw = '';
      stream.on('data', (chunk) => { raw += chunk.toString(); });
      stream.on('end', () => {
        messages.push(raw);
        callback();
      });
    },
  });
  await new Promise<void>((resolve, reject) => {
    smtp.once('error', reject);
    smtp.listen(0, '127.0.0.1', () => resolve());
  });
  port = (smtp.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => smtp.close(() => resolve()));
});

describe('ImapConnector.reply (SMTP local)', () => {
  it('envoie un email avec les en-têtes de threading', async () => {
    const connector = new ImapConnector();
    const result = await connector.reply({
      accountId: 'a',
      config: { host: 'imap.example.com', user: 'u', smtpHost: '127.0.0.1', smtpPort: port, smtpSecure: false },
      tokens: { pass: 'secret' },
      to: ['dest@example.com'],
      subject: 'Re: Test',
      body: 'Bonjour depuis le test',
      inReplyTo: '<orig@example.com>',
      references: ['<orig@example.com>'],
    });

    expect(result.messageId).toBeTruthy();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Subject: Re: Test');
    expect(messages[0]).toContain('In-Reply-To: <orig@example.com>');
    expect(messages[0]).toContain('Bonjour depuis le test');
  });
});
