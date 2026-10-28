import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NewEvent } from '@fil/shared';
import { BaseConnector, header, type WebhookRequest } from './base.connector.js';

/** Slack (Events API). Le secret attendu est le « Signing Secret » de l'app Slack. */
export class SlackConnector extends BaseConnector {
  readonly info = {
    id: 'slack',
    name: 'Slack',
    category: 'Messagerie et collaboration',
    access: 'gratuit' as const,
    canReply: true,
    status: 'available' as const,
  };

  override verifyWebhook(req: WebhookRequest, secret: string | undefined): boolean {
    const ts = header(req, 'x-slack-request-timestamp');
    const sig = header(req, 'x-slack-signature');
    if (!secret || !ts || !sig) return false;
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // anti-rejeu
    const base = `v0:${ts}:${req.rawBody.toString('utf8')}`;
    const expected = 'v0=' + createHmac('sha256', secret).update(base).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  override handshake(req: WebhookRequest): unknown | undefined {
    const b = req.body as any;
    return b?.type === 'url_verification' ? { challenge: b.challenge } : undefined;
  }

  normalize(req: WebhookRequest, accountId: string): NewEvent[] {
    const b = req.body as any;
    const e = b?.event;
    if (b?.type !== 'event_callback' || !e) return [];
    if (e.type !== 'message' && e.type !== 'app_mention') return [];
    if (e.subtype || !e.text) return []; // ignore éditions, bots, etc.
    return [{
      connector: this.info.id,
      accountId,
      externalId: e.ts,
      kind: e.type === 'app_mention' ? 'mention' : 'message',
      author: { id: e.user, name: e.user ?? 'Inconnu' },
      body: e.text,
      occurredAt: new Date(Number(e.ts) * 1000).toISOString(),
    }];
  }
}
