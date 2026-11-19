import { timingSafeEqual } from 'node:crypto';
import type { NewEvent } from '@fil/shared';
import { BaseConnector, header, type PollContext, type PollResult, type ReplyContext, type ReplyResult, type WebhookRequest } from './base.connector.js';

const API = 'https://api.telegram.org';

/** Jeton du bot, stocké chiffré côté serveur (PUT /tokens : { botToken }). */
function botToken(tokens: Record<string, unknown> | null): string {
  const token = typeof tokens?.botToken === 'string' ? tokens.botToken.trim() : '';
  if (!token) throw new Error('jeton de bot Telegram manquant (BotFather)');
  return token;
}

async function call(token: string, method: string, payload?: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok || !data?.ok) {
    const desc = data?.description ?? `HTTP ${res.status}`;
    if (res.status === 409) {
      throw new Error(`${desc} — le bot a un webhook actif : supprime-le (deleteWebhook) ou utilise le mode webhook`);
    }
    throw new Error(desc);
  }
  return data.result;
}

/**
 * Telegram (bot). Deux modes :
 * - polling getUpdates (par défaut, aucun domaine public requis) ;
 * - webhook (setWebhook + secret_token dans X-Telegram-Bot-Api-Secret-Token).
 * Répondre envoie un sendMessage dans la conversation d'origine.
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
    return toEvents(update, accountId);
  }

  /** Vérifie le jeton : getMe + signale un webhook actif (incompatible avec le polling). */
  async test(ctx: PollContext): Promise<unknown> {
    const token = botToken(ctx.tokens);
    const me = await call(token, 'getMe');
    const hook = await call(token, 'getWebhookInfo').catch(() => null);
    return {
      bot: me?.username ? `@${me.username}` : me?.first_name,
      webhook: hook?.url || null,
    };
  }

  async poll(ctx: PollContext): Promise<PollResult> {
    const token = botToken(ctx.tokens);
    // Curseur par ressource « updates » : offset = dernier update_id traité + 1.
    const offset = Number(ctx.resources?.updates ?? 0) || 0;
    const updates: any[] = await call(token, 'getUpdates', {
      offset: offset || undefined,
      timeout: 0,
      allowed_updates: ['message'],
    });

    const events: NewEvent[] = [];
    let nextOffset = offset;
    for (const update of updates) {
      const id = Number(update?.update_id ?? 0);
      if (id >= nextOffset) nextOffset = id + 1;
      events.push(...toEvents(update, ctx.accountId));
    }

    return {
      events,
      resourceCursors: nextOffset !== offset ? [{ resource: 'updates', cursor: String(nextOffset) }] : undefined,
    };
  }

  async reply(ctx: ReplyContext): Promise<ReplyResult> {
    const token = botToken(ctx.tokens);
    // author.id = chat.id : on répond dans la conversation d'origine (privée ou groupe).
    const chatId = ctx.to[0];
    if (!chatId) throw new Error('conversation Telegram introuvable');
    const sent = await call(token, 'sendMessage', { chat_id: chatId, text: ctx.body });
    return { messageId: sent?.message_id ? String(sent.message_id) : undefined };
  }
}

/** Convertit une update Telegram (message) en événement du fil. */
function toEvents(update: any, accountId: string): NewEvent[] {
  const m = update?.message;
  if (!m) return [];
  if (m.from?.is_bot) return []; // ignore les messages de bots (dont le nôtre)
  const text = typeof m.text === 'string' ? m.text : typeof m.caption === 'string' ? m.caption : '';
  if (!text.trim()) return [];

  const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ')
    || m.from?.username || 'Inconnu';
  const chatId = String(m.chat?.id ?? m.from?.id ?? '');

  return [{
    connector: 'telegram',
    accountId,
    externalId: `tg:${chatId}:${m.message_id}`,
    kind: 'message',
    // author.id = chat.id pour que « Répondre » retrouve la conversation.
    author: { id: chatId, name },
    body: text,
    occurredAt: new Date((m.date ?? Date.now() / 1000) * 1000).toISOString(),
  }];
}
