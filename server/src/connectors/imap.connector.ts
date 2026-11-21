import type { EventAttachment, NewEvent } from '@fil/shared';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { BaseConnector, type PollContext, type PollResult, type WebhookRequest, type ReplyContext, type ReplyResult, type AttachmentRef, type DownloadAttachmentResult } from './base.connector.js';

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
  // Google affiche le mot de passe d'application avec des espaces (« xxxx xxxx xxxx xxxx ») :
  // on les retire automatiquement pour éviter un échec d'authentification bête.
  const pass = (asString(ctx.tokens?.pass) ?? '').replace(/\s+/g, '');
  // Compte connecté via OAuth (Google) : XOAUTH2, pas de mot de passe.
  const accessToken = asString(ctx.tokens?.accessToken);
  const oauth = ctx.tokens?.authType === 'oauth2' && !!accessToken;
  if (!host) throw new Error('IMAP: config.host requis');
  if (!user) throw new Error('IMAP: config.user requis');
  if (!oauth && !pass) throw new Error('IMAP: tokens.pass ou jeton OAuth requis');
  return {
    host,
    user,
    pass,
    accessToken,
    oauth,
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
  const pass = ((asString(ctx.tokens?.smtpPass) ?? asString(ctx.tokens?.pass)) ?? '').replace(/\s+/g, '');
  const accessToken = asString(ctx.tokens?.accessToken);
  const oauth = ctx.tokens?.authType === 'oauth2' && !!accessToken;
  if (!host) throw new Error('SMTP: config.smtpHost ou config.host requis');
  if (!user) throw new Error('SMTP: config.smtpUser ou config.user requis');
  if (!oauth && !pass) throw new Error('SMTP: mot de passe ou jeton OAuth requis');
  const port = asNumber(ctx.config.smtpPort, 465);
  const secure = ctx.config.smtpSecure !== undefined ? !!ctx.config.smtpSecure : port === 465;
  const from = asString(ctx.config.from) ?? asString(ctx.config.smtpFrom) ?? user;
  const auth = oauth
    ? { type: 'OAuth2' as const, user, accessToken: accessToken! }
    : { user, pass };
  return { host, port, secure, user, pass, accessToken, oauth, from, auth };
}

/** Rend les erreurs IMAP lisibles : imapflow renvoie « Command failed » sans le détail du serveur. */
function imapError(err: unknown): Error {
  const e = err as { message?: string; response?: string; text?: string };
  const detail = e?.response ?? e?.text;
  return new Error(detail ? `IMAP: ${e.message} — ${detail}` : `IMAP: ${e.message ?? String(err)}`);
}

function makeClient(info: ReturnType<typeof connectionFrom>): ImapFlow {
  return new ImapFlow({
    host: info.host,
    port: info.port,
    secure: info.secure,
    // XOAUTH2 (Google) ou mot de passe/mot de passe d'application.
    auth: info.oauth ? { user: info.user, accessToken: info.accessToken! } : { user: info.user, pass: info.pass },
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
    // Selon le serveur, l'échec remonte au connect() (rejet) ou plus tard
    // (socket coupée -> « Connection not available ») : on garde l'erreur d'origine.
    let clientError: unknown = null;
    client.on('error', (err) => { clientError = err; });
    try {
      await client.connect();
      const list = await client.list();
      const mailboxes = list.map((m) => m.path);
      const missing = configured.filter((m) => !mailboxes.includes(m));
      return { ok: true, configured, mailboxes, missing };
    } catch (err) {
      throw imapError(clientError ?? err);
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
      auth: smtp.auth as any,
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

  /**
   * Télécharge le contenu d'une pièce jointe à la demande.
   * Stratégie :
   *  - dossier + UID connus (nouveaux événements) -> fetch direct,
   *  - sinon recherche du message par Message-ID dans les dossiers configurés
   *    (anciens événements, qui n'avaient pas ces métadonnées).
   */
  async downloadAttachment(ctx: PollContext, params: AttachmentRef): Promise<DownloadAttachmentResult> {
    const info = connectionFrom(ctx);
    const mailboxes = params.mailbox ? [params.mailbox] : mailboxesFrom(ctx.config);
    const client = makeClient(info);
    try {
      await client.connect();
      for (const mailbox of mailboxes) {
        let lock;
        try {
          lock = await client.getMailboxLock(mailbox);
        } catch {
          continue; // dossier inaccessible : on essaie le suivant
        }
        try {
          // Cible du message : par UID direct, sinon par recherche Message-ID.
          let uids: number[] = [];
          if (params.uid) {
            uids = [params.uid];
          } else if (params.messageId) {
            const found = (await client.search({ header: { 'message-id': params.messageId } }, { uid: true })) || [];
            uids = found.map(Number).filter((n) => Number.isFinite(n) && n > 0);
          }
          for (const uid of uids) {
            for await (const message of client.fetch({ uid }, { source: true }, { uid: true })) {
              if (!message.source) continue;
              let parsed;
              try {
                parsed = await simpleParser(message.source);
              } catch {
                continue;
              }
              const list = parsed.attachments ?? [];
              const att =
                (params.index !== undefined ? list[params.index] : undefined) ??
                list.find((a) => a.filename === params.filename);
              if (att?.content) {
                return { content: att.content as Buffer, contentType: att.contentType };
              }
            }
          }
        } finally {
          lock.release();
        }
      }
      throw new Error('IMAP: pièce jointe introuvable (ou déplacée)');
    } catch (err) {
      throw imapError(err);
    } finally {
      try {
        await client.logout();
      } catch {
        // Connexion déjà fermée.
      }
    }
  }

  async poll(ctx: PollContext): Promise<PollResult> {
    const info = connectionFrom(ctx);
    const mailboxes = mailboxesFrom(ctx.config);
    const now = new Date().toISOString();

    const client = makeClient(info);

    const events: NewEvent[] = [];
    const resourceCursors: { resource: string; cursor: string }[] = [];

    try {
      await client.connect();

      for (const mailbox of mailboxes) {
        if (events.length >= 20) break;

        // Curseur PAR dossier : on ne rattrape que le nouveau contenu de CE dossier.
        // (Fenêtre de 24 h de marge : les doublons sont éliminés par dedup_key.)
        const mailboxCursor = ctx.resources?.[`mailbox:${mailbox}`] ?? ctx.lastPolledAt;
        const since = mailboxCursor
          ? new Date(new Date(mailboxCursor).getTime() - 24 * 60 * 60 * 1000)
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        let lock;
        try {
          lock = await client.getMailboxLock(mailbox);
        } catch (err) {
          console.error(`IMAP: dossier "${mailbox}" inaccessible`, err);
          continue;
        }

        let latestInternalDate: string | undefined;

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
                  .map((a, i) => ({
                    filename: a.filename || 'pièce jointe',
                    contentType: a.contentType || undefined,
                    size: a.size || undefined,
                    // Où retrouver le contenu si l'utilisateur veut le télécharger.
                    mailbox,
                    uid: message.uid,
                    index: i,
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

            // Le curseur du dossier avance jusqu'au message le plus récent vu.
            if (!latestInternalDate || occurredAt > latestInternalDate) latestInternalDate = occurredAt;

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

        if (latestInternalDate) {
          resourceCursors.push({ resource: `mailbox:${mailbox}`, cursor: latestInternalDate });
        }
      }
    } finally {
      try {
        await client.logout();
      } catch {
        // La connexion peut déjà être fermée après une erreur réseau.
      }
    }

    return { events, cursor: now, resourceCursors };
  }
}
