import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../connectors/registry.js';
import { listEvents, markEventRead, countUnread, countUnreadByConnector, countEvents, markAllRead, getEventForReply } from '../db/events.store.js';
import { sseHandler } from '../sse/index.js';
import { requireAuth, attachUser, type AuthRequest } from '../auth/middleware.js';
import { validateBody, validateQuery } from '../utils/validate.js';
import { getConnection, findActiveConnection } from '../db/repos/connections.repo.js';
import { createOutbound, markOutboundSent, markOutboundFailed, listOutboundForEvent, listOutboundForAccounts } from '../db/repos/outbound.repo.js';
import { listAccountsForUser } from '../db/repos/accounts.repo.js';
import { decryptToken } from '../crypto/tokens.js';
import { replySubject } from '../connectors/imap.connector.js';

export const apiRouter = Router();
const isProd = process.env.NODE_ENV === 'production';

apiRouter.get('/health', (_req, res) => void res.json({ ok: true }));
apiRouter.get('/connectors', (_req, res) => void res.json(registry.catalog()));

const eventsQuery = z.object({
  connector: z.string().optional(),
  kind: z.enum(['message', 'mention', 'notification', 'task', 'other']).optional(),
  read: z.enum(['all', 'read', 'unread']).optional().default('all'),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  q: z.string().trim().max(200).optional(),
  before: z.string().datetime({ offset: true }).optional(),
});

// En prod: auth obligatoire. En dev: on attache l'utilisateur si présent.
apiRouter.get('/events', isProd ? requireAuth : attachUser, validateQuery(eventsQuery), (req: AuthRequest, res) => {
  const q = (req as any).validatedQuery as z.infer<typeof eventsQuery>;
  void res.json(listEvents(q.limit, req.userId, {
    connector: q.connector,
    kind: q.kind,
    read: q.read,
    search: q.q,
    before: q.before,
  }));
});

apiRouter.get('/events/unread-count', isProd ? requireAuth : attachUser, (req: AuthRequest, res) => {
  // group=connector : répartition par app (menu radial), sinon le total simple.
  if (req.query.group === 'connector') {
    return void res.json({
      count: countUnread(req.userId),
      total: countEvents(req.userId),
      byConnector: countUnreadByConnector(req.userId),
    });
  }
  void res.json({ count: countUnread(req.userId), total: countEvents(req.userId) });
});

apiRouter.post('/events/read-all', isProd ? requireAuth : attachUser, (req: AuthRequest, res) => {
  void res.json({ ok: true, updated: markAllRead(req.userId) });
});

const replySchema = z.object({
  body: z.string().trim().min(1).max(20000),
  subject: z.string().trim().max(500).optional(),
  to: z.string().email().optional(),
});

apiRouter.post('/events/:id/reply', isProd ? requireAuth : attachUser, validateBody(replySchema), async (req: AuthRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const input = (req as any).validatedBody as z.infer<typeof replySchema>;

  const event = getEventForReply(id, req.userId);
  if (!event) return void res.status(404).json({ error: 'événement introuvable' });
  if (event.connector !== 'imap') {
    return void res.status(400).json({ error: 'réponse non supportée pour ce connecteur' });
  }

  const connector = registry.get('imap');
  if (!connector?.reply) return void res.status(400).json({ error: 'connecteur IMAP indisponible' });

  const connection = event.connectionId
    ? getConnection(event.connectionId, event.accountId)
    : findActiveConnection(event.accountId, 'imap');
  if (!connection) return void res.status(404).json({ error: 'connexion IMAP introuvable' });
  if (!connection.active) return void res.status(400).json({ error: 'connexion IMAP en pause' });

  const to = input.to ? [input.to] : event.author?.id ? [event.author.id] : [];
  if (to.length === 0 || !to[0]?.includes('@')) {
    return void res.status(400).json({ error: 'destinataire introuvable, précisez « to »' });
  }

  let config: Record<string, unknown> = {};
  if (connection.config_json) {
    try { config = JSON.parse(connection.config_json); } catch { config = {}; }
  }

  let tokens: Record<string, unknown> | null = null;
  if (connection.encrypted_tokens_json) {
    try {
      tokens = JSON.parse(decryptToken(connection.encrypted_tokens_json)) as Record<string, unknown>;
    } catch {
      return void res.status(500).json({ error: 'tokens IMAP illisibles (clé de chiffrement ?)' });
    }
  }

  const subject = input.subject || replySubject(event.title);
  const outboundId = createOutbound({
    eventId: event.id,
    connectionId: connection.id,
    accountId: event.accountId,
    userId: req.userId,
    to,
    subject,
    body: input.body,
  });

  try {
    const result = await connector.reply({
      accountId: event.accountId,
      config,
      tokens,
      to,
      subject,
      body: input.body,
      inReplyTo: event.externalId,
      references: event.externalId ? [event.externalId] : undefined,
    });
    markOutboundSent(outboundId, result.messageId);
    return void res.json({ ok: true, id: outboundId, messageId: result.messageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markOutboundFailed(outboundId, message);
    return void res.status(502).json({ error: message });
  }
});

// Téléchargement d'une pièce jointe à la demande : on ne garde pas le contenu
// en base, on le re-récupère depuis la source (IMAP) avec les tokens chiffrés.
apiRouter.get('/events/:id/attachments/:index', isProd ? requireAuth : attachUser, async (req: AuthRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const idx = Number(req.params.index);
  const event = getEventForReply(id, req.userId);
  if (!event) return void res.status(404).json({ error: 'événement introuvable' });

  const att = event.attachments?.[idx];
  if (!att) return void res.status(404).json({ error: 'pièce jointe introuvable' });

  if (!event.connectionId) return void res.status(400).json({ error: 'cette source ne permet pas le téléchargement' });
  const connection = getConnection(event.connectionId, event.accountId);
  if (!connection) return void res.status(404).json({ error: 'connexion source supprimée' });

  const connector = registry.get(event.connector);
  if (!connector?.downloadAttachment) return void res.status(501).json({ error: 'téléchargement non supporté pour ce connecteur' });

  // Repli pour les anciens événements : Message-ID quand l'UID n'est pas connu.
  const externalId = event.externalId;
  const uidFromExternal = externalId?.startsWith('uid:') ? Number(externalId.slice(4)) : undefined;

  try {
    const { content, contentType } = await connector.downloadAttachment(
      {
        accountId: event.accountId,
        config: connection.config_json ? JSON.parse(connection.config_json) : {},
        tokens: connection.encrypted_tokens_json ? JSON.parse(decryptToken(connection.encrypted_tokens_json)) : null,
      },
      {
        filename: att.filename,
        mailbox: att.mailbox,
        uid: att.uid ?? (Number.isFinite(uidFromExternal) ? uidFromExternal : undefined),
        index: att.index,
        messageId: !externalId?.startsWith('uid:') ? externalId : undefined,
      },
    );
    // Nom de fichier ASCII sûr + version UTF-8 pour les accents.
    const safeName = att.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(att.filename)}`);
    return void res.type(contentType ?? 'application/octet-stream').send(content);
  } catch (err: any) {
    return void res.status(502).json({ error: err?.message || 'erreur lors du téléchargement' });
  }
});

apiRouter.get('/events/:id/outbound', isProd ? requireAuth : attachUser, (req: AuthRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const event = getEventForReply(id, req.userId);
  if (!event) return void res.status(404).json({ error: 'événement introuvable' });
  return void res.json(listOutboundForEvent(id, req.userId));
});

const outboundQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  accountId: z.string().optional(),
});

apiRouter.get('/outbound', isProd ? requireAuth : attachUser, validateQuery(outboundQuery), (req: AuthRequest, res) => {
  const q = (req as any).validatedQuery as z.infer<typeof outboundQuery>;
  if (req.userId) {
    const accounts = listAccountsForUser(req.userId).map((a) => a.id);
    return void res.json(listOutboundForAccounts(accounts, q.limit));
  }
  if (!isProd && q.accountId) return void res.json(listOutboundForAccounts([q.accountId], q.limit));
  return void res.status(400).json({ error: 'accountId requis' });
});

apiRouter.post('/events/:id/read', isProd ? requireAuth : attachUser, (req: AuthRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const ok = markEventRead(id, req.userId);
  if (!ok) return void res.status(404).json({ error: 'événement introuvable' });
  void res.json({ ok: true });
});

apiRouter.get('/stream', sseHandler);
