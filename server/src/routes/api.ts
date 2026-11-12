import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../connectors/registry.js';
import { listEvents, markEventRead, countUnread, markAllRead, getEventForReply } from '../db/events.store.js';
import { sseHandler } from '../sse/index.js';
import { requireAuth, attachUser, type AuthRequest } from '../auth/middleware.js';
import { validateBody, validateQuery } from '../utils/validate.js';
import { getConnection, findActiveConnection } from '../db/repos/connections.repo.js';
import { createOutbound, markOutboundSent, markOutboundFailed } from '../db/repos/outbound.repo.js';
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
  void res.json({ count: countUnread(req.userId) });
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

apiRouter.post('/events/:id/read', isProd ? requireAuth : attachUser, (req: AuthRequest, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const ok = markEventRead(id, req.userId);
  if (!ok) return void res.status(404).json({ error: 'événement introuvable' });
  void res.json({ ok: true });
});

apiRouter.get('/stream', sseHandler);
