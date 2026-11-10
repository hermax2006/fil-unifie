import { timingSafeEqual } from 'node:crypto';
import type { NewEvent, EventKind, EventAttachment } from '@fil/shared';
import { BaseConnector, header, type WebhookRequest } from './base.connector.js';

/** Webhook générique : toute app ou script capable d'envoyer du JSON peut alimenter le fil. */
export class WebhookConnector extends BaseConnector {
  readonly info = {
    id: 'webhook',
    name: 'Webhook générique',
    category: 'Standards universels',
    access: 'gratuit' as const,
    canReply: false,
    status: 'available' as const,
  };

  override verifyWebhook(req: WebhookRequest, secret: string | undefined): boolean {
    const given = header(req, 'x-webhook-secret');
    if (!secret || !given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  normalize(req: WebhookRequest, accountId: string): NewEvent[] {
    const p = (req.body ?? {}) as Record<string, unknown>;
    const kinds: EventKind[] = ['message', 'mention', 'notification', 'task', 'other'];
    const kind = kinds.includes(p.kind as EventKind) ? (p.kind as EventKind) : 'notification';
    const body = typeof p.body === 'string' ? p.body : JSON.stringify(p);
    const attachments: EventAttachment[] | undefined = Array.isArray(p.attachments)
      ? p.attachments
          .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
          .map((a) => ({
            filename: typeof a.filename === 'string' ? a.filename : 'pièce jointe',
            contentType: typeof a.contentType === 'string' ? a.contentType : undefined,
            size: typeof a.size === 'number' ? a.size : undefined,
          }))
      : undefined;
    return [{
      connector: this.info.id,
      accountId,
      kind,
      author: typeof p.author === 'string' ? { name: p.author } : undefined,
      title: typeof p.title === 'string' ? p.title : undefined,
      body,
      url: typeof p.url === 'string' ? p.url : undefined,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      occurredAt: new Date().toISOString(),
    }];
  }
}
