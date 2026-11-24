import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NewEvent } from '@fil/shared';
import { BaseConnector, header, type ReplyContext, type ReplyResult, type WebhookRequest } from './base.connector.js';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Slack.
 * - Lecture : Events API (webhook signé par le *Signing Secret* de l'app).
 *   Le secret de l'endpoint sert de repli, sinon `SLACK_SIGNING_SECRET` est utilisé.
 * - Réponse : `chat.postMessage` avec le bot token obtenu par OAuth.
 *   L'identifiant externe contient `slack:<canal>:<ts>` pour répondre dans le fil.
 */
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
    // Slack signe toujours avec le Signing Secret de l'app (pas celui de l'endpoint).
    const signingSecret = process.env.SLACK_SIGNING_SECRET || secret;
    if (!signingSecret || !ts || !sig) return false;
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // anti-rejeu
    const base = `v0:${ts}:${req.rawBody.toString('utf8')}`;
    const expected = 'v0=' + createHmac('sha256', signingSecret).update(base).digest('hex');
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
    const channel = asString(e.channel) ?? 'inconnu';
    return [{
      connector: this.info.id,
      accountId,
      externalId: `slack:${channel}:${e.ts}`,
      kind: e.type === 'app_mention' ? 'mention' : 'message',
      author: { id: e.user, name: e.user ? `@${e.user}` : 'Inconnu' },
      body: e.text,
      url: `https://slack.com/app_redirect?channel=${encodeURIComponent(channel)}`,
      occurredAt: new Date(Number(e.ts) * 1000).toISOString(),
    }];
  }

  async reply(ctx: ReplyContext): Promise<ReplyResult> {
    const token = asString(ctx.tokens?.accessToken) ?? asString(ctx.tokens?.botToken);
    if (!token) throw new Error('Slack: jeton du bot absent — connecte Slack (OAuth)');

    // externalId = slack:<canal>:<ts> ; repli sur la cible fournie par l'UI.
    const match = /^slack:([^:]+):(.+)$/.exec(asString(ctx.inReplyTo) ?? '');
    const channel = match?.[1] ?? asString(ctx.to[0]);
    const threadTs = match?.[2];
    if (!channel) throw new Error('Slack: canal introuvable');

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text: ctx.body, thread_ts: threadTs }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; ts?: string };
    if (!data.ok) throw new Error(`Slack: ${data.error ?? `HTTP ${res.status}`}`);
    return { messageId: data.ts };
  }
}
