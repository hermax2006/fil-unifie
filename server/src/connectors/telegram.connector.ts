import { timingSafeEqual } from 'node:crypto';
import type { NewEvent } from '@fil/shared';
import { BaseConnector, header, type WebhookRequest } from './base.connector.js';

/**
 * Telegram (bot). Configure le webhook avec setWebhook en passant secret_token :
 * Telegram renvoie ce secret dans l'en-tête X-Telegram-Bot-Api-Secret-Token.
 */
export class TelegramConnector extends BaseConnector {
  readonly info = {
    id: 'telegram',
    name: 'Telegram (bot)',
    category: 'Messagerie et collaboration',
    access: 'gratuit' as const,
    canReply: true,
    status: 'available' as const,
  };

  override verifyWebhook(req: WebhookRequest, secret: string | undefined): boolean {
    const given = header(req, 'x-telegram-bot-api-secret-token');
    if (!secret || !given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  normalize(req: WebhookRequest, accountId: string): NewEvent[] {
    const update = (req.body ?? {}) as any;
    const m = update.message;
    if (!m?.text) return [];
    const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ')
      || m.from?.username || 'Inconnu';
    return [{
      connector: this.info.id,
      accountId,
      externalId: String(m.message_id),
      kind: 'message',
      author: { id: String(m.from?.id ?? ''), name },
      body: m.text,
      occurredAt: new Date((m.date ?? Date.now() / 1000) * 1000).toISOString(),
    }];
  }
}
