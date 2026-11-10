import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { WebhookConnector } from '../connectors/webhook.connector.js';
import { TelegramConnector } from '../connectors/telegram.connector.js';
import { SlackConnector } from '../connectors/slack.connector.js';
import type { WebhookRequest } from '../connectors/base.connector.js';

function wr(headers: Record<string, string>, body: unknown): WebhookRequest {
  const raw = Buffer.from(JSON.stringify(body ?? {}));
  return { headers, rawBody: raw, body };
}

describe('WebhookConnector', () => {
  const c = new WebhookConnector();
  it('verifies x-webhook-secret', () => {
    expect(c.verifyWebhook(wr({ 'x-webhook-secret': 'abc' }, {}), 'abc')).toBe(true);
    expect(c.verifyWebhook(wr({ 'x-webhook-secret': 'wrong' }, {}), 'abc')).toBe(false);
    expect(c.verifyWebhook(wr({}, {}), 'abc')).toBe(false);
  });
  it('normalizes payload', () => {
    const ev = c.normalize(wr({}, { kind: 'message', body: 'hi', author: 'me', title: 't' }), 'acc');
    expect(ev).toHaveLength(1);
    expect(ev[0].connector).toBe('webhook');
    expect(ev[0].accountId).toBe('acc');
    expect(ev[0].kind).toBe('message');
    expect(ev[0].body).toBe('hi');
    expect(ev[0].author?.name).toBe('me');
  });
  it('normalise les métadonnées de pièces jointes', () => {
    const ev = c.normalize(wr({}, {
      body: 'avec pièce jointe',
      attachments: [
        { filename: 'a.pdf', contentType: 'application/pdf', size: 1234 },
        { filename: 'b.png' },
        { size: 10 },
      ],
    }), 'acc');
    expect(ev[0].attachments).toEqual([
      { filename: 'a.pdf', contentType: 'application/pdf', size: 1234 },
      { filename: 'b.png', contentType: undefined, size: undefined },
      { filename: 'pièce jointe', contentType: undefined, size: 10 },
    ]);
  });
});

describe('TelegramConnector', () => {
  const c = new TelegramConnector();
  it('verifies telegram secret header', () => {
    expect(c.verifyWebhook(wr({ 'x-telegram-bot-api-secret-token': 'tok' }, {}), 'tok')).toBe(true);
    expect(c.verifyWebhook(wr({ 'x-telegram-bot-api-secret-token': 'x' }, {}), 'tok')).toBe(false);
  });
  it('normalizes message update', () => {
    const body = { message: { message_id: 1, date: 1700000000, text: 'hello', from: { id: 7, first_name: 'A' } } };
    const ev = c.normalize(wr({}, body), 'acc');
    expect(ev).toHaveLength(1);
    expect(ev[0].externalId).toBe('1');
    expect(ev[0].body).toBe('hello');
    expect(ev[0].author?.name).toBe('A');
  });
});

describe('SlackConnector', () => {
  const c = new SlackConnector();
  it('verifies slack HMAC signature', () => {
    const secret = 'signing-secret';
    const ts = String(Math.floor(Date.now() / 1000));
    const body = { type: 'event_callback' };
    const raw = Buffer.from(JSON.stringify(body));
    const base = `v0:${ts}:${raw.toString('utf8')}`;
    const sig = 'v0=' + createHmac('sha256', secret).update(base).digest('hex');
    expect(c.verifyWebhook({ headers: { 'x-slack-request-timestamp': ts, 'x-slack-signature': sig }, rawBody: raw, body }, secret)).toBe(true);
    expect(c.verifyWebhook({ headers: { 'x-slack-request-timestamp': ts, 'x-slack-signature': 'v0=bad' }, rawBody: raw, body }, secret)).toBe(false);
  });
  it('handles url_verification handshake', () => {
    expect(c.handshake(wr({}, { type: 'url_verification', challenge: 'abc' }))).toEqual({ challenge: 'abc' });
  });
});
