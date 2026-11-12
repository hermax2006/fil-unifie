import type { EventAttachment, NewEvent } from '@fil/shared';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { BaseConnector, type PollContext, type PollResult, type WebhookRequest, type ReplyContext, type ReplyResult } from './base.connector.js';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toIso(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function mailboxesFrom(config: Record<string, unknown>): string[] {
  const list = Array.isArray(config.mailboxes)
    ? config.mailboxes.map(asString).filter((m): m is string => !!m)
    : [];
  if (list.length > 0) return list;
  return [asString(config.mailbox) ?? 'INBOX'];
}

function connectionFrom(ctx: PollContext) {
  const host = asString(ctx.config.host);
  const user = asString(ctx.config.user);
  const pass = asString(ctx.tokens?.pass);
  if (!host) throw new Error('IMAP: config.host requis');
  if (!user) throw new Error('IMAP: config.user requis');
  if (!pass) throw new Error('IMAP: tokens.pass requis (mot de passe d\'application)');
  return {
    host,
    user,
    pass,
    port: asNumber(ctx.config.port, 993),
    secure: ctx.config.secure !== false,
  };
}

/** Sujet de réponse sans empiler les « Re: ». */
export function replySubject(original?: string): string {
  const title = original?.trim();
  if (!title) return 'Re: (sans objet)';
  return /^re\s*:/i.test(title) ? title : `Re: ${title}`;
}

function smtpFrom(ctx: ReplyContext) {
  const host = asString(ctx.config.smtpHost) ?? asString(ctx.config.host);
  const user = asString(ctx.config.smtpUser) ?? asString(ctx.config.user);
  const pass = asString(ctx.tokens?.smtpPass) ?? asString(ctx.tokens?.pass);
  if (!host) throw new Error('SMTP: config.smtpHost ou config.host requis');
  if (!user) throw new Error('SMTP: config.smtpUser ou config.user requis');
  if (!pass) throw new Error('SMTP: mot de passe requis (tokens.smtpPass ou tokens.pass)');
  const port = asNumber(ctx.config.smtpPort, 465);
  const secure = ctx.config.smtpSecure !== undefined ? !!ctx.config.smtpSecure : port === 465;
  const from = asString(ctx.config.from) ?? asString(ctx.config.smtpFrom) ?? user;
  return { host, port, secure, user, pass, from };
}

function makeClient(info: ReturnType<typeof connectionFrom>): ImapFlow {
  return new ImapFlow({
    host: info.host,
    port: info.port,
    secure: info.secure,
    auth: { user: info.user, pass: info.pass },
    logger: false,
    // Timeouts courts : sans eux, une connexion qui traîne bloque la requête
    // HTTP jusqu'à la coupure du proxy/navigateur (réponse vide côté client).
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

/**
 * Connecteur IMAP.
 * - config (non sensible) : host, port, secure, user, mailbox ou mailboxes[]
 * - tokens (chiffrés en BDD) : pass (mot de passe ou mot de passe d'application)
 *
 * On interroge chaque dossier depuis la dernière synchronisation, puis on
 * convertit les messages en événements. Les doublons sont éliminés par
 * dedup_key (Message-ID). Seules les métadonnées des pièces jointes sont gardées.
 */
export class ImapConnector extends BaseConnector {
  readonly info = {
    id: 'imap',
    name: 'IMAP (mail)',
    category: 'Mail, agenda, fichiers',
    access: 'gratuit' as const,
    canReply: true,
    status: 'available' as const,
  };

  normalize(_req: WebhookRequest, _accountId: string): NewEvent[] {
    return [];
  }

  async test(ctx: PollContext): Promise<Record<string, unknown>> {
    const info = connectionFrom(ctx);
    const configured = mailboxesFrom(ctx.config);
    const client = makeClient(info);
    try {
      await client.connect();
      const list = await client.list();
      const mailboxes = list.map((m) => m.path);
      const missing = configured.filter((m) => !mailboxes.includes(m));
      return { ok: true, configured, mailboxes, missing };
    } finally {
      try {
        await client.logout();
      } catch {
        // Connexion déjà fermée.
      }
    }
  }

  async reply(ctx: ReplyContext): Promise<ReplyResult> {
    const smtp = smtpFrom(ctx);
    const to = ctx.to.map(asString).filter((v): v is string => !!v);
    if (to.length === 0) throw new Error('SMTP: destinataire requis');

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });

    const info = await transporter.sendMail({
      from: smtp.from,
      to,
      subject: ctx.subject ?? replySubject(),
      text: ctx.body,
      inReplyTo: ctx.inReplyTo,
      references: ctx.references?.length ? ctx.references : ctx.inReplyTo,
    });

    return { messageId: info.messageId };
  }

  async poll(ctx: PollContext): Promise<PollResult> {
    const info = connectionFrom(ctx);
    const mailboxes = mailboxesFrom(ctx.config);
    const now = new Date().toISOString();

    // IMAP ne filtre qu'à la journée : on prend une marge d'un jour.
    // Les doublons sont rejetés ensuite par dedup_key.
    const since = ctx.lastPolledAt
      ? new Date(new Date(ctx.lastPolledAt).getTime() - 24 * 60 * 60 * 1000)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const client = makeClient(info);

    const events: NewEvent[] = [];
    try {
      await client.connect();

      for (const mailbox of mailboxes) {
        if (events.length >= 20) break;

        let lock;
        try {
          lock = await client.getMailboxLock(mailbox);
        } catch (err) {
          console.error(`IMAP: dossier "${mailbox}" inaccessible`, err);
          continue;
        }

        try {
          for await (const message of client.fetch(
            { since },
            { envelope: true, source: true, internalDate: true, uid: true },
            { uid: true },
          )) {
            if (events.length >= 20) break;

            const envelope = message.envelope;
            const subject = asString(envelope?.subject) ?? '(sans objet)';
            const from = envelope?.from?.[0];
            let body = subject;
            let attachments: EventAttachment[] | undefined;

            if (message.source) {
              try {
                const parsed = await simpleParser(message.source);
                const htmlText = typeof parsed.html === 'string' ? parsed.html.replace(/<[^>]*>/g, ' ') : undefined;
                body = asString(parsed.text) ?? asString(htmlText) ?? subject;
                const list = (parsed.attachments ?? [])
                  .slice(0, 20)
                  .map((a) => ({
                    filename: a.filename || 'pièce jointe',
                    contentType: a.contentType || undefined,
                    size: a.size || undefined,
                  }));
                if (list.length > 0) attachments = list;
              } catch {
                // Message MIME illisible : on garde l'objet comme corps.
              }
            }

            const occurredAt =
              toIso(message.internalDate) ??
              toIso(envelope?.date) ??
              now;

            events.push({
              connector: this.info.id,
              accountId: ctx.accountId,
              externalId: asString(envelope?.messageId) ?? `uid:${message.uid}`,
              kind: 'message',
              author: from ? { id: from.address, name: from.name || from.address || 'inconnu' } : undefined,
              title: subject,
              body: body.slice(0, 20000),
              attachments,
              occurredAt,
            });
          }
        } finally {
          lock.release();
        }
      }
    } finally {
      try {
        await client.logout();
      } catch {
        // La connexion peut déjà être fermée après une erreur réseau.
      }
    }

    return { events, cursor: now };
  }
}
